import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from 'generated/prisma';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep the callable CommonJS export.
import sanitizeHtml = require('sanitize-html');
import { PrismaService } from '../prisma/prisma.service';
import { getProductionTime } from './product-dispatch';

const feedProduct = {
  id: true,
  slug: true,
  title: true,
  description: true,
  price: true,
  availability: true,
  availabilityDate: true,
  brand: true,
  gtin: true,
  mpn: true,
  identifierExists: true,
  isMadeToOrder: true,
  productionTimeMinDays: true,
  productionTimeMaxDays: true,
  productionDayType: true,
  category: { select: { name: true } },
  images: {
    orderBy: [
      { isMain: 'desc' },
      { position: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: { url: true },
  },
} satisfies Prisma.ProductSelect;
type FeedProduct = Prisma.ProductGetPayload<{ select: typeof feedProduct }>;

function httpUrl(value: string | undefined) {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) &&
    !url.username &&
    !url.password
    ? url
    : null;
}

function xmlText(value: string) {
  // XML 1.0 permits only tab, newline and carriage return among ASCII controls.
  // eslint-disable-next-line no-control-regex
  return value
    .replace(
      /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
      '',
    )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function element(tag: string, value: string | number | null | undefined) {
  return value == null || value === ''
    ? ''
    : `<${tag}>${xmlText(String(value))}</${tag}>`;
}

function productDescription(html: string) {
  const escapedText = sanitizeHtml(
    html.replace(/<\/?(?:p|div|br|li|tr|td|th|h[1-6])\b[^>]*>/gi, ' '),
    {
      allowedTags: [],
      allowedAttributes: {},
    },
  );
  const entities = { amp: '&', lt: '<', gt: '>' } as const;
  return escapedText
    .replace(
      /&(amp|lt|gt);/g,
      (_, entity: keyof typeof entities) => entities[entity],
    )
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class GoogleShoppingService {
  private readonly logger = new Logger(GoogleShoppingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async generate() {
    const storefront = httpUrl(
      this.config.get<string>('GOOGLE_SHOPPING_STORE_URL'),
    );
    const path = this.config.get<string>('GOOGLE_SHOPPING_PRODUCT_PATH');
    if (
      !storefront ||
      !path?.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      !/\{(?:id|slug)\}/.test(path) ||
      !URL.canParse(path, storefront) ||
      new URL(path, storefront).origin !== storefront.origin
    ) {
      throw new ServiceUnavailableException(
        'Google Shopping storefront URLs are not configured',
      );
    }

    const language =
      this.config
        .get<string>('GOOGLE_SHOPPING_LANGUAGE')
        ?.trim()
        .toLowerCase() || 'uk';
    if (!/^[a-z]{2,3}$/.test(language)) {
      throw new ServiceUnavailableException(
        'Google Shopping language must be a primary language code',
      );
    }
    const products = await this.prisma.product.findMany({
      where: {
        isPublished: true,
        currency: 'UAH',
        OR: [
          { locale: null },
          { locale: language },
          { locale: { startsWith: `${language}-` } },
        ],
      },
      select: feedProduct,
      orderBy: { id: 'asc' },
    });
    const now = new Date();
    const items = products.map((product) =>
      this.item(product, storefront, path, now),
    );
    const skipped = items.filter((item) => !item).length;
    if (skipped)
      this.logger.warn(
        `Skipped ${skipped} incomplete or unsupported Google Shopping offers`,
      );

    const title =
      this.config.get<string>('GOOGLE_SHOPPING_STORE_NAME')?.trim() ||
      storefront.hostname;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
      '<channel>',
      element('title', title),
      element('link', storefront.href),
      element('description', title),
      element('language', language),
      ...items.filter(Boolean),
      '</channel>',
      '</rss>',
    ].join('\n');
  }

  private item(product: FeedProduct, storefront: URL, path: string, now: Date) {
    const title = product.title.trim().slice(0, 150);
    const description = productDescription(product.description ?? '').slice(
      0,
      5000,
    );
    const images = [
      ...new Set(
        product.images.map(({ url }) => httpUrl(url)?.href).filter(Boolean),
      ),
    ];
    const [image, ...additionalImages] = images;
    const availability = product.availability?.toLowerCase() ?? 'in_stock';
    const needsAvailabilityDate =
      availability === 'preorder' || availability === 'backorder';
    const production = getProductionTime(product);
    if (
      !title ||
      !description ||
      !image ||
      !product.price.gt(0) ||
      (path.includes('{slug}') && !product.slug) ||
      (needsAvailabilityDate && !(product.availabilityDate > now)) ||
      (production && production.dayType !== 'BUSINESS')
    ) {
      return null;
    }

    const link = new URL(
      path
        .replace(/\{id\}/g, encodeURIComponent(product.id))
        .replace(/\{slug\}/g, encodeURIComponent(product.slug ?? '')),
      storefront,
    );
    if (link.origin !== storefront.origin) return null;

    return [
      '<item>',
      element('g:id', product.id),
      element('g:title', title),
      element('g:description', description),
      element('g:link', link.href),
      element('g:image_link', image),
      ...additionalImages
        .slice(0, 10)
        .map((url) => element('g:additional_image_link', url)),
      element('g:condition', 'new'),
      element('g:availability', availability),
      element(
        'g:availability_date',
        needsAvailabilityDate
          ? `${product.availabilityDate.toISOString().slice(0, 16)}Z`
          : null,
      ),
      element('g:price', `${product.price.toFixed(2)} UAH`),
      element('g:product_type', product.category.name),
      element('g:brand', product.brand),
      element('g:gtin', product.gtin),
      element('g:mpn', product.mpn),
      element(
        'g:identifier_exists',
        product.identifierExists === false ? 'no' : null,
      ),
      element(
        'g:min_handling_time',
        production && production.minDays !== production.maxDays
          ? production.minDays
          : null,
      ),
      element('g:max_handling_time', production?.maxDays),
      '</item>',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
