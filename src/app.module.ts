import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsModule } from './products/products.module';
import { PrismaModule } from './prisma/prisma.module';
import { DmsModule } from './dms/dms.module';
import { CategoriesModule } from './categories/categories.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [ProductsModule, PrismaModule, DmsModule, CategoriesModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
