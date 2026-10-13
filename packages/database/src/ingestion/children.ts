import { and, eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { collectionQuery, engagementSnapshot, itemMedia, itemQueryMatch, type NewItemMedia } from '../schema/index.js';
import { EventConflictError } from '../errors.js';
import type { IngestTransaction } from './types.js';
export function mediaRows(event: OsintEvent, itemId: string): NewItemMedia[] {
  return (event.media ?? []).map(media => ({ item_id: itemId, position: media.index, media_type: media.type,
    media_url: media.url, width: media.width, height: media.height, duration_s: media.duration, alt_text: media.altText }));
}
export async function saveChildren(tx: IngestTransaction, event: OsintEvent, itemId: string, current: boolean): Promise<void> {
  if (current && event.media !== undefined) {
    if (event.mediaComplete) await tx.delete(itemMedia).where(eq(itemMedia.item_id, itemId));
    for (const row of mediaRows(event, itemId)) await tx.insert(itemMedia).values(row)
      .onConflictDoUpdate({ target: [itemMedia.item_id, itemMedia.position], set: row });
  }
  const e = event.engagement;
  const count = (value: string | undefined): bigint | undefined => value === undefined ? undefined : BigInt(value);
  if (e) await tx.insert(engagementSnapshot).values({ item_id: itemId, provider: event.provider,
    captured_at: e.capturedAt ?? event.observedAt, likes_kind: e.likes !== undefined ? e.likesKind ?? 'like' : e.likesKind,
    views: count(e.views), likes: count(e.likes), reposts: count(e.reposts), replies: count(e.replies), quotes: count(e.quotes), saves: count(e.saves),
  }).onConflictDoNothing();
  for (const queryId of event.queryIds ?? []) {
    const [query] = await tx.select().from(collectionQuery).where(and(eq(collectionQuery.reality_id, event.realityId), eq(collectionQuery.query_id, queryId)));
    if (!query || query.platform !== event.platform) throw new EventConflictError('Unknown or mismatched collection query');
    await tx.insert(itemQueryMatch).values({ reality_id: event.realityId, item_id: itemId, query_id: queryId, matched_at: event.observedAt }).onConflictDoNothing();
  }
}
