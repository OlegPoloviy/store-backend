import {
  Controller,
  Post,
  UseGuards,
  Body,
  Headers,
  Req,
  Get,
  Delete,
  Param,
  Patch,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from 'src/DTO/add-to-cart.dto';
import { OptionalJwtAuthGuard } from 'src/guards/optional.guard';
import { CartSessionService } from './cart-session.service';
import { IsIn } from 'class-validator';

class UpdateQuantityDto {
  @IsIn(['increase', 'decrease'])
  action: 'increase' | 'decrease';
}

@Controller('cart')
export class CartController {
  constructor(
    private cartService: CartService,
    private cartSession: CartSessionService,
  ) {}

  @Post('session')
  createSession() {
    return { cartToken: this.cartSession.create() };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post('items')
  async addToCart(
    @Body() dto: AddToCartDto,
    @Headers('x-cart-token') cartToken: string,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;
    // Якщо це перший візит, anonymousId може не бути,
    // але зазвичай його генерують на клієнті при старті сесії.
    // Якщо прийшов null для обох - сервіс викине помилку.

    return this.cartService.addToCart(userId, this.cartSession.parse(cartToken), dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async getCart(
    @Headers('x-cart-token') cartToken: string,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.cartService.getCart(userId, this.cartSession.parse(cartToken));
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Delete('items/:itemId')
  async removeCartItem(
    @Param('itemId') itemId: string,
    @Headers('x-cart-token') cartToken: string,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.cartService.removeItem(userId, this.cartSession.parse(cartToken), itemId);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Patch('items/:itemId/quantity')
  async updateQuantity(
    @Param('itemId') itemId: string,
    @Headers('x-cart-token') cartToken: string,
    @Body() body: UpdateQuantityDto,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.cartService.updateItemQuantity(
      userId,
      this.cartSession.parse(cartToken),
      itemId,
      body.action,
    );
  }
}
