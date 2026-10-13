import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.repo.ready();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
