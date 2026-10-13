import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { PlatformsService } from './platforms.service.js';

@Controller('v1/platforms')
@UseGuards(BearerGuard)
export class PlatformsController {
  constructor(@Inject(PlatformsService) private readonly platforms: PlatformsService) {}

  @Get()
  list(): Promise<unknown> {
    return this.platforms.list();
  }

  @Get(':platform')
  get(@Param('platform') platform: string): Promise<unknown> {
    return this.platforms.get(platform);
  }
}
