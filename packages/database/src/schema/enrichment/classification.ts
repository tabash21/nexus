import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, primaryKey, real, text, timestamp } from 'drizzle-orm/pg-core';
import { core } from '../base.js';
import { item } from '../items/item.js';

export const classification = core.table('classification', {
  item_id: text('item_id').notNull(),
  model: text('model').notNull(),
  prompt_version: text('prompt_version').notNull(),
  relevance: real('relevance'),
  misinfo_score: real('misinfo_score'),
  sentiment: text('sentiment'),
  summary_en: text('summary_en'),
  classified_at: timestamp('classified_at', { withTimezone: true, mode: 'string' }).notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
}, t => [
  primaryKey({ name: 'classification_pk', columns: [t.item_id] }),
  check('classification_relevance_range', sql`relevance >= 0 AND relevance <= 1`),
  check('classification_misinfo_score_range', sql`misinfo_score >= 0 AND misinfo_score <= 1`),
  check('classification_revision_positive', sql`content_revision > 0`),
  foreignKey({ name: 'classification_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('cascade'),
]);

export type ClassificationRow = typeof classification.$inferSelect;
export type NewClassification = typeof classification.$inferInsert;
