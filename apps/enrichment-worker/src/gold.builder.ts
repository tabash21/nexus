import { goldItemMessageSchema, type GoldItemMessage } from '@nexus/contracts';
import type { IngestResult } from '@nexus/database';

type ItemRow = IngestResult['item'];

/** PostgreSQL returns `timestamptz` text such as `2026-10-19 06:51:57+00`; gold carries ISO-8601. */
function iso(value: string): string;
function iso(value: string | null): string | null;
function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/**
 * Pure mapping from the committed `core.item` row to the `gold.v1` envelope.
 * Validated against the contract, so a mapping bug fails loudly instead of publishing bad data.
 */
export function buildGoldMessage({ eventId, item }: Pick<IngestResult, 'eventId' | 'item'>): GoldItemMessage {
  return goldItemMessageSchema.parse({
    stageVersion: 'gold.v1',
    eventId,
    item: {
      itemId: item.item_id,
      realityId: item.reality_id,
      platform: item.platform,
      nativeId: item.native_id,
      itemType: item.item_type,
      schemaVersion: item.schema_version,
      url: item.url,
      sourceId: item.source_id,
      authorId: item.author_id,
      authorNameRaw: item.author_name_raw,
      publishedAt: iso(item.published_at),
      publishedAtSource: item.published_at_source,
      editedAt: iso(item.edited_at),
      collectedAt: iso(item.collected_at),
      lastSeenAt: iso(item.last_seen_at),
      deletedAt: iso(item.deleted_at),
      title: item.title,
      text: item.content_text,
      lang: item.lang,
      langConfidence: item.lang_confidence,
      langPlatform: item.lang_platform,
      hashtags: item.hashtags,
      mentions: item.mentions,
      links: item.links,
      isSensitive: item.is_sensitive,
      replyToItemId: item.reply_to_item_id,
      conversationId: item.conversation_id,
      quotedItemId: item.quoted_item_id,
      sharedFromItemId: item.shared_from_item_id,
      sharedFromSource: item.shared_from_source,
      duplicateOf: item.dup_of,
      contentHash: item.content_hash,
      contentRevision: item.content_revision.toString(),
      currentEventId: item.current_event_id,
      collector: item.collector,
      provider: item.provider,
      rawUri: item.raw_uri,
      platformExtra: item.platform_extra,
    },
  });
}
