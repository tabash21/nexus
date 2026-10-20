import { and, eq, ne } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import type { IngestTransaction } from '../types.js';
import { entity, itemEntity, itemLocation, item } from '../schema/index.js';
import { createHash } from 'crypto';

/**
 * Persist extracted entities and item->entity/item_location links inside the ingest transaction.
 * - Creates `core.entity` rows (idempotent)
 * - Creates `core.item_entity` rows for PER/ORG
 * - Creates `core.item_location` rows for LOC
 */
export async function saveEntities(
  tx: IngestTransaction,
  event: OsintEvent,
  itemId: string,
  current: boolean,
  extracted: { type: 'PER' | 'ORG' | 'LOC'; surface_form: string }[],
): Promise<void> {
  if (!current) return; // only persist entity links for the current revision

  const [row] = await tx.select({ content_revision: item.content_revision }).from(item).where(eq(item.item_id, itemId));
  if (!row) return;
  const contentRevision = row.content_revision;

  await tx
    .delete(itemEntity)
    .where(
      and(
        eq(itemEntity.item_id, itemId),
        eq(itemEntity.reality_id, event.realityId),
        ne(itemEntity.content_revision, contentRevision),
      ),
    );

  await tx
    .delete(itemLocation)
    .where(
      and(
        eq(itemLocation.item_id, itemId),
        eq(itemLocation.reality_id, event.realityId),
        ne(itemLocation.content_revision, contentRevision),
      ),
    );

  const seen = new Set<string>();

  for (const e of extracted) {
    const key = `${e.type}:${e.surface_form}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const h = createHash('sha256');
    h.update(key);
    const entityId = h.digest('hex');

    // Insert entity row (idempotent)
    await tx
      .insert(entity)
      .values({
        entity_id: entityId,
        type: e.type,
        canonical_name: e.surface_form,
        reality_id: event.realityId,
      })
      .onConflictDoNothing();

    if (e.type === 'LOC') {
      await tx
        .insert(itemLocation)
        .values({
          item_id: itemId,
          place_id: entityId,
          geo_kind: 'content',
          surface_form: e.surface_form,
          content_revision: contentRevision,
          reality_id: event.realityId,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .insert(itemEntity)
        .values({
          item_id: itemId,
          entity_id: entityId,
          surface_form: e.surface_form,
          content_revision: contentRevision,
          reality_id: event.realityId,
        })
        .onConflictDoNothing();
    }
  }
}

export default saveEntities;
