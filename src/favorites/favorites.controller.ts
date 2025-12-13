import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  BadRequestException,
  UnauthorizedException,
  Delete,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(AuthGuard('jwt'))
export class FavoritesController {
  constructor(private favoritesService: FavoritesService) {}

  @Get()
  async getAllFavorites(@Request() req: any) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    return this.favoritesService.getAllFavoriteProducts(userId);
  }

  @Post()
  async addToFavorite(
    @Request() req: any,
    @Body() body: { productId: string },
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    if (!body.productId) {
      throw new BadRequestException('Product ID is required');
    }

    return this.favoritesService.addToFavorite(userId, body.productId);
  }

  @Delete()
  async removeFromFavorites(
    @Request() req: any,
    @Body() body: { productId: string },
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    if (!body.productId) {
      throw new BadRequestException('Product ID is required');
    }

    return this.favoritesService.removeFromFavorites(userId, body.productId);
  }

  @Get('status/:productId')
  async getFavoriteStatus(
    @Request() req: any,
    @Param('productId') productId: string,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    if (!productId) {
      throw new BadRequestException('Product ID is required');
    }

    return this.favoritesService.getFavoriteStatus(userId, productId);
  }
}
