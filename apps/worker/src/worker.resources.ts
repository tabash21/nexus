import { createKafka } from '../../../scripts/lib/kafka-client.mjs';
import { sourceSubscriptions } from '../../../scripts/lib/source-registry.mjs';
import { createPool, createItemDatabase, ingest, itemSchema } from '@nexus/database';
import type { Consumer, Producer } from 'kafkajs';
import type { SourceSubscription } from '../../../scripts/lib/source-registry.mjs';
import type { OsintEvent, Delivery } from '@nexus/contracts';
export interface WorkerResources {
  streamId: string;
  quarantineTopic: string;
  consumers: { source: SourceSubscription; consumer: Consumer }[];
  producer: Producer;
  pool: ReturnType<typeof createPool>;
  ready(): Promise<void>;
  ingest(event: OsintEvent, delivery: Delivery, eventHash: string): Promise<{ duplicate: boolean }>;
}
export function createResources(env: NodeJS.ProcessEnv = process.env): WorkerResources {
  if (!env.DATABASE_URL || !env.KAFKA_STREAM_ID) throw new Error('DATABASE_URL and KAFKA_STREAM_ID are required');
  const kafka = createKafka('nexus-worker', env);
  const sources = sourceSubscriptions(env);
  const pool = createPool(env.DATABASE_URL);
  const db = createItemDatabase(pool);
  return {
    streamId: env.KAFKA_STREAM_ID, quarantineTopic: env.KAFKA_DLQ_TOPIC ?? 'osint.quarantine.v1',
    consumers: sources.map(source => ({ source, consumer: kafka.consumer({ groupId: source.groupId, sessionTimeout: 60000 }) })),
    producer: kafka.producer({ idempotent: true, maxInFlightRequests: 1 }), pool,
    ingest: (event: Parameters<typeof ingest>[1], delivery: Parameters<typeof ingest>[2], eventHash: string) => ingest(db, event, delivery, eventHash),
    ready: async (): Promise<void> => {
      await pool.query('SELECT 1 FROM ingest.processing_receipts LIMIT 1');
      for (const platform of new Set(sources.map(source => source.platform))) {
        await db.insert(itemSchema.platform).values({ platform, display_name: platform }).onConflictDoNothing();
      }
    },
  };
}
