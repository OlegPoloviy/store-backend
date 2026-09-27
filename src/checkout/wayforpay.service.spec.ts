import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { WayForPayService } from './wayforpay.service';
import { toMinor } from './money';

const settings: Record<string, string> = {
  WAYFORPAY_SECRET_KEY: '0123456789abcdef0123456789abcdef',
  WAYFORPAY_MERCHANT_ACCOUNT: 'test_merchant',
  WAYFORPAY_DOMAIN: 'example.com',
  WAYFORPAY_SERVICE_URL: 'https://example.com/checkout/wayforpay/webhook',
  WAYFORPAY_RETURN_URL: 'https://example.com/payment-result',
};
const gateway = new WayForPayService({ get: (key: string) => settings[key] } as ConfigService);

describe('WayForPay payment integrity', () => {
  it('signs exactly the fields sent to the hosted payment page', () => {
    const order = {
      totalMinor: 154736,
      shippingMinor: 0,
      customerFirstName: 'Ada',
      customerLastName: 'Lovelace',
      customerEmail: 'ada@example.com',
      shippingAddress: '1 Main St',
      shippingCity: 'London',
      shippingCountry: 'GB',
      items: [
        { productTitle: 'Chair', quantity: 1, unitPriceMinor: 100000 },
        { productTitle: 'Table', quantity: 1, unitPriceMinor: 54736 },
      ],
    };
    const attempt = { reference: 'pay-123', createdAt: new Date(1415379863 * 1000) };
    const form = gateway.form(order as any, attempt as any);
    const expected = createHmac('md5', settings.WAYFORPAY_SECRET_KEY)
      .update('test_merchant;example.com;pay-123;1415379863;1547.36;UAH;Chair;Table;1;1;1000.00;547.36')
      .digest('hex');
    expect(form.fields.merchantSignature).toBe(expected);
    expect(form.action).toBe('https://secure.wayforpay.com/pay');
  });

  it('rejects a forged signature and a changed amount', () => {
    const body = {
      merchantAccount: 'test_merchant', orderReference: 'pay-123', amount: 1547.36,
      currency: 'UAH', authCode: '123', cardPan: '42****4242',
      transactionStatus: 'Approved', reasonCode: 1100, merchantSignature: '',
    };
    const signed = [body.merchantAccount, body.orderReference, body.amount, body.currency,
      body.authCode, body.cardPan, body.transactionStatus, body.reasonCode].join(';');
    body.merchantSignature = createHmac('md5', settings.WAYFORPAY_SECRET_KEY).update(signed).digest('hex');
    expect(() => gateway.verify(body, 154736)).not.toThrow();
    expect(() => gateway.verify({ ...body, merchantSignature: '0'.repeat(32) }, 154736)).toThrow();
    expect(() => gateway.verify(body, 154735)).toThrow();
  });

  it('rejects fractions of a minor unit', () => {
    expect(() => toMinor('1.001')).toThrow();
    expect(toMinor('1.01')).toBe(101);
  });
});
