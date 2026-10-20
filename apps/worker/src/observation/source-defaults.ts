import type { Delivery, OsintEvent } from '@nexus/contracts';
import { deterministicEventId } from '../adapters/types.js';
import type { Message } from '../types.js';

export interface SourceDefaultsResult {
  event: OsintEvent;
  contentVersionAt?: string;
  legacyReplay?: boolean;
}

/**
 * Uses Kafka delivery identity and time for native collectors that omit them.
 * Telegram additionally supplies its native content version for edit ordering.
 */
export function applySourceDefaults(initialEvent: OsintEvent, value: unknown, message: Message): SourceDefaultsResult {
  let event = initialEvent;
  let contentVersionAt: string | undefined;
  const legacyReplay = message.headers?.['nexus-legacy-replay']?.toString('utf8') === '1';

  if (['telegram', 'truthsocial'].includes(event.platform) && value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    if (event.platform === 'telegram' && raw.schemaVersion !== 'provisional.v1') {
      contentVersionAt = event.item.editedAt ?? event.item.publishedAt;
    }
    if (raw.eventId === undefined) {
      const replayOrigin = message.headers?.['nexus-replay-origin']?.toString('utf8');
      if (!legacyReplay) {
        const origin = replayOrigin ? (JSON.parse(replayOrigin) as Delivery) : message;
        event = {
          ...event,
          eventId: deterministicEventId(
            'kafka-observation',
            origin.streamId,
            `${origin.topic}:${origin.partition}:${origin.offset}`,
          ),
        };
      }
    }
    if (raw.observedAt === undefined) {
      const observedAt = new Date(Number(message.timestamp)).toISOString();
      event = {
        ...event,
        observedAt,
        ...(event.engagement ? { engagement: { ...event.engagement, capturedAt: observedAt } } : {}),
      };
    }
  }

  return {
    event,
    ...(contentVersionAt ? { contentVersionAt } : {}),
    ...(legacyReplay ? { legacyReplay: true } : {}),
  };
}
