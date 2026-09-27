<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Environment

### Secure checkout (WayForPay)

Copy the checkout settings from `.env.example` and supply real merchant credentials. The payment is charged in UAH. `CHECKOUT_SHIPPING_RATES_UAH_JSON` contains country codes and shipping charges in kopiykas; checkout rejects unconfigured countries and products not priced in UAH. Configure the real shipping charge for every supported destination before accepting orders. The current implementation does not calculate VAT, sales tax, import duties or inventory reservations; settle those policies before enabling a country.

Apply the Prisma migrations and generate the client before running the API. The existing Supabase database contains cart, favorite and collection tables that were previously created outside migration history. Use `migrate deploy` against that database; do not accept a `migrate dev` prompt to reset it:

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Guest cart tokens are bearer credentials. Store them privately and send them in `x-cart-token`; the former `x-anonymous-id` header is no longer accepted. Authenticated callers can use their JWT without a cart token. The callback route must be reachable over HTTPS at `WAYFORPAY_SERVICE_URL`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/cart/session` | Create a signed guest cart token. |
| `POST` | `/cart/items` | Add an item (`productId`, `quantity`). |
| `GET` | `/cart` | Current cart and server-side current prices. |
| `PATCH` | `/cart/items/:itemId/quantity` | Body: `{ "action": "increase" }` or `decrease`. |
| `DELETE` | `/cart/items/:itemId` | Remove an item from the caller's cart. |
| `GET` | `/checkout/quote?country=DE` | Current UAH item and shipping amounts in kopiykas. |
| `POST` | `/checkout` | Create frozen order; requires `Idempotency-Key` UUID and shipping/customer body below. |
| `GET` | `/checkout/orders/:id` | Read own order status and items. |
| `POST` | `/checkout/orders/:id/retry` | New payment attempt only after an explicit failed callback. |
| `POST` | `/checkout/orders/:id/mock-payment` | Local mock result (`approved` or `declined`), available only in mock mode. |
| `POST` | `/checkout/wayforpay/webhook` | WayForPay callback, HMAC verified; never call from the browser. |

`POST /checkout` body:

```json
{
  "customerEmail": "buyer@example.com",
  "customerFirstName": "Ada",
  "customerLastName": "Lovelace",
  "customerPhone": "+123456789",
  "shippingCountry": "DE",
  "shippingAddress": "Example Str. 1",
  "shippingCity": "Berlin",
  "shippingRegion": "Berlin",
  "shippingPostalCode": "10115"
}
```

The response includes `orderId`, totals in kopiykas, and `payment: { action, method, fields }`. Submit `fields` as an HTML POST form to the supplied `action`; array values use the form names `productName[]`, `productCount[]` and `productPrice[]`. Never treat a browser redirect as proof of payment: poll `GET /checkout/orders/:id` until the verified callback sets `PAID`. The same idempotency key returns the same order and payment attempt. A failed attempt can be retried using the retry endpoint; pending attempts cannot be retried.

The server checks the WayForPay callback signature, merchant, amount, currency, and payment reference before changing order state. Repeated callbacks are safe. Card data is handled only on WayForPay's hosted page.

### Local mock payment

Set `NODE_ENV=development`, `PAYMENT_MODE=mock`, and `MOCK_SHIPPING_RATES_MINOR_JSON`. The API binds to `127.0.0.1` in this mode and never calls WayForPay; real WayForPay credentials are not required. A production process refuses to start with mock payments enabled. Mock mode accepts UAH, USD, and EUR products in a single-currency cart and uses explicit mock country shipping rates in the same currency's minor units. Real WayForPay checkout still accepts UAH only. Use a local database with the checkout migration applied. Then:

1. `POST /cart/session`; keep the returned `cartToken` as the `x-cart-token` header for guest requests.
2. Add a product with `POST /cart/items`, then call `GET /checkout/quote?country=DE`.
3. Create the order with `POST /checkout` and a fresh UUID `Idempotency-Key`. The response contains `payment.provider: "mock"` and its action URL.
4. `POST /checkout/orders/:id/mock-payment` with `{ "outcome": "approved" }` or `{ "outcome": "declined" }`, using the same cart token or JWT. Read the result with `GET /checkout/orders/:id`.

Mock approval produces `PAID`; mock decline produces `FAILED`, after which `/retry` creates a new attempt. These calls simulate database state transitions only; they do not test WayForPay's hosted page, callback delivery, or bank authorization.

Image uploads use Supabase Storage bucket `product-images`.

```bash
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
# or
SUPABASE_ANON_KEY="your-anon-key"
```

Use a Supabase API key from Project Settings > API. Do not use the JWT secret
as the Storage API bearer token.

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
