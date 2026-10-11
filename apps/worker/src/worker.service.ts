import { Inject, Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { createPool, ingest } from '@nexus/database';
import { processMessage } from './process.js';

export const WORKER_RESOURCES = Symbol('WORKER_RESOURCES');
export const WORKER_FATAL = Symbol('WORKER_FATAL');

export function createResources(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const streamId = env.KAFKA_STREAM_ID;
  if (!databaseUrl || !streamId) throw new Error('DATABASE_URL and KAFKA_STREAM_ID are required');
  const kafka = new Kafka({ clientId: 'nexus-worker', brokers: (env.KAFKA_BROKERS ?? 'localhost:9092').split(','), retry: { retries: 8 } });
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

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private stopping: Promise<void> | undefined;
  constructor(
    @Inject(WORKER_RESOURCES) private readonly resources: WorkerResources,
    @Inject(WORKER_FATAL) private readonly fatal: () => Promise<void>,
  ) {}
  async onModuleInit() {
    const { consumer, producer, pool, streamId, topic: inputTopic, quarantineTopic } = this.resources;
    pool.on('error', error => this.logger.error(error, 'Idle database connection failed'));
    consumer.on(consumer.events.CRASH, ({ payload }) => {
      this.logger.error(payload.error, 'Consumer crashed; restart=' + payload.restart);
      if (!payload.restart) void this.fatal().catch(error => this.logger.error(error, 'Failed to close application'));
    });
    try {
      await pool.query('SELECT 1 FROM processing_receipts LIMIT 1');
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic: inputTopic, fromBeginning: true });
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message, heartbeat }) => {
          await heartbeat();
          await processMessage({ streamId, topic, partition, offset: message.offset, value: message.value,
            key: message.key, timestamp: message.timestamp, headers: message.headers }, {
            ingest: (event, delivery) => ingest(pool, event, delivery),
            quarantine: async record => {
              await producer.send({ topic: quarantineTopic, acks: -1,
                messages: [{ key: streamId + ':' + topic + ':' + partition + ':' + message.offset, value: JSON.stringify(record) }] });
              this.logger.warn({ topic, partition, offset: message.offset, reason: record.reason }, 'Record quarantined');
            },
            commit: async delivery => {
              await heartbeat();
              await consumer.commitOffsets([{ topic: delivery.topic, partition: delivery.partition, offset: (BigInt(delivery.offset) + 1n).toString() }]);
            },
          });
        },
      });
      this.logger.log('Processing worker started');
    } catch (error) { await this.onApplicationShutdown(); throw error; }
  }
  onApplicationShutdown(): Promise<void> {
    this.stopping ??= (async () => {
      // Close all resources even if one disconnect fails.
      const outcomes = await Promise.allSettled([this.resources.consumer.disconnect(), this.resources.producer.disconnect()]);
      await this.resources.pool.end();
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') this.logger.error(outcome.reason, 'Disconnect failed');
      }
    })();
    return this.stopping;
  }
}

