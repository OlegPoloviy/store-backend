import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  ProductAvailability,
  ProductionDayType,
} from 'generated/prisma';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep the callable CommonJS export.
import sanitizeHtml = require('sanitize-html');

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCTS = 500;

export type ImportFormat = 'catalog' | 'horoshop' | 'google-shopping';
type Row = Record<string, unknown>;
type Translation = { title?: string; description?: string };

export type ImportProduct = {
  row: number;
  data: Omit<
    Prisma.ProductUncheckedCreateInput,
    'categoryId' | 'translations'
  > & {
    sku: string;
    translations: Record<string, Translation>;
  };
  category: string;
  images: string[];
  source: Prisma.InputJsonObject;
};

type ImportIssue = { row: number; sku?: string; message: string };

const availabilityValues: Record<string, ProductAvailability> = {
  in_stock: 'IN_STOCK',
  out_of_stock: 'OUT_OF_STOCK',
  preorder: 'PREORDER',
  backorder: 'BACKORDER',
};

function record(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function missing(value: unknown): value is null | undefined | '' {
  return value === undefined || value === null || value === '';
}

function scalar(value: unknown, field: string, limit = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error(
      field + ' must be a non-empty string of at most ' + limit + ' characters',
    );
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, limit?: number) {
  return missing(value) ? undefined : scalar(value, field, limit);
}

function locale(value: unknown) {
  const tag = scalar(value, 'locale', 50);
  return Intl.getCanonicalLocales(tag.toLowerCase() === 'ua' ? 'uk' : tag)[0];
}

function boolean(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  switch (typeof value === 'string' ? value.trim().toLowerCase() : value) {
    case 'true':
    case 'yes':
    case 'да':
    case 'так':
      return true;
    case 'false':
    case 'no':
    case 'нет':
    case 'ні':
      return false;
    default:
      throw new Error(field + ' must be a boolean');
  }
}

function optionalBoolean(value: unknown, field: string) {
  return missing(value) ? undefined : boolean(value, field);
}

function price(value: unknown, field: string) {
  const decimal =
    typeof value === 'number' ? String(value) : scalar(value, field);
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(decimal)) {
    throw new Error(
      field +
        ' must be a non-negative amount with up to 8 whole digits and 2 decimal places',
    );
  }
  return decimal.replace(',', '.');
}

function url(value: unknown, field: string) {
  const address = scalar(value, field, 2000);
  const parsed = URL.canParse(address) ? new URL(address) : undefined;
  if (
    !parsed ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    !/^https?:\/\//i.test(address) ||
    /[\s\\]/.test(address) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      field + ' must be an absolute HTTP(S) URL without credentials',
    );
  }
  return address;
}

function description(value: unknown) {
  const html = sanitizeHtml(scalar(value, 'description', 100_000), {
    allowedTags: [
      'p',
      'br',
      'div',
      'ul',
      'ol',
      'li',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'h2',
      'h3',
      'h4',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'blockquote',
    ],
    allowedAttributes: {},
  });
  if (!sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim()) {
    throw new Error('description must contain text');
  }
  return html;
}

function productionTime(
  value: unknown,
  dayType: unknown,
  madeToOrder: boolean | undefined,
) {
  if (missing(value) && missing(dayType)) return undefined;
  if (madeToOrder !== true)
    throw new Error('production time requires is_made_to_order: true');
  const range =
    typeof value === 'number'
      ? String(value)
      : scalar(value, 'production_time_days', 32);
  const match = /^(\d{1,10})(?:\s*[-–]\s*(\d{1,10}))?$/.exec(range);
  const kind = scalar(dayType, 'production_day_type').toUpperCase();
  if (kind !== 'BUSINESS' && kind !== 'CALENDAR') {
    throw new Error('production_day_type must be business or calendar');
  }
  if (
    !match ||
    Number(match[1]) > Number(match[2] ?? match[1]) ||
    Number(match[2] ?? match[1]) > 2_147_483_647
  ) {
    throw new Error(
      'production_time_days must be a non-negative integer or an ordered range such as 10-14',
    );
  }
  return {
    productionTimeMinDays: Number(match[1]),
    productionTimeMaxDays: Number(match[2] ?? match[1]),
    productionDayType: kind as ProductionDayType,
  };
}

function horoshopTranslations(row: Row) {
  const translations: Record<string, Translation> = {};
  for (const [column, value] of Object.entries(row)) {
    if (missing(value)) continue;
    const match =
      /^(Название|Назва|Название модификации|Назва модифікації|Описание товара|Опис товару)\(([a-z0-9-]+)\)$/i.exec(
        column,
      );
    if (!match) continue;
    const language = locale(match[2]);
    const translation = (translations[language] ??= {});
    if (/^(название модификации|назва модифікації)$/i.test(match[1])) {
      translation.title = scalar(value, 'title', 500);
    } else if (/^(название|назва)$/i.test(match[1])) {
      translation.title ??= scalar(value, 'title', 500);
    } else {
      translation.description = description(value);
    }
  }
  return translations;
}

function fromHoroshop(row: Row, language: string) {
  const translations = horoshopTranslations(row);
  const stock = optionalText(
    row['Наличие'] ?? row['Наявність'],
    'availability',
  );
  const status = stock?.toLowerCase();
  const madeToOrder = ['під замовлення', 'под заказ'].includes(status);
  const availability: Record<string, string> = {
    'в наявності': 'in_stock',
    'в наличии': 'in_stock',
    'немає в наявності': 'out_of_stock',
    'нет в наличии': 'out_of_stock',
    передзамовлення: 'preorder',
    предзаказ: 'preorder',
  };
  if (
    status &&
    !madeToOrder &&
    !Object.prototype.hasOwnProperty.call(availability, status) &&
    missing(row.availability)
  ) {
    throw new Error('Unmapped Horoshop availability: ' + stock);
  }
  const photos = row['Фото'];
  return {
    ...row,
    sku: row['Артикул'],
    title: translations[language]?.title,
    description: translations[language]?.description,
    category: row['Раздел'] ?? row['Розділ'],
    price: row['Цена'] ?? row['Ціна'],
    currency: row['Валюта'],
    original_price: row['Старая цена'] ?? row['Стара ціна'],
    brand: row['Бренд'],
    slug: row['Алиас'] ?? row['Аліас'],
    color: row['Цвет'] ?? row['Колір'],
    images:
      typeof photos === 'string'
        ? photos
            .split(';')
            .map((photo) => photo.trim())
            .filter(Boolean)
        : photos,
    is_published: row['Отображать'] ?? row['Відображати'],
    gtin: row.gtin ?? row['Штрихкод'],
    mpn:
      row.mpn ?? row['Код производителя товара'] ?? row['Код виробника товару'],
    availability:
      row.availability ?? (madeToOrder ? null : availability[status]),
    is_made_to_order:
      row.is_made_to_order ?? (stock === undefined ? undefined : madeToOrder),
    translations,
  };
}

function googlePrice(value: unknown, field: string) {
  const match = /^(\d+(?:\.\d{1,2})?) ([A-Z]{3})$/.exec(scalar(value, field));
  if (!match)
    throw new Error(
      field + ' must contain amount and currency, e.g. 129.00 EUR',
    );
  return { price: match[1], currency: match[2] };
}

function fromGoogle(row: Row) {
  const fields = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/^g:/, ''), value]),
  );
  const regular = googlePrice(fields.price, 'price');
  const sale = missing(fields.sale_price)
    ? undefined
    : googlePrice(fields.sale_price, 'sale_price');
  if (
    sale &&
    (sale.currency !== regular.currency ||
      Number(sale.price) >= Number(regular.price))
  ) {
    throw new Error(
      'sale_price must be lower than price and use the same currency',
    );
  }
  const additional = fields.additional_image_link;
  return {
    ...fields,
    sku: fields.id,
    price: sale?.price ?? regular.price,
    currency: regular.currency,
    original_price: sale ? regular.price : null,
    images: [
      fields.image_link,
      ...(missing(additional)
        ? []
        : Array.isArray(additional)
          ? additional
          : [additional]),
    ],
    category:
      fields.category ?? fields.product_type ?? fields.google_product_category,
  };
}

function importRow(
  row: Row,
  source: Row,
  format: ImportFormat,
  language: string,
  index: number,
  warnings: ImportIssue[],
): ImportProduct {
  const sku = scalar(row.sku ?? row.id, 'sku', 50);
  const currency = scalar(row.currency, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error('currency must be a three-letter code');
  const title = scalar(row.title, 'title', 500);
  const productDescription =
    format === 'horoshop'
      ? scalar(row.description, 'description', 100_000)
      : description(row.description);
  if (
    !Array.isArray(row.images) ||
    !row.images.length ||
    row.images.length > 50
  ) {
    throw new Error('images must contain between 1 and 50 URLs');
  }
  const images = [
    ...new Set(row.images.map((image, i) => url(image, 'images[' + i + ']'))),
  ];
  const madeToOrder = optionalBoolean(row.is_made_to_order, 'is_made_to_order');
  const production = productionTime(
    row.production_time_days,
    row.production_day_type,
    madeToOrder,
  );
  if (madeToOrder && !production) {
    const message =
      'Set production_time_days and production_day_type for made-to-order products';
    if (format === 'catalog') throw new Error(message);
    warnings.push({ row: index, sku, message });
  }

  const availability = optionalText(row.availability, 'availability');
  if (
    availability &&
    !Object.prototype.hasOwnProperty.call(
      availabilityValues,
      availability.toLowerCase(),
    )
  ) {
    throw new Error(
      'availability must be in_stock, out_of_stock, preorder or backorder',
    );
  }
  const availabilityDate = optionalText(
    row.availability_date,
    'availability_date',
  );
  if (
    availabilityDate &&
    (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(availabilityDate) ||
      !Number.isFinite(Date.parse(availabilityDate)))
  ) {
    throw new Error('availability_date must be an ISO 8601 timestamp');
  }
  const gtin = optionalText(row.gtin, 'gtin');
  const mpn = optionalText(row.mpn, 'mpn', 70);
  const identifierExists = optionalBoolean(
    row.identifier_exists,
    'identifier_exists',
  );
  if (gtin && !/^(?:\d{8}|\d{12,14})$/.test(gtin)) {
    throw new Error('gtin must be a string of 8, 12, 13 or 14 digits');
  }
  if (identifierExists === false && (gtin || mpn)) {
    throw new Error(
      'identifier_exists cannot be false when a GTIN or MPN is supplied',
    );
  }
  if (
    format === 'google-shopping' &&
    (!availability ||
      missing(row.link) ||
      (['preorder', 'backorder'].includes(availability.toLowerCase()) &&
        !availabilityDate))
  ) {
    throw new Error(
      'Google Shopping requires link and availability, plus availability_date for preorder/backorder',
    );
  }
  const translations = (
    format === 'horoshop' ? row.translations : {}
  ) as Record<string, Translation>;
  translations[language] = { title, description: productDescription };
  return {
    row: index,
    data: {
      sku,
      title,
      description: productDescription,
      price: price(row.price, 'price'),
      currency,
      locale: language,
      translations,
      slug: optionalText(row.slug, 'slug'),
      link: missing(row.link) ? undefined : url(row.link, 'link'),
      color: optionalText(row.color, 'color'),
      brand: optionalText(row.brand, 'brand', 70),
      originalPrice: missing(row.original_price)
        ? row.original_price === null
          ? null
          : undefined
        : price(row.original_price, 'original_price'),
      isPublished: optionalBoolean(row.is_published, 'is_published'),
      availability: availability
        ? availabilityValues[availability.toLowerCase()]
        : row.availability === null
          ? null
          : undefined,
      availabilityDate: availabilityDate
        ? new Date(availabilityDate)
        : availability || row.availability === null
          ? null
          : undefined,
      gtin,
      mpn,
      identifierExists: identifierExists ?? (gtin || mpn ? true : undefined),
      isMadeToOrder: madeToOrder,
      ...production,
      ...(madeToOrder === false && {
        productionTimeMinDays: null,
        productionTimeMaxDays: null,
        productionDayType: null,
      }),
    },
    category: scalar(row.category, 'category', 750),
    images,
    source: source as Prisma.InputJsonObject,
  };
}

export function parseProductImport(
  payload: unknown,
  onProgress?: (processed: number, total: number) => void,
) {
  if (!record(payload)) throw new BadRequestException('Expected a JSON object');
  const format = payload.format === undefined ? 'catalog' : payload.format;
  if (
    format !== 'catalog' &&
    format !== 'horoshop' &&
    format !== 'google-shopping'
  ) {
    throw new BadRequestException(
      'format must be catalog, horoshop or google-shopping',
    );
  }
  if (payload.dryRun !== undefined && typeof payload.dryRun !== 'boolean') {
    throw new BadRequestException('dryRun must be a boolean');
  }
  let language: string;
  try {
    language = locale(payload.locale);
  } catch {
    throw new BadRequestException(
      'Provide a valid locale, e.g. en, en-GB or uk',
    );
  }
  if (
    !Array.isArray(payload.products) ||
    !payload.products.length ||
    payload.products.length > MAX_PRODUCTS
  ) {
    throw new BadRequestException(
      'products must contain between 1 and ' + MAX_PRODUCTS + ' rows',
    );
  }

  const products: ImportProduct[] = [];
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const seen = new Map<string, number>();
  const total = payload.products.length;
  onProgress?.(0, total);
  for (const [offset, source] of payload.products.entries()) {
    const index = offset + 1;
    let sku: string;
    try {
      if (!record(source)) throw new Error('Expected a product object');
      validateSource(source);
      const rawSku =
        source.sku ?? source.id ?? source['Артикул'] ?? source['g:id'];
      if (typeof rawSku === 'string') sku = rawSku.trim();
      const row =
        format === 'horoshop'
          ? fromHoroshop(source, language)
          : format === 'google-shopping'
            ? fromGoogle(source)
            : source;
      const rowWarnings: ImportIssue[] = [];
      const product = importRow(
        row,
        source,
        format,
        language,
        index,
        rowWarnings,
      );
      sku = product.data.sku;
      const first = seen.get(sku);
      if (first !== undefined)
        throw new Error('Duplicate SKU already present in row ' + first);
      seen.set(sku, index);
      products.push(product);
      warnings.push(...rowWarnings);
    } catch (error) {
      errors.push({ row: index, sku, message: error.message });
    }
    if (index % 20 === 0 || index === total) onProgress?.(index, total);
  }
  return {
    products,
    warnings,
    errors,
    total,
    dryRun: payload.dryRun === true,
    format,
  };
}

function validateSource(value: unknown, depth = 0): void {
  if (depth > 30)
    throw new Error('Row exceeds the maximum nesting depth of 30');
  if (typeof value === 'string' && /[\uD800-\uDFFF\u0000]/u.test(value)) {
    throw new Error('Row contains an invalid Unicode character');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Row contains a non-finite number');
  }
  if (Array.isArray(value)) {
    for (const item of value) validateSource(item, depth + 1);
  } else if (record(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateSource(key);
      validateSource(item, depth + 1);
    }
  }
}
