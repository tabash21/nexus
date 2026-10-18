import { Inject, Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import type { SourceSubscription } from '@nexus/contracts';
import { nextOffset, withHeartbeat } from '@nexus/kafka';
import { processMessage } from './process.js';
import { archiveRaw } from './archive.js';
import { WORKER_FATAL, WORKER_RESOURCES, type FatalHandler } from './worker.tokens.js';
import type { WorkerConsumer, WorkerResources } from './worker.resources.js';
import type { Dependencies, Message } from './types.js';

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
    const r = this.resources;
    try {
      await r.ready();
      await r.producer.connect();

      for (const workerConsumer of r.consumers) {
        await this.startConsumer(workerConsumer);
      }

      this.logger.log('Platform consumers started: ' + r.consumers.map(c => c.source.platform).join(', '));
    } catch (error) {
      await this.onApplicationShutdown();
      throw error;
    }
  }

  private async startConsumer({ consumer, source }: WorkerConsumer): Promise<void> {
    consumer.on(consumer.events.CRASH, ({ payload }) => {
      this.logger.error(payload.error, 'Consumer crashed: ' + source.platform);
      if (!payload.restart) {
        void this.fatal().catch(error => this.logger.error(error));
      }
    });

    await consumer.connect();
    await consumer.subscribe({ topic: source.topic, fromBeginning: true });
    await consumer.run({
      autoCommit: false,
      eachMessage: async payload => this.handleMessage(consumer, source, payload),
    });
  }

  private async handleMessage(
    consumer: Consumer,
    source: SourceSubscription,
    { topic, partition, message, heartbeat }: EachMessagePayload,
  ): Promise<void> {
    const r = this.resources;
    const msg: Message = {
      streamId: r.streamId,
      topic,
      partition,
      offset: message.offset,
      value: message.value,
      key: message.key,
      timestamp: message.timestamp,
      headers: message.headers,
    };

    await withHeartbeat(heartbeat, async guard => {
      const dependencies = this.buildDependencies(consumer, source, msg, guard);
      await processMessage(msg, dependencies);
    });
  }

  private buildDependencies(
    consumer: Consumer,
    source: SourceSubscription,
    message: Message,
    guard: () => Promise<void>,
  ): Dependencies {
    const r = this.resources;
    const { topic, partition, offset } = message;

    return {
      source,
      archive: delivery => archiveRaw(r.s3, r.rawBucket, delivery),
      publish: async (key, observation) => {
        await r.producer.send({
          topic: r.silverTopic,
          acks: -1,
          messages: [{ key, value: JSON.stringify(observation) }],
        });
      },
      quarantine: async record => {
        await r.producer.send({
          topic: r.quarantineTopic,
          acks: -1,
          messages: [
            {
              key: [r.streamId, topic, partition, offset].join(':'),
              value: JSON.stringify(record),
            },
          ],
        });
        this.logger.warn({ topic, partition, offset, reason: record.reason }, 'Record quarantined');
      },
      commit: async delivery => {
        await guard();
        await consumer.commitOffsets([{ topic, partition, offset: nextOffset(delivery.offset) }]);
      },
    };
  }

  onApplicationShutdown(): Promise<void> {
    this.stopping ??= (async () => {
      // Stop consumers before closing resources needed by in-flight messages.
      const outcomes = await Promise.allSettled(this.resources.consumers.map(c => c.consumer.disconnect()));
      outcomes.push(...(await Promise.allSettled([this.resources.producer.disconnect()])));
      this.resources.s3.destroy();
      for (const result of outcomes) {
        if (result.status === 'rejected') {
          this.logger.error(result.reason, 'Shutdown failed');
        }
      }
    })();
    return this.stopping;
  }
}
