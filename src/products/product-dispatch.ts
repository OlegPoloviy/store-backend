import type { Product } from 'generated/prisma';

export const DEFAULT_PRODUCTION_TIME = {
  productionTimeMinDays: 14,
  productionTimeMaxDays: 14,
  productionDayType: 'BUSINESS',
} as const;

type ProductionFields = Pick<
  Product,
  | 'isMadeToOrder'
  | 'availability'
  | 'productionTimeMinDays'
  | 'productionTimeMaxDays'
  | 'productionDayType'
>;

const kyivDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getProductionTime(product: ProductionFields) {
  if (!product.isMadeToOrder || product.availability === 'OUT_OF_STOCK') {
    return null;
  }
  return {
    minDays:
      product.productionTimeMinDays ??
      DEFAULT_PRODUCTION_TIME.productionTimeMinDays,
    maxDays:
      product.productionTimeMaxDays ??
      DEFAULT_PRODUCTION_TIME.productionTimeMaxDays,
    dayType:
      product.productionDayType ?? DEFAULT_PRODUCTION_TIME.productionDayType,
  };
}

function dispatchDate(today: string, days: number, businessDays: boolean) {
  const date = new Date(`${today}T00:00:00Z`);
  if (businessDays) {
    const weekday = date.getUTCDay() || 7;
    if (weekday > 5) {
      // From a weekend, Monday is the first available dispatch day.
      date.setUTCDate(
        date.getUTCDate() + (days === 0 ? 8 - weekday : 5 - weekday),
      );
    }
    const remainingDays = days % 5;
    const crossesWeekend = (date.getUTCDay() || 7) + remainingDays > 5;
    days = Math.floor(days / 5) * 7 + remainingDays + (crossesWeekend ? 2 : 0);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isFinite(date.valueOf()) && date.getUTCFullYear() <= 9999
    ? date.toISOString().slice(0, 10)
    : null;
}

export function getEstimatedDispatch(
  product: ProductionFields,
  now = new Date(),
) {
  const time = getProductionTime(product);
  if (!time) return null;

  const today = kyivDate.format(now);
  const businessDays = time.dayType === 'BUSINESS';
  const earliestDate = dispatchDate(today, time.minDays, businessDays);
  const latestDate = dispatchDate(today, time.maxDays, businessDays);
  return earliestDate && latestDate ? { earliestDate, latestDate } : null;
}
