import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DmsModule } from '../dms/dms.module';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';
import { ProductExportController } from './product-export.controller';
import { ProductExportService } from './product-export.service';

@Module({
  imports: [PrismaModule, DmsModule],
  controllers: [
    ProductsController,
    ProductImportController,
    ProductExportController,
  ],
  providers: [ProductsService, ProductImportService, ProductExportService],
})
export class ProductsModule {}
