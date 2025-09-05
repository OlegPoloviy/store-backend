import { Controller, Get, Post, Body } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDTO } from 'src/DTO/create-category.dto';
import { CategoryResponseDTO } from 'src/DTO/category-response.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  async getCategories(): Promise<any> {
    return this.categoriesService.getCategories();
  }

  @Post()
  async createCategory(
    @Body() data: CreateCategoryDTO,
  ): Promise<CategoryResponseDTO> {
    return this.categoriesService.createCategory(data);
  }
}
