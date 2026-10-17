import { eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { engagementSnapshot } from '../schema/index.js';
import { EventConflictError } from '../errors.js';
import type { IngestTransaction } from './types.js';

const toBigInt = (value: string | undefined): bigint | undefined => value === undefined ? undefined : BigInt(value);

/**
 * Appends a point-in-time engagement snapshot (views, likes, ...). Snapshots are immutable:
 * each observation has its own event identity, including at equal timestamps.
 */
export async function saveEngagement(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  const engagement = event.engagement;
  if (!engagement) return;
  const values = {
    event_id: event.eventId,
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
  };
  const inserted = await tx.insert(engagementSnapshot).values(values).onConflictDoNothing().returning({ snapshot_id: engagementSnapshot.snapshot_id });
  if (inserted.length) return;
  const [stored] = await tx.select().from(engagementSnapshot).where(eq(engagementSnapshot.event_id, event.eventId));
  if (!stored || stored.item_id !== itemId || stored.provider !== event.provider ||
    new Date(stored.captured_at).getTime() !== new Date(values.captured_at).getTime() ||
    stored.views !== (values.views ?? null) || stored.likes !== (values.likes ?? null) ||
    stored.reposts !== (values.reposts ?? null) || stored.replies !== (values.replies ?? null) ||
    stored.quotes !== (values.quotes ?? null) || stored.saves !== (values.saves ?? null) ||
    stored.likes_kind !== (values.likes_kind ?? null)) {
    throw new EventConflictError('Engagement event ID reused with different counts');
  }
}
