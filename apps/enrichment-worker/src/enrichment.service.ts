import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { EachMessagePayload, KafkaMessage } from 'kafkajs';
import { nextOffset, withHeartbeat } from '@nexus/kafka';
import type { IngestResult } from '@nexus/database';
import { ENRICHMENT_RESOURCES } from './enrichment.tokens.js';
import type { EnrichmentResources } from './enrichment.resources.js';
import { isQuarantinable, parseSilverMessage } from './silver.validator.js';
import { buildGoldMessage } from './gold.builder.js';

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
      let result: IngestResult | undefined;
      try {
        const { silver } = parseSilverMessage(message, r.sources);
        result = await r.ingest(silver.event, delivery, silver.eventHash, silver.rawUri, {
          contentVersionAt: silver.contentVersionAt,
          legacySourceTopic: silver.legacyReplay ? silver.sourceDelivery.topic : undefined,
        });
      } catch (error) {
        if (!isQuarantinable(error)) {
          throw error;
        }
        await this.quarantine(topic, partition, message, error);
      }

      // Outside the quarantine boundary: gold failures are infrastructure or mapping faults and must not ack.
      if (result) await this.publishGold(result);

      await guard();
      await r.consumer.commitOffsets([{ topic, partition, offset: nextOffset(message.offset) }]);
    });
  }

  /** Republishes duplicates too, so a crash between PostgreSQL commit and this send is recovered on redelivery. */
  private async publishGold(result: IngestResult): Promise<void> {
    const r = this.resources;
    const gold = buildGoldMessage(result);
    await r.producer.send({
      topic: r.goldTopic,
      acks: -1,
      messages: [{ key: gold.item.itemId, value: JSON.stringify(gold) }],
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
