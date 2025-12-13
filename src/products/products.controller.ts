import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UseGuards,
  Delete,
  BadRequestException,
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
    if (!dataString) {
      throw new BadRequestException('Product data is required');
    }

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

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Delete('/:id')
  async deleteProduct(@Param('id') id: string) {
    return this.productsService.deleteProduct(id);
  }
}
