import { eq, sql } from 'drizzle-orm';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { item, type ItemRow } from '../schema/index.js';
import { buildItemRow, type ItemContent } from './item-row.js';
import type { DetectItemLanguage } from './language.js';
import type { IngestTransaction } from './types.js';

export interface SaveItemResult {
  itemId: string;
  /** False when existing content and attachments must be preserved. */
  current: boolean;
}

/**
 * Upserts the canonical item for this event. Concurrent workers are serialized per item, and
 * source content versions prevent delayed observations from reverting edits.
 */
export async function saveItem(
  tx: IngestTransaction,
  event: OsintEvent,
  rawUri?: string,
  contentVersionAt?: string,
  detectLanguage?: DetectItemLanguage,
): Promise<SaveItemResult> {
  const identity = itemIdentity(event);
  const { itemId } = identity;
  const previous = await lockItem(tx, itemId);

  const content = describeContent(event, previous);
  const current = isCurrentObservation(event, previous, content, contentVersionAt);
  if (!current) {
    if (previous && new Date(event.observedAt) > new Date(previous.last_seen_at)) {
      await tx.update(item).set({ last_seen_at: event.observedAt }).where(eq(item.item_id, itemId));
    }
    return { itemId, current };
  }

  const row = buildItemRow(event, identity, previous, content, rawUri, detectLanguage);
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

/** Source edit time selects content; collection time orders observations of the same content. */
function isCurrentObservation(
  event: OsintEvent,
  previous: ItemRow | undefined,
  content: ItemContent,
  contentVersionAt?: string,
): boolean {
  if (previous && contentVersionAt) {
    const incomingVersion = new Date(contentVersionAt).getTime();
    const storedVersion = new Date(previous.edited_at ?? previous.published_at).getTime();
    if (incomingVersion < storedVersion || (incomingVersion === storedVersion && content.changed)) return false;
    if (incomingVersion > storedVersion) return true;
  }
  return (
    !previous ||
    new Date(event.observedAt) > new Date(previous.last_seen_at) ||
    previous.current_event_id === event.eventId
  );
}

/** Only text and title invalidate text enrichment. Telegram omissions mean no current title. */
function describeContent(event: OsintEvent, previous: ItemRow | undefined): ItemContent {
  const title =
    event.platform === 'telegram' ? (event.item.title ?? null) : (event.item.title ?? previous?.title ?? null);
  const contentHash = hash({ title, text: event.item.text });
  const changed = previous !== undefined && contentHash !== previous.content_hash;
  return { title, contentHash, changed };
}
