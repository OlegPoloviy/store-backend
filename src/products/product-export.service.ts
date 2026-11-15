import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from 'generated/prisma';
import writeExcel from 'write-excel-file/node';
import { PrismaService } from '../prisma/prisma.service';

export const PRODUCT_EXPORT_TYPES = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export type ProductExportFormat = keyof typeof PRODUCT_EXPORT_TYPES;

const relations = {
  category: { select: { name: true } },
  images: {
    orderBy: [{ isMain: 'desc' }, { position: 'asc' }, { id: 'asc' }],
    select: { url: true, isMain: true, position: true, altText: true },
  },
} satisfies Prisma.ProductInclude;
type Product = Prisma.ProductGetPayload<{ include: typeof relations }>;

const columns = {
  product_id: (p) => p.id,
  sku: (p) => p.sku,
  title: (p) => p.title,
  description: (p) => p.description,
  price: (p) => p.price.toFixed(2),
  currency: (p) => p.currency,
  category: (p) => p.category.name,
  images: (p) => p.images.map(({ url }) => url),
  locale: (p) => p.locale,
  brand: (p) => p.brand,
  slug: (p) => p.slug,
  link: (p) => p.link,
  original_price: (p) => p.originalPrice?.toFixed(2) ?? null,
  is_published: (p) => p.isPublished,
  availability: (p) => p.availability?.toLowerCase() ?? null,
  availability_date: (p) => p.availabilityDate?.toISOString() ?? null,
  gtin: (p) => p.gtin,
  mpn: (p) => p.mpn,
  identifier_exists: (p) => p.identifierExists,
  is_made_to_order: (p) => p.isMadeToOrder,
  production_time_days: (p) =>
    p.productionTimeMinDays === null
      ? null
      : p.productionTimeMaxDays === null ||
          p.productionTimeMaxDays === p.productionTimeMinDays
        ? String(p.productionTimeMinDays)
        : p.productionTimeMinDays + '-' + p.productionTimeMaxDays,
  production_day_type: (p) => p.productionDayType?.toLowerCase() ?? null,
  primary_material: (p) => p.primaryMaterial,
  secondary_materials: (p) => p.secondaryMaterials,
  wood_treatment: (p) => p.woodTreatment,
  finish: (p) => p.finish,
  origin_of_material: (p) => p.originOfMaterial,
  handmade: (p) => p.handmade,
  craftsmanship_details: (p) => p.craftsmanshipDetails,
  width: (p) => p.width?.toFixed(2) ?? null,
  depth: (p) => p.depth?.toFixed(2) ?? null,
  height: (p) => p.height?.toFixed(2) ?? null,
  unit_of_measure: (p) => p.unitOfMeasure,
  weight: (p) => p.weight?.toFixed(2) ?? null,
  weight_unit: (p) => p.weightUnit,
  seating_capacity: (p) => p.seatingCapacity,
  storage_capacity: (p) => p.storageCapacity,
  style: (p) => p.style,
  color: (p) => p.color,
  texture: (p) => p.texture,
  design_inspiration: (p) => p.designInspiration,
  pattern: (p) => p.pattern,
  features: (p) => p.features,
  assembly_required: (p) => p.assemblyRequired,
  care_instructions: (p) => p.careInstructions,
  warranty: (p) => p.warranty,
  unique_identifier: (p) => p.uniqueIdentifier,
  designer: (p) => p.designer,
  creation_date: (p) => p.creationDate?.toISOString() ?? null,
  story: (p) => p.story,
  translations: (p) => p.translations,
  image_details: (p) => p.images,
  created_at: (p) => p.createdAt.toISOString(),
  updated_at: (p) => p.updatedAt.toISOString(),
} satisfies Record<string, (product: Product) => Prisma.JsonValue>;

const fields = Object.entries(columns);
const headers = Object.keys(columns);
const decimals = new Set([
  'price',
  'original_price',
  'width',
  'depth',
  'height',
  'weight',
]);

function tableCell(value: Prisma.JsonValue): string | number | boolean | null {
  if (value == null) return null;
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

function csvCell(value: string | number | boolean | null) {
  let text = value === null ? '' : String(value);
  // Quoting CSV fields alone does not prevent spreadsheets from evaluating formulas.
  if (typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/.test(value)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

@Injectable()
export class ProductExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(format: ProductExportFormat): Promise<Buffer> {
    const products = await this.prisma.product.findMany({
      include: relations,
      orderBy: { id: 'asc' },
    });
    if (format === 'json') {
      const rows = products.map((product) =>
        Object.fromEntries(
          fields.map(([field, read]) => [field, read(product)]),
        ),
      );
      return Buffer.from(JSON.stringify({ products: rows }, null, 2));
    }

    const rows = products.map((product) =>
      fields.map(([, read]) => tableCell(read(product))),
    );
    if (format === 'csv') {
      const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
      return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n');
    }

    if (
      rows.length >= 1_048_576 ||
      rows.some((row) =>
        row.some((value) => typeof value === 'string' && value.length > 32_767),
      )
    ) {
      throw new UnprocessableEntityException(
        'The catalog exceeds Excel limits. Export as JSON or CSV.',
      );
    }
    return writeExcel(
      [
        headers.map((value) => ({ value, fontWeight: 'bold' })),
        ...rows.map((row) =>
          row.map((value, index) =>
            typeof value === 'string' && decimals.has(headers[index])
              ? { value: Number(value), format: '0.00' }
              : value,
          ),
        ),
      ],
      { sheet: 'Products', stickyRowsCount: 1 },
    ).toBuffer();
  }
}
