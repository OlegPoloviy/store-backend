import { ConfigService } from '@nestjs/config';
import { ProductImportCurrencyService } from './product-import-currency.service';
import { parseProductImport } from './product-import.parser';

jest.mock('sanitize-html', () =>
  process.getBuiltinModule('node:module').createRequire(__filename)(
    'sanitize-html',
  ),
);

const catalogRow = {
  sku: 'NB-001',
  title: 'Oak bench',
  description: 'Solid oak',
  price: '1000',
  original_price: '1200',
  currency: 'UAH',
  category: 'Benches',
  images: ['https://example.com/bench.jpg'],
};

function batch(product = catalogRow) {
  return parseProductImport({ locale: 'en', products: [product] }).products;
}

describe('NBU currency conversion at import', () => {
  const service = new ProductImportCurrencyService(
    new ConfigService({
      CART_SESSION_SECRET: 'product-import-test-secret-12345678',
    }),
  );

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockImplementation(async (endpoint) => {
      const day = new URL(String(endpoint)).searchParams.get('start');
      const exchangedate = [
        day.slice(6),
        day.slice(4, 6),
        day.slice(0, 4),
      ].join('.');
      return Response.json([
        { cc: 'USD', exchangedate, rate_per_unit: 40 },
        { cc: 'EUR', exchangedate, rate_per_unit: 43 },
      ]);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('previews a batch and saves the same rates and amounts without another fetch', async () => {
    const products = batch();
    const preview = await service.convert(products, 'catalog', true);
    expect(preview.report.count).toBe(1);
    expect(preview.report.sample[0].prices).toEqual({
      USD: { amount: '25.00', originalAmount: '30.00', rate: '40' },
      EUR: { amount: '23.26', originalAmount: '27.91', rate: '43' },
    });
    expect(products[0].data.convertedPrices).toBeUndefined();
    const committed = await service.convert(
      products,
      'catalog',
      false,
      preview.report.token,
    );
    expect(committed.pricesByRow.get(1)).toEqual({
      source: 'NBU',
      date: preview.report.rates.date,
      baseAmount: '1000.00',
      prices: preview.report.sample[0].prices,
    });
    expect(preview.pricesByRow.get(1)).toEqual(committed.pricesByRow.get(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('requires a new preview after the file changes or the quote expires', async () => {
    const preview = await service.convert(batch(), 'catalog', true);
    await expect(
      service.convert(
        batch({ ...catalogRow, price: '1010' }),
        'catalog',
        false,
        preview.report.token,
      ),
    ).rejects.toThrow('Validate the file again');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    await expect(
      service.convert(batch(), 'catalog', false, preview.report.token),
    ).rejects.toThrow('Validate the file again');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips foreign prices and reports unavailable rates before saving', async () => {
    await expect(
      service.convert(
        batch({ ...catalogRow, currency: 'USD' }),
        'catalog',
        true,
      ),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(service.convert(batch(), 'catalog', true)).rejects.toThrow(
      'NBU exchange rates are unavailable',
    );
  });
});
