import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Prisma } from 'generated/prisma';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { ProductExportController } from './product-export.controller';
import { ProductExportService } from './product-export.service';
import { readProductImportFile } from './product-import.file';
import { parseProductImport } from './product-import.parser';
import { readImportWorkbook } from './product-import.xlsx';

// Load the real sanitizer through Node because Jest 29 cannot require its ESM parser.
jest.mock('sanitize-html', () =>
  process.getBuiltinModule('node:module').createRequire(__filename)(
    'sanitize-html',
  ),
);

const createdAt = new Date('2026-01-01T12:00:00Z');
const product = {
  id: 'bench-id',
  sku: '00012',
  title: '=2+2',
  description: 'Solid "oak"\nЛавка',
  price: new Prisma.Decimal('179.90'),
  currency: 'EUR',
  category: { name: 'Benches' },
  images: [
    {
      url: 'https://example.com/bench;a.jpg',
      isMain: true,
      position: 0,
      altText: 'Oak bench',
    },
  ],
  gtin: '0123456789012',
  primaryMaterial: 'Oak',
  secondaryMaterials: ['Ash; birch'],
  width: new Prisma.Decimal('30.25'),
  seatingCapacity: 0,
  handmade: false,
  assemblyRequired: false,
  story: "'=written as text",
  creationDate: createdAt,
  locale: 'uk',
  isPublished: false,
  productionTimeMinDays: null,
  translations: { uk: { title: 'Лавка' } },
  createdAt,
  updatedAt: createdAt,
};

describe('product export', () => {
  let app: INestApplication;
  let service: ProductExportService;
  const findMany = jest.fn().mockResolvedValue([
    product,
    {
      ...product,
      id: '04043413-f0a1-4c99-b540-316ad88289c9',
      sku: null,
      locale: null,
      description: null,
      images: [],
    },
  ]);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProductExportController],
      providers: [
        ProductExportService,
        { provide: PrismaService, useValue: { product: { findMany } } },
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
    service = module.get(ProductExportService);
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('protects the download and rejects unsupported formats', async () => {
    await request(app.getHttpServer())
      .get('/products/export?format=json')
      .expect(401);
    await request(app.getHttpServer())
      .get('/products/export?format=json')
      .set('Authorization', 'USER')
      .expect(403);
    await request(app.getHttpServer())
      .get('/products/export?format=xml')
      .set('Authorization', 'ADMIN')
      .expect(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('downloads JSON with unpublished and legacy products and keeps exact values', async () => {
    const result = await request(app.getHttpServer())
      .get('/products/export?format=json')
      .set('Authorization', 'ADMIN')
      .expect('Content-Disposition', 'attachment; filename="products.json"')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);

    expect(result.body.products).toMatchObject([
      {
        sku: '00012',
        price: '179.90',
        category: 'Benches',
        is_published: false,
        images: [product.images[0].url],
        image_details: product.images,
        translations: product.translations,
      },
      {
        product_id: '04043413-f0a1-4c99-b540-316ad88289c9',
        sku: null,
        images: [],
      },
    ]);
    expect(findMany.mock.calls.at(-1)[0]).not.toHaveProperty('where');
  });

  it('exports UTF-8 CSV with escaped text and neutralized formulas', async () => {
    const result = await request(app.getHttpServer())
      .get('/products/export?format=csv')
      .set('Authorization', 'ADMIN')
      .expect('Content-Type', /text\/csv/)
      .expect('Content-Disposition', 'attachment; filename="products.csv"')
      .expect(200);

    expect(result.text).toContain('\uFEFF"product_id","sku","title"');
    expect(result.text).toContain('"00012","\'=2+2","Solid ""oak""\nЛавка"');
    expect(result.text).toContain('"[""https://example.com/bench;a.jpg""]"');
    const file = {
      originalname: 'products.csv',
      buffer: Buffer.from(result.text),
    } as Express.Multer.File;
    expect(await readProductImportFile(file, { locale: 'uk' })).toMatchObject({
      format: 'catalog',
      products: [
        { sku: '00012', images: [product.images[0].url] },
        { product_id: '04043413-f0a1-4c99-b540-316ad88289c9', images: [] },
      ],
    });
  });

  it.each(['json', 'xlsx', 'csv'] as const)(
    'round-trips editable %s fields and a product without a SKU',
    async (format) => {
      const file = {
        originalname: 'products.' + format,
        buffer: await service.export(format),
      } as Express.Multer.File;
      const result = parseProductImport(await readProductImportFile(file, {}));
      expect(result.errors).toEqual([]);
      expect(result.products[0].data).toMatchObject({
        sku: '00012',
        title: product.title,
        locale: 'uk',
        gtin: product.gtin,
        primaryMaterial: product.primaryMaterial,
        secondaryMaterials: product.secondaryMaterials,
        width: product.width.toFixed(2),
        seatingCapacity: 0,
        handmade: false,
        assemblyRequired: false,
        story: product.story,
        creationDate: createdAt,
        translations: product.translations,
      });
      expect(new Prisma.Decimal(String(result.products[0].data.price))).toEqual(
        product.price,
      );
      const { url, ...imageDetails } = product.images[0];
      expect(result.products[0].imageDetails.get(url)).toEqual(imageDetails);
      expect(result.products[1].data).toMatchObject({
        id: '04043413-f0a1-4c99-b540-316ad88289c9',
        locale: null,
        description: null,
      });
      expect(result.products[1].data.sku).toBeUndefined();
      expect(result.products[1].images).toEqual([]);
    },
  );

  it('writes a real workbook with text identifiers, numeric prices and no live formulas', async () => {
    const buffer = await service.export('xlsx');
    const [headers, row] = await readImportWorkbook(buffer);

    expect(
      Object.fromEntries(headers.map((header, index) => [header, row[index]])),
    ).toMatchObject({
      sku: '00012',
      gtin: '0123456789012',
      price: '179.9',
      title: '=2+2',
      images: JSON.stringify([product.images[0].url]),
    });
  });
});
