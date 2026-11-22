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
import { AdminGuard } from '../guards/admin.guard';
import { readProductImportFile } from './product-import.file';
import { MAX_IMPORT_BYTES } from './product-import.parser';
import {
  ProductImportService,
  type ProductImportCurrencyOptions,
} from './product-import.service';

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
        throw new BadRequestException('Upload a file in the file field');
      body = await readProductImportFile(file, request.query);
    } else if (!request.is('application/json')) {
      throw new UnsupportedMediaTypeException(
        'Send application/json or multipart/form-data',
      );
    }
    const requestedConversion = request.query.convertCurrency;
    if (
      requestedConversion !== undefined &&
      requestedConversion !== 'true' &&
      requestedConversion !== 'false'
    ) {
      throw new BadRequestException('convertCurrency must be true or false');
    }
    const conversion = {
      enabled: requestedConversion === 'true',
      token: request.get('x-product-conversion-token'),
    };
    if (
      request.accepts(['application/json', 'application/x-ndjson']) ===
      'application/x-ndjson'
    ) {
      await this.streamImport(body, response, conversion);
      return;
    }
    const report = await this.service.import(body, undefined, conversion);
    if (!report.dryRun && report.errors.length) {
      throw new UnprocessableEntityException(report);
    }
    response.status(HttpStatus.OK).json(report);
  }

  private async streamImport(
    body: unknown,
    response: Response,
    conversion: ProductImportCurrencyOptions,
  ) {
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
      const report = await this.service.import(
        body,
        (progress) => send({ type: 'progress', ...progress }),
        conversion,
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
