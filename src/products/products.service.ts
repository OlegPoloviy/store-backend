import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDTO } from '../DTO/create-product.dto';
import { DmsService } from 'src/dms/dms.service';
import type { Express } from 'express';
import { Prisma } from 'generated/prisma';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private dms: DmsService,
  ) {}

  private async uploadProductImages(
    files: Express.Multer.File[],
  ): Promise<string[]> {
    if (!files || files.length === 0) {
      return [];
    }
    const uploadPromises = files.map((file) => this.dms.uploadSingleFile(file));
    const uploadResults = await Promise.all(uploadPromises);
    return uploadResults.map((result) => result.url);
  }

  async getAllProducts() {
    try {
      const products = await this.prisma.product.findMany({
        include: {
          category: true,
          images: true,
        },
      });
      return products;
    } catch (error) {
      throw new NotFoundException(error);
    }
  }

  async createProduct(data: CreateProductDTO, files?: Express.Multer.File[]) {
    try {
      const imageUrls = await this.uploadProductImages(files);

      // Витягуємо category окремо, бо для неї connectOrCreate
      const { category, ...rest } = data;

      const productData: Prisma.ProductCreateInput = {
        ...rest, // тут залетять всі інші поля, які збігаються з Product
        category: {
          connectOrCreate: {
            where: { name: category },
            create: { name: category },
          },
        },
        images: {
          create: imageUrls.map((url) => ({
            url,
            altText: data.title,
          })),
        },
      };

      const createdProduct = await this.prisma.product.create({
        data: productData,
        include: {
          category: true,
          images: true,
        },
      });

      return createdProduct;
    } catch (error) {
      console.error('Create product error:', error);
      throw new InternalServerErrorException(
        `Failed to create product: ${error.message}`,
      );
    }
  }

  async getProductsByCategory(category: string) {
    try {
      const product = await this.prisma.product.findMany({
        where: {
          category: {
            name: {
              equals: category,
              mode: 'insensitive',
            },
          },
        },
        include: {
          category: true,
          images: true,
        },
      });

      return product;
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error);
    }
  }

  async getProductById(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          category: true,
          images: true,
        },
      });

      return product;
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error);
    }
  }

  async getCategories() {
    try {
      const categories = await this.prisma.category.findMany();
      return categories;
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error);
    }
  }
}
