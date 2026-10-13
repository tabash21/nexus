import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type pg from 'pg';
import { createItemDatabase } from './client.js';
import type { IngestDatabase } from './ingestion/types.js';
import { item, itemMedia, itemTopic, itemLocation, itemEntity, itemQueryMatch, classification, engagementSnapshot } from './schema/index.js';
import type { ItemRow, ItemMediaRow, ItemTopicRow, ItemLocationRow, ItemEntityRow, ItemQueryMatchRow, ClassificationRow, EngagementSnapshotRow } from './schema/index.js';
export interface ListOptions {
  limit: number; realityId: number; source?: string; platform?: string; from?: string; to?: string;
  cursor?: { time: string; id: string };
}
const fields = { item_id: item.item_id, reality_id: item.reality_id, platform: item.platform, native_id: item.native_id,
  source_id: item.source_id, published_at: item.published_at, last_seen_at: item.last_seen_at,
  title: item.title, url: item.url, lang: item.lang, content_revision: item.content_revision };
export type ItemListEntry = Pick<ItemRow, keyof typeof fields>;
export type ItemDetail = Omit<ItemRow, 'tsv'> & { media: ItemMediaRow[]; topics: ItemTopicRow[];
  locations: ItemLocationRow[]; entities: ItemEntityRow[]; queries: ItemQueryMatchRow[];
  classification: ClassificationRow | null; engagement: EngagementSnapshotRow | null };
export interface ItemRepository {
  ready(): Promise<void>;
  list(options: ListOptions): Promise<ItemListEntry[]>;
  get(id: string, realityId: number): Promise<ItemDetail | null>;
}
export function itemRepository(db: IngestDatabase): ItemRepository {
  return {
    ready: async (): Promise<void> => { await db.select({ id: item.item_id }).from(item).limit(1); },
    list: async (options: ListOptions): Promise<ItemListEntry[]> => {
      const conditions: SQL[] = [eq(item.reality_id, options.realityId)];
      if (options.source) conditions.push(eq(item.source_id, options.source));
      if (options.platform) conditions.push(eq(item.platform, options.platform));
      if (options.from) conditions.push(gte(item.published_at, options.from));
      if (options.to) conditions.push(lt(item.published_at, options.to));
      if (options.cursor) conditions.push(sql`(${item.published_at},${item.item_id}) < (${options.cursor.time}::timestamptz,${options.cursor.id})`);
      return db.select(fields).from(item).where(and(...conditions)).orderBy(desc(item.published_at), desc(item.item_id)).limit(options.limit + 1);
    },
    get: async (id: string, realityId: number): Promise<ItemDetail | null> => db.transaction(async tx => {
      const [row] = await tx.select().from(item).where(and(eq(item.item_id, id), eq(item.reality_id, realityId)));
      if (!row) return null;
      const [media, topics, locations, entities, queries, analysis, engagement] = await Promise.all([
        tx.select().from(itemMedia).where(eq(itemMedia.item_id, id)).orderBy(itemMedia.position),
        tx.select().from(itemTopic).where(and(eq(itemTopic.item_id, id), eq(itemTopic.content_revision, row.content_revision))),
        tx.select().from(itemLocation).where(and(eq(itemLocation.item_id, id), eq(itemLocation.content_revision, row.content_revision))),
        tx.select().from(itemEntity).where(and(eq(itemEntity.item_id, id), eq(itemEntity.content_revision, row.content_revision))),
        tx.select().from(itemQueryMatch).where(eq(itemQueryMatch.item_id, id)),
        tx.select().from(classification).where(and(eq(classification.item_id, id), eq(classification.content_revision, row.content_revision))),
        tx.select().from(engagementSnapshot).where(eq(engagementSnapshot.item_id, id)).orderBy(desc(engagementSnapshot.captured_at), engagementSnapshot.provider).limit(1),
      ]);
      const { tsv: _tsv, ...data } = row;
      return { ...data, media, topics, locations, entities, queries, classification: analysis[0] ?? null, engagement: engagement[0] ?? null };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' }),
  };
}
export function repository(pool: pg.Pool): ReturnType<typeof itemRepository> { return itemRepository(createItemDatabase(pool)); }
