import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
import { ENRICHMENT_RESOURCES } from '../enrichment.tokens.js';
import type { EnrichmentResources } from '../enrichment.resources.js';
import { processMediaJob } from './processing.js';

@Injectable()
export class MediaProcessingService implements OnModuleInit, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(MediaProcessingService.name);
  private readonly shutdown = new AbortController();
  private running?: Promise<void>;

  constructor(@Inject(ENRICHMENT_RESOURCES) private readonly resources: EnrichmentResources) {}

  async onModuleInit(): Promise<void> {
    if (!this.resources.media) return;
    await this.resources.ready();
    await this.resources.media.ready();
    await this.resources.media.cleanupTemporary();
    this.running = this.run();
    this.logger.log('Local media OCR ready');
  }

  private async run(): Promise<void> {
    const media = this.resources.media!;
    let nextCleanup = Date.now() + 60000;
    while (!this.shutdown.signal.aborted) {
      try {
        if (Date.now() >= nextCleanup) {
          await media.cleanupTemporary();
          nextCleanup = Date.now() + 60000;
        }
        const jobs = await media.claim();
        for (const job of jobs) {
          if (this.shutdown.signal.aborted) break;
          await processMediaJob(media, job, this.shutdown.signal);
        }
        if (jobs.length) continue;
      } catch {
        // Pending jobs/leases remain durable. Retry infrastructure without leaking source URLs.
        this.logger.error('Media job infrastructure unavailable; retrying');
      }
      await setTimeout(1000, undefined, { signal: this.shutdown.signal }).catch(() => undefined);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.shutdown.abort();
    await this.running;
  }

  onApplicationShutdown(): void {
    this.resources.media?.close();
  }
}
