import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CollectionInputDTO } from 'src/DTO/collection.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CollectionsService {
  constructor(private prismaService: PrismaService) {}

  async createCollection(userId: string, data: CollectionInputDTO) {
    try {
      const collection = await this.prismaService.collection.create({
        data: {
          name: data.name,
          isPrivate: data.isPrivate,
          user: {
            connect: { id: userId },
          },
        },
      });

      return collection;
    } catch (error) {
      console.error('Create collection error:', error);
      throw new InternalServerErrorException(
        `Failed to create collection: ${error.message}`,
      );
    }
  }

  async getColletions(userId: string) {
    try {
      const collections = await this.prismaService.collection.findMany({
        where: {
          userId: userId,
        },
      });

      return collections;
    } catch (error) {
      throw new NotFoundException('Cant found any collections for this user');
    }
  }

  async addItem(userId: string, collectionId: string, itemId: string) {
    const collection = await this.prismaService.collection.findFirst({
      where: {
        id: collectionId,
        userId: userId,
      },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    try {
      return await this.prismaService.collectionItem.create({
        data: {
          collectionId: collectionId,
          productId: itemId,
        },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('This item is already in your collection');
      }
      throw error;
    }
  }

  async getItemsByCollection(userId: string, collectionId: string) {
    const collectionWithItems = await this.prismaService.collection.findUnique({
      where: {
        id: collectionId,
      },
      include: {
        collectionItems: {
          include: {
            product: {
              include: {
                images: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!collectionWithItems || collectionWithItems.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return collectionWithItems.collectionItems;
  }
}
