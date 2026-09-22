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
  Patch,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDTO } from '../DTO/create-product.dto';
import { UpdateProductDTO } from '../DTO/update-product.dto';
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

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Patch('/id/:id')
  @UseInterceptors(FilesInterceptor('images', 10))
  async updateProduct(
    @Param('id') id: string,
    @Body() body?: UpdateProductDTO & { data?: string | UpdateProductDTO },
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
    let productData: UpdateProductDTO = {};
    const dataPayload = body?.data;

    if (typeof dataPayload === 'string') {
      try {
        productData = JSON.parse(dataPayload);
      } catch {
        throw new BadRequestException('Invalid product data JSON');
      }
    } else if (dataPayload) {
      productData = dataPayload;
    } else if (body) {
      const { data, ...plainBody } = body;
      productData = plainBody;
    }

    if (
      Object.keys(productData).length === 0 &&
      (!files || files.length === 0)
    ) {
      throw new BadRequestException('Product update data is required');
    }

    return this.productsService.updateProduct(id, productData, files);
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

  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @Delete('/id/:id')
  async deleteProduct(@Param('id') id: string): Promise<{ message: string }> {
    await this.productsService.deleteProduct(id);
    return { message: 'Product deleted successfully' };
  }
}
