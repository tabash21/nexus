import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, primaryKey, real, smallint, text } from 'drizzle-orm/pg-core';
import { core } from './base.js';
import { item } from './item.js';

export const itemMedia = core.table('item_media', {
  item_id: text('item_id').notNull(),
  position: smallint('position').notNull(),
  media_type: text('media_type').notNull(),
  media_url: text('media_url'),
  thumb_url: text('thumb_url'),
  duration_s: real('duration_s'),
  width: integer('width'),
  height: integer('height'),
  alt_text: text('alt_text'),
  s3_uri: text('s3_uri'),
  ocr_text: text('ocr_text'),
  transcript: text('transcript'),
}, t => [
  primaryKey({ name: 'item_media_pk', columns: [t.item_id, t.position] }),
  check('item_media_position_nonnegative', sql`position >= 0`),
  check('media_type_allowed', sql`media_type IN ('image','video','audio','document','link_card')`),
  check('media_dimensions_positive', sql`(width IS NULL OR width > 0) AND (height IS NULL OR height > 0)`),
  check('media_duration_valid', sql`duration_s >= 0 AND duration_s < 'Infinity'::real`),
  foreignKey({ name: 'item_media_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('cascade'),
]);

export type ItemMediaRow = typeof itemMedia.$inferSelect;
export type NewItemMedia = typeof itemMedia.$inferInsert;
