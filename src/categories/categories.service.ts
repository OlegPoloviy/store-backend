import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDTO } from 'src/DTO/create-category.dto';
import { CategoryResponseDTO } from 'src/DTO/category-response.dto';
import { UpdateCategoryDTO } from 'src/DTO/update-category.dto';
import { DmsService } from 'src/dms/dms.service';
import type { Express } from 'express';

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
        ? await this.dms.uploadSingleFile(categoryImageFile, 'categories')
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

  async updateCategory(
    id: string,
    data: UpdateCategoryDTO,
    categoryImageFile?: Express.Multer.File,
  ): Promise<CategoryResponseDTO> {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Category not found');
    }

    const uploaded = categoryImageFile
      ? await this.dms.uploadSingleFile(categoryImageFile, 'categories')
      : null;

    let category: CategoryResponseDTO;
    try {
      category = await this.prisma.category.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(uploaded && { categoryImage: uploaded.url }),
        },
        select: { id: true, name: true, categoryImage: true },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Category name already exists');
      }
      if (error?.code === 'P2025') {
        throw new NotFoundException('Category not found');
      }
      throw error;
    }

    if (uploaded && current.categoryImage) {
      await this.dms.deleteFilesByUrls([current.categoryImage]);
    }

    return category;
  }
}
