import {
  hash,
  silverObservationSchema,
  type OsintEvent,
  type SilverObservation,
  type SourceSubscription,
} from '@nexus/contracts';
import type { ArchivedRaw } from '../archive.js';
import type { Message } from '../types.js';

export function decodePayload(message: Message, source: SourceSubscription): unknown {
  if (message.topic !== source.topic || message.value === null) {
    throw new Error('Invalid message boundary');
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message.value));
}

export interface BuildSilverOptions {
  event: OsintEvent;
  value: unknown;
  archived: ArchivedRaw;
  message: Message;
  contentVersionAt?: string;
  legacyReplay?: boolean;
}

export function buildSilverObservation(options: BuildSilverOptions): SilverObservation {
  const { event, value, archived, message, contentVersionAt, legacyReplay } = options;

  return silverObservationSchema.parse({
    stageVersion: 'silver.v1',
    event,
    eventHash: hash(value),
    rawSha256: archived.rawSha256,
    rawUri: archived.rawUri,
    ...(contentVersionAt ? { contentVersionAt } : {}),
    ...(legacyReplay ? { legacyReplay: true } : {}),
    sourceDelivery: {
      streamId: message.streamId,
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
    },
  });
}

export function quarantineRecord(error: unknown, message: Message, archived: ArchivedRaw): Record<string, unknown> {
  return {
    reason: error instanceof Error ? error.message : String(error),
    sourceDelivery: {
      streamId: message.streamId,
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
    },
    rawUri: archived.rawUri,
    rawSha256: archived.rawSha256,
  };
}
