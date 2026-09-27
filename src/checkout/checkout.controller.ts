import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from 'src/guards/optional.guard';
import { CartSessionService } from 'src/cart/cart-session.service';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutDto, MockPaymentDto } from './checkout.dto';
import { WayForPayCallback } from './wayforpay.service';

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly cartSession: CartSessionService,
  ) {}

  private customer(req: any, cartToken?: string) {
    const user = req.user;
    return {
      userId: user?.sub || user?.user_id || user?.id || null,
      anonymousId: this.cartSession.parse(cartToken),
    };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('quote')
  quote(@Req() req: any, @Headers('x-cart-token') cartToken: string, @Query('country') country: string) {
    return this.checkout.quote(this.customer(req, cartToken), country);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(
    @Req() req: any,
    @Headers('x-cart-token') cartToken: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.checkout.create(this.customer(req, cartToken), dto, idempotencyKey);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('orders/:id')
  get(@Req() req: any, @Headers('x-cart-token') cartToken: string, @Param('id') id: string) {
    return this.checkout.get(this.customer(req, cartToken), id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post('orders/:id/retry')
  retry(@Req() req: any, @Headers('x-cart-token') cartToken: string, @Param('id') id: string) {
    return this.checkout.retry(this.customer(req, cartToken), id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post('orders/:id/mock-payment')
  mockPayment(
    @Req() req: any,
    @Headers('x-cart-token') cartToken: string,
    @Param('id') id: string,
    @Body() dto: MockPaymentDto,
  ) {
    return this.checkout.mockPayment(this.customer(req, cartToken), id, dto.outcome);
  }

  @Post('wayforpay/webhook')
  webhook(@Body() body: WayForPayCallback) {
    return this.checkout.callback(body);
  }
}
