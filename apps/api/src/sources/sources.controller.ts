import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { SourcesService } from './sources.service.js';

@Controller('v1/sources')
@UseGuards(BearerGuard)
export class SourcesController {
  constructor(@Inject(SourcesService) private readonly sources: SourcesService) {}

  @Get()
  list(@Query() query: unknown): Promise<unknown> {
    return this.sources.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.sources.get(id, query);
  }

  @Get(':id/items')
  getItems(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.sources.getItems(id, query);
  }
}
