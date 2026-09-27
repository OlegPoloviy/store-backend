import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { PaymentAttempt, Prisma } from 'generated/prisma';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCheckoutDto } from './checkout.dto';
import { toMinor } from './money';
import { WayForPayCallback, WayForPayService } from './wayforpay.service';

type Customer = { userId: string | null; anonymousId: string | null };

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gateway: WayForPayService,
  ) {}

  private owner(customer: Customer): string {
    if (customer.userId) return `user:${customer.userId}`;
    if (customer.anonymousId) return `guest:${customer.anonymousId}`;
    throw new ForbiddenException('Cart session is required');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private isMockMode(): boolean {
    const mode = this.config.get<string>('PAYMENT_MODE');
    if (mode !== 'mock') return false;
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('Mock payments are only available with NODE_ENV=development');
    }
    return true;
  }

  private shippingMinor(country: string, currency: string): number {
    const mock = this.isMockMode();
    const setting = mock ? 'MOCK_SHIPPING_RATES_MINOR_JSON' : 'CHECKOUT_SHIPPING_RATES_UAH_JSON';
    const raw = this.config.get<string>(setting);
    if (!raw) throw new Error(`${setting} is required`);
    let rates: Record<string, number> | Record<string, Record<string, number>>;
    try {
      rates = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid ${setting}`);
    }
    const amount = mock
      ? (rates as Record<string, Record<string, number>>)[currency]?.[country]
      : (rates as Record<string, number>)[country];
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2147483647) {
      throw new BadRequestException('Shipping is not available for this country');
    }
    return amount;
  }

  private async activeCart(customer: Customer) {
    const cart = await this.prisma.cart.findFirst({
      where: customer.userId
        ? { userId: customer.userId, status: 'ACTIVE' }
        : { anonymousId: customer.anonymousId, status: 'ACTIVE' },
      include: { items: { include: { product: true } } },
    });
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');
    return cart;
  }

  private calculate(cart: Awaited<ReturnType<CheckoutService['activeCart']>>, country: string) {
    const currency = cart.items[0].product.currency;
    if (!['UAH', 'USD', 'EUR'].includes(currency) || (!this.isMockMode() && currency !== 'UAH')) {
      throw new BadRequestException('Checkout currency is not supported');
    }
    let subtotalMinor = 0;
    const items = cart.items.map((item) => {
      if (item.product.currency !== currency) {
        throw new BadRequestException('Cart items must use the same currency');
      }
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        throw new BadRequestException('Invalid product quantity');
      }
      const unitPriceMinor = toMinor(item.product.price);
      const totalMinor = unitPriceMinor * item.quantity;
      if (!Number.isSafeInteger(totalMinor) || totalMinor > 2147483647) {
        throw new BadRequestException('Order amount is too large');
      }
      subtotalMinor += totalMinor;
      return {
        productId: item.productId,
        productTitle: item.product.title,
        quantity: item.quantity,
        unitPriceMinor,
        totalMinor,
        currency,
      };
    });
    const shippingMinor = this.shippingMinor(country, currency);
    const totalMinor = subtotalMinor + shippingMinor;
    if (!Number.isSafeInteger(totalMinor) || totalMinor > 2147483647) {
      throw new BadRequestException('Order amount is too large');
    }
    return { items, subtotalMinor, shippingMinor, totalMinor, currency };
  }

  async quote(customer: Customer, country: string) {
    this.owner(customer);
    if (!/^[A-Z]{2}$/.test(country)) throw new BadRequestException('Invalid country');
    const cart = await this.activeCart(customer);
    return this.calculate(cart, country);
  }

  async create(customer: Customer, dto: CreateCheckoutDto, idempotencyKey: string) {
    const owner = this.owner(customer);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey || '')) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    const idempotencyKeyHash = this.hash(`${owner}:${idempotencyKey}`);
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKeyHash },
      include: { items: true, attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (existing) return this.checkoutResponse(existing);

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const cart = await tx.cart.findFirst({
          where: customer.userId
            ? { userId: customer.userId, status: 'ACTIVE' }
            : { anonymousId: customer.anonymousId, status: 'ACTIVE' },
        });
        if (!cart) throw new BadRequestException('Cart is empty');
        await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cart.id} AND status = 'ACTIVE' FOR UPDATE`;
        const lockedCart = await tx.cart.findFirst({
          where: { id: cart.id, status: 'ACTIVE' },
          include: { items: { include: { product: true } } },
        });
        if (!lockedCart || lockedCart.items.length === 0) throw new BadRequestException('Cart is empty');
        const amount = this.calculate(lockedCart, dto.shippingCountry);
        const created = await tx.order.create({
          data: {
            userId: customer.userId,
            anonymousIdHash: customer.anonymousId ? this.hash(customer.anonymousId) : null,
            cartId: cart.id,
            idempotencyKeyHash,
            status: 'PENDING',
            currency: amount.currency,
            subtotalMinor: amount.subtotalMinor,
            shippingMinor: amount.shippingMinor,
            totalMinor: amount.totalMinor,
            shippingCountry: dto.shippingCountry,
            shippingAddress: dto.shippingAddress.trim(),
            shippingCity: dto.shippingCity.trim(),
            shippingRegion: dto.shippingRegion?.trim(),
            shippingPostalCode: dto.shippingPostalCode.trim(),
            customerEmail: dto.customerEmail.toLowerCase().trim(),
            customerFirstName: dto.customerFirstName.trim(),
            customerLastName: dto.customerLastName.trim(),
            customerPhone: dto.customerPhone?.trim(),
            items: { create: amount.items },
            attempts: { create: { reference: randomUUID(), amountMinor: amount.totalMinor, currency: amount.currency } },
          },
          include: { items: true, attempts: true },
        });
        const frozen = await tx.cart.updateMany({
          where: { id: cart.id, status: 'ACTIVE' },
          data: { status: 'CHECKED_OUT' },
        });
        if (frozen.count !== 1) throw new ConflictException('Cart changed during checkout');
        return created;
      });
      return this.checkoutResponse(order);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const order = await this.prisma.order.findUnique({
          where: { idempotencyKeyHash },
          include: { items: true, attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (order) return this.checkoutResponse(order);
      }
      throw error;
    }
  }

  private checkoutResponse(order: any) {
    const attempt = order.attempts[0];
    return {
      orderId: order.id,
      status: order.status,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      shippingMinor: order.shippingMinor,
      totalMinor: order.totalMinor,
      payment: order.status === 'PENDING' && attempt?.status === 'CREATED'
        ? this.isMockMode()
          ? {
              provider: 'mock',
              method: 'POST',
              action: `/checkout/orders/${order.id}/mock-payment`,
              allowedOutcomes: ['approved', 'declined'],
            }
          : this.gateway.form(order, attempt)
        : null,
    };
  }

  async get(customer: Customer, id: string) {
    this.owner(customer);
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (customer.userId ? order.userId !== customer.userId : order.anonymousIdHash !== this.hash(customer.anonymousId!)) {
      throw new NotFoundException('Order not found');
    }
    return { ...this.checkoutResponse(order), items: order.items, paidAt: order.paidAt };
  }

  async retry(customer: Customer, id: string) {
    await this.get(customer, id);
    const order = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING' } });
      if (changed.count !== 1) throw new ConflictException('Payment is not ready for retry');
      const current = await tx.order.findUniqueOrThrow({ where: { id } });
      await tx.paymentAttempt.create({
        data: { orderId: id, reference: randomUUID(), amountMinor: current.totalMinor, currency: current.currency },
      });
      return tx.order.findUniqueOrThrow({
        where: { id },
        include: { items: true, attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
    });
    return this.checkoutResponse(order);
  }

  async mockPayment(customer: Customer, id: string, outcome: 'approved' | 'declined') {
    if (!this.isMockMode()) throw new NotFoundException();
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order || (customer.userId
      ? order.userId !== customer.userId
      : !customer.anonymousId || order.anonymousIdHash !== this.hash(customer.anonymousId))) {
      throw new NotFoundException('Order not found');
    }
    const attempt = order.attempts[0];
    if (!attempt || order.status !== 'PENDING' || attempt.status !== 'CREATED') {
      throw new ConflictException('Payment attempt is no longer pending');
    }
    await this.applyPaymentStatus(attempt, outcome === 'approved' ? 'Approved' : 'Declined', outcome === 'approved' ? '1100' : '1101', true);
    return this.get(customer, id);
  }

  async callback(body: WayForPayCallback) {
    if (this.isMockMode()) throw new NotFoundException();
    if (!body || typeof body.orderReference !== 'string') throw new BadRequestException('Invalid callback');
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { reference: body.orderReference } });
    if (!attempt) throw new NotFoundException('Payment not found');
    this.gateway.verify(body, attempt.amountMinor);
    await this.applyPaymentStatus(attempt, body.transactionStatus, String(body.reasonCode));
    return this.gateway.acknowledge(body.orderReference);
  }

  private async applyPaymentStatus(attempt: PaymentAttempt, status: string, reasonCode: string, strict = false) {
    if (status === 'Approved') {
      await this.prisma.$transaction(async (tx) => {
        const paymentChanged = await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, status: strict ? 'CREATED' : { in: ['CREATED', 'DECLINED'] } },
          data: { status: 'APPROVED', gatewayStatus: status, gatewayReasonCode: reasonCode },
        });
        if (strict && paymentChanged.count !== 1) throw new ConflictException('Payment attempt is no longer pending');
        const changed = await tx.order.updateMany({
          where: { id: attempt.orderId, status: strict ? 'PENDING' : { in: ['PENDING', 'FAILED'] } },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (strict && changed.count !== 1) throw new ConflictException('Order is no longer pending');
        if (changed.count === 1) {
          const order = await tx.order.findUniqueOrThrow({ where: { id: attempt.orderId } });
          await tx.cart.updateMany({ where: { id: order.cartId }, data: { status: 'CHECKED_OUT' } });
        }
      });
    } else if (status === 'Declined' || status === 'Expired') {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, status: 'CREATED' },
          data: { status: 'DECLINED', gatewayStatus: status, gatewayReasonCode: reasonCode },
        });
        if (strict && changed.count !== 1) throw new ConflictException('Payment attempt is no longer pending');
        if (changed.count === 1) {
          const orderChanged = await tx.order.updateMany({ where: { id: attempt.orderId, status: 'PENDING' }, data: { status: 'FAILED' } });
          if (strict && orderChanged.count !== 1) throw new ConflictException('Order is no longer pending');
        }
      });
    } else if (status === 'Refunded' || status === 'Voided') {
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, status: { not: 'REFUNDED' } },
          data: { status: 'REFUNDED', gatewayStatus: status },
        });
        const otherApproved = await tx.paymentAttempt.count({
          where: { orderId: attempt.orderId, id: { not: attempt.id }, status: 'APPROVED' },
        });
        if (otherApproved === 0) {
          await tx.order.updateMany({
            where: { id: attempt.orderId, status: { in: ['PENDING', 'FAILED', 'PAID'] } },
            data: { status: 'REFUNDED' },
          });
        }
      });
    }
  }
}
