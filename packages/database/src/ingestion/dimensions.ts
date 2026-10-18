import { sql } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { author, source } from '../schema/index.js';
import type { IngestTransaction } from '../types.js';
import { toBigInt } from './bigint.js';

/**
 * Upserts the "dimension" records an item refers to: its source (channel/site/...) and author.
 * Profile metadata only moves forward in time: an older observation never overwrites newer metadata.
 */
export async function saveDimensions(
  tx: IngestTransaction,
  event: OsintEvent,
  sourceId: string,
  authorId?: string,
): Promise<void> {
  await saveSource(tx, event, sourceId);
  if (event.author && authorId) await saveAuthor(tx, event, event.author, authorId);
}

async function saveSource(tx: IngestTransaction, event: OsintEvent, sourceId: string): Promise<void> {
  const metadata = {
    source_kind: event.source.kind,
    display_name: event.source.name,
    handle_or_url: event.source.handleOrUrl,
    subscribers: toBigInt(event.source.subscribers),
    metadata_observed_at: event.observedAt,
    updated_at: event.observedAt,
  };
  await tx
    .insert(source)
    .values({ reality_id: event.realityId, source_id: sourceId, platform: event.platform, ...metadata })
    .onConflictDoUpdate({
      target: [source.reality_id, source.source_id],
      set: metadata,
      setWhere: sql`source.metadata_observed_at IS NULL OR source.metadata_observed_at < ${event.observedAt}::timestamptz`,
    });
}

type EventAuthor = NonNullable<OsintEvent['author']>;

async function saveAuthor(
  tx: IngestTransaction,
  event: OsintEvent,
  eventAuthor: EventAuthor,
  authorId: string,
): Promise<void> {
  const profile = {
    display_name: eventAuthor.name,
    handle: eventAuthor.handle,
    verified: eventAuthor.verified,
    followers: toBigInt(eventAuthor.followers),
    profile_seen_at: event.observedAt,
  };
  await tx
    .insert(author)
    .values({
      reality_id: event.realityId,
      author_id: authorId,
      native_user_id: eventAuthor.id,
      platform: event.platform,
      ...profile,
    })
    .onConflictDoUpdate({
      target: [author.reality_id, author.author_id],
      set: profile,
      setWhere: sql`author.profile_seen_at < ${event.observedAt}::timestamptz`,
    });
}
