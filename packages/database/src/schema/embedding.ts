import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, primaryKey, text, timestamp, vector } from 'drizzle-orm/pg-core';
import { core } from './base.js';
import { item } from './item.js';

export const embedding = core.table('embedding', {
  item_id: text('item_id').notNull(),
  model: text('model').notNull(),
  content_vec: vector('content_vec', { dimensions: 1024 }).notNull(),
  title_vec: vector('title_vec', { dimensions: 1024 }),
  embedded_at: timestamp('embedded_at', { withTimezone: true, mode: 'string' }).notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
}, t => [
  primaryKey({ name: 'embedding_pk', columns: [t.item_id] }),
  check('embedding_revision_positive', sql`content_revision > 0`),
  foreignKey({ name: 'embedding_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('cascade'),
]);

export type EmbeddingRow = typeof embedding.$inferSelect;
export type NewEmbedding = typeof embedding.$inferInsert;
