import type pg from 'pg';
import type { Consumer, Producer } from 'kafkajs';
import { createKafka, DEFAULT_QUARANTINE_TOPIC, DEFAULT_SILVER_TOPIC } from '@nexus/kafka';
import { sourceSubscriptions, type SourceSubscription, type OsintEvent, type Delivery } from '@nexus/contracts';
import {
  createPool,
  createItemDatabase,
  ingest,
  requireRealities,
  itemSchema,
  type IngestOptions,
  type IngestResult,
} from '@nexus/database';

export interface EnrichmentResources {
  pool: pg.Pool;
  consumer: Consumer;
  producer: Producer;
  silverTopic: string;
  quarantineTopic: string;
  streamId: string;
  sources: SourceSubscription[];
  ingest: (
    event: OsintEvent,
    delivery: Delivery,
    eventHash: string,
    rawUri: string,
    options?: IngestOptions,
  ) => Promise<IngestResult>;
  ready: () => Promise<void>;
}

export function createResources(env: NodeJS.ProcessEnv = process.env): EnrichmentResources {
  if (!env.DATABASE_URL || !env.KAFKA_STREAM_ID) {
    throw new Error('DATABASE_URL and KAFKA_STREAM_ID are required');
  }

  const pool = createPool(env.DATABASE_URL);
  const db = createItemDatabase(pool);
  const kafka = createKafka('nexus-silver-writer', env);
  const sources = sourceSubscriptions(env);

  return {
    pool,
    consumer: kafka.consumer({
      groupId: env.KAFKA_SILVER_GROUP_ID ?? 'nexus-silver-writer-v1',
      sessionTimeout: 60000,
    }),
    producer: kafka.producer({ idempotent: true, maxInFlightRequests: 1 }),
    silverTopic: env.KAFKA_SILVER_TOPIC ?? DEFAULT_SILVER_TOPIC,
    quarantineTopic: env.KAFKA_DLQ_TOPIC ?? DEFAULT_QUARANTINE_TOPIC,
    streamId: env.KAFKA_STREAM_ID,
    sources,
    ingest: (event, delivery, eventHash, rawUri, options) =>
      // Pass through extractedEntities if provided in options to the database ingest pipeline.
      ingest(db, event, delivery, eventHash, rawUri, options),
    ready: async () => {
      await pool.query('SELECT 1 FROM ingest.processing_receipts LIMIT 1');
      await requireRealities(
        db,
        sources.map(source => source.realityId),
      );
      for (const platform of new Set(sources.map(source => source.platform))) {
        await db.insert(itemSchema.platform).values({ platform, display_name: platform }).onConflictDoNothing();
      }
    },
  };
}
