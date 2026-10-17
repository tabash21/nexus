import { createKafka } from '@nexus/kafka';
import { sourceSubscriptions } from '@nexus/contracts';
import { createPool, createItemDatabase, ingest, requireRealities, itemSchema } from '@nexus/database';

export const ENRICHMENT_RESOURCES = Symbol('ENRICHMENT_RESOURCES');

export function createResources(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL || !env.KAFKA_STREAM_ID) throw new Error('DATABASE_URL and KAFKA_STREAM_ID are required');
  const pool = createPool(env.DATABASE_URL);
  const db = createItemDatabase(pool);
  const kafka = createKafka('nexus-silver-writer', env);
  const sources = sourceSubscriptions(env);
  return {
    pool,
    consumer: kafka.consumer({ groupId: env.KAFKA_SILVER_GROUP_ID ?? 'nexus-silver-writer-v1', sessionTimeout: 60000 }),
    producer: kafka.producer({ idempotent: true, maxInFlightRequests: 1 }),
    silverTopic: env.KAFKA_SILVER_TOPIC ?? 'items.silver',
    quarantineTopic: env.KAFKA_DLQ_TOPIC ?? 'osint.quarantine.v1',
    streamId: env.KAFKA_STREAM_ID,
    sources,
    ingest: (event: Parameters<typeof ingest>[1], delivery: Parameters<typeof ingest>[2], eventHash: string, rawUri: string) =>
      ingest(db, event, delivery, eventHash, rawUri),
    ready: async () => {
      await pool.query('SELECT 1 FROM ingest.processing_receipts LIMIT 1');
      await requireRealities(db, sources.map(source => source.realityId));
      for (const platform of new Set(sources.map(source => source.platform))) {
        await db.insert(itemSchema.platform).values({ platform, display_name: platform }).onConflictDoNothing();
      }
    },
  };
}

export type EnrichmentResources = ReturnType<typeof createResources>;
