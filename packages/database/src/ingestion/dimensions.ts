import { sql } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { author, source } from '../schema/index.js';
import type { IngestTransaction } from './types.js';
export async function saveDimensions(tx: IngestTransaction, event: OsintEvent, sourceId: string, authorId?: string): Promise<void> {
  const sourceData = { source_kind: event.source.kind, display_name: event.source.name,
    handle_or_url: event.source.handleOrUrl, subscribers: event.source.subscribers !== undefined ? BigInt(event.source.subscribers) : undefined,
    metadata_observed_at: event.observedAt, updated_at: event.observedAt };
  await tx.insert(source).values({ reality_id: event.realityId, source_id: sourceId, platform: event.platform, ...sourceData })
    .onConflictDoUpdate({ target: [source.reality_id, source.source_id], set: sourceData,
      setWhere: sql`source.metadata_observed_at IS NULL OR source.metadata_observed_at < ${event.observedAt}::timestamptz` });
  if (event.author && authorId) {
    const data = { display_name: event.author.name, handle: event.author.handle, verified: event.author.verified,
      followers: event.author.followers !== undefined ? BigInt(event.author.followers) : undefined, profile_seen_at: event.observedAt };
    await tx.insert(author).values({ reality_id: event.realityId, author_id: authorId, native_user_id: event.author.id, platform: event.platform, ...data })
      .onConflictDoUpdate({ target: [author.reality_id, author.author_id], set: data,
        setWhere: sql`author.profile_seen_at < ${event.observedAt}::timestamptz` });
  }
}
