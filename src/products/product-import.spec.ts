import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { json } from 'express';
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
