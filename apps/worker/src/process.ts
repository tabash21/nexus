import { hash, itemIdentity, normalize, silverObservationSchema,
  type Delivery, type SilverObservation, type SourceSubscription } from '@nexus/contracts';
import { adapt } from './adapters/index.js';
import { deterministicEventId } from './adapters/types.js';
import { runQuickProcessors, type QuickProcessor } from './quick-processors.js';
import type { ArchivedRaw } from './archive.js';
import type { IHeaders } from 'kafkajs';

export type Message = Delivery & { value: Buffer | null; key: Buffer | null; timestamp: string; headers?: IHeaders };
export type Dependencies = {
  source: SourceSubscription;
  quickProcessors?: readonly QuickProcessor[];
  archive: (message: Message) => Promise<ArchivedRaw>;
  publish: (key: string, observation: SilverObservation) => Promise<void>;
  quarantine: (record: Record<string, unknown>) => Promise<void>;
  commit: (message: Delivery) => Promise<void>;
};
export async function processMessage(message: Message, dependencies: Dependencies): Promise<void> {
  const archived = await dependencies.archive(message);
  let observation: SilverObservation;
  try {
    if (message.topic !== dependencies.source.topic || message.value === null) throw new Error('Invalid message boundary');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message.value));
    let event = adapt(value, dependencies.source);
    if (event.platform === 'telegram' && value && typeof value === 'object') {
      const raw = value as Record<string, unknown>;
      if (raw.eventId === undefined) {
        const replayOrigin = message.headers?.['nexus-replay-origin']?.toString('utf8');
        if (message.headers?.['nexus-legacy-replay']?.toString('utf8') !== '1') {
          const origin = replayOrigin ? JSON.parse(replayOrigin) as Delivery : message;
          event = { ...event, eventId: deterministicEventId('kafka-observation', origin.streamId,
            `${origin.topic}:${origin.partition}:${origin.offset}`) };
        }
      }
      if (raw.observedAt === undefined) {
        const observedAt = new Date(Number(message.timestamp)).toISOString();
        event = { ...event, observedAt,
          ...(event.engagement ? { engagement: { ...event.engagement, capturedAt: observedAt } } : {}) };
      }
    }
    event = normalize(runQuickProcessors(event, dependencies.quickProcessors ?? []));
    observation = silverObservationSchema.parse({ stageVersion: 'silver.v1', event,
      eventHash: hash(value), rawSha256: archived.rawSha256, rawUri: archived.rawUri,
      sourceDelivery: { streamId: message.streamId, topic: message.topic,
        partition: message.partition, offset: message.offset } });
  } catch (error) {
    await dependencies.quarantine({ reason: error instanceof Error ? error.message : String(error),
      sourceDelivery: { streamId: message.streamId, topic: message.topic,
        partition: message.partition, offset: message.offset }, rawUri: archived.rawUri,
      rawSha256: archived.rawSha256 });
    await dependencies.commit(message);
    return;
  }
  await dependencies.publish(itemIdentity(observation.event).itemId, observation);
  await dependencies.commit(message);
}
