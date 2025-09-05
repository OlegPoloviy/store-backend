import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  controllers: [CategoriesController],
  imports: [PrismaModule],
  providers: [CategoriesService],
})
export class CategoriesModule {}
