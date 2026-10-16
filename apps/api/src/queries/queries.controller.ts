import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { CollectionQueriesService } from './queries.service.js';

@Controller('v1/queries')
@UseGuards(BearerGuard)
export class CollectionQueriesController {
  constructor(@Inject(CollectionQueriesService) private readonly queries: CollectionQueriesService) {}

  @Get()
  list(@Query() query: unknown): Promise<unknown> {
    return this.queries.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.queries.get(id, query);
  }
}
