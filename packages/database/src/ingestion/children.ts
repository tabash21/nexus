import type { OsintEvent } from '@nexus/contracts';
import { saveMedia } from './media.js';
import { saveEngagement } from './engagement.js';
import { saveQueryMatches } from './query-matches.js';
import type { IngestTransaction } from './types.js';

/**
 * Persists the item's child records. Media is only written when this observation is the item's
 * current one (so stale events cannot overwrite newer attachments); engagement snapshots and query
 * matches are historical facts and are always recorded.
 */
export async function saveChildren(
  tx: IngestTransaction,
  event: OsintEvent,
  itemId: string,
  current: boolean,
): Promise<void> {
  if (current && event.media !== undefined) await saveMedia(tx, event, itemId);
  await saveEngagement(tx, event, itemId);
  await saveQueryMatches(tx, event, itemId);
}
