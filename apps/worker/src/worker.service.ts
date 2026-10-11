import { Inject, Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { ingest } from '@nexus/database';
import { processMessage } from './process.js';
import { WORKER_FATAL, WORKER_RESOURCES, type FatalHandler } from './worker.tokens.js';
import { createResources, type WorkerResources } from './worker.resources.js';

export { WORKER_FATAL, WORKER_RESOURCES, type FatalHandler } from './worker.tokens.js';
export { createResources, type WorkerResources } from './worker.resources.js';

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private stopping: Promise<void> | undefined;

  constructor(
    @Inject(WORKER_RESOURCES) private readonly resources: WorkerResources,
    @Inject(WORKER_FATAL) private readonly fatal: FatalHandler,
  ) {}

  async onModuleInit(): Promise<void> {
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
          await processMessage(
            {
              streamId,
              topic,
              partition,
              offset: message.offset,
              value: message.value,
              key: message.key,
              timestamp: message.timestamp,
              headers: message.headers,
            },
            {
              ingest: (event, delivery) => ingest(pool, event, delivery),
              quarantine: async record => {
                await producer.send({
                  topic: quarantineTopic,
                  acks: -1,
                  messages: [
                    {
                      key: streamId + ':' + topic + ':' + partition + ':' + message.offset,
                      value: JSON.stringify(record),
                    },
                  ],
                });
                this.logger.warn({ topic, partition, offset: message.offset, reason: record.reason }, 'Record quarantined');
              },
              commit: async delivery => {
                await heartbeat();
                await consumer.commitOffsets([
                  { topic: delivery.topic, partition: delivery.partition, offset: (BigInt(delivery.offset) + 1n).toString() },
                ]);
              },
            },
          );
        },
      });
      this.logger.log('Processing worker started');
    } catch (error) {
      await this.onApplicationShutdown();
      throw error;
    }
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
