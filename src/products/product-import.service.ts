import {
  ConflictException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { previewProductImport } from './product-import-preview';
import {
  findImportImages,
  getImportImageMetadata,
  getImportInsertValue,
  getImportUpdateValue,
  importTranslationUpdate,
  productImportColumn,
  productImportColumns,
} from './product-import-values';
import {
  type ImportProduct,
  parseProductImport,
} from './product-import.parser';
import { ProductImportCurrencyService } from './product-import-currency.service';

export type ProductImportCurrencyOptions = { enabled: boolean; token?: string };

export type ProductImportProgress = {
  phase: 'validating' | 'writing' | 'committing';
  processed: number;
  total: number;
};

const WRITE_GROUP_SIZE = 50;

function productKey(data: ImportProduct['data']) {
  return data.sku == null ? 'id:' + data.id : 'sku:' + data.sku;
}

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: ProductImportCurrencyService,
  ) {}

  async import(
    payload: unknown,
    onProgress?: (progress: ProductImportProgress) => void,
    options?: ProductImportCurrencyOptions,
  ) {
    const { products, warnings, errors, total, dryRun, format } =
      parseProductImport(payload, (processed, total) =>
        onProgress?.({ phase: 'validating', processed, total }),
      );
    const conversion =
      options?.enabled && !errors.length
        ? await this.currency.convert(products, format, dryRun, options.token)
        : undefined;
    for (const product of products) {
      const prices = conversion?.pricesByRow.get(product.row);
      if (prices) product.data.convertedPrices = prices;
    }
    const report = {
      total,
      valid: products.length,
      dryRun,
      errors,
      warnings,
      conversion: conversion?.report,
    };

    if (errors.length) return { ...report, imported: 0 };
    if (dryRun) {
      const preview = await previewProductImport(this.prisma, products);
      return { ...report, imported: 0, preview };
    }

    onProgress?.({ phase: 'writing', processed: 0, total });
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const names = [
            ...new Set(products.map(({ category }) => category)),
          ].sort();
          await tx.category.createMany({
            data: names.map((name) => ({ name })),
            skipDuplicates: true,
          });
          const categories = new Map(
            (
              await tx.category.findMany({
                where: { name: { in: names } },
                select: { id: true, name: true },
              })
            ).map(({ id, name }) => [name, id]),
          );

          // All import requests acquire product locks in the same order.
          products.sort((a, b) =>
            productKey(a.data) < productKey(b.data) ? -1 : 1,
          );
          for (
            let offset = 0;
            offset < products.length;
            offset += WRITE_GROUP_SIZE
          ) {
            const group = products.slice(offset, offset + WRITE_GROUP_SIZE);
            const ids = new Map([
              ...(await this.upsertProducts(
                tx,
                group.filter(({ data }) => data.sku != null),
                categories,
                'sku',
              )),
              ...(await this.upsertProducts(
                tx,
                group.filter(({ data }) => data.sku == null),
                categories,
                'id',
              )),
            ]);

            const sources = group.map(({ data, source }) => ({
              productId: ids.get(productKey(data)),
              format,
              data: source,
            }));
            await tx.$executeRaw`
              INSERT INTO "ProductImportSource" ("productId", format, data)
              SELECT "productId", format, data
              FROM jsonb_populate_recordset(NULL::"ProductImportSource", ${JSON.stringify(sources)}::jsonb)
              ON CONFLICT ("productId", format) DO UPDATE SET data = EXCLUDED.data
            `;

            await this.syncImages(tx, group, ids);
            onProgress?.({
              phase: 'writing',
              processed: offset + group.length,
              total,
            });
          }
          onProgress?.({ phase: 'committing', processed: total, total });
        },
        { timeout: 120_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          throw new ConflictException(
            'Concurrent catalog change. Retry the import.',
          );
        }
        if (error.code === 'P2028') {
          throw new GatewayTimeoutException(
            'The import transaction expired. No products were imported. Try a smaller batch.',
          );
        }
      }
      throw error;
    }

    return { ...report, imported: products.length };
  }

  private async upsertProducts(
    tx: Prisma.TransactionClient,
    group: ImportProduct[],
    categories: Map<string, string>,
    identity: 'sku' | 'id',
  ) {
    if (!group.length) return new Map<string, string>();
    const conflictColumn = Prisma.raw(identity);
    const values = group.map(({ data, category }) => ({
      ...data,
      categoryId: categories.get(category),
    }));
    const suppliedFields = JSON.stringify(
      Object.fromEntries(
        values.map(({ sku, id, ...fields }) => [sku ?? id, fields]),
      ),
    );

    const supplied = Prisma.sql`((SELECT fields FROM supplied) -> EXCLUDED.${conflictColumn})`;
    const update = productImportColumns.map(
      (field) => Prisma.sql`
      ${productImportColumn(field)} = ${getImportUpdateValue(field, supplied)}
    `,
    );
    const insert = productImportColumns.map(getImportInsertValue);
    // The JSON key test preserves omitted values while allowing explicit nulls.
    const saved = await tx.$queryRaw<{ id: string; sku: string }[]>`
      WITH supplied AS (SELECT ${suppliedFields}::jsonb AS fields)
      INSERT INTO "Product" (id, sku, ${Prisma.join(productImportColumns.map(productImportColumn))},
        translations, "createdAt", "updatedAt")
      SELECT COALESCE(p.id, gen_random_uuid()::text), p.sku, ${Prisma.join(insert)},
        p.translations, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM jsonb_array_elements(${JSON.stringify(values)}::jsonb) WITH ORDINALITY AS input(data, ordinal)
      CROSS JOIN LATERAL jsonb_populate_record(NULL::"Product", input.data) AS p
      ORDER BY input.ordinal
      ON CONFLICT (${conflictColumn}) DO UPDATE SET ${Prisma.join(update)},
        "updatedAt" = CURRENT_TIMESTAMP,
        translations = ${importTranslationUpdate}
      RETURNING id, sku
    `;
    return new Map(
      saved.map((row) => [identity + ':' + row[identity], row.id]),
    );
  }

  private async syncImages(
    tx: Prisma.TransactionClient,
    group: ImportProduct[],
    ids: Map<string, string>,
  ) {
    const existingImages = await findImportImages(tx, [...ids.values()]);
    const imagesByProduct = new Map<
      string,
      Map<string, (typeof existingImages)[number]>
    >();
    const staleIds = new Set<string>();
    for (const image of existingImages) {
      let imagesByUrl = imagesByProduct.get(image.productId);
      if (!imagesByUrl) {
        imagesByUrl = new Map();
        imagesByProduct.set(image.productId, imagesByUrl);
      }
      if (!imagesByUrl.has(image.url)) imagesByUrl.set(image.url, image);
      staleIds.add(image.id);
    }

    const create: Prisma.ProductImageCreateManyInput[] = [];
    const update: {
      id: string;
      position: number;
      isMain: boolean;
      altText: string | null;
    }[] = [];
    for (const product of group) {
      const { data, images } = product;
      const productId = ids.get(productKey(data));
      for (const [index, url] of images.entries()) {
        const existing = imagesByProduct.get(productId)?.get(url);
        const { position, isMain, altText } = getImportImageMetadata(
          product,
          url,
          index,
          existing,
        );
        if (existing) {
          staleIds.delete(existing.id);
          if (
            existing.position !== position ||
            existing.isMain !== isMain ||
            existing.altText !== altText
          ) {
            update.push({ id: existing.id, position, isMain, altText });
          }
        } else {
          create.push({
            url,
            position,
            isMain,
            productId,
            altText,
            managed: false,
          });
        }
      }
    }

    if (staleIds.size)
      await tx.productImage.deleteMany({
        where: { id: { in: [...staleIds] } },
      });
    if (update.length) {
      await tx.$executeRaw`
        UPDATE "ProductImage" AS image
        SET position = patch.position, "isMain" = patch."isMain", "altText" = patch."altText"
        FROM jsonb_to_recordset(${JSON.stringify(update)}::jsonb)
          AS patch(id text, position integer, "isMain" boolean, "altText" text)
        WHERE image.id = patch.id
      `;
    }
    if (create.length) await tx.productImage.createMany({ data: create });
  }
}
