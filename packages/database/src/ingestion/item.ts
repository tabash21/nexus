import { eq, sql } from 'drizzle-orm';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { item, type ItemRow } from '../schema/index.js';
import { mediaChanged } from './media.js';
import { buildItemRow, type ItemContent } from './item-row.js';
import type { IngestTransaction } from './types.js';

export interface SaveItemResult {
  itemId: string;
  /** False when the event is older than the stored observation and the item was left untouched. */
  current: boolean;
}

/**
 * Upserts the canonical item for this event. Concurrent workers are serialized per item, and
 * out-of-order (older) observations never overwrite a newer item state.
 */
export async function saveItem(tx: IngestTransaction, event: OsintEvent): Promise<SaveItemResult> {
  const identity = itemIdentity(event);
  const { itemId } = identity;
  const previous = await lockItem(tx, itemId);

  const current = isCurrentObservation(event, previous);
  if (!current) return { itemId, current };

  const content = await describeContent(tx, event, itemId, previous);
  const row = buildItemRow(event, identity, previous, content);
  if (previous) await tx.update(item).set(row).where(eq(item.item_id, itemId));
  else await tx.insert(item).values(row);
  return { itemId, current };
}

/**
 * Takes a transaction-scoped advisory lock on the item id (covers the not-yet-inserted case),
 * then loads and row-locks the existing item if any.
 */
async function lockItem(tx: IngestTransaction, itemId: string): Promise<ItemRow | undefined> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${itemId},0))`);
  const [previous] = await tx.select().from(item).where(eq(item.item_id, itemId)).for('update');
  return previous;
}

/** New items, strictly newer observations, and re-applications of the current event are current. */
function isCurrentObservation(event: OsintEvent, previous: ItemRow | undefined): boolean {
  return !previous
    || new Date(event.observedAt) > new Date(previous.last_seen_at)
    || previous.current_event_id === event.eventId;
}

/** Computes the content hash and whether text/title or media changed versus the stored item. */
async function describeContent(tx: IngestTransaction, event: OsintEvent, itemId: string, previous: ItemRow | undefined): Promise<ItemContent> {
  const title = event.item.title ?? previous?.title ?? null;
  const contentHash = hash({ title, text: event.item.text });
  const changed = previous !== undefined && (
    contentHash !== previous.content_hash
    || (event.media !== undefined && await mediaChanged(tx, event, itemId))
  );
  return { title, contentHash, changed };
}
