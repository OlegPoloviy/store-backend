import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Order, OrderItem, PaymentAttempt } from 'generated/prisma';
import { fromMinor, toMinor } from './money';

export type WayForPayCallback = {
  merchantAccount: string;
  orderReference: string;
  merchantSignature: string;
  amount: number | string;
  currency: string;
  authCode: string;
  cardPan: string;
  transactionStatus: string;
  reasonCode: number | string;
};

@Injectable()
export class WayForPayService {
  constructor(private readonly config: ConfigService) {}

  private value(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) throw new Error(`${name} is required`);
    return value;
  }

  private httpsUrl(name: string): string {
    const value = this.value(name);
    if (!value.startsWith('https://')) throw new Error(`${name} must use HTTPS`);
    return value;
  }

  private sign(values: Array<string | number>): string {
    return createHmac('md5', this.value('WAYFORPAY_SECRET_KEY'))
      .update(values.join(';'), 'utf8')
      .digest('hex');
  }

  form(order: Order & { items: OrderItem[] }, attempt: PaymentAttempt) {
    const productName = order.items.map((item) => item.productTitle);
    const productCount = order.items.map((item) => item.quantity);
    const productPrice = order.items.map((item) => fromMinor(item.unitPriceMinor));
    if (order.shippingMinor > 0) {
      productName.push('Shipping');
      productCount.push(1);
      productPrice.push(fromMinor(order.shippingMinor));
    }
    const fields = {
      merchantAccount: this.value('WAYFORPAY_MERCHANT_ACCOUNT'),
      merchantDomainName: this.value('WAYFORPAY_DOMAIN'),
      merchantTransactionType: 'SALE',
      merchantTransactionSecureType: 'AUTO',
      orderReference: attempt.reference,
      orderDate: Math.floor(attempt.createdAt.getTime() / 1000),
      amount: fromMinor(order.totalMinor),
      currency: 'UAH',
      productName,
      productCount,
      productPrice,
      clientFirstName: order.customerFirstName,
      clientLastName: order.customerLastName,
      clientEmail: order.customerEmail,
      clientPhone: order.customerPhone || undefined,
      clientAddress: order.shippingAddress,
      clientCity: order.shippingCity,
      serviceUrl: this.httpsUrl('WAYFORPAY_SERVICE_URL'),
      returnUrl: this.httpsUrl('WAYFORPAY_RETURN_URL'),
      language: 'EN',
    };
    const merchantSignature = this.sign([
      fields.merchantAccount,
      fields.merchantDomainName,
      fields.orderReference,
      fields.orderDate,
      fields.amount,
      fields.currency,
      ...productName,
      ...productCount,
      ...productPrice,
    ]);
    return { action: 'https://secure.wayforpay.com/pay', method: 'POST', fields: { ...fields, merchantSignature } };
  }

  verify(callback: WayForPayCallback, amountMinor: number): void {
    if (callback.merchantAccount !== this.value('WAYFORPAY_MERCHANT_ACCOUNT') || callback.currency !== 'UAH') {
      throw new BadRequestException('Invalid payment merchant or currency');
    }
    const signature = this.sign([
      callback.merchantAccount,
      callback.orderReference,
      callback.amount,
      callback.currency,
      callback.authCode,
      callback.cardPan,
      callback.transactionStatus,
      callback.reasonCode,
    ]);
    const expected = Buffer.from(signature, 'ascii');
    const received = Buffer.from(callback.merchantSignature || '', 'ascii');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BadRequestException('Invalid payment signature');
    }
    if (toMinor(callback.amount) !== amountMinor) {
      throw new BadRequestException('Payment amount mismatch');
    }
  }

  acknowledge(reference: string) {
    const time = Math.floor(Date.now() / 1000);
    const status = 'accept';
    return { orderReference: reference, status, time, signature: this.sign([reference, status, time]) };
  }
}
