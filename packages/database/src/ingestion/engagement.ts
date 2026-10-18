import { eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { engagementSnapshot, type EngagementSnapshotRow } from '../schema/index.js';
import { EventConflictError } from '../errors.js';
import type { IngestTransaction } from '../types.js';
import { toBigInt } from './bigint.js';

interface ExpectedEngagement {
  item_id: string;
  provider: string;
  captured_at: string;
  likes_kind?: string;
  views?: bigint;
  likes?: bigint;
  reposts?: bigint;
  replies?: bigint;
  quotes?: bigint;
  saves?: bigint;
}

function matchesStoredEngagement(stored: EngagementSnapshotRow, expected: ExpectedEngagement): boolean {
  return (
    stored.item_id === expected.item_id &&
    stored.provider === expected.provider &&
    new Date(stored.captured_at).getTime() === new Date(expected.captured_at).getTime() &&
    stored.views === (expected.views ?? null) &&
    stored.likes === (expected.likes ?? null) &&
    stored.reposts === (expected.reposts ?? null) &&
    stored.replies === (expected.replies ?? null) &&
    stored.quotes === (expected.quotes ?? null) &&
    stored.saves === (expected.saves ?? null) &&
    stored.likes_kind === (expected.likes_kind ?? null)
  );
}

/**
 * Appends a point-in-time engagement snapshot (views, likes, ...). Snapshots are immutable:
 * each observation has its own event identity, including at equal timestamps.
 */
export async function saveEngagement(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  const engagement = event.engagement;
  if (!engagement) return;

  const values: ExpectedEngagement & { event_id: string } = {
    event_id: event.eventId,
    item_id: itemId,
    provider: event.provider,
    captured_at: engagement.capturedAt ?? event.observedAt,
    // Likes default to plain "like" semantics unless the collector says they are a score.
    likes_kind: engagement.likes !== undefined ? (engagement.likesKind ?? 'like') : engagement.likesKind,
    views: toBigInt(engagement.views),
    likes: toBigInt(engagement.likes),
    reposts: toBigInt(engagement.reposts),
    replies: toBigInt(engagement.replies),
    quotes: toBigInt(engagement.quotes),
    saves: toBigInt(engagement.saves),
  };

  const inserted = await tx
    .insert(engagementSnapshot)
    .values(values)
    .onConflictDoNothing()
    .returning({ snapshot_id: engagementSnapshot.snapshot_id });

  if (inserted.length) return;

  const [stored] = await tx.select().from(engagementSnapshot).where(eq(engagementSnapshot.event_id, event.eventId));
  if (!stored || !matchesStoredEngagement(stored, values)) {
    throw new EventConflictError('Engagement event ID reused with different counts');
  }
}
