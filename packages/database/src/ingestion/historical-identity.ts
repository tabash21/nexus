import { and, eq, exists } from 'drizzle-orm';
import { itemIdentity, type OsintEvent } from '@nexus/contracts';
import { deliveries, ingestEvents, processingReceipts } from '../schema/index.js';
import type { IngestTransaction } from './types.js';

/** Replays of pre-observation-ID Telegram payloads retain their stored event identity. */
export async function resolveHistoricalIdentity(tx: IngestTransaction, event: OsintEvent,
  eventHash: string, sourceTopic?: string): Promise<OsintEvent> {
  if (event.platform !== 'telegram') return event;
  const [stored] = await tx.select({ eventId: ingestEvents.event_id }).from(ingestEvents)
    .innerJoin(processingReceipts, eq(processingReceipts.event_id, ingestEvents.event_id))
    .where(and(eq(ingestEvents.event_hash, eventHash),
      eq(ingestEvents.reality_id, event.realityId),
      eq(processingReceipts.item_id, itemIdentity(event).itemId),
      sourceTopic ? exists(tx.select({ eventId: deliveries.event_id }).from(deliveries)
        .where(and(eq(deliveries.event_id, ingestEvents.event_id), eq(deliveries.topic, sourceTopic)))) : undefined))
    .limit(1);
  return stored ? { ...event, eventId: stored.eventId } : event;
}
