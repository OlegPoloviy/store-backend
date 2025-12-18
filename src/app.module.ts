import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsModule } from './products/products.module';
import { PrismaModule } from './prisma/prisma.module';
import { DmsModule } from './dms/dms.module';
import { CategoriesModule } from './categories/categories.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { FavoritesModule } from './favorites/favorites.module';
import { CollectionsModule } from './collections/collections.module';
import { CartModule } from './cart/cart.module';

@Module({
  imports: [
    ProductsModule,
    PrismaModule,
    DmsModule,
    CategoriesModule,
    AuthModule,
    UserModule,
    FavoritesModule,
    CollectionsModule,
    CartModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
