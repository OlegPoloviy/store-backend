import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DmsModule } from '../dms/dms.module';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';
import { ProductExportController } from './product-export.controller';
import { ProductExportService } from './product-export.service';
import { GoogleShoppingController } from './google-shopping.controller';
import { GoogleShoppingService } from './google-shopping.service';
import { ProductImportCurrencyService } from './product-import-currency.service';

@Module({
  imports: [PrismaModule, DmsModule],
  controllers: [
    ProductsController,
    ProductImportController,
    ProductExportController,
    GoogleShoppingController,
  ],
  providers: [
    ProductsService,
    ProductImportService,
    ProductImportCurrencyService,
    ProductExportService,
    GoogleShoppingService,
  ],
})
export class ProductsModule {}
