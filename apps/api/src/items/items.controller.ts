import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { ItemsService } from './items.service.js';

@Controller('v1/items')
@UseGuards(BearerGuard)
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @Get()
  list(@Query() query: unknown): Promise<unknown> {
    return this.items.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.items.get(id, query);
  }

  @Get(':id/media')
  getMedia(@Param('id') id: string): Promise<unknown> {
    return this.items.getMedia(id);
  }

  @Get(':id/enrichment')
  getEnrichment(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.items.getEnrichment(id, query);
  }

  @Get(':id/thread')
  getThread(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.items.getThread(id, query);
  }

  @Get(':id/related')
  getRelated(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.items.getRelated(id, query);
  }
}
