import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { IngestDatabase } from '../ingestion/types.js';
import {
  item,
  itemMedia,
  itemTopic,
  itemLocation,
  itemEntity,
  itemQueryMatch,
  classification,
  engagementSnapshot,
  source,
  author,
  reality,
  platform,
  topic,
  entity,
  collectionQuery,
  embedding,
} from '../schema/index.js';
import type {
  ListOptions,
  ItemListEntry,
  ItemDetail,
  FullItemRow,
} from './types.js';

export const itemFields = {
  item_id: item.item_id,
  reality_id: item.reality_id,
  platform: item.platform,
  native_id: item.native_id,
  source_id: item.source_id,
  published_at: item.published_at,
  last_seen_at: item.last_seen_at,
  title: item.title,
  url: item.url,
  lang: item.lang,
  content_revision: item.content_revision,
};

export async function listItems(db: IngestDatabase, options: ListOptions): Promise<(ItemListEntry | FullItemRow)[]> {
  const conditions: SQL[] = [eq(item.reality_id, options.realityId)];
  if (options.source) conditions.push(eq(item.source_id, options.source));
  if (options.platform) conditions.push(eq(item.platform, options.platform));
  if (options.author) conditions.push(eq(item.author_id, options.author));
  if (options.lang) conditions.push(eq(item.lang, options.lang));
  if (options.itemType) conditions.push(eq(item.item_type, options.itemType as any));
  if (options.from) conditions.push(gte(item.published_at, options.from));
  if (options.to) conditions.push(lt(item.published_at, options.to));
  if (options.cursor) {
    conditions.push(sql`(${item.published_at},${item.item_id}) < (${options.cursor.time}::timestamptz,${options.cursor.id})`);
  }
  if (options.topic) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM core.item_topic it WHERE it.item_id = ${item.item_id} AND it.topic_id = ${options.topic})`,
    );
  }
  if (options.entityId) {
    conditions.push(
      sql`(EXISTS (SELECT 1 FROM core.item_entity ie WHERE ie.item_id = ${item.item_id} AND ie.entity_id = ${options.entityId}) OR EXISTS (SELECT 1 FROM core.item_location il WHERE il.item_id = ${item.item_id} AND il.place_id = ${options.entityId}))`,
    );
  }

  const query = options.full
    ? db.select({
        item_id: item.item_id, reality_id: item.reality_id, platform: item.platform, native_id: item.native_id,
        url: item.url, item_type: item.item_type, schema_version: item.schema_version, source_id: item.source_id,
        author_id: item.author_id, author_name_raw: item.author_name_raw, published_at: item.published_at,
        published_at_source: item.published_at_source, edited_at: item.edited_at, collected_at: item.collected_at,
        title: item.title, content_text: item.content_text, lang: item.lang, lang_confidence: item.lang_confidence,
        lang_platform: item.lang_platform, hashtags: item.hashtags, mentions: item.mentions, links: item.links,
        is_sensitive: item.is_sensitive, reply_to_item_id: item.reply_to_item_id, conversation_id: item.conversation_id,
        quoted_item_id: item.quoted_item_id, shared_from_item_id: item.shared_from_item_id,
        shared_from_source: item.shared_from_source, content_hash: item.content_hash, simhash: item.simhash,
        dup_of: item.dup_of, deleted_at: item.deleted_at, collector: item.collector, provider: item.provider,
        raw_uri: item.raw_uri, platform_extra: item.platform_extra, last_seen_at: item.last_seen_at,
        current_event_id: item.current_event_id, content_revision: item.content_revision,
      })
    : db.select(itemFields);

  return query.from(item).where(and(...conditions)).orderBy(desc(item.published_at), desc(item.item_id)).limit(options.limit + 1);
}

export async function getItemDetail(db: IngestDatabase, id: string, realityId: number): Promise<ItemDetail | null> {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(item).where(and(eq(item.item_id, id), eq(item.reality_id, realityId)));
    if (!row) return null;

    const [
      media,
      topics,
      locations,
      entities,
      queries,
      analysis,
      engagement,
      sourceRow,
      authorRow,
      realityRow,
      platformRow,
      embeddings,
      dupParent,
      replyParent,
      quotedParent,
      sharedParent,
      replies,
      duplicates,
    ] = await Promise.all([
      tx.select().from(itemMedia).where(eq(itemMedia.item_id, id)).orderBy(itemMedia.position),
      tx.select({
        item_id: itemTopic.item_id, topic_id: itemTopic.topic_id, score: itemTopic.score,
        content_revision: itemTopic.content_revision, name: topic.name, description: topic.description,
      }).from(itemTopic).leftJoin(topic, eq(itemTopic.topic_id, topic.topic_id))
        .where(and(eq(itemTopic.item_id, id), eq(itemTopic.content_revision, row.content_revision))),
      tx.select({
        item_id: itemLocation.item_id, place_id: itemLocation.place_id, geo_kind: itemLocation.geo_kind,
        surface_form: itemLocation.surface_form, confidence: itemLocation.confidence,
        content_revision: itemLocation.content_revision, reality_id: itemLocation.reality_id,
        canonical_name: entity.canonical_name, country: entity.country, admin1: entity.admin1, geonames_id: entity.geonames_id,
      }).from(itemLocation).leftJoin(entity, and(eq(itemLocation.place_id, entity.entity_id), eq(itemLocation.reality_id, entity.reality_id)))
        .where(and(eq(itemLocation.item_id, id), eq(itemLocation.content_revision, row.content_revision))),
      tx.select({
        item_id: itemEntity.item_id, entity_id: itemEntity.entity_id, surface_form: itemEntity.surface_form,
        content_revision: itemEntity.content_revision, reality_id: itemEntity.reality_id,
        canonical_name: entity.canonical_name, type: entity.type, country: entity.country,
      }).from(itemEntity).leftJoin(entity, and(eq(itemEntity.entity_id, entity.entity_id), eq(itemEntity.reality_id, entity.reality_id)))
        .where(and(eq(itemEntity.item_id, id), eq(itemEntity.content_revision, row.content_revision))),
      tx.select({
        item_id: itemQueryMatch.item_id, query_id: itemQueryMatch.query_id, matched_at: itemQueryMatch.matched_at,
        reality_id: itemQueryMatch.reality_id, query_text: collectionQuery.query_text, description: collectionQuery.description,
      }).from(itemQueryMatch).leftJoin(collectionQuery, and(eq(itemQueryMatch.query_id, collectionQuery.query_id), eq(itemQueryMatch.reality_id, collectionQuery.reality_id)))
        .where(eq(itemQueryMatch.item_id, id)),
      tx.select().from(classification).where(and(eq(classification.item_id, id), eq(classification.content_revision, row.content_revision))),
      tx.select().from(engagementSnapshot).where(eq(engagementSnapshot.item_id, id)).orderBy(desc(engagementSnapshot.captured_at), engagementSnapshot.provider).limit(1),
      tx.select().from(source).where(and(eq(source.reality_id, row.reality_id), eq(source.source_id, row.source_id), eq(source.platform, row.platform))).limit(1),
      row.author_id ? tx.select().from(author).where(and(eq(author.reality_id, row.reality_id), eq(author.author_id, row.author_id), eq(author.platform, row.platform))).limit(1) : Promise.resolve([]),
      tx.select().from(reality).where(eq(reality.reality_id, row.reality_id)).limit(1),
      tx.select().from(platform).where(eq(platform.platform, row.platform)).limit(1),
      tx.select({
        item_id: embedding.item_id, model: embedding.model, embedded_at: embedding.embedded_at,
        content_revision: embedding.content_revision,
      }).from(embedding).where(eq(embedding.item_id, id)),
      row.dup_of ? tx.select(itemFields).from(item).where(and(eq(item.item_id, row.dup_of), eq(item.reality_id, row.reality_id))).limit(1) : Promise.resolve([]),
      row.reply_to_item_id ? tx.select(itemFields).from(item).where(and(eq(item.item_id, row.reply_to_item_id), eq(item.reality_id, row.reality_id))).limit(1) : Promise.resolve([]),
      row.quoted_item_id ? tx.select(itemFields).from(item).where(and(eq(item.item_id, row.quoted_item_id), eq(item.reality_id, row.reality_id))).limit(1) : Promise.resolve([]),
      row.shared_from_item_id ? tx.select(itemFields).from(item).where(and(eq(item.item_id, row.shared_from_item_id), eq(item.reality_id, row.reality_id))).limit(1) : Promise.resolve([]),
      tx.select(itemFields).from(item).where(and(eq(item.reply_to_item_id, id), eq(item.reality_id, row.reality_id))).orderBy(desc(item.published_at)).limit(10),
      tx.select(itemFields).from(item).where(and(eq(item.dup_of, id), eq(item.reality_id, row.reality_id))).orderBy(desc(item.published_at)).limit(10),
    ]);

    const { tsv: _tsv, ...data } = row;
    return {
      ...data,
      media,
      topics,
      locations,
      entities,
      queries,
      classification: analysis[0] ?? null,
      engagement: engagement[0] ?? null,
      source: sourceRow[0] ?? null,
      author: authorRow[0] ?? null,
      reality: realityRow[0] ?? null,
      platformInfo: platformRow[0] ?? null,
      embeddings,
      relations: {
        duplicateOf: dupParent[0] ?? null,
        replyTo: replyParent[0] ?? null,
        quoted: quotedParent[0] ?? null,
        sharedFrom: sharedParent[0] ?? null,
        replies,
        duplicates,
      },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export async function getItemMedia(db: IngestDatabase, id: string) {
  return db.select().from(itemMedia).where(eq(itemMedia.item_id, id)).orderBy(itemMedia.position);
}

export async function getItemThread(db: IngestDatabase, id: string, realityId: number) {
  const [current] = await db.select(itemFields).from(item).where(and(eq(item.item_id, id), eq(item.reality_id, realityId)));
  if (!current) return null;
  const [parent, replies] = await Promise.all([
    db.select(itemFields).from(item).where(and(sql`${item.item_id} = (SELECT reply_to_item_id FROM core.item WHERE item_id = ${id} AND reality_id = ${realityId})`, eq(item.reality_id, realityId))).limit(1),
    db.select(itemFields).from(item).where(and(eq(item.reply_to_item_id, id), eq(item.reality_id, realityId))).orderBy(desc(item.published_at)).limit(50),
  ]);
  return { current, parent: parent[0] ?? null, replies };
}

export async function getItemRelated(db: IngestDatabase, id: string, realityId: number) {
  const [current] = await db.select(itemFields).from(item).where(and(eq(item.item_id, id), eq(item.reality_id, realityId)));
  if (!current) return null;
  const [duplicates, quotes, shares] = await Promise.all([
    db.select(itemFields).from(item).where(and(eq(item.dup_of, id), eq(item.reality_id, realityId))).orderBy(desc(item.published_at)).limit(20),
    db.select(itemFields).from(item).where(and(eq(item.quoted_item_id, id), eq(item.reality_id, realityId))).orderBy(desc(item.published_at)).limit(20),
    db.select(itemFields).from(item).where(and(eq(item.shared_from_item_id, id), eq(item.reality_id, realityId))).orderBy(desc(item.published_at)).limit(20),
  ]);
  return { duplicates, quotes, shares };
}
