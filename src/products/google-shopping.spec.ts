import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from 'generated/prisma';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleShoppingController } from './google-shopping.controller';
import { GoogleShoppingService } from './google-shopping.service';
import { readImportXml } from './product-import.xml';

jest.mock('sanitize-html', () =>
  process.getBuiltinModule('node:module').createRequire(__filename)(
    'sanitize-html',
  ),
);

const base = {
  id: 'bench-id',
  title: 'Лавка & стіл',
  description: '<p>Дуб &amp; ясен</p><p>Масив &lt; 3 м</p>',
  price: new Prisma.Decimal('149.9'),
  brand: 'KarpatMaster',
  category: { name: 'Лавки' },
  images: [
    { url: 'https://cdn.example.com/first.jpg?width=800&height=800' },
    { url: 'https://cdn.example.com/second.jpg' },
  ],
  availability: 'IN_STOCK',
};

describe('Google Shopping feed', () => {
  let app: INestApplication;
  const findMany = jest.fn();
  const config: Record<string, string> = {
    GOOGLE_SHOPPING_STORE_URL: 'https://store.example.com',
    GOOGLE_SHOPPING_PRODUCT_PATH: '/shop/{id}',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GoogleShoppingController],
      providers: [
        GoogleShoppingService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        { provide: PrismaService, useValue: { product: { findMany } } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves a public XML feed with fresh status, prices, links and handling times', async () => {
    const availabilityDate = new Date(Date.now() + 30 * 86_400_000);
    findMany.mockResolvedValueOnce([
      base,
      { ...base, id: 'mto', isMadeToOrder: true, availability: null },
      {
        ...base,
        id: 'paused',
        isMadeToOrder: true,
        availability: 'OUT_OF_STOCK',
      },
      {
        ...base,
        id: 'backorder',
        availability: 'BACKORDER',
        availabilityDate,
      },
      { ...base, id: 'missing-image', images: [] },
      { ...base, id: 'missing-date', availability: 'PREORDER' },
    ]);

    const response = await request(app.getHttpServer())
      .get('/feeds/google-shopping.xml')
      .expect('Content-Type', /application\/xml/)
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isPublished: true,
          currency: 'UAH',
          OR: [
            { locale: null },
            { locale: 'uk' },
            { locale: { startsWith: 'uk-' } },
          ],
        },
      }),
    );
    const rss = readImportXml(response.text);
    expect(rss.attributes.version).toBe('2.0');
    expect(
      rss.children[0].children.find(({ name }) => name === 'language')?.text,
    ).toBe('uk');
    const items = rss.children[0].children.filter(
      ({ name }) => name === 'item',
    );
    expect(items).toHaveLength(4);
    expect(
      items[0].children.every(
        ({ namespace }) => namespace === 'http://base.google.com/ns/1.0',
      ),
    ).toBe(true);
    const offers = items.map(({ children }) =>
      Object.fromEntries(children.map(({ name, text }) => [name, text])),
    );
    expect(offers[0]).toMatchObject({
      id: 'bench-id',
      title: base.title,
      description: 'Дуб & ясен Масив < 3 м',
      link: 'https://store.example.com/shop/bench-id',
      image_link: base.images[0].url,
      additional_image_link: base.images[1].url,
      availability: 'in_stock',
      price: '149.90 UAH',
    });
    expect(offers[1]).toMatchObject({
      availability: 'in_stock',
      max_handling_time: '14',
    });
    expect(offers[2]).toMatchObject({ availability: 'out_of_stock' });
    expect(offers[2]).not.toHaveProperty('max_handling_time');
    expect(offers[3]).toMatchObject({
      availability: 'backorder',
      availability_date: `${availabilityDate.toISOString().slice(0, 16)}Z`,
    });

    findMany.mockResolvedValueOnce([
      { ...base, price: new Prisma.Decimal('155') },
    ]);
    const updated = await request(app.getHttpServer())
      .get('/feeds/google-shopping.xml')
      .expect(200);
    expect(updated.text).toContain('<g:price>155.00 UAH</g:price>');
  });

  it('returns 503 when the catalog links would lead off the storefront', async () => {
    const originalPath = config.GOOGLE_SHOPPING_PRODUCT_PATH;
    config.GOOGLE_SHOPPING_PRODUCT_PATH = '//elsewhere.example.com/{id}';
    try {
      await request(app.getHttpServer())
        .get('/feeds/google-shopping.xml')
        .expect(503);
    } finally {
      config.GOOGLE_SHOPPING_PRODUCT_PATH = originalPath;
    }
  });
});
