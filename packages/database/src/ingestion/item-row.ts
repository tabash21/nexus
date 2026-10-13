import type { itemIdentity, OsintEvent } from '@nexus/contracts';
import type { ItemRow, NewItem } from '../schema/index.js';

export type ItemIdentity = ReturnType<typeof itemIdentity>;

export interface ItemContent {
  title: string | null;
  contentHash: string;
  changed: boolean;
}

/**
 * Pure merge of the incoming observation with the previously stored item row.
 * Fields the platform may omit (title, publishedAt, editedAt) fall back to what we already know;
 * first-seen facts (collected_at) are preserved; content_revision bumps only on real changes.
 */
export function buildItemRow(event: OsintEvent, identity: ItemIdentity, previous: ItemRow | undefined, content: ItemContent): NewItem {
  return {
    item_id: identity.itemId,
    reality_id: event.realityId,
    platform: event.platform,
    native_id: identity.nativeId,
    source_id: identity.sourceId,
    author_id: identity.authorId,
    item_type: event.item.type,
    url: event.item.url,
    ...publishedFields(event, previous),
    edited_at: latestEditedAt(event, previous),
    collected_at: previous?.collected_at ?? event.observedAt,
    last_seen_at: event.observedAt,
    title: content.title,
    content_text: event.item.text,
    content_hash: content.contentHash,
    lang_platform: event.item.language,
    hashtags: event.item.hashtags,
    mentions: event.item.mentions,
    links: event.item.links,
    is_sensitive: event.item.sensitive,
    platform_extra: event.item.extra,
    collector: event.collector,
    provider: event.provider,
    current_event_id: event.eventId,
    // raw_uri belongs to the archived raw event; keep it only when re-applying the same event.
    raw_uri: previous?.current_event_id === event.eventId ? previous.raw_uri : null,
    content_revision: (previous?.content_revision ?? 1n) + (content.changed ? 1n : 0n),
  };
}

/** Platform publish time wins; otherwise keep the known value, falling back to first observation time. */
function publishedFields(event: OsintEvent, previous: ItemRow | undefined): Pick<NewItem, 'published_at' | 'published_at_source'> {
  return {
    published_at: event.item.publishedAt ?? previous?.published_at ?? event.observedAt,
    published_at_source: event.item.publishedAt ? 'platform' : previous?.published_at_source ?? 'collected_at_fallback',
  };
}

/** Edit timestamps only move forward. */
function latestEditedAt(event: OsintEvent, previous: ItemRow | undefined): NewItem['edited_at'] {
  const incoming = event.item.editedAt;
  const isNewer = incoming && (!previous?.edited_at || new Date(incoming) > new Date(previous.edited_at));
  return isNewer ? incoming : previous?.edited_at;
}
