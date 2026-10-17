import { Inject, Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { processMessage } from './process.js';
import { withHeartbeat } from './heartbeat.js';
import { archiveRaw } from './archive.js';
import { WORKER_FATAL, WORKER_RESOURCES, type FatalHandler } from './worker.tokens.js';
import type { WorkerResources } from './worker.resources.js';
export { WORKER_FATAL, WORKER_RESOURCES, type FatalHandler } from './worker.tokens.js';
export { createResources, type WorkerResources } from './worker.resources.js';
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private stopping: Promise<void> | undefined;
  constructor(@Inject(WORKER_RESOURCES) private readonly resources: WorkerResources,
    @Inject(WORKER_FATAL) private readonly fatal: FatalHandler) {}
  async onModuleInit(): Promise<void> {
    const r = this.resources;
    try {
      await r.ready();
      await r.producer.connect();
      for (const { consumer, source } of r.consumers) {
        consumer.on(consumer.events.CRASH, ({ payload }) => {
          this.logger.error(payload.error, 'Consumer crashed: ' + source.platform);
          if (!payload.restart) void this.fatal().catch(error => this.logger.error(error));
        });
        await consumer.connect();
        await consumer.subscribe({ topic: source.topic, fromBeginning: true });
        await consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message, heartbeat }) => {
          await withHeartbeat(heartbeat, async guard => processMessage({ streamId: r.streamId, topic, partition,
            offset: message.offset, value: message.value, key: message.key, timestamp: message.timestamp, headers: message.headers }, {
            source,
            archive: delivery => archiveRaw(r.s3, r.rawBucket, delivery),
            publish: async (key, observation) => {
              await r.producer.send({ topic: r.silverTopic, acks: -1,
                messages: [{ key, value: JSON.stringify(observation) }] });
            },
            quarantine: async record => {
              await r.producer.send({ topic: r.quarantineTopic, acks: -1,
                messages: [{ key: [r.streamId, topic, partition, message.offset].join(':'), value: JSON.stringify(record) }] });
              this.logger.warn({ topic, partition, offset: message.offset, reason: record.reason }, 'Record quarantined');
            },
            commit: async delivery => {
              await guard();
              await consumer.commitOffsets([{ topic, partition, offset: (BigInt(delivery.offset) + 1n).toString() }]);
            },
          }));
        } });
      }
      this.logger.log('Platform consumers started: ' + r.consumers.map(c => c.source.platform).join(', '));
    } catch (error) { await this.onApplicationShutdown(); throw error; }
  }
  onApplicationShutdown(): Promise<void> {
    this.stopping ??= (async () => {
      // Stop consumers before closing resources needed by in-flight messages.
      const outcomes = await Promise.allSettled(this.resources.consumers.map(c => c.consumer.disconnect()));
      outcomes.push(...await Promise.allSettled([this.resources.producer.disconnect()]));
      this.resources.s3.destroy();
      for (const result of outcomes) if (result.status === 'rejected') this.logger.error(result.reason, 'Shutdown failed');
    })();
    return this.stopping;
  }
}
