import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import { join } from 'node:path';
import request = require('supertest');
import { PrismaService } from '../prisma/prisma.service';
import { ProductImportController } from './product-import.controller';
import { MAX_IMPORT_BYTES, parseProductImport } from './product-import.parser';
import { ProductImportService } from './product-import.service';

// Load the real sanitizer with Node because Jest 29 can't require its ESM parser.
jest.mock('sanitize-html', () =>
  process.getBuiltinModule('node:module').createRequire(__filename)(
    'sanitize-html',
  ),
);

const catalogRow = {
  sku: 'KM-001',
  title: 'Oak bench',
  description: '<p>Made from oak.</p>',
  price: '179.90',
  currency: 'EUR',
  category: 'Benches',
  images: ['https://example.com/main.jpg', 'https://example.com/side.jpg'],
  identifier_exists: false,
  is_made_to_order: true,
  production_time_days: '10–14',
  production_day_type: 'business',
};

describe('product import parser', () => {
  it('validates production ranges, duplicates and exact decimals', () => {
    const result = parseProductImport({
      locale: 'en-GB',
      products: [
        catalogRow,
        catalogRow,
        { ...catalogRow, sku: 'KM-002', price: '179.901' },
        { ...catalogRow, sku: 'KM-003', production_time_days: '14-10' },
      ],
    });
    expect(result.errors.map((issue) => issue.row)).toEqual([2, 3, 4]);
    expect(result.products[0].data).toMatchObject({
      price: '179.90',
      currency: 'EUR',
      identifierExists: false,
      productionTimeMinDays: 10,
      productionTimeMaxDays: 14,
      productionDayType: 'BUSINESS',
    });
  });

  it('preserves Horoshop source attributes and cleans storefront descriptions', () => {
    const source = {
      Артикул: 'DR-001',
      'Название(UA)': 'Лавка',
      'Название(RU)': 'Скамья',
      'Описание товара(UA)': '<p data-path-to-node="1">Дуб</p>',
      'Описание товара(RU)': '<p>Дуб</p>',
      Цена: '11800.00',
      Валюта: 'UAH',
      Раздел: 'Дерево/Лавки',
      Наличие: 'Під замовлення',
      Фото: 'https://example.com/main.jpg;\nhttps://example.com/side.jpg',
      'META keywords(UA)': 'лавка, дуб',
    };
    const result = parseProductImport({
      format: 'horoshop',
      locale: 'uk',
      products: [source],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toMatchObject([{ row: 1, sku: 'DR-001' }]);
    expect(result.products[0]).toMatchObject({
      source,
      images: catalogRow.images,
      data: {
        sku: 'DR-001',
        isMadeToOrder: true,
        availability: null,
        translations: {
          uk: { title: 'Лавка', description: '<p>Дуб</p>' },
          ru: { title: 'Скамья' },
        },
      },
    });
    expect(
      parseProductImport({
        format: 'horoshop',
        locale: 'en',
        products: [source],
      }).errors,
    ).toMatchObject([{ row: 1, sku: 'DR-001' }]);
  });

  it('maps Google Shopping prices and additional images', () => {
    const result = parseProductImport({
      format: 'google-shopping',
      locale: 'en',
      products: [
        {
          'g:id': 'KM-002',
          'g:title': 'Oak bench',
          'g:description': '<p>Oak</p>',
          'g:price': '179.90 EUR',
          'g:sale_price': '159.90 EUR',
          'g:product_type': 'Benches',
          'g:availability': 'in_stock',
          'g:link': 'https://example.com/bench',
          'g:image_link': catalogRow.images[0],
          'g:additional_image_link': catalogRow.images[1],
        },
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({
      images: catalogRow.images,
      data: {
        price: '159.90',
        originalPrice: '179.90',
        availability: 'IN_STOCK',
      },
    });
  });
});

describe('POST /products/import', () => {
  let app: INestApplication;
  const transaction = jest.fn();
  const payload = { locale: 'en-GB', dryRun: true, products: [catalogRow] };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProductImportController],
      providers: [
        ProductImportService,
        { provide: PrismaService, useValue: { $transaction: transaction } },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = { app_metadata: { role: req.headers.authorization } };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.use('/products/import', json({ limit: MAX_IMPORT_BYTES }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated and non-admin callers', async () => {
    await request(app.getHttpServer())
      .post('/products/import')
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .post('/products/import')
      .set('Authorization', 'USER')
      .send(payload)
      .expect(403);
  });

  it('accepts JSON larger than the default body limit and a multipart JSON file', async () => {
    const largePayload = {
      ...payload,
      products: [{ ...catalogRow, sourceNotes: 'a'.repeat(120_000) }],
    };
    const expected = {
      total: 1,
      valid: 1,
      imported: 0,
      dryRun: true,
      errors: [],
      warnings: [],
    };
    const response = await request(app.getHttpServer())
      .post('/products/import')
      .set('Authorization', 'ADMIN')
      .send(largePayload)
      .expect(200);
    expect(response.body).toEqual(expected);
    const uploaded = await request(app.getHttpServer())
      .post('/products/import')
      .set('Authorization', 'ADMIN')
      .attach('file', Buffer.from(JSON.stringify(payload)), 'products.json')
      .expect(200);
    expect(uploaded.body).toEqual(expected);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reports invalid rows without committing a partial batch', async () => {
    const response = await request(app.getHttpServer())
      .post('/products/import')
      .set('Authorization', 'ADMIN')
      .send({ ...payload, dryRun: false, products: [catalogRow, catalogRow] })
      .expect(422);
    expect(response.body).toMatchObject({
      valid: 1,
      imported: 0,
      errors: [{ row: 2, sku: catalogRow.sku }],
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['csv', ';'],
    ['csv', ','],
    ['tsv', '\t'],
  ])(
    'validates a %s upload with delimiter %j',
    async (extension, delimiter) => {
      const headers = [
        'sku',
        'title',
        'description',
        'price',
        'currency',
        'category',
        'images',
      ];
      const values = [
        '00123',
        '"Oak, bench"',
        '"<p>Solid\noak.</p>"',
        '"179,90"',
        'EUR',
        'Benches',
        '"' + catalogRow.images.join(';') + '"',
      ];
      const data =
        '\uFEFF' +
        headers.join(delimiter) +
        '\r\n' +
        values.join(delimiter) +
        '\r\n' +
        values.join(delimiter);
      const response = await request(app.getHttpServer())
        .post('/products/import?locale=en-GB&dryRun=true')
        .set('Authorization', 'ADMIN')
        .attach('file', Buffer.from(data), 'catalog.' + extension)
        .expect(200);
      expect(response.body).toMatchObject({
        valid: 1,
        imported: 0,
        errors: [{ row: 2, sku: '00123' }],
      });
    },
  );

  it('detects Horoshop by the headers even when the first product is missing a SKU', async () => {
    const csv = [
      'Артикул,Назва(UA),Опис товару(UA),Ціна,Валюта,Розділ,Фото',
      ',Лавка,Дуб,11800,UAH,Лавки,https://example.com/bench.jpg',
      '001,Лавка,Дуб,11800,UAH,Лавки,https://example.com/bench.jpg',
    ].join('\n');
    const response = await request(app.getHttpServer())
      .post('/products/import?locale=uk&dryRun=true')
      .set('Authorization', 'ADMIN')
      .attach('file', Buffer.from(csv), 'horoshop.csv')
      .expect(200);
    expect(response.body).toMatchObject({
      total: 2,
      valid: 1,
      errors: [{ row: 1, message: expect.stringContaining('sku') }],
    });
  });

  it('validates the first Excel worksheet with shared strings and sparse cells', async () => {
    const response = await request(app.getHttpServer())
      .post('/products/import?locale=en-GB&dryRun=true')
      .set('Authorization', 'ADMIN')
      .attach(
        'file',
        join(__dirname, '../../test/fixtures/product-import.xlsx'),
      )
      .expect(200);
    expect(response.body).toMatchObject({
      total: 2,
      valid: 1,
      imported: 0,
      errors: [
        { row: 2, sku: '0007', message: expect.stringContaining('title') },
      ],
    });
  });

  it('validates an RSS upload with namespace aliases and repeated image links', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:merchant="http://base.google.com/ns/1.0" version="2.0">
        <channel><item>
          <merchant:id>00001</merchant:id>
          <merchant:title>Oak bench</merchant:title>
          <merchant:description><![CDATA[<p>Oak</p>]]></merchant:description>
          <merchant:link>https://example.com/bench</merchant:link>
          <merchant:availability>in_stock</merchant:availability>
          <merchant:price>179.90 EUR</merchant:price>
          <merchant:product_type>Benches</merchant:product_type>
          <merchant:image_link>${catalogRow.images[0]}</merchant:image_link>
          <merchant:additional_image_link>${catalogRow.images[1]}</merchant:additional_image_link>
          <merchant:additional_image_link>https://example.com/detail.jpg</merchant:additional_image_link>
        </item></channel>
      </rss>`;
    const response = await request(app.getHttpServer())
      .post('/products/import?locale=en-GB&dryRun=true')
      .set('Authorization', 'ADMIN')
      .set('Accept', 'application/x-ndjson')
      .attach('file', Buffer.from(xml), 'feed.xml')
      .expect(200)
      .expect('Content-Type', /application\/x-ndjson/);
    const events = response.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: 'report',
      report: { total: 1, valid: 1, imported: 0, errors: [] },
    });
  });

  it('can preview a JSON file using the query flag even when the file requests a write', async () => {
    const response = await request(app.getHttpServer())
      .post('/products/import?dryRun=true')
      .set('Authorization', 'ADMIN')
      .attach(
        'file',
        Buffer.from(JSON.stringify({ ...payload, dryRun: false })),
        'catalog.json',
      )
      .expect(200);
    expect(response.body).toMatchObject({
      valid: 1,
      dryRun: true,
      imported: 0,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('streams validation progress and a report with one-based row errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/products/import')
      .set('Authorization', 'ADMIN')
      .set('Accept', 'application/x-ndjson')
      .send({ ...payload, products: [catalogRow, catalogRow] })
      .expect(200)
      .expect('Content-Type', /application\/x-ndjson/);

    const events = response.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      { type: 'progress', phase: 'validating', processed: 0, total: 2 },
      { type: 'progress', phase: 'validating', processed: 2, total: 2 },
      {
        type: 'report',
        report: {
          total: 2,
          valid: 1,
          imported: 0,
          dryRun: true,
          warnings: [],
          errors: [
            {
              row: 2,
              sku: catalogRow.sku,
              message: 'Duplicate SKU already present in row 1',
            },
          ],
        },
      },
    ]);
    expect(transaction).not.toHaveBeenCalled();
  });
});
