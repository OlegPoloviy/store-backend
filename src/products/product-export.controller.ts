import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../guards/admin.guard';
import {
  PRODUCT_EXPORT_TYPES,
  ProductExportService,
} from './product-export.service';

@Controller('products/export')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class ProductExportController {
  constructor(private readonly service: ProductExportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async exportProducts(@Query('format') format: unknown) {
    if (format !== 'json' && format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('format must be json, csv or xlsx');
    }
    const data = await this.service.export(format);
    return new StreamableFile(data, {
      type: PRODUCT_EXPORT_TYPES[format],
      disposition: 'attachment; filename="products.' + format + '"',
    });
  }
}
