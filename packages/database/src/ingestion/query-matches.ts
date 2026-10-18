import { and, eq } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { collectionQuery, itemQueryMatch } from '../schema/index.js';
import { EventConflictError } from '../errors.js';
import type { IngestTransaction } from './types.js';

/**
 * Links the item to the collection queries that matched it. Each query must be registered in the
 * event's reality for the same platform; otherwise the event is a poison pill and is quarantined.
 */
export async function saveQueryMatches(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  for (const queryId of event.queryIds ?? []) {
    await assertQueryMatchesEvent(tx, event, queryId);
    await tx
      .insert(itemQueryMatch)
      .values({
        reality_id: event.realityId,
        item_id: itemId,
        query_id: queryId,
        matched_at: event.observedAt,
      })
      .onConflictDoNothing();
  }
}

async function assertQueryMatchesEvent(tx: IngestTransaction, event: OsintEvent, queryId: string): Promise<void> {
  const [query] = await tx
    .select()
    .from(collectionQuery)
    .where(and(eq(collectionQuery.reality_id, event.realityId), eq(collectionQuery.query_id, queryId)));
  if (!query || query.platform !== event.platform)
    throw new EventConflictError('Unknown or mismatched collection query');
}
