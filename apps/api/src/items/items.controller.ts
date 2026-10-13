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
}
