import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { IngestDatabase } from '../types.js';
import { source, item } from '../schema/index.js';
import type { SourceRow } from '../schema/index.js';
import type { SourceListOptions, ListOptions, ItemListEntry, FullItemRow } from './types.js';
import { listItems } from './items.js';

export async function listSources(db: IngestDatabase, options: SourceListOptions): Promise<SourceRow[]> {
  const conditions: SQL[] = [eq(source.reality_id, options.realityId)];
  if (options.platform) conditions.push(eq(source.platform, options.platform));
  if (options.arena) conditions.push(eq(source.arena, options.arena));
  if (options.tier) conditions.push(eq(source.tier, options.tier));
  if (options.active !== undefined) conditions.push(eq(source.active, options.active));
  if (options.cursor) conditions.push(gt(source.source_id, options.cursor));

  return db
    .select()
    .from(source)
    .where(and(...conditions))
    .orderBy(source.source_id)
    .limit(options.limit + 1);
}

export async function getSource(db: IngestDatabase, id: string, realityId: number): Promise<SourceRow | null> {
  const [row] = await db
    .select()
    .from(source)
    .where(and(eq(source.source_id, id), eq(source.reality_id, realityId)))
    .limit(1);
  return row ?? null;
}

export async function getSourceItems(
  db: IngestDatabase,
  sourceId: string,
  options: ListOptions,
): Promise<(ItemListEntry | FullItemRow)[]> {
  return listItems(db, { ...options, source: sourceId });
}
