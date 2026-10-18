import { and, eq, type SQL } from 'drizzle-orm';
import type { IngestDatabase } from '../types.js';
import { platform, reality, topic, collectionQuery } from '../schema/index.js';
import type { PlatformRow, RealityRow, TopicRow, CollectionQueryRow } from '../schema/index.js';
import type { QueryListOptions, ListOptions, ItemListEntry, FullItemRow } from './types.js';
import { listItems } from './items.js';

export async function listPlatforms(db: IngestDatabase): Promise<PlatformRow[]> {
  return db.select().from(platform).orderBy(platform.platform);
}

export async function getPlatform(db: IngestDatabase, platformCode: string): Promise<PlatformRow | null> {
  const [row] = await db.select().from(platform).where(eq(platform.platform, platformCode)).limit(1);
  return row ?? null;
}

export async function listRealities(db: IngestDatabase): Promise<RealityRow[]> {
  return db.select().from(reality).orderBy(reality.reality_id);
}

export async function getReality(db: IngestDatabase, realityId: number): Promise<RealityRow | null> {
  const [row] = await db.select().from(reality).where(eq(reality.reality_id, realityId)).limit(1);
  return row ?? null;
}

export async function listTopics(
  db: IngestDatabase,
  options?: { active?: boolean; limit?: number },
): Promise<TopicRow[]> {
  const conditions: SQL[] = [];
  if (options?.active !== undefined) conditions.push(eq(topic.active, options.active));
  const query = db.select().from(topic);
  if (conditions.length) query.where(and(...conditions));
  return query.orderBy(topic.topic_id).limit(options?.limit ?? 100);
}

export async function getTopic(db: IngestDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await db.select().from(topic).where(eq(topic.topic_id, topicId)).limit(1);
  return row ?? null;
}

export async function getTopicItems(
  db: IngestDatabase,
  topicId: string,
  options: ListOptions,
): Promise<(ItemListEntry | FullItemRow)[]> {
  return listItems(db, { ...options, topic: topicId });
}

export async function listQueries(db: IngestDatabase, options: QueryListOptions): Promise<CollectionQueryRow[]> {
  const conditions: SQL[] = [eq(collectionQuery.reality_id, options.realityId)];
  if (options.platform) conditions.push(eq(collectionQuery.platform, options.platform));
  if (options.active !== undefined) conditions.push(eq(collectionQuery.active, options.active));

  return db
    .select()
    .from(collectionQuery)
    .where(and(...conditions))
    .orderBy(collectionQuery.query_id)
    .limit(options.limit);
}

export async function getQuery(
  db: IngestDatabase,
  queryId: string,
  realityId: number,
): Promise<CollectionQueryRow | null> {
  const [row] = await db
    .select()
    .from(collectionQuery)
    .where(and(eq(collectionQuery.query_id, queryId), eq(collectionQuery.reality_id, realityId)))
    .limit(1);
  return row ?? null;
}
