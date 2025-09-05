import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDTO } from 'src/DTO/create-category.dto';
import { CategoryResponseDTO } from 'src/DTO/category-response.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async getCategories() {
    try {
      const categories = await this.prisma.category.findMany();
      return categories;
    } catch (error) {
      console.error(error);
      throw new NotFoundException(error);
    }
  }

  async createCategory(data: CreateCategoryDTO): Promise<CategoryResponseDTO> {
    try {
      const category = await this.prisma.category.create({
        data,
        select: { id: true, name: true, categoryImage: true },
      });
      return {
        id: category.id,
        name: category.name,
        categoryImage: category.categoryImage || null,
      };
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(error);
    }
  }
}
