import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
  BadRequestException,
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

      const { category, ...rest } = data;

      const productData: Prisma.ProductCreateInput = {
        ...rest,
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

  async addToFavorite(userId: string, productId: string) {
    try {
      // Verify user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      // Verify product exists
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundException(`Product with ID ${productId} not found`);
      }

      // Check if favorite already exists
      const existingFavorite = await this.prisma.favorite.findUnique({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });

      if (existingFavorite) {
        throw new ConflictException('Product is already in favorites');
      }

      // Create favorite
      const favorite = await this.prisma.favorite.create({
        data: {
          userId,
          productId,
        },
        include: {
          product: {
            include: {
              category: true,
              images: true,
            },
          },
        },
      });

      return favorite;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Add to favorite error:', error);
      throw new InternalServerErrorException(
        `Failed to add product to favorites: ${error.message}`,
      );
    }
  }

  async removeFromFavorites(userId: string, productId: string) {
    try {
      const favorite = await this.prisma.favorite.findUnique({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });

      if (!favorite) {
        throw new NotFoundException(
          'Product is not in favorites or favorite not found',
        );
      }

      // Delete the favorite
      await this.prisma.favorite.delete({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });

      return { message: 'Product removed from favorites successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Remove from favorite error:', error);
      throw new InternalServerErrorException(
        `Failed to remove product from favorites: ${error.message}`,
      );
    }
  }

  async getFavoriteStatus(userId: string, productId: string) {
    try {
      const favorite = await this.prisma.favorite.findUnique({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });

      return {
        isFavorite: !!favorite,
        productId,
      };
    } catch (error) {
      console.error('Get favorite status error:', error);
      throw new InternalServerErrorException(
        `Failed to get favorite status: ${error.message}`,
      );
    }
  }
}
