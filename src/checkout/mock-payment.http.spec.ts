import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PrismaService } from 'src/prisma/prisma.service';
import { CartSessionService } from 'src/cart/cart-session.service';
import { OptionalJwtAuthGuard } from 'src/guards/optional.guard';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { WayForPayService } from './wayforpay.service';

class TestUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = { sub: 'user-1' };
    return true;
  }
}

describe('local mock payment HTTP flow', () => {
  let app: INestApplication;
  let order: any;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    order = {
      id: 'order-1', userId: 'user-1', status: 'PENDING', cartId: 'cart-1',
      currency: 'USD', subtotalMinor: 10000, shippingMinor: 0, totalMinor: 10000,
      items: [], paidAt: null,
      attempts: [{ id: 'attempt-1', orderId: 'order-1', status: 'CREATED' }],
    };
    const db: any = {
      order: {
        findUnique: async () => order,
        findUniqueOrThrow: async () => order,
        updateMany: async ({ data }: any) => { Object.assign(order, data); return { count: 1 }; },
      },
      paymentAttempt: {
        updateMany: async ({ data }: any) => { Object.assign(order.attempts[0], data); return { count: 1 }; },
      },
      cart: { updateMany: async () => ({ count: 1 }) },
    };
    db.$transaction = (fn: (tx: any) => Promise<any>) => fn(db);
    const module = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: db },
        { provide: ConfigService, useValue: { get: (key: string) => key === 'PAYMENT_MODE' ? 'mock' : undefined } },
        { provide: WayForPayService, useValue: { form: () => { throw new Error('Real gateway must not be called'); } } },
        { provide: CartSessionService, useValue: { parse: () => null } },
      ],
    }).overrideGuard(OptionalJwtAuthGuard).useClass(TestUserGuard).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('rejects an invalid outcome and then completes a valid mock payment', async () => {
    await request(app.getHttpServer())
      .post('/checkout/orders/order-1/mock-payment')
      .send({ outcome: 'refunded' })
      .expect(400);
    expect(order.status).toBe('PENDING');

    const response = await request(app.getHttpServer())
      .post('/checkout/orders/order-1/mock-payment')
      .send({ outcome: 'approved' })
      .expect(201);
    expect(response.body).toMatchObject({ orderId: 'order-1', status: 'PAID', currency: 'USD', totalMinor: 10000 });
    expect(order.attempts[0].status).toBe('APPROVED');

    await request(app.getHttpServer())
      .post('/checkout/orders/order-1/mock-payment')
      .send({ outcome: 'approved' })
      .expect(409);
  });
});
