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

### Batch product import

In the admin panel, open **Product management → Batch import**. Choose a
file, validate it, then select **Import batch**. The dialog includes a CSV
template for the catalog format. Each batch accepts up to 5 MiB and 500 products.

`POST /products/import` requires an admin JWT and supports these inputs:

- **Excel (.xlsx)** uses the first worksheet and treats the first populated row
  as the header. Store SKUs and GTINs as text to preserve leading zeroes.
  Save older `.xls` workbooks as `.xlsx` or CSV. Use ISO 8601 text for timestamps.
- **CSV and TSV** use UTF-8 and a header row. CSV accepts commas, semicolons
  or tabs. Quote cells containing delimiters or line breaks. In catalog tables,
  separate URLs in the `images` cell with semicolons. For Google Shopping tables,
  use semicolons in `additional_image_link`.
- **XML** accepts Google Shopping RSS or Atom feeds and catalog XML structured
  as `<products><product>…</product></products>`. Catalog product elements use
  the same field names as JSON. For multiple images use
  `<images><image>https://example.com/bench.jpg</image></images>`
  with an `image` element per URL. Use CDATA or escaped text for HTML descriptions.
- **JSON** accepts the object shown below as an `application/json` request
  or a UTF-8 `.json` upload.

Upload files in the multipart field `file`. For Excel, CSV, TSV and XML,
set `locale` as a query parameter and optionally set `format` to `catalog`,
`horoshop`, `google-shopping` or `auto` (the default). For all uploaded files,
`?dryRun=true` validates the batch without saving it and takes precedence over
the `dryRun` value inside a JSON file.

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" -F "file=@catalog.xlsx" \
  "http://localhost:3001/products/import?locale=uk&format=auto&dryRun=true"
```

```json
{
  "format": "catalog",
  "locale": "en-GB",
  "dryRun": true,
  "products": [
    {
      "sku": "KM-001",
      "title": "Oak bench",
      "description": "<p>Made from solid oak.</p>",
      "price": "179.90",
      "currency": "EUR",
      "category": "Benches",
      "images": ["https://example.com/images/oak-bench.jpg"],
      "identifier_exists": false,
      "is_made_to_order": true,
      "production_time_days": "10-14",
      "production_day_type": "business"
    }
  ]
}
```

- `catalog` accepts the fields above and optional `brand`, `slug`, `link`, `color`,
  `original_price`, `is_published`, `availability`, `availability_date` (ISO timestamp
  with timezone), `gtin` and `mpn`. Use `business` or `calendar` for production days.
  An integer such as `14` sets both ends of the range. If supplied, the first photo
  is the main image. Preserve SKUs and GTINs as strings to retain leading zeroes.
- `horoshop` reads the original column headers. For example, choose the locale
  `uk` for `Название(UA)` and
  `Описание товара(UA)`. The selected locale needs a title and description.
  The supplied spreadsheet has Ukrainian and Russian copy. To publish an English
  version, import English copy with the same SKUs and `locale: "en"`. The service
  merges localized titles and descriptions, and the selected locale becomes the
  product's primary language. The source data keeps the original columns and HTML.
  `Під замовлення` sets the made-to-order flag. If the import omits the
  production lead time, the preview reports that the import will keep an
  existing lead time or set 14 business days. A Google availability value can
  be supplied explicitly.
- `google-shopping` accepts rows with Google Shopping attribute names,
  optionally prefixed with `g:`. It maps `id` to SKU, parses prices such as
  `179.90 EUR`, and uses `image_link` followed by `additional_image_link`.
  Set `category`, `product_type`, or `google_product_category`. HTML descriptions
  are cleaned for catalog display.

`dryRun: true` returns validation results without database writes. A live
request with row errors returns `422` and imports zero products. Reports
contain `total`, `valid`, `imported`, `dryRun`, `errors` and `warnings`, with
one-based product indexes. A successful live request writes the whole batch
in one transaction. The SKU identifies existing records, retaining their UUID.
Existing catalog records can be linked before importing by explicitly assigning
their corresponding SKUs. The import creates missing category names and stores
image URLs in the supplied order. It preserves prices and currencies as provided.

```bash
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
# or
SUPABASE_ANON_KEY="your-anon-key"
```

Use a Supabase API key from Project Settings > API. Do not use the JWT secret
as the Storage API bearer token.

### Product export

Open **Product management → Export products** and choose JSON, Excel (.xlsx),
or CSV. Each download contains the whole catalog, including unpublished products
and products without SKUs, regardless of the filters on the admin page.

`GET /products/export?format=json|xlsx|csv` requires an admin JWT and returns an
attachment. The JSON response contains a `products` array with category names,
image URLs, image details, and translations. Excel and UTF-8 CSV use the same
field names as column headers and represent lists and objects as JSON in cells.
Excel preserves SKUs and GTINs as text and uses numeric cells for prices and
measurements. CSV prefixes formula-like text with an apostrophe for spreadsheet
safety.

JSON, XLSX and CSV catalog exports can be imported back through Batch import.
Each row keeps its saved locale, translations, dimensions, product details,
image descriptions, main image and image order. Imports match by SKU when
present and by the exported product UUID for records without a SKU. The UUID of
a product matched by SKU, its creation timestamp and its update timestamp are
managed by the store. Horoshop-specific source columns are kept with the original
import source. Split any export over 500 products or 5 MiB into smaller batches
before reimporting.

### Optional currency conversion at import

Select **Add USD and EUR prices for UAH products** in Batch import to fetch the
current official NBU rates during validation. The preview shows the rate date
and the converted amounts. Confirming the same file within 15 minutes reuses
the rates shown in the preview. The server signs the quote with
`CART_SESSION_SECRET`, which must contain at least 32 characters. An expired
quote or a changed file requires a new preview. Other currencies already in the
file keep their original amounts.

Imported UAH prices remain the checkout and feed prices. The store saves USD
and EUR as additional, approximate prices on the product, with the old prices
when available. These amounts are a snapshot of the confirmed import and are
recalculated only when conversion is selected on another import. A change to
the source price clears the previous conversion. Apply the Prisma migration
before starting the updated backend.

Validation also compares the file with the current catalog. The report counts
new, updated and unchanged products and lists the fields that would change for
each updated product. This comparison includes converted prices, image details
and translations. It ignores system timestamps and the retained source copy.

### Estimated dispatch and Google Shopping feed

`GET /products/id/:id` returns `estimatedDispatch` with `earliestDate` and
`latestDate` as `YYYY-MM-DD` for made-to-order products available for purchase.
Both dates are equal for a fixed lead time. The estimate uses the current date
in `Europe/Kyiv` and the product's stored lead time, with a fallback of 14
business days. Business days are Monday through Friday. The calculation skips
weekends and does not apply a holiday calendar or an order cutoff.

Configure `GOOGLE_SHOPPING_STORE_URL` and `GOOGLE_SHOPPING_PRODUCT_PATH` with the
public storefront's URL and actual product route. The route template accepts
`{id}` for the product UUID or `{slug}` for the storefront slug. Set
`GOOGLE_SHOPPING_STORE_NAME` to use a channel name other than the storefront's
hostname.

`GET /feeds/google-shopping.xml` serves public RSS 2.0 XML generated on each
request from the published UAH catalog. It uses the current selling price and
includes products saved in `GOOGLE_SHOPPING_LANGUAGE` (default `uk`), including
regional variants such as `uk-UA`. Products without a saved locale are assumed
to use the configured language. Products missing required offer data, including
a future availability date for preorder or backorder, are skipped. Made-to-order
offers use the Google availability status and per-product handling time in
business days. Made-to-order products with a calendar-day lead time are skipped
by this feed. The storefront proxies the same path to the backend. Set country,
language and delivery settings in Merchant Center and schedule a daily fetch of
the deployed feed URL.

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
