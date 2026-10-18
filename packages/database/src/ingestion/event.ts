import { eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { EventConflictError } from '../errors.js';
import { ingestEvents } from '../schema/index.js';
import type { IngestTransaction } from '../types.js';

export { assertRealityRegistered } from './reality.js';

/**
 * Records the event envelope (first writer wins) and locks its row for the rest of the transaction.
 * If the same eventId was previously stored with a different hash or reality, the event is a
 * poison pill: eventIds are immutable, so reuse with different content must be quarantined.
 */
export async function registerEvent(tx: IngestTransaction, event: OsintEvent, eventHash: string): Promise<void> {
  await tx
    .insert(ingestEvents)
    .values({
      event_id: event.eventId,
      event_hash: eventHash,
      schema_version: event.schemaVersion,
      reality_id: event.realityId,
      observed_at: event.observedAt,
    })
    .onConflictDoNothing();

  const [stored] = await tx.select().from(ingestEvents).where(eq(ingestEvents.event_id, event.eventId)).for('update');

  const sameContent = stored?.event_hash === eventHash && stored.reality_id === event.realityId;
  if (!sameContent) {
    throw new EventConflictError('Event ID reused with different content');
  }
}
