import { and, eq } from 'drizzle-orm';
import { PROCESSOR_VERSION, type OsintEvent } from '@nexus/contracts';
import { processingReceipts } from '../schema/index.js';
import type { IngestTransaction } from './types.js';

/** True when this event was already fully processed by the current processor version. */
export async function hasProcessingReceipt(tx: IngestTransaction, eventId: string): Promise<boolean> {
  const [receipt] = await tx
    .select()
    .from(processingReceipts)
    .where(and(eq(processingReceipts.event_id, eventId), eq(processingReceipts.processor_version, PROCESSOR_VERSION)));
  return receipt !== undefined;
}

/** Marks the event as processed so replays/redeliveries short-circuit as duplicates. */
export async function recordProcessingReceipt(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  await tx.insert(processingReceipts).values({
    event_id: event.eventId,
    processor_version: PROCESSOR_VERSION,
    reality_id: event.realityId,
    item_id: itemId,
  });
}
