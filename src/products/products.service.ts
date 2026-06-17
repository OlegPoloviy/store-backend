import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDTO } from '../DTO/create-product.dto';
import { UpdateProductDTO } from '../DTO/update-product.dto';
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
    const uploadPromises = files.map((file) =>
      this.dms.uploadSingleFile(file, 'products'),
    );
    const uploadResults = await Promise.all(uploadPromises);
    return uploadResults.map((result) => result.url);
  }

  // --- ОНОВЛЕНИЙ МЕТОД ---
  // Додаємо аргумент userId? (опціональний)
  async getAllProducts(userId?: string) {
    try {
      const products = await this.prisma.product.findMany({
        include: {
          category: true,
          images: true,
          favorites: userId
            ? {
                where: { userId },
              }
            : false,
        },
      });

      // Мапимо результат, додаючи поле isFavorite
      return products.map((product) => {
        const isFavorite = !!(
          product.favorites && product.favorites.length > 0
        );
        const { favorites, ...rest } = product;
        return {
          ...rest,
          isFavorite,
        };
      });
    } catch (error) {
      throw new NotFoundException(error);
    }
  }

  async createProduct(data: CreateProductDTO, files?: Express.Multer.File[]) {
    try {
      const imageUrls = await this.uploadProductImages(files);
      const { seatingCapacity, category, ...rest } = data;
      const transformed = Number(seatingCapacity);

      const productData: Prisma.ProductCreateInput = {
        ...rest,
        seatingCapacity: transformed,
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

  async updateProduct(
    id: string,
    data: UpdateProductDTO,
    files?: Express.Multer.File[],
  ) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: { images: true },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      const imageUrls = await this.uploadProductImages(files);
      const { seatingCapacity, category, images, ...rest } = data;
      const productData = Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== undefined),
      ) as Prisma.ProductUpdateInput;

      if (seatingCapacity !== undefined) {
        productData.seatingCapacity = Number(seatingCapacity);
      }

      if (category !== undefined) {
        productData.category = {
          connectOrCreate: {
            where: { name: category },
            create: { name: category },
          },
        };
      }

      const shouldReplaceImages = images !== undefined;
      const nextImageData = [
        ...(images || []).map((image) => ({
          url: image.url,
          altText: image.alt || data.title || product.title,
        })),
        ...imageUrls.map((url) => ({
          url,
          altText: data.title || product.title,
        })),
      ];

      if (shouldReplaceImages) {
        productData.images = {
          deleteMany: {},
          create: nextImageData,
        };
      } else if (imageUrls.length > 0) {
        productData.images = {
          create: nextImageData,
        };
      }

      const updatedProduct = await this.prisma.product.update({
        where: { id },
        data: productData,
        include: {
          category: true,
          images: true,
        },
      });

      if (shouldReplaceImages) {
        const nextImageUrls = new Set(nextImageData.map((image) => image.url));
        const removedImageUrls = product.images
          .map((image) => image.url)
          .filter((url) => !nextImageUrls.has(url));

        await this.dms.deleteFilesByUrls(removedImageUrls);
      }

      return updatedProduct;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      console.error('Update product error:', error);
      throw new InternalServerErrorException(
        `Failed to update product: ${error.message}`,
      );
    }
  }

  // --- ОНОВЛЕНИЙ МЕТОД ---
  async getProductsByCategory(category: string, userId?: string) {
    try {
      const products = await this.prisma.product.findMany({
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
          // Перевірка favorites
          favorites: userId ? { where: { userId } } : false,
        },
      });

      return products.map((product) => {
        const isFavorite = product.favorites && product.favorites.length > 0;
        const { favorites, ...rest } = product;
        return { ...rest, isFavorite };
      });
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error);
    }
  }

  // --- ОНОВЛЕНИЙ МЕТОД ---
  async getProductById(id: string, userId?: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          category: true,
          images: true,
          // Перевірка favorites
          favorites: userId ? { where: { userId } } : false,
        },
      });

      if (!product) throw new NotFoundException('Product not found');

      const isFavorite = product.favorites && product.favorites.length > 0;
      const { favorites, ...rest } = product;

      return {
        ...rest,
        isFavorite,
      };
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error); // Або re-throw, якщо error вже HTTP exception
    }
  }

  async deleteProduct(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: { images: true },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      await this.dms.deleteFilesByUrls(
        product.images.map((image) => image.url),
      );

      await this.prisma.$transaction([
        this.prisma.productImage.deleteMany({
          where: { productId: id },
        }),
        this.prisma.product.delete({
          where: { id },
        }),
      ]);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Something went wrong with deleting a product',
        error,
      );
    }
  }
}
