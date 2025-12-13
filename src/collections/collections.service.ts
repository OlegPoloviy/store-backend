import {
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
}
