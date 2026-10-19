import { normalize, itemIdentity, type OsintEvent, type Delivery } from '@nexus/contracts';
import { assertRealityRegistered, registerEvent } from './ingestion/event.js';
import { recordDelivery } from './ingestion/delivery.js';
import { hasProcessingReceipt, recordProcessingReceipt } from './ingestion/receipt.js';
import { saveDimensions } from './ingestion/dimensions.js';
import { saveItem } from './ingestion/item.js';
import { saveChildren } from './ingestion/children.js';
import { recordRawDelivery, scheduleEnrichment } from './ingestion/schedule.js';
import { resolveHistoricalIdentity } from './ingestion/historical-identity.js';
import type { DetectItemLanguage } from './ingestion/language.js';
import type { IngestDatabase, IngestTransaction } from './types.js';

export type { DetectItemLanguage, ItemLanguage, LanguageInput } from './ingestion/language.js';

export interface IngestResult {
  duplicate: boolean;
}

export interface IngestOptions {
  contentVersionAt?: string;
  /** Original source topic whose pre-cutover delivery proves the legacy identity. */
  legacySourceTopic?: string;
  /** Pure language detector run on the stored title and text whenever the current item is written. */
  detectLanguage?: DetectItemLanguage;
}

/**
 * Persists one validated OSINT event delivered from Kafka, atomically and idempotently.
 *
 * Everything runs in a single transaction, so the worker may commit the Kafka offset only after
 * this resolves. Throws `EventConflictError` for poison-pill events (caller quarantines them);
 * any other error is an infrastructure failure and must not be acknowledged.
 *
 * Returns `{ duplicate: true }` when the event was already processed (replay or redelivery).
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
      if (!rawUri) await scheduleEnrichment(tx, event, delivery, itemIdentity(event).itemId, true);
      return { duplicate: true };
    }

    const { itemId, current } = await applyEvent(tx, event, rawUri, options);
    if (!rawUri) await scheduleEnrichment(tx, event, delivery, itemId, current);
    await recordProcessingReceipt(tx, event, itemId);
    return { duplicate: false };
  });
}

/** Projects the event into the domain tables (source/author, item, and its child rows). */
async function applyEvent(
  tx: IngestTransaction,
  event: OsintEvent,
  rawUri: string | undefined,
  options: IngestOptions,
): Promise<{ itemId: string; current: boolean }> {
  const { sourceId, authorId } = itemIdentity(event);
  await saveDimensions(tx, event, sourceId, authorId);
  const { itemId, current } = await saveItem(tx, event, rawUri, options.contentVersionAt, options.detectLanguage);
  await saveChildren(tx, event, itemId, current);
  return { itemId, current };
}
