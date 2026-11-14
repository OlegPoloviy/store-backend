import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DmsModule } from '../dms/dms.module';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';

@Module({
  imports: [PrismaModule, DmsModule],
  controllers: [ProductsController, ProductImportController],
  providers: [ProductsService, ProductImportService],
})
export class ProductsModule {}
