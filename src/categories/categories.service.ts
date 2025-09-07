import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDTO } from 'src/DTO/create-category.dto';
import { CategoryResponseDTO } from 'src/DTO/category-response.dto';
import { DmsService } from 'src/dms/dms.service';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private dms: DmsService,
  ) {}

  async getCategories() {
    try {
      const categories = await this.prisma.category.findMany();
      return categories;
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error);
    }
  }

  async createCategory(
    data: CreateCategoryDTO,
    categoryImageFile?: Express.Multer.File,
  ): Promise<CategoryResponseDTO> {
    try {
      const uploaded = categoryImageFile
        ? await this.dms.uploadSingleFile(categoryImageFile)
        : null;
      const category = await this.prisma.category.create({
        data: {
          name: data.name,
          categoryImage: uploaded?.url ?? null,
        },
        select: { id: true, name: true },
      });
      return {
        id: category.id,
        name: category.name,
        categoryImage: uploaded?.url || null,
      };
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(error);
    }
  }
}
