import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from 'generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { parseProductImport } from './product-import.parser';

@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(payload: unknown) {
    const { products, warnings, errors, total, dryRun, format } =
      parseProductImport(payload);
    const report = { total, valid: products.length, dryRun, errors, warnings };

    if (errors.length || dryRun) {
      return { ...report, imported: 0 };
    }

    await this.prisma
      .$transaction(
        async (tx) => {
          const categories = new Map<string, string>();
          const categoryNames = [
            ...new Set(products.map((product) => product.category)),
          ].sort();
          for (const name of categoryNames) {
            // Updating the name to itself lets Prisma use PostgreSQL's native upsert.
            const category = await tx.category.upsert({
              where: { name },
              create: { name },
              update: { name },
              select: { id: true },
            });
            categories.set(name, category.id);
          }

          // Acquire row locks in the same order in every batch.
          products.sort((a, b) => (a.data.sku < b.data.sku ? -1 : 1));
          for (const { data, category, images, source } of products) {
            const { translations, ...fields } = data;
            const values = { ...fields, categoryId: categories.get(category) };
            const product = await tx.product.upsert({
              where: { sku: data.sku },
              create: values,
              update: values,
              select: { id: true, translations: true },
            });
            const previous = product.translations as typeof translations | null;
            const nextTranslations = { ...previous };
            for (const [language, translation] of Object.entries(
              translations,
            )) {
              nextTranslations[language] = {
                ...previous?.[language],
                ...translation,
              };
            }
            await tx.product.update({
              where: { id: product.id },
              data: { translations: nextTranslations },
            });
            await tx.productImportSource.upsert({
              where: { productId_format: { productId: product.id, format } },
              create: { productId: product.id, format, data: source },
              update: { data: source },
            });

            const existingImages = await tx.productImage.findMany({
              where: { productId: product.id },
              orderBy: [
                { managed: 'desc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
            });
            const staleImageIds = new Set(
              existingImages.map((image) => image.id),
            );
            const newImages: Prisma.ProductImageCreateManyInput[] = [];
            for (const [position, url] of images.entries()) {
              const imageData = { url, position, isMain: position === 0 };
              const existing = existingImages.find(
                (image) => image.url === url,
              );
              if (existing) {
                staleImageIds.delete(existing.id);
                if (
                  existing.position !== position ||
                  existing.isMain !== imageData.isMain
                ) {
                  await tx.productImage.update({
                    where: { id: existing.id },
                    data: imageData,
                  });
                }
              } else {
                newImages.push({
                  ...imageData,
                  productId: product.id,
                  altText: data.title,
                  managed: false,
                });
              }
            }
            if (staleImageIds.size) {
              await tx.productImage.deleteMany({
                where: { id: { in: [...staleImageIds] } },
              });
            }
            if (newImages.length)
              await tx.productImage.createMany({ data: newImages });
          }
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          throw new ConflictException(
            'Concurrent catalog change. Retry the import.',
          );
        }
        throw error;
      });

    return { ...report, imported: products.length };
  }
}
