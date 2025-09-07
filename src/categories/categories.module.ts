import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DmsModule } from 'src/dms/dms.module';

@Module({
  controllers: [CategoriesController],
  imports: [PrismaModule, DmsModule],
  providers: [CategoriesService],
})
export class CategoriesModule {}
