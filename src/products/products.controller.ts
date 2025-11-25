import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UseGuards,
  Request,
  BadRequestException,
  UnauthorizedException,
  Delete,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDTO } from '../DTO/create-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from 'src/guards/admin.guard';
import type { Express } from 'express';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  async getAllProducts(): Promise<any> {
    return this.productsService.getAllProducts();
  }

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Post()
  @UseInterceptors(FilesInterceptor('images', 10))
  async createProduct(
    @Body('data') dataString: string,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: '.(jpg|jpeg|png|webp)' }),
        ],
        fileIsRequired: false,
      }),
    )
    files?: Express.Multer.File[],
  ): Promise<any> {
    // Parse the JSON string to get the CreateProductDTO object
    const productData: CreateProductDTO = JSON.parse(dataString);

    return this.productsService.createProduct(productData, files);
  }

  @Get('/category/:category')
  async getProductsByCategory(
    @Param('category') category: string,
  ): Promise<any> {
    return this.productsService.getProductsByCategory(category);
  }

  @Get('/id/:id')
  async getProductById(@Param('id') id: string): Promise<any> {
    return this.productsService.getProductById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/favorite')
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

    return this.productsService.addToFavorite(userId, body.productId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('/favorite')
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

    return this.productsService.removeFromFavorites(userId, body.productId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('/favorite/status/:productId')
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

    return this.productsService.getFavoriteStatus(userId, productId);
  }
}
