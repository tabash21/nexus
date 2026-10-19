import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { EachMessagePayload, KafkaMessage } from 'kafkajs';
import { nextOffset, withHeartbeat } from '@nexus/kafka';
import { ENRICHMENT_RESOURCES } from './enrichment.tokens.js';
import type { EnrichmentResources } from './enrichment.resources.js';
import { isQuarantinable, parseSilverMessage } from './silver.validator.js';
import { extractMetaFromSilver } from './extractors/meta.js';
import { generateEntityId } from './extractors/entityId.js';
import { itemIdentity } from '@nexus/contracts';

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

    await withHeartbeat(heartbeat, async guard => {
      try {
        const { silver } = parseSilverMessage(message, r.sources);
        const extracted = extractMetaFromSilver(silver);
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
