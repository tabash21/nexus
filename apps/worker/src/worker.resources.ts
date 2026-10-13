import { createKafka } from '../../../scripts/lib/kafka-client.mjs';
import { createPool } from '@nexus/database';

export function createResources(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const streamId = env.KAFKA_STREAM_ID;
  if (!databaseUrl || !streamId) {
    throw new Error('DATABASE_URL and KAFKA_STREAM_ID are required');
  }

  const kafka = createKafka('nexus-worker', env);

  return {
    streamId,
    topic: env.KAFKA_TOPIC ?? 'osint.raw.v1',
    quarantineTopic: env.KAFKA_DLQ_TOPIC ?? 'osint.quarantine.v1',
    consumer: kafka.consumer({ groupId: env.KAFKA_GROUP_ID ?? 'nexus-normalizer-v1', sessionTimeout: 60000 }),
    producer: kafka.producer({ idempotent: true, maxInFlightRequests: 1 }),
    pool: createPool(databaseUrl),
  };
}

export type WorkerResources = ReturnType<typeof createResources>;
