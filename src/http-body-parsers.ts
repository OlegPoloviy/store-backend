import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { MAX_IMPORT_BYTES } from './products/product-import.parser';

export function configureBodyParsers(app: NestExpressApplication) {
  app.use('/products/import', json({ limit: MAX_IMPORT_BYTES }));
  // Nest sees the scoped jsonParser and skips automatic JSON parser registration.
  app.useBodyParser('json');
}
