import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnprocessableEntityException,
  UploadedFile,
  UnsupportedMediaTypeException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { TextDecoder } from 'node:util';
import { AdminGuard } from '../guards/admin.guard';
import { MAX_IMPORT_BYTES } from './product-import.parser';
import { ProductImportService } from './product-import.service';

@Controller('products/import')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class ProductImportController {
  constructor(private readonly service: ProductImportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES, fields: 0 },
    }),
  )
  async importProducts(
    @Req() request: Request,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (request.is('multipart/form-data')) {
      if (!file)
        throw new BadRequestException('Upload a JSON file in the file field');
      try {
        body = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(file.buffer),
        );
      } catch {
        throw new BadRequestException('File must contain valid UTF-8 JSON');
      }
    } else if (!request.is('application/json')) {
      throw new UnsupportedMediaTypeException(
        'Send application/json or multipart/form-data',
      );
    }
    const report = await this.service.import(body);
    if (!report.dryRun && report.errors.length) {
      throw new UnprocessableEntityException(report);
    }
    return report;
  }
}
