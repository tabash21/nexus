import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { EachMessagePayload, KafkaMessage } from 'kafkajs';
import { nextOffset, withHeartbeat } from '@nexus/kafka';
import { claimJobs, completeJob, failJob, type ClaimedJob } from '@nexus/database';
import { ENRICHMENT_RESOURCES } from './enrichment.tokens.js';
import type { EnrichmentResources } from './enrichment.resources.js';
import { isQuarantinable, parseSilverMessage } from './silver.validator.js';
import { ProcessorRegistry } from './processors/registry.js';
import type { EnrichmentTaskContext } from './processors/types.js';

const PROCESSOR_POLL_MS = 3000;

@Injectable()
export class EnrichmentService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly registry = new ProcessorRegistry();
  private poller?: NodeJS.Timeout;

  constructor(@Inject(ENRICHMENT_RESOURCES) private readonly resources: EnrichmentResources) {}

  async onModuleInit(): Promise<void> {
    const r = this.resources;
    await r.ready();
    await r.producer.connect();
    await r.consumer.connect();
    await r.consumer.subscribe({ topic: r.silverTopic, fromBeginning: true });

    await r.consumer.run({
      autoCommit: false,
      eachMessage: async payload => this.handleMessage(payload),
    });

    this.startProcessorLoop();
    this.logger.log('Silver writer ready');
  }

  private startProcessorLoop(): void {
    if (this.poller) return;

    this.poller = setInterval(() => {
      void this.pollDueJobs().catch(error => {
        this.logger.error(error, 'Enrichment job poll failed');
      });
    }, PROCESSOR_POLL_MS);
  }

  private async pollDueJobs(): Promise<void> {
    const jobs = await claimJobs(this.resources.pool, 5, 90);
    if (jobs.length === 0) return;

    await Promise.all(
      jobs.map(async job => {
        try {
          await this.processJob(job);
        } catch (error) {
          this.logger.error(error, `Processor loop failed for job ${job.job_id}`);
        }
      }),
    );
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    const processor = this.registry.find(job.job_type, job.processor_version);
    if (!processor) {
      const reason = `Unsupported processor: ${job.job_type}@${job.processor_version}`;
      const succeeded = await failJob(this.resources.pool, job, reason);
      this.logger.warn({ jobId: job.job_id, reason }, succeeded ? 'Job failed due to unsupported processor' : 'Unsupported processor not claimed');
      return;
    }

    try {
      const result = await processor.process(this.buildContext(job));
      await completeJob(this.resources.pool, job, result);
      this.logger.log(`Completed ${job.job_type}@${job.processor_version} for item ${job.item_id}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const succeeded = await failJob(this.resources.pool, job, reason);
      this.logger.warn({ jobId: job.job_id, reason }, succeeded ? 'Job failed and queued for retry' : 'Job failed after lease loss');
    }
  }

  private buildContext(job: ClaimedJob): EnrichmentTaskContext {
    const rawPayload = typeof job.raw_payload === 'object' && job.raw_payload !== null ? job.raw_payload : {};
    const rawBytes = Buffer.isBuffer(job.raw_bytes) ? job.raw_bytes : Buffer.from(JSON.stringify(rawPayload));

    return {
      job,
      signal: new AbortController().signal,
      item: {
        itemId: job.item_id,
        platform: job.platform,
        title: job.title ?? null,
        text: job.content_text ?? '',
        lang: job.lang ?? null,
        url: job.url ?? null,
        publishedAt: job.published_at,
        sourceId: job.source_id,
        authorId: job.author_id,
      },
      raw: {
        payload: rawPayload,
        bytes: rawBytes,
      },
    };
  }

  private async handleMessage({ topic, partition, message, heartbeat }: EachMessagePayload): Promise<void> {
    const r = this.resources;
    const delivery = { streamId: r.streamId, topic, partition, offset: message.offset };

    await withHeartbeat(heartbeat, async guard => {
      try {
        const { silver } = parseSilverMessage(message, r.sources);
        await r.ingest(silver.event, delivery, silver.eventHash, silver.rawUri, {
          contentVersionAt: silver.contentVersionAt,
          legacySourceTopic: silver.legacyReplay ? silver.sourceDelivery.topic : undefined,
        });
      } catch (error) {
        if (!isQuarantinable(error)) {
          throw error;
        }
        await this.quarantine(topic, partition, message, error);
      }

      await guard();
      await r.consumer.commitOffsets([{ topic, partition, offset: nextOffset(message.offset) }]);
    });
  }

  private async quarantine(topic: string, partition: number, message: KafkaMessage, error: Error): Promise<void> {
    const r = this.resources;
    await r.producer.send({
      topic: r.quarantineTopic,
      acks: -1,
      messages: [
        {
          key: `${topic}:${partition}:${message.offset}`,
          value: JSON.stringify({
            stage: 'silver-writer',
            reason: error.message,
            topic,
            partition,
            offset: message.offset,
            valueBase64: message.value?.toString('base64') ?? null,
          }),
        },
      ],
    });
    this.logger.warn(`Silver record quarantined: ${error.message}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = undefined;
    }

    const r = this.resources;
    await Promise.allSettled([r.consumer.disconnect(), r.producer.disconnect(), r.pool.end()]);
  }
}
