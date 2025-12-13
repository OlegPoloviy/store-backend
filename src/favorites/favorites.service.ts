import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product } from 'generated/prisma';

@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

  async getAllFavoriteProducts(userId: string): Promise<Product[]> {
    try {
      const favorites = await this.prisma.favorite.findMany({
        where: { userId },
        include: {
          product: {
            include: {
              category: true,
              images: true,
            },
          },
        },
      });
      return favorites.map((fav) => fav.product);
    } catch (error) {
      console.error('Get all favorites error:', error);
      throw new NotFoundException('Cannot find users favorite products');
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
