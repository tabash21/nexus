import { normalize, itemIdentity, type OsintEvent, type Delivery } from '@nexus/contracts';
import { assertRealityRegistered, registerEvent } from './ingestion/event.js';
import { recordDelivery } from './ingestion/delivery.js';
import { hasProcessingReceipt, recordProcessingReceipt } from './ingestion/receipt.js';
import { saveDimensions } from './ingestion/dimensions.js';
import { loadItem, saveItem } from './ingestion/item.js';
import { saveChildren } from './ingestion/children.js';
import { recordRawDelivery, scheduleEnrichment } from './ingestion/schedule.js';
import { resolveHistoricalIdentity } from './ingestion/historical-identity.js';
import type { ItemRow } from './schema/index.js';
import type { IngestDatabase, IngestTransaction } from './types.js';

export interface IngestResult {
  duplicate: boolean;
  /** Event id as persisted; legacy replays resolve to their pre-cutover identity. */
  eventId: string;
  /** Current item state inside the committed transaction, also returned for duplicates. */
  item: ItemRow;
}

export interface IngestOptions {
  contentVersionAt?: string;
  /** Original source topic whose pre-cutover delivery proves the legacy identity. */
  legacySourceTopic?: string;
}

/**
 * Persists one validated OSINT event delivered from Kafka, atomically and idempotently.
 *
 * Everything runs in a single transaction, so the worker may commit the Kafka offset only after
 * this resolves. Throws `EventConflictError` for poison-pill events (caller quarantines them);
 * any other error is an infrastructure failure and must not be acknowledged.
 *
 * Returns `duplicate: true` when the event was already processed (replay or redelivery). The
 * current item is returned either way so callers can republish it after a crash before handoff.
 */
export async function ingest(
  db: IngestDatabase,
  input: OsintEvent,
  delivery: Delivery,
  eventHash: string,
  rawUri?: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const normalized = normalize(input);
  return db.transaction(async tx => {
    const event =
      !rawUri || options.legacySourceTopic
        ? await resolveHistoricalIdentity(tx, normalized, eventHash, options.legacySourceTopic)
        : normalized;
    await assertRealityRegistered(tx, event.realityId);
    await registerEvent(tx, event, eventHash);
    await recordDelivery(tx, delivery, event.eventId, rawUri);
    if (!rawUri) await recordRawDelivery(tx, event, delivery);

    if (await hasProcessingReceipt(tx, event.eventId)) {
      // Legacy receipts predate input snapshots. An exact replay can backfill the current item.
      const itemId = itemIdentity(event).itemId;
      if (!rawUri) await scheduleEnrichment(tx, event, delivery, itemId, true);
      return { duplicate: true, eventId: event.eventId, item: await loadItem(tx, itemId) };
    }

    const { itemId, current } = await applyEvent(tx, event, rawUri, options.contentVersionAt);
    if (!rawUri) await scheduleEnrichment(tx, event, delivery, itemId, current);
    await recordProcessingReceipt(tx, event, itemId);
    return { duplicate: false, eventId: event.eventId, item: await loadItem(tx, itemId) };
  });
}

/** Projects the event into the domain tables (source/author, item, and its child rows). */
async function applyEvent(
  tx: IngestTransaction,
  event: OsintEvent,
  rawUri?: string,
  contentVersionAt?: string,
): Promise<{ itemId: string; current: boolean }> {
  const { sourceId, authorId } = itemIdentity(event);
  await saveDimensions(tx, event, sourceId, authorId);
  const { itemId, current } = await saveItem(tx, event, rawUri, contentVersionAt);
  await saveChildren(tx, event, itemId, current);
  return { itemId, current };
}
