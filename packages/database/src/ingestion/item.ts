import { eq, sql } from 'drizzle-orm';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { item, itemMedia, type NewItem } from '../schema/index.js';
import { mediaRows } from './children.js';
import type { IngestTransaction } from './types.js';
export async function saveItem(tx: IngestTransaction, event: OsintEvent): Promise<{ itemId: string; current: boolean }> {
  const { itemId, nativeId, sourceId, authorId } = itemIdentity(event);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${itemId},0))`);
  const [previous] = await tx.select().from(item).where(eq(item.item_id, itemId)).for('update');
  const current = !previous || new Date(event.observedAt) > new Date(previous.last_seen_at) || previous.current_event_id === event.eventId;
  if (!current) return { itemId, current };
  const title = event.item.title ?? previous?.title ?? null;
  const contentHash = hash({ title, text: event.item.text });
  let changed = previous !== undefined && contentHash !== previous.content_hash;
  if (previous && event.media !== undefined) {
    const stored = await tx.select().from(itemMedia).where(eq(itemMedia.item_id, itemId));
    const incoming = mediaRows(event, itemId);
    changed ||= (event.mediaComplete && stored.length !== incoming.length) || incoming.some(row => {
      const old = stored.find(m => m.position === row.position);
      return !old || Object.entries(row).some(([key, value]) => value !== undefined && old[key as keyof typeof old] !== value);
    });
  }
  const data: NewItem = { item_id: itemId, reality_id: event.realityId, platform: event.platform, native_id: nativeId,
    source_id: sourceId, author_id: authorId, item_type: event.item.type, url: event.item.url,
    published_at: event.item.publishedAt ?? previous?.published_at ?? event.observedAt,
    published_at_source: event.item.publishedAt ? 'platform' : previous?.published_at_source ?? 'collected_at_fallback',
    edited_at: event.item.editedAt && (!previous?.edited_at || new Date(event.item.editedAt) > new Date(previous.edited_at)) ? event.item.editedAt : previous?.edited_at,
    collected_at: previous?.collected_at ?? event.observedAt, last_seen_at: event.observedAt,
    title, content_text: event.item.text, content_hash: contentHash, lang_platform: event.item.language,
    hashtags: event.item.hashtags, mentions: event.item.mentions, links: event.item.links,
    is_sensitive: event.item.sensitive, platform_extra: event.item.extra,
    collector: event.collector, provider: event.provider, current_event_id: event.eventId,
    raw_uri: previous?.current_event_id === event.eventId ? previous.raw_uri : null,
    content_revision: (previous?.content_revision ?? 1n) + (changed ? 1n : 0n) };
  if (previous) await tx.update(item).set(data).where(eq(item.item_id, itemId));
  else await tx.insert(item).values(data);
  return { itemId, current };
}
