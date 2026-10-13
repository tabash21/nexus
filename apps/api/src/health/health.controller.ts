import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DOCUMENT_REPOSITORY, type DocumentRepository } from '../tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly repo: DocumentRepository) {}

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
