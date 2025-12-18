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
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AuthGuard } from '@nestjs/passport';
import { AddToCartDto } from 'src/DTO/add-to-cart.dto';
import { OptionalJwtAuthGuard } from 'src/guards/optional.guard';

@Controller('cart')
export class CartController {
  constructor(private cartService: CartService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('items')
  async addToCart(
    @Body() dto: AddToCartDto,
    @Headers('x-anonymous-id') anonymousId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;
    // Якщо це перший візит, anonymousId може не бути,
    // але зазвичай його генерують на клієнті при старті сесії.
    // Якщо прийшов null для обох - сервіс викине помилку.

    return this.cartService.addToCart(userId, anonymousId, dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async getCart(
    @Headers('x-anonymous-id') anonymousId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.cartService.getCart(userId, anonymousId);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Delete('items/:productId')
  async removeCartItem(
    @Param('productId') productId: string,
    @Headers('x-anonymous-id') anonymousId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.cartService.removeItem(userId, anonymousId, productId);
  }
}
