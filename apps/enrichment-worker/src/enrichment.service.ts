import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { EventConflictError } from '@nexus/database';
import { itemIdentity, silverObservationSchema, sourceReality } from '@nexus/contracts';
import { withHeartbeat } from './heartbeat.js';
import { ENRICHMENT_RESOURCES, type EnrichmentResources } from './resources.js';

class InvalidSilverError extends Error {}

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
    await r.consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message, heartbeat }) => {
      await withHeartbeat(heartbeat, async guard => {
        const delivery = { streamId: r.streamId, topic, partition, offset: message.offset };
        try {
          if (!message.value) throw new InvalidSilverError('Empty silver message');
          const silver = silverObservationSchema.parse(JSON.parse(message.value.toString('utf8')));
          const source = r.sources.find(s => s.topic === silver.sourceDelivery.topic);
          if (!source || source.platform !== silver.event.platform || sourceReality(source) !== silver.event.realityId) {
            throw new InvalidSilverError('Silver source and reality do not match a configured raw topic');
          }
          if (message.key?.toString('utf8') !== itemIdentity(silver.event).itemId) {
            throw new InvalidSilverError('Silver item key does not match its event');
          }
          await r.ingest(silver.event, delivery, silver.eventHash, silver.rawUri);
        } catch (error) {
          if (error instanceof EventConflictError || error instanceof InvalidSilverError || error instanceof SyntaxError ||
              error instanceof Error && error.name === 'ZodError') {
            await r.producer.send({ topic: r.quarantineTopic, acks: -1,
              messages: [{ key: `${topic}:${partition}:${message.offset}`,
                value: JSON.stringify({ stage: 'silver-writer', reason: error.message,
                  topic, partition, offset: message.offset, valueBase64: message.value?.toString('base64') ?? null }) }] });
            this.logger.warn(`Silver record quarantined: ${error.message}`);
          } else throw error;
        }
        await guard();
        await r.consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
      });
    } });
    this.logger.log('Silver writer ready');
  }

  async onApplicationShutdown(): Promise<void> {
    const r = this.resources;
    await Promise.allSettled([r.consumer.disconnect(), r.producer.disconnect(), r.pool.end()]);
  }
}
