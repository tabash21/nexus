import type { OsintEvent } from '@nexus/contracts';
import { engagementSnapshot } from '../schema/index.js';
import type { IngestTransaction } from './types.js';

const toBigInt = (value: string | undefined): bigint | undefined => value === undefined ? undefined : BigInt(value);

/**
 * Appends a point-in-time engagement snapshot (views, likes, ...). Snapshots are immutable:
 * a repeated (item, provider, capturedAt) snapshot is ignored.
 */
export async function saveEngagement(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  const engagement = event.engagement;
  if (!engagement) return;
  await tx.insert(engagementSnapshot).values({
    item_id: itemId,
    provider: event.provider,
    captured_at: engagement.capturedAt ?? event.observedAt,
    // Likes default to plain "like" semantics unless the collector says they are a score.
    likes_kind: engagement.likes !== undefined ? engagement.likesKind ?? 'like' : engagement.likesKind,
    views: toBigInt(engagement.views),
    likes: toBigInt(engagement.likes),
    reposts: toBigInt(engagement.reposts),
    replies: toBigInt(engagement.replies),
    quotes: toBigInt(engagement.quotes),
    saves: toBigInt(engagement.saves),
  }).onConflictDoNothing();
}
