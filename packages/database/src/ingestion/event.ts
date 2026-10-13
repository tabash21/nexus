import { eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { EventConflictError } from '../errors.js';
import { ingestEvents, reality } from '../schema/index.js';
import type { IngestTransaction } from './types.js';

/** Rejects events targeting a reality (tenant/workspace) that has not been registered. */
export async function assertRealityRegistered(tx: IngestTransaction, realityId: OsintEvent['realityId']): Promise<void> {
  const [realm] = await tx.select().from(reality).where(eq(reality.reality_id, realityId));
  if (!realm) throw new EventConflictError('Reality must be registered before ingestion');
}

/**
 * Records the event envelope (first writer wins) and locks its row for the rest of the transaction.
 * If the same eventId was previously stored with a different hash or reality, the event is a
 * poison pill: eventIds are immutable, so reuse with different content must be quarantined.
 */
export async function registerEvent(tx: IngestTransaction, event: OsintEvent, eventHash: string): Promise<void> {
  await tx.insert(ingestEvents).values({
    event_id: event.eventId,
    event_hash: eventHash,
    schema_version: event.schemaVersion,
    reality_id: event.realityId,
    observed_at: event.observedAt,
  }).onConflictDoNothing();

  const [stored] = await tx.select().from(ingestEvents)
    .where(eq(ingestEvents.event_id, event.eventId))
    .for('update');

  const sameContent = stored?.event_hash === eventHash && stored.reality_id === event.realityId;
  if (!sameContent) throw new EventConflictError('Event ID reused with different content');
}
