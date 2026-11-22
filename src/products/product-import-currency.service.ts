import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from 'generated/prisma';
import type { ImportFormat, ImportProduct } from './product-import.parser';

const quoteLifetimeMs = 15 * 60_000;
const nbuDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

type Rates = { date: string; USD: string; EUR: string };
type Currency = 'USD' | 'EUR';
type Quote = { batch: string; expiresAt: number; rates: Rates };
type NbuRate = { cc?: string; exchangedate?: string; rate_per_unit?: number };

@Injectable()
export class ProductImportCurrencyService {
  constructor(private readonly config: ConfigService) {}

  async convert(
    products: ImportProduct[],
    format: ImportFormat,
    dryRun: boolean,
    token?: string,
  ) {
    const eligible = products.filter(({ data }) => data.currency === 'UAH');
    if (!eligible.length) return undefined;

    const batch = createHash('sha256')
      .update(JSON.stringify({ format, products }))
      .digest('hex');
    const quote: Quote = dryRun
      ? {
          batch,
          rates: await this.getRates(),
          expiresAt: Date.now() + quoteLifetimeMs,
        }
      : this.verify(token, batch);

    const sample = [];
    const pricesByRow = new Map<number, Prisma.InputJsonObject>();
    for (const { row, data } of eligible) {
      const baseAmount = new Prisma.Decimal(String(data.price)).toFixed(2);
      const originalAmount =
        data.originalPrice == null
          ? null
          : new Prisma.Decimal(String(data.originalPrice)).toFixed(2);
      const convertAmount = (rate: string, amount: string) =>
        new Prisma.Decimal(amount)
          .div(rate)
          .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
      const priceFor = (currency: Currency) => {
        const rate = quote.rates[currency];
        return {
          amount: convertAmount(rate, baseAmount),
          originalAmount:
            originalAmount === null
              ? null
              : convertAmount(rate, originalAmount),
          rate,
        };
      };
      const prices = { USD: priceFor('USD'), EUR: priceFor('EUR') };
      pricesByRow.set(row, {
        source: 'NBU',
        date: quote.rates.date,
        baseAmount,
        prices,
      });
      if (sample.length < 5) {
        sample.push({
          row,
          sku: data.sku,
          title: data.title,
          baseAmount,
          originalAmount,
          prices,
        });
      }
    }

    return {
      pricesByRow,
      report: {
        count: eligible.length,
        rates: quote.rates,
        sample,
        ...(dryRun && { token: this.encode(quote) }),
      },
    };
  }

  private async getRates(): Promise<Rates> {
    const date = nbuDate.format(new Date());
    const day = date.replace(/-/g, '');
    const endpoint = new URL('https://bank.gov.ua/NBU_Exchange/exchange_site');
    endpoint.search = 'start=' + day + '&end=' + day + '&json';

    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error('Invalid NBU response');
      const rows: NbuRate[] = await response.json();
      const officialDate = date.split('-').reverse().join('.');
      const rate = (currency: Currency) => {
        const value = rows.find(
          ({ cc, exchangedate }) =>
            cc === currency && exchangedate === officialDate,
        )?.rate_per_unit;
        if (!Number.isFinite(value) || value <= 0)
          throw new Error('Missing currency rate');
        return String(value);
      };
      return { date, USD: rate('USD'), EUR: rate('EUR') };
    } catch {
      throw new ServiceUnavailableException(
        'NBU exchange rates are unavailable. Try again or import without conversion.',
      );
    }
  }

  private signature(payload: string) {
    const secret = this.config.get<string>('CART_SESSION_SECRET');
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'Currency conversion is not configured.',
      );
    }
    return createHmac('sha256', secret)
      .update('product-import-fx:')
      .update(payload)
      .digest('base64url');
  }

  private encode(quote: Quote) {
    const payload = Buffer.from(JSON.stringify(quote)).toString('base64url');
    return payload + '.' + this.signature(payload);
  }

  private verify(token: string | undefined, batch: string): Quote {
    const invalid = () =>
      new BadRequestException(
        'Validate the file again to confirm the exchange rates.',
      );
    if (!token || token.length > 1024 || !/^[\w-]+\.[\w-]{43}$/.test(token))
      throw invalid();
    const [payload, signature] = token.split('.');
    const expected = this.signature(payload);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw invalid();
    const quote: Quote = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    );
    if (quote.batch !== batch || quote.expiresAt <= Date.now()) throw invalid();
    return quote;
  }
}
