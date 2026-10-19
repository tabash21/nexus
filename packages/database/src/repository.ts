import type pg from 'pg';
import { createItemDatabase } from './client.js';
import type { IngestDatabase } from './types.js';
import { item } from './schema/index.js';
import type {
  ListOptions,
  SourceListOptions,
  AuthorListOptions,
  EntityListOptions,
  QueryListOptions,
} from './queries/types.js';
import {
  listItems,
  getItemDetail,
  getItemMedia,
  getItemEnrichment,
  getItemThread,
  getItemRelated,
} from './queries/items.js';
import { listSources, getSource, getSourceItems } from './queries/sources.js';
import { listAuthors, getAuthor, getAuthorItems } from './queries/authors.js';
import {
  listPlatforms,
  getPlatform,
  listRealities,
  getReality,
  listTopics,
  getTopic,
  getTopicItems,
  listQueries,
  getQuery,
} from './queries/registries.js';
import { listEntities, getEntity, getEntityItems } from './queries/entities.js';
import { getStats } from './queries/stats.js';

export * from './queries/types.js';

export function itemRepository(db: IngestDatabase) {
  return {
    ready: async (): Promise<void> => {
      await db.select({ id: item.item_id }).from(item).limit(1);
    },
    // Items
    list: (options: ListOptions) => listItems(db, options),
    get: (id: string, realityId: number) => getItemDetail(db, id, realityId),
    getMany: (ids: string[], realityId: number) => Promise.all(ids.map(id => getItemDetail(db, id, realityId))),
    getItemMedia: (id: string) => getItemMedia(db, id),
    getItemEnrichment: (id: string, realityId: number) => getItemEnrichment(db, id, realityId),
    getItemThread: (id: string, realityId: number) => getItemThread(db, id, realityId),
    getItemRelated: (id: string, realityId: number) => getItemRelated(db, id, realityId),
    // Sources
    listSources: (options: SourceListOptions) => listSources(db, options),
    getSource: (id: string, realityId: number) => getSource(db, id, realityId),
    getSourceItems: (sourceId: string, options: ListOptions) => getSourceItems(db, sourceId, options),
    // Authors
    listAuthors: (options: AuthorListOptions) => listAuthors(db, options),
    getAuthor: (id: string, realityId: number) => getAuthor(db, id, realityId),
    getAuthorItems: (authorId: string, options: ListOptions) => getAuthorItems(db, authorId, options),
    // Platforms & Realities
    listPlatforms: () => listPlatforms(db),
    getPlatform: (platformCode: string) => getPlatform(db, platformCode),
    listRealities: () => listRealities(db),
    getReality: (realityId: number) => getReality(db, realityId),
    // Topics
    listTopics: (options?: { active?: boolean; limit?: number }) => listTopics(db, options),
    getTopic: (topicId: string) => getTopic(db, topicId),
    getTopicItems: (topicId: string, options: ListOptions) => getTopicItems(db, topicId, options),
    // Entities
    listEntities: (options: EntityListOptions) => listEntities(db, options),
    getEntity: (id: string, realityId: number) => getEntity(db, id, realityId),
    getEntityItems: (entityId: string, options: ListOptions) => getEntityItems(db, entityId, options),
    // Queries
    listQueries: (options: QueryListOptions) => listQueries(db, options),
    getQuery: (queryId: string, realityId: number) => getQuery(db, queryId, realityId),
    // Stats
    getStats: (realityId: number) => getStats(db, realityId),
  };
}

export type ItemRepository = ReturnType<typeof itemRepository>;

export function repository(pool: pg.Pool): ItemRepository {
  return itemRepository(createItemDatabase(pool));
}
