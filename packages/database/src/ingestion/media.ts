import { and, eq, notInArray } from 'drizzle-orm';
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

function rowDiffers(row: NewItemMedia, old: ItemMediaRow | undefined): boolean {
  if (!old) return true;
  return Object.entries(row).some(([key, value]) => value !== undefined && old[key as keyof ItemMediaRow] !== value);
}

/**
 * Upserts media attachments. A complete list (`mediaComplete`) replaces all stored rows;
 * a partial list only upserts the positions it contains.
 */
export async function saveMedia(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  const rows = mediaRows(event, itemId);
  if (event.mediaComplete) {
    const positions = rows.map(row => row.position);
    await tx.delete(itemMedia).where(positions.length
      ? and(eq(itemMedia.item_id, itemId), notInArray(itemMedia.position, positions))
      : eq(itemMedia.item_id, itemId));
  }
  for (const row of rows) {
    const [old] = await tx.select().from(itemMedia).where(and(eq(itemMedia.item_id, itemId), eq(itemMedia.position, row.position)));
    const changed = rowDiffers(row, old);
    await tx.insert(itemMedia).values(row)
      .onConflictDoUpdate({ target: [itemMedia.item_id, itemMedia.position], set: {
        ...row,
        ...(changed ? { s3_uri: null, ocr_text: null, transcript: null } : {}),
      } });
  }
}
