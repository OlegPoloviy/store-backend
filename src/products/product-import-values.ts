import { Prisma, type ProductImage } from 'generated/prisma';
import { catalogDetailColumns } from './product-catalog-fields';
import { DEFAULT_PRODUCTION_TIME } from './product-dispatch';
import type { ImportProduct } from './product-import.parser';

export const productImportColumns = [
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
  'convertedPrices',
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
  ...catalogDetailColumns,
  'categoryId',
] as const satisfies readonly (keyof ImportProduct['data'] | 'categoryId')[];

type ImportColumn = (typeof productImportColumns)[number];

export function productImportColumn(field: ImportColumn) {
  return Prisma.raw('"' + field + '"');
}

export function getImportInsertValue(field: ImportColumn) {
  const incoming = Prisma.sql`p.${productImportColumn(field)}`;
  switch (field) {
    case 'brand':
      return Prisma.sql`COALESCE(${incoming}, 'KarpatMaster')`;
    case 'isPublished':
    case 'handmade':
      return Prisma.sql`COALESCE(${incoming}, true)`;
    case 'isMadeToOrder':
      return Prisma.sql`COALESCE(${incoming}, false)`;
    case 'secondaryMaterials':
    case 'craftsmanshipDetails':
    case 'features':
      return Prisma.sql`COALESCE(${incoming}, ARRAY[]::text[])`;
    case 'productionTimeMinDays':
    case 'productionTimeMaxDays':
      return Prisma.sql`COALESCE(${incoming}, CASE WHEN p."isMadeToOrder"
        THEN ${DEFAULT_PRODUCTION_TIME[field]}::integer END)`;
    case 'productionDayType':
      return Prisma.sql`COALESCE(${incoming}, CASE WHEN p."isMadeToOrder"
        THEN ${DEFAULT_PRODUCTION_TIME.productionDayType}::"ProductionDayType" END)`;
    default:
      return incoming;
  }
}

// Both the write and read-only preview use "Product" for the saved row
// and EXCLUDED for the candidate filled with the insert defaults.
export function getImportUpdateValue(
  field: ImportColumn,
  supplied: Prisma.Sql,
) {
  const existing = Prisma.sql`"Product".${productImportColumn(field)}`;
  const incoming = Prisma.sql`EXCLUDED.${productImportColumn(field)}`;
  if (field === 'convertedPrices') {
    return Prisma.sql`CASE
      WHEN ${supplied} ? 'convertedPrices' THEN ${incoming}
      WHEN EXCLUDED.price IS DISTINCT FROM "Product".price
        OR EXCLUDED.currency IS DISTINCT FROM "Product".currency
        OR ((${supplied} ? 'originalPrice') AND EXCLUDED."originalPrice" IS DISTINCT FROM "Product"."originalPrice")
      THEN NULL
      ELSE ${existing}
    END`;
  }
  const productionDefault =
    field in DEFAULT_PRODUCTION_TIME
      ? Prisma.sql`WHEN (${supplied} ? 'isMadeToOrder') AND EXCLUDED."isMadeToOrder"
        THEN COALESCE(${existing}, ${incoming})`
      : Prisma.empty;
  return Prisma.sql`CASE
    WHEN ${supplied} ? ${field} THEN ${incoming}
    ${productionDefault}
    ELSE ${existing}
  END`;
}

export const importTranslationUpdate = Prisma.sql`CASE
  WHEN EXCLUDED.translations IS NULL THEN "Product".translations
  ELSE COALESCE("Product".translations, '{}'::jsonb) || COALESCE((
    SELECT jsonb_object_agg(locale, COALESCE("Product".translations -> locale, '{}'::jsonb) || translation)
    FROM jsonb_each(EXCLUDED.translations) AS t(locale, translation)
  ), '{}'::jsonb)
END`;

export function findImportImages(
  db: Pick<Prisma.TransactionClient, 'productImage'>,
  ids: string[],
) {
  if (!ids.length) return Promise.resolve([]);
  return db.productImage.findMany({
    where: { productId: { in: ids } },
    orderBy: [{ managed: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      productId: true,
      url: true,
      position: true,
      isMain: true,
      altText: true,
    },
  });
}

type ImageMetadata = Pick<ProductImage, 'position' | 'isMain' | 'altText'>;

export function getImportImageMetadata(
  product: ImportProduct,
  url: string,
  index: number,
  existing?: ImageMetadata,
): ImageMetadata {
  return (
    product.imageDetails.get(url) ?? {
      position: index,
      isMain: index === 0,
      altText: existing ? existing.altText : product.data.title,
    }
  );
}
