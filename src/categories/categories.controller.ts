import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { CategoriesService } from './categories.service';
import { AdminGuard } from 'src/guards/admin.guard';
import { CreateCategoryDTO } from 'src/DTO/create-category.dto';
import { CategoryResponseDTO } from 'src/DTO/category-response.dto';
import { UpdateCategoryDTO } from 'src/DTO/update-category.dto';
import type { Express } from 'express';

@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  async getCategories(): Promise<any> {
    return this.categoriesService.getCategories();
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseInterceptors(FileInterceptor('categoryImage'))
  async createCategory(
    @Body() data: CreateCategoryDTO,
    @UploadedFile() categoryImage: Express.Multer.File,
  ): Promise<CategoryResponseDTO> {
    return this.categoriesService.createCategory(data, categoryImage);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseInterceptors(FileInterceptor('categoryImage'))
  async updateCategory(
    @Param('id') id: string,
    @Body() data: UpdateCategoryDTO,
    @UploadedFile() categoryImage?: Express.Multer.File,
  ): Promise<CategoryResponseDTO> {
    if (data.name === undefined && !categoryImage) {
      throw new BadRequestException('Category update data is required');
    }

    return this.categoriesService.updateCategory(id, data, categoryImage);
  }
}
