import { Kafka } from 'kafkajs';
import { createPool } from '@nexus/database';

export function createResources(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const streamId = env.KAFKA_STREAM_ID;
  if (!databaseUrl || !streamId) {
    throw new Error('DATABASE_URL and KAFKA_STREAM_ID are required');
  }

  const brokers = (env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'nexus-worker', brokers, retry: { retries: 8 } });

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
