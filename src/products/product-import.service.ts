import {
  ConflictException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  type ImportProduct,
  parseProductImport,
} from './product-import.parser';

export type ProductImportProgress = {
  phase: 'validating' | 'writing' | 'committing';
  processed: number;
  total: number;
};

const WRITE_GROUP_SIZE = 50;
const UPDATE_FIELDS = [
  'title',
  'description',
  'price',
  'currency',
  'locale',
  'slug',
  'link',
  'color',
  'brand',
  'originalPrice',
  'isPublished',
  'availability',
  'availabilityDate',
  'gtin',
  'mpn',
  'identifierExists',
  'isMadeToOrder',
  'productionTimeMinDays',
  'productionTimeMaxDays',
  'productionDayType',
  'categoryId',
] as const satisfies readonly (keyof ImportProduct['data'] | 'categoryId')[];

function column(field: (typeof UPDATE_FIELDS)[number]) {
  return Prisma.raw('"' + field + '"');
}

@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(
    payload: unknown,
    onProgress?: (progress: ProductImportProgress) => void,
  ) {
    const { products, warnings, errors, total, dryRun, format } =
      parseProductImport(payload, (processed, total) =>
        onProgress?.({ phase: 'validating', processed, total }),
      );
    const report = { total, valid: products.length, dryRun, errors, warnings };

    if (errors.length || dryRun) {
      return { ...report, imported: 0 };
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

          // All import requests acquire product locks in the same SKU order.
          products.sort((a, b) => (a.data.sku < b.data.sku ? -1 : 1));
          for (
            let offset = 0;
            offset < products.length;
            offset += WRITE_GROUP_SIZE
          ) {
            const group = products.slice(offset, offset + WRITE_GROUP_SIZE);
            const ids = await this.upsertProducts(tx, group, categories);

            const sources = group.map(({ data, source }) => ({
              productId: ids.get(data.sku),
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
  ) {
    const values = group.map(({ data, category }) => ({
      ...data,
      categoryId: categories.get(category),
    }));
    const suppliedFields = JSON.stringify(
      Object.fromEntries(values.map(({ sku, ...fields }) => [sku, fields])),
    );

    const update = UPDATE_FIELDS.map(
      (field) => Prisma.sql`
      ${column(field)} = CASE
        WHEN ((SELECT fields FROM supplied) -> EXCLUDED.sku) ? ${field}
        THEN EXCLUDED.${column(field)} ELSE "Product".${column(field)}
      END
    `,
    );
    const insert = UPDATE_FIELDS.map((field) => {
      switch (field) {
        case 'brand':
          return Prisma.sql`COALESCE(p."brand", 'KarpatMaster')`;
        case 'isPublished':
          return Prisma.sql`COALESCE(p."isPublished", true)`;
        case 'isMadeToOrder':
          return Prisma.sql`COALESCE(p."isMadeToOrder", false)`;
        default:
          return Prisma.sql`p.${column(field)}`;
      }
    });
    // The JSON key test preserves omitted values while allowing explicit nulls.
    const saved = await tx.$queryRaw<{ id: string; sku: string }[]>`
      WITH supplied AS (SELECT ${suppliedFields}::jsonb AS fields)
      INSERT INTO "Product" (id, sku, ${Prisma.join(UPDATE_FIELDS.map(column))},
        translations, "createdAt", "updatedAt",
        "secondaryMaterials", "craftsmanshipDetails", features)
      SELECT gen_random_uuid()::text, p.sku, ${Prisma.join(insert)},
        p.translations, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
        ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]
      FROM jsonb_array_elements(${JSON.stringify(values)}::jsonb) WITH ORDINALITY AS input(data, ordinal)
      CROSS JOIN LATERAL jsonb_populate_record(NULL::"Product", input.data) AS p
      ORDER BY input.ordinal
      ON CONFLICT (sku) DO UPDATE SET ${Prisma.join(update)},
        "updatedAt" = CURRENT_TIMESTAMP,
        translations = COALESCE("Product".translations, '{}'::jsonb) || (
          SELECT jsonb_object_agg(locale, COALESCE("Product".translations -> locale, '{}'::jsonb) || translation)
          FROM jsonb_each(EXCLUDED.translations) AS t(locale, translation)
        )
      RETURNING id, sku
    `;
    return new Map(saved.map(({ sku, id }) => [sku, id]));
  }

  private async syncImages(
    tx: Prisma.TransactionClient,
    group: ImportProduct[],
    ids: Map<string, string>,
  ) {
    const existingImages = await tx.productImage.findMany({
      where: { productId: { in: [...ids.values()] } },
      orderBy: [{ managed: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        productId: true,
        url: true,
        position: true,
        isMain: true,
      },
    });
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
    const update: { id: string; position: number; isMain: boolean }[] = [];
    for (const { data, images } of group) {
      const productId = ids.get(data.sku);
      for (const [position, url] of images.entries()) {
        const isMain = position === 0;
        const existing = imagesByProduct.get(productId)?.get(url);
        if (existing) {
          staleIds.delete(existing.id);
          if (existing.position !== position || existing.isMain !== isMain) {
            update.push({ id: existing.id, position, isMain });
          }
        } else {
          create.push({
            url,
            position,
            isMain,
            productId,
            altText: data.title,
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
        SET position = patch.position, "isMain" = patch."isMain"
        FROM jsonb_to_recordset(${JSON.stringify(update)}::jsonb)
          AS patch(id text, position integer, "isMain" boolean)
        WHERE image.id = patch.id
      `;
    }
    if (create.length) await tx.productImage.createMany({ data: create });
  }
}
