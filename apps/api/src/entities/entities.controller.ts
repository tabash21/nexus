import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { EntitiesService } from './entities.service.js';

@Controller('v1/entities')
@UseGuards(BearerGuard)
export class EntitiesController {
  constructor(@Inject(EntitiesService) private readonly entities: EntitiesService) {}

  @Get()
  list(@Query() query: unknown): Promise<unknown> {
    return this.entities.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.entities.get(id, query);
  }

  @Get(':id/items')
  getItems(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.entities.getItems(id, query);
  }
}
