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
  Req,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDTO } from '../DTO/create-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from 'src/guards/admin.guard';
import { OptionalJwtAuthGuard } from 'src/guards/optional.guard';
import type { Express } from 'express';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async getAllProducts(@Req() req: any): Promise<any> {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.productsService.getAllProducts(userId);
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

  @UseGuards(OptionalJwtAuthGuard)
  @Get('/category/:category')
  async getProductsByCategory(
    @Req() req,
    @Param('category') category: string,
  ): Promise<any> {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.productsService.getProductsByCategory(category, userId);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('/id/:id')
  async getProductById(@Req() req, @Param('id') id: string): Promise<any> {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.productsService.getProductById(id, userId);
  }
}
