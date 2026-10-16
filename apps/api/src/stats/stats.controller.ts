import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { StatsService } from './stats.service.js';

@Controller('v1/stats')
@UseGuards(BearerGuard)
export class StatsController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  @Get('overview')
  getOverview(@Query() query: unknown): Promise<unknown> {
    return this.stats.getOverview(query);
  }
}
