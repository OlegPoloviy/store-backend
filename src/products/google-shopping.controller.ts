import { Controller, Get, Header } from '@nestjs/common';
import { GoogleShoppingService } from './google-shopping.service';

@Controller('feeds')
export class GoogleShoppingController {
  constructor(private readonly feed: GoogleShoppingService) {}

  @Get('google-shopping.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  getFeed() {
    return this.feed.generate();
  }
}
