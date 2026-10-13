import { sql } from 'drizzle-orm';
import { boolean, foreignKey, integer, primaryKey, text } from 'drizzle-orm/pg-core';
import { core } from './base.js';
import { reality } from './reality.js';
import { platform } from './platform.js';

export const collectionQuery = core.table('collection_query', {
  reality_id: integer('reality_id').notNull(),
  query_id: text('query_id').notNull(),
  platform: text('platform').notNull(),
  query_text: text('query_text').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(sql`true`),
}, t => [
  primaryKey({ name: 'collection_query_pk', columns: [t.reality_id, t.query_id] }),
  foreignKey({ name: 'collection_query_reality_fk', columns: [t.reality_id], foreignColumns: [reality.reality_id] }).onDelete('restrict'),
  foreignKey({ name: 'collection_query_platform_fk', columns: [t.platform], foreignColumns: [platform.platform] }).onDelete('restrict'),
]);

export type CollectionQueryRow = typeof collectionQuery.$inferSelect;
export type NewCollectionQuery = typeof collectionQuery.$inferInsert;
