import type { Delivery, OsintEvent } from '@nexus/contracts';
import { deterministicEventId } from '../adapters/types.js';
import type { Message } from '../types.js';

export interface TelegramDefaultsResult {
  event: OsintEvent;
  contentVersionAt?: string;
  legacyReplay?: boolean;
}

/**
 * Applies Telegram-specific backwards-compatibility overrides for eventId, observedAt,
 * and contentVersionAt when dealing with legacy raw collector payloads and replays.
 */
export function applyTelegramDefaults(
  initialEvent: OsintEvent,
  value: unknown,
  message: Message,
): TelegramDefaultsResult {
  let event = initialEvent;
  let contentVersionAt: string | undefined;
  const legacyReplay = message.headers?.['nexus-legacy-replay']?.toString('utf8') === '1';

  if (event.platform === 'telegram' && value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    if (raw.schemaVersion !== 'provisional.v1') {
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
