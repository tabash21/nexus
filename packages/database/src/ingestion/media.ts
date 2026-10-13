import { eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { itemMedia, type ItemMediaRow, type NewItemMedia } from '../schema/index.js';
import type { IngestTransaction } from './types.js';

/** Maps the event's media attachments to `item_media` rows keyed by position. */
export function mediaRows(event: OsintEvent, itemId: string): NewItemMedia[] {
  return (event.media ?? []).map(media => ({
    item_id: itemId,
    position: media.index,
    media_type: media.type,
    media_url: media.url,
    width: media.width,
    height: media.height,
    duration_s: media.duration,
    alt_text: media.altText,
  }));
}

/**
 * True when the incoming media differs from what is stored. A complete media list that changes the
 * attachment count counts as a change; otherwise only fields present on the incoming rows are compared.
 */
export async function mediaChanged(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<boolean> {
  const stored = await tx.select().from(itemMedia).where(eq(itemMedia.item_id, itemId));
  const incoming = mediaRows(event, itemId);
  if (event.mediaComplete && stored.length !== incoming.length) return true;
  return incoming.some(row => rowDiffers(row, stored.find(old => old.position === row.position)));
}

function rowDiffers(row: NewItemMedia, old: ItemMediaRow | undefined): boolean {
  if (!old) return true;
  return Object.entries(row).some(([key, value]) => value !== undefined && old[key as keyof ItemMediaRow] !== value);
}

/**
 * Upserts media attachments. A complete list (`mediaComplete`) replaces all stored rows;
 * a partial list only upserts the positions it contains.
 */
export async function saveMedia(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  if (event.mediaComplete) await tx.delete(itemMedia).where(eq(itemMedia.item_id, itemId));
  for (const row of mediaRows(event, itemId)) {
    await tx.insert(itemMedia).values(row)
      .onConflictDoUpdate({ target: [itemMedia.item_id, itemMedia.position], set: row });
  }
}
