import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, primaryKey, real, text } from 'drizzle-orm/pg-core';
import { core } from './base.js';
import { item } from './item.js';
import { topic } from './topic.js';

export const itemTopic = core.table('item_topic', {
  item_id: text('item_id').notNull(),
  topic_id: text('topic_id').notNull(),
  score: real('score').notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
}, t => [
  primaryKey({ name: 'item_topic_pk', columns: [t.item_id, t.topic_id] }),
  check('item_topic_score_range', sql`score >= 0 AND score <= 1`),
  check('item_topic_revision_positive', sql`content_revision > 0`),
  foreignKey({ name: 'item_topic_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('cascade'),
  foreignKey({ name: 'item_topic_topic_fk', columns: [t.topic_id], foreignColumns: [topic.topic_id] }).onDelete('restrict'),
  index('item_topic_reverse_idx').using('btree', t.topic_id, t.item_id),
]);

export type ItemTopicRow = typeof itemTopic.$inferSelect;
export type NewItemTopic = typeof itemTopic.$inferInsert;
