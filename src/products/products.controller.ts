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
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDTO } from './DTO/create-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  async getAllProducts(): Promise<any> {
    return this.productsService.getAllProducts();
  }

  @Post()
  @UseInterceptors(FilesInterceptor('images', 10))
  async createProduct(
    @Body() data: CreateProductDTO,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: '.(jpg|jpeg|png|webp)' }),
        ],
        fileIsRequired: false,
      }),
    )
    files?: Express.Multer.File[],
  ): Promise<any> {
    return this.productsService.createProduct(data, files);
  }

  @Get('/:category')
  async getProductsByCategory(
    @Param('category') category: string,
  ): Promise<any> {
    return this.productsService.getProductsByCategory(category);
  }
}
