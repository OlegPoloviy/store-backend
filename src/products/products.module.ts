import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DmsModule } from '../dms/dms.module';

@Module({
  imports: [PrismaModule, DmsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
