import { getEstimatedDispatch } from './product-dispatch';

const madeToOrder = {
  isMadeToOrder: true,
  availability: null,
  productionTimeMinDays: null,
  productionTimeMaxDays: null,
  productionDayType: null,
};

describe('estimated dispatch', () => {
  it('uses 14 weekdays and advances when the date changes in Kyiv', () => {
    expect(
      getEstimatedDispatch(madeToOrder, new Date('2026-11-23T21:59:00Z')),
    ).toEqual({
      earliestDate: '2026-12-11',
      latestDate: '2026-12-11',
    });
    expect(
      getEstimatedDispatch(madeToOrder, new Date('2026-11-23T22:00:00Z')),
    ).toEqual({
      earliestDate: '2026-12-14',
      latestDate: '2026-12-14',
    });
  });

  it('starts counting weekend orders on Monday', () => {
    expect(
      getEstimatedDispatch(madeToOrder, new Date('2026-11-22T14:00:00Z')),
    ).toEqual({
      earliestDate: '2026-12-10',
      latestDate: '2026-12-10',
    });
  });

  it('preserves an explicitly supplied calendar-day range', () => {
    expect(
      getEstimatedDispatch(
        {
          ...madeToOrder,
          productionTimeMinDays: 1,
          productionTimeMaxDays: 3,
          productionDayType: 'CALENDAR',
        },
        new Date('2026-11-20T12:00:00Z'),
      ),
    ).toEqual({
      earliestDate: '2026-11-21',
      latestDate: '2026-11-23',
    });
  });

  it('returns no estimate when orders are paused or the product is ready-made', () => {
    expect(
      getEstimatedDispatch({ ...madeToOrder, availability: 'OUT_OF_STOCK' }),
    ).toBeNull();
    expect(
      getEstimatedDispatch({ ...madeToOrder, isMadeToOrder: false }),
    ).toBeNull();
  });
});
