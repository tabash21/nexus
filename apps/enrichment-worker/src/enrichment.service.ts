import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { EachMessagePayload, KafkaMessage } from 'kafkajs';
import { nextOffset, withHeartbeat } from '@nexus/kafka';
import { ENRICHMENT_RESOURCES } from './enrichment.tokens.js';
import type { EnrichmentResources } from './enrichment.resources.js';
import { isQuarantinable, parseSilverMessage } from './silver.validator.js';
import { entityMentionsProcessor } from './processors/implementations/entity-mentions.processor.js';

@Injectable()
export class EnrichmentService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EnrichmentService.name);

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

    this.logger.log('Silver writer ready');
  }

  private async handleMessage({ topic, partition, message, heartbeat }: EachMessagePayload): Promise<void> {
    const r = this.resources;
    const delivery = { streamId: r.streamId, topic, partition, offset: message.offset };
    const abortController = new AbortController();

    await withHeartbeat(heartbeat, async guard => {
      try {
        const { silver } = parseSilverMessage(message, r.sources);
        const processorResult = await entityMentionsProcessor.process({
          job: {
            item_id: silver.event.item.nativeId,
            platform: silver.event.platform,
            content_revision: silver.event.item.nativeId,
            event_id: silver.event.eventId,
            job_id: 'entity-mentions',
            job_type: 'entity-mentions',
            processor_version: 'entity-mentions.v1',
            input_hash: silver.eventHash,
            claim_token: 'processor-inline',
            attempts: 1,
            raw_bytes: Buffer.from(message.value ?? '[]'),
            raw_payload: silver as Record<string, unknown>,
            title: silver.event.item.title ?? null,
            content_text: silver.event.item.text,
            lang: silver.event.item.language ?? null,
            url: silver.event.item.url ?? null,
            published_at: silver.event.item.publishedAt ?? silver.event.observedAt,
            source_id: silver.event.source.id,
            author_id: silver.event.author?.id ?? null,
          },
          signal: abortController.signal,
          item: {
            itemId: silver.event.item.nativeId,
            platform: silver.event.platform,
            title: silver.event.item.title ?? null,
            text: silver.event.item.text,
            lang: silver.event.item.language ?? null,
            url: silver.event.item.url ?? null,
            publishedAt: silver.event.item.publishedAt ?? silver.event.observedAt,
            sourceId: silver.event.source.id,
            authorId: silver.event.author?.id ?? null,
          },
          raw: {
            payload: silver as Record<string, unknown>,
            bytes: Buffer.from(JSON.stringify(silver)),
          },
        });

        const extracted = (processorResult.values.entities ?? []) as {
          type: 'PER' | 'ORG' | 'LOC';
          surface_form: string;
        }[];

        const ingestOptions: {
          contentVersionAt?: string;
          legacySourceTopic?: string;
          extractedEntities?: { type: 'PER' | 'ORG' | 'LOC'; surface_form: string }[];
        } = {
          contentVersionAt: silver.contentVersionAt,
          legacySourceTopic: silver.legacyReplay ? silver.sourceDelivery.topic : undefined,
        };

        if (extracted.length > 0) {
          ingestOptions.extractedEntities = extracted;
        }

        await r.ingest(silver.event, delivery, silver.eventHash, silver.rawUri, ingestOptions);
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
    const r = this.resources;
    await Promise.allSettled([r.consumer.disconnect(), r.producer.disconnect(), r.pool.end()]);
  }
}
