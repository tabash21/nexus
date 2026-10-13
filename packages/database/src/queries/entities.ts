import { and, eq, gt, ilike, sql, type SQL } from 'drizzle-orm';
import type { IngestDatabase } from '../ingestion/types.js';
import { entity } from '../schema/index.js';
import type { EntityRow } from '../schema/index.js';
import type { EntityListOptions, ListOptions, ItemListEntry, FullItemRow } from './types.js';
import { listItems } from './items.js';

export async function listEntities(db: IngestDatabase, options: EntityListOptions): Promise<EntityRow[]> {
  const conditions: SQL[] = [eq(entity.reality_id, options.realityId)];
  if (options.type) conditions.push(eq(entity.type, options.type));
  if (options.country) conditions.push(eq(entity.country, options.country));
  if (options.search) conditions.push(ilike(entity.canonical_name, `%${options.search}%`));
  if (options.cursor) conditions.push(gt(entity.entity_id, options.cursor));

  return db.select().from(entity)
    .where(and(...conditions))
    .orderBy(entity.entity_id)
    .limit(options.limit + 1);
}

export async function getEntity(db: IngestDatabase, id: string, realityId: number): Promise<EntityRow | null> {
  const [row] = await db.select().from(entity)
    .where(and(eq(entity.entity_id, id), eq(entity.reality_id, realityId)))
    .limit(1);
  return row ?? null;
}

export async function getEntityItems(
  db: IngestDatabase,
  entityId: string,
  options: ListOptions,
): Promise<(ItemListEntry | FullItemRow)[]> {
  return listItems(db, {
    ...options,
    entityId,
  });
}
