import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CartModule } from 'src/cart/cart.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { WayForPayService } from './wayforpay.service';

@Module({
  imports: [ConfigModule, CartModule, PrismaModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, WayForPayService],
})
export class CheckoutModule {}
