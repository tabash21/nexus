import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { TopicsService } from './topics.service.js';

@Controller('v1/topics')
@UseGuards(BearerGuard)
export class TopicsController {
  constructor(@Inject(TopicsService) private readonly topics: TopicsService) {}

  @Get()
  list(@Query() query: unknown): Promise<unknown> {
    return this.topics.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<unknown> {
    return this.topics.get(id);
  }

  @Get(':id/items')
  getItems(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.topics.getItems(id, query);
  }
}
