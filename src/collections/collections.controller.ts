import {
  Body,
  Controller,
  Post,
  UseGuards,
  Request,
  Get,
  UnauthorizedException,
  Param,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CollectionInputDTO } from 'src/DTO/collection.dto';
import { CollectionsService } from './collections.service';

@Controller('collections')
@UseGuards(AuthGuard('jwt'))
export class CollectionsController {
  constructor(private collectionsService: CollectionsService) {}

  @Post()
  async createCollection(
    @Request() req: any,
    @Body() collectionInput: CollectionInputDTO,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    return this.collectionsService.createCollection(userId, collectionInput);
  }

  @Get()
  async getCollections(@Request() req) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.collectionsService.getColletions(userId);
  }

  @Post('/item')
  async addItem(
    @Request() req,
    @Body() body: { collectionId: string; itemId: string },
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    const { collectionId, itemId } = body;

    return this.collectionsService.addItem(userId, collectionId, itemId);
  }

  @Get('/:collectionId/items')
  async getItemsByCollection(
    @Request() req,
    @Param('collectionId') collectionid: string,
  ) {
    const user = req.user;
    const userId = user?.sub || user?.user_id || user?.id;

    return this.collectionsService.getItemsByCollection(userId, collectionid);
  }
}
