import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CheckoutService } from './checkout.service';
import { WayForPayService } from './wayforpay.service';
import { Prisma } from 'generated/prisma';

describe('CheckoutService callback', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const gateway = new WayForPayService({
    get: (key: string) => ({
      WAYFORPAY_SECRET_KEY: secret,
      WAYFORPAY_MERCHANT_ACCOUNT: 'test_merchant',
    })[key],
  } as ConfigService);

  function callback(status = 'Approved') {
    const body = {
      merchantAccount: 'test_merchant', orderReference: 'attempt-1', amount: 25,
      currency: 'UAH', authCode: '123', cardPan: '42****4242',
      transactionStatus: status, reasonCode: status === 'Approved' ? 1100 : 1101,
      merchantSignature: '',
    };
    body.merchantSignature = createHmac('md5', secret)
      .update([body.merchantAccount, body.orderReference, body.amount, body.currency,
        body.authCode, body.cardPan, body.transactionStatus, body.reasonCode].join(';'))
      .digest('hex');
    return body;
  }

  it('marks an order paid once after a valid callback and acknowledges duplicates', async () => {
    const db: any = {
      paymentAttempt: {
        findUnique: jest.fn().mockResolvedValue({ id: 'attempt-id', orderId: 'order-id', amountMinor: 2500 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ cartId: 'cart-id' }),
      },
      cart: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    db.$transaction = (fn: (tx: any) => Promise<any>) => fn(db);
    const service = new CheckoutService(db, {} as ConfigService, gateway);
    expect((await service.callback(callback())).status).toBe('accept');
    expect((await service.callback(callback())).status).toBe('accept');
    expect(db.cart.updateMany).toHaveBeenCalledTimes(1);
    expect(db.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-id', status: { in: ['PENDING', 'FAILED'] } },
    }));
  });

  it('does not mutate the database for an invalid callback', async () => {
    const db: any = {
      paymentAttempt: { findUnique: jest.fn().mockResolvedValue({ id: 'attempt-id', orderId: 'order-id', amountMinor: 2500 }) },
      $transaction: jest.fn(),
    };
    const service = new CheckoutService(db, {} as ConfigService, gateway);
    await expect(service.callback({ ...callback(), amount: 26 })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('quotes current catalog prices plus configured country shipping', async () => {
    const db: any = {
      cart: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cart-1',
          items: [{ quantity: 2, productId: 'p1', product: {
            title: 'Chair', currency: 'UAH', price: new Prisma.Decimal('123.45'),
          } }],
        }),
      },
    };
    const config = { get: () => '{"DE": 2500}' } as unknown as ConfigService;
    const service = new CheckoutService(db, config, gateway);
    expect(await service.quote({ userId: 'user-1', anonymousId: null }, 'DE')).toMatchObject({
      subtotalMinor: 24690, shippingMinor: 2500, totalMinor: 27190, currency: 'UAH',
    });
    await expect(service.quote({ userId: 'user-1', anonymousId: null }, 'US')).rejects.toThrow();
  });

  it('freezes an order using server prices and shipping, then locks its cart', async () => {
    const cart = {
      id: 'cart-1',
      items: [{ quantity: 2, productId: 'p1', product: {
        title: 'Chair', currency: 'UAH', price: new Prisma.Decimal('123.45'),
      } }],
    };
    const tx: any = {
      cart: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: cart.id }).mockResolvedValueOnce(cart),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: cart.id }]),
      order: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        id: 'order-1', status: 'PENDING', ...data,
        items: data.items.create,
        attempts: [{ status: 'CREATED', createdAt: new Date(), reference: 'attempt-1' }],
      })) },
    };
    const db: any = {
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: (fn: (client: any) => Promise<any>) => fn(tx),
    };
    const mockGateway = { form: jest.fn().mockReturnValue({ action: 'https://secure.wayforpay.com/pay' }) };
    const service = new CheckoutService(db, { get: () => '{"DE":2500}' } as unknown as ConfigService, mockGateway as any);
    const response = await service.create(
      { userId: 'user-1', anonymousId: null },
      { customerEmail: 'ada@example.com', customerFirstName: 'Ada', customerLastName: 'Lovelace',
        shippingCountry: 'DE', shippingAddress: 'Street 1', shippingCity: 'Berlin',
        shippingPostalCode: '10115' },
      '789cc69b-dfb6-47f4-9347-e69e75a2c7fd',
    );
    expect(response.totalMinor).toBe(27190);
    expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ subtotalMinor: 24690, shippingMinor: 2500, totalMinor: 27190 }),
    }));
    expect(tx.cart.updateMany).toHaveBeenCalledWith({
      where: { id: cart.id, status: 'ACTIVE' }, data: { status: 'CHECKED_OUT' },
    });
  });
});
