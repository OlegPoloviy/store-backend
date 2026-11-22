import { Prisma } from 'generated/prisma';
import type { ImportProduct } from './product-import.parser';
import {
  findImportImages,
  getImportImageMetadata,
  getImportInsertValue,
  getImportUpdateValue,
  importTranslationUpdate,
  productImportColumn,
  productImportColumns,
} from './product-import-values';

type ChangeValue = string | number | boolean | null;
type Change<Value = ChangeValue> = {
  field: string;
  before: Value;
  after: Value;
};
type PreviewRow = {
  position: number;
  productId: string | null;
  changes: Change<Prisma.JsonValue>[];
};

function displayValue(value: Prisma.JsonValue): ChangeValue {
  if (typeof value === 'string') {
    return value.length > 160 ? value.slice(0, 160) + '…' : value;
  }
  return typeof value === 'object' ? null : value;
}

function asDisplayChange(change: PreviewRow['changes'][number]): Change {
  const before = displayValue(change.before);
  const after = displayValue(change.after);
  return before === after
    ? { field: change.field, before: null, after: null }
    : { field: change.field, before, after };
}

export async function previewProductImport(
  db: Pick<Prisma.TransactionClient, '$queryRaw' | 'productImage'>,
  products: ImportProduct[],
) {
  const input = JSON.stringify(
    products.map(({ data, category }) => ({ ...data, category })),
  );
  // Materialize the insert defaults before applying the same update rules as the upsert.
  const candidates = productImportColumns.map(
    (field) =>
      Prisma.sql`${getImportInsertValue(field)} AS ${productImportColumn(field)}`,
  );
  const diffs = productImportColumns
    .filter((field) => field !== 'categoryId')
    .map((field) => ({
      field,
      before: Prisma.sql`"Product".${productImportColumn(field)}`,
      after: getImportUpdateValue(field, Prisma.sql`EXCLUDED.input`),
    }));
  const changes = [
    ...diffs,
    {
      field: 'category',
      before: Prisma.sql`category.name`,
      after: Prisma.sql`EXCLUDED."categoryName"`,
    },
    {
      field: 'translations',
      before: Prisma.sql`"Product".translations`,
      after: importTranslationUpdate,
    },
  ].map(({ field, before, after }, order) => {
    // Return monetary values as decimal strings for display.
    const asJson = (value: Prisma.Sql) =>
      field === 'price' || field === 'originalPrice'
        ? Prisma.sql`to_jsonb((${value})::text)`
        : Prisma.sql`to_jsonb(${value})`;
    return Prisma.sql`(${order}::int, ${field}::text, ${asJson(before)}, ${asJson(after)})`;
  });

  const rows = await db.$queryRaw<PreviewRow[]>`
    WITH candidates AS (
      SELECT ordinal::int AS position, data AS input, data ->> 'category' AS "categoryName",
        p.id, p.sku, p.translations, ${Prisma.join(candidates)}
      FROM jsonb_array_elements(${input}::jsonb) WITH ORDINALITY AS list(data, ordinal)
      CROSS JOIN LATERAL jsonb_populate_record(NULL::"Product", list.data) AS p
    )
    SELECT EXCLUDED.position, "Product".id AS "productId",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('field', field, 'before', before, 'after', after) ORDER BY position)
        FROM (VALUES ${Prisma.join(changes)}) AS changes(position, field, before, after)
        WHERE "Product".id IS NOT NULL AND before IS DISTINCT FROM after
      ), '[]'::jsonb) AS changes
    FROM candidates AS EXCLUDED
    LEFT JOIN "Product" ON ("Product".sku = EXCLUDED.sku)
      OR (EXCLUDED.sku IS NULL AND "Product".id = EXCLUDED.id)
    LEFT JOIN "Category" AS category ON category.id = "Product"."categoryId"
    ORDER BY EXCLUDED.position
  `;

  const existingImages = await findImportImages(
    db,
    rows.flatMap(({ productId }) => (productId ? [productId] : [])),
  );
  const imagesByProduct = new Map<string, typeof existingImages>();
  for (const image of existingImages) {
    const group = imagesByProduct.get(image.productId) ?? [];
    group.push(image);
    imagesByProduct.set(image.productId, group);
  }

  const preview = {
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    updates: [] as {
      row: number;
      sku?: string;
      title: string;
      changes: Change[];
    }[],
  };
  for (const { position, productId, changes } of rows) {
    if (!productId) {
      preview.newCount++;
      continue;
    }
    const product = products[position - 1];
    const existing = imagesByProduct.get(productId) ?? [];
    const imageChanged =
      existing.length !== product.images.length ||
      product.images.some((url, index) => {
        const image = existing.find((item) => item.url === url);
        if (!image) return true;
        const proposed = getImportImageMetadata(product, url, index, image);
        return (
          image.position !== proposed.position ||
          image.isMain !== proposed.isMain ||
          image.altText !== proposed.altText
        );
      });
    const visibleChanges = changes.map(asDisplayChange);
    if (imageChanged) {
      visibleChanges.push({
        field: 'images',
        before:
          existing.length === product.images.length ? null : existing.length,
        after:
          existing.length === product.images.length
            ? null
            : product.images.length,
      });
    }
    if (visibleChanges.length) {
      preview.updatedCount++;
      preview.updates.push({
        row: product.row,
        sku: product.data.sku,
        title: product.data.title,
        changes: visibleChanges,
      });
    } else {
      preview.unchangedCount++;
    }
  }
  return preview;
}
