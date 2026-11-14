import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UnsupportedMediaTypeException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { TextDecoder } from 'node:util';
import { AdminGuard } from '../guards/admin.guard';
import { MAX_IMPORT_BYTES } from './product-import.parser';
import { ProductImportService } from './product-import.service';

@Controller('products/import')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class ProductImportController {
  private readonly logger = new Logger(ProductImportController.name);

  constructor(private readonly service: ProductImportService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES, fields: 0 },
    }),
  )
  async importProducts(
    @Req() request: Request,
    @Res() response: Response,
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
    if (
      request.accepts(['application/json', 'application/x-ndjson']) ===
      'application/x-ndjson'
    ) {
      await this.streamImport(body, response);
      return;
    }
    const report = await this.service.import(body);
    if (!report.dryRun && report.errors.length) {
      throw new UnprocessableEntityException(report);
    }
    response.status(HttpStatus.OK).json(report);
  }

  private async streamImport(body: unknown, response: Response) {
    response.status(HttpStatus.OK).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const send = (event: object) => {
      if (!response.destroyed) response.write(JSON.stringify(event) + '\n');
    };
    try {
      const report = await this.service.import(body, (progress) =>
        send({ type: 'progress', ...progress }),
      );
      send({ type: 'report', report });
    } catch (error) {
      if (error instanceof HttpException) {
        send({ type: 'error', message: error.message });
      } else {
        this.logger.error(
          'Product import failed',
          error instanceof Error ? error.stack : undefined,
        );
        send({ type: 'error', message: 'The product import request failed.' });
      }
    } finally {
      response.end();
    }
  }
}
