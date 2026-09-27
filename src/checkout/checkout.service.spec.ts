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
    const service = new CheckoutService(db, { get: () => undefined } as unknown as ConfigService, gateway);
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
    const service = new CheckoutService(db, { get: () => undefined } as unknown as ConfigService, gateway);
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

  it('completes a local mock payment without WayForPay credentials', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const pending = {
        id: 'order-1', userId: 'user-1', status: 'PENDING', cartId: 'cart-1',
        attempts: [{ id: 'attempt-1', orderId: 'order-1', status: 'CREATED' }],
      };
      const paid = { ...pending, status: 'PAID', paidAt: new Date(), items: [], attempts: [{ ...pending.attempts[0], status: 'APPROVED' }] };
      const db: any = {
        order: {
          findUnique: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(paid),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ cartId: 'cart-1' }),
        },
        paymentAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        cart: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      db.$transaction = (fn: (client: any) => Promise<any>) => fn(db);
      const service = new CheckoutService(db, { get: () => 'mock' } as unknown as ConfigService, gateway);
      const result = await service.mockPayment({ userId: 'user-1', anonymousId: null }, 'order-1', 'approved');
      expect(result.status).toBe('PAID');
      expect(result.payment).toBeNull();
      expect(db.paymentAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'attempt-1', status: 'CREATED' },
      }));
      expect(db.cart.updateMany).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('rejects mock payments outside development mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const service = new CheckoutService({} as any, { get: () => 'mock' } as unknown as ConfigService, gateway);
      await expect(service.mockPayment({ userId: 'user-1', anonymousId: null }, 'order-1', 'approved')).rejects.toThrow(
        'Mock payments are only available',
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('returns a mock payment action without gateway credentials', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const order = {
        id: 'order-1', status: 'PENDING', currency: 'UAH',
        subtotalMinor: 2500, shippingMinor: 0, totalMinor: 2500,
        attempts: [{ status: 'CREATED' }],
      };
      const db: any = { order: { findUnique: jest.fn().mockResolvedValue(order) }, $transaction: jest.fn() };
      const unavailableGateway = { form: jest.fn(() => { throw new Error('Gateway credentials unavailable'); }) };
      const service = new CheckoutService(db, { get: () => 'mock' } as unknown as ConfigService, unavailableGateway as any);
      const result = await service.create(
        { userId: 'user-1', anonymousId: null }, {} as any,
        '789cc69b-dfb6-47f4-9347-e69e75a2c7fd',
      );
      expect(result.payment).toMatchObject({
        provider: 'mock', action: '/checkout/orders/order-1/mock-payment', method: 'POST',
      });
      expect(unavailableGateway.form).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('quotes existing USD products only in mock mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const db: any = { cart: { findFirst: jest.fn().mockResolvedValue({
        id: 'cart-1', items: [{ quantity: 1, productId: 'p1', product: {
          title: 'Desk', currency: 'USD', price: new Prisma.Decimal('100.00'),
        } }],
      }) } };
      const mockConfig = { get: (key: string) => key === 'PAYMENT_MODE' ? 'mock'
        : key === 'MOCK_SHIPPING_RATES_MINOR_JSON' ? '{"USD":{"US":6000}}' : undefined } as unknown as ConfigService;
      const mockService = new CheckoutService(db, mockConfig, gateway);
      expect(await mockService.quote({ userId: 'user-1', anonymousId: null }, 'US')).toMatchObject({
        currency: 'USD', subtotalMinor: 10000, shippingMinor: 6000, totalMinor: 16000,
      });
      const liveService = new CheckoutService(db, { get: () => undefined } as unknown as ConfigService, gateway);
      await expect(liveService.quote({ userId: 'user-1', anonymousId: null }, 'US')).rejects.toThrow(
        'Checkout currency is not supported',
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
