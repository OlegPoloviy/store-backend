import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartSessionService } from './cart-session.service';
import { CartController } from './cart.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CartService, CartSessionService],
  exports: [CartSessionService],
  controllers: [CartController],
})
export class CartModule {}
