import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { RealitiesService } from './realities.service.js';

@Controller('v1/realities')
@UseGuards(BearerGuard)
export class RealitiesController {
  constructor(@Inject(RealitiesService) private readonly realities: RealitiesService) {}

  @Get()
  list(): Promise<unknown> {
    return this.realities.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<unknown> {
    return this.realities.get(id);
  }
}
