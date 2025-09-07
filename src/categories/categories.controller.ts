import {
  Controller,
  Get,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  @UseInterceptors(FileInterceptor('categoryImage'))
  async createCategory(
    @Body() data: CreateCategoryDTO,
    @UploadedFile() categoryImage: Express.Multer.File,
  ): Promise<CategoryResponseDTO> {
    return this.categoriesService.createCategory(data, categoryImage);
  }
}
