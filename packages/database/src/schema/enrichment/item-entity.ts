import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, primaryKey, text } from 'drizzle-orm/pg-core';
import { core } from '../base.js';
import { reality } from '../registry/reality.js';
import { item } from '../items/item.js';
import { entity } from '../identity/entity.js';

export const itemEntity = core.table('item_entity', {
  item_id: text('item_id').notNull(),
  entity_id: text('entity_id').notNull(),
  surface_form: text('surface_form').notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
  reality_id: integer('reality_id').notNull(),
}, t => [
  primaryKey({ name: 'item_entity_pk', columns: [t.item_id, t.entity_id, t.surface_form] }),
  foreignKey({ name: 'item_entity_reality_fk', columns: [t.reality_id], foreignColumns: [reality.reality_id] }).onDelete('restrict'),
  check('item_entity_revision_positive', sql`content_revision > 0`),
  foreignKey({ name: 'item_entity_item_fk', columns: [t.reality_id, t.item_id], foreignColumns: [item.reality_id, item.item_id] }).onDelete('cascade'),
  foreignKey({ name: 'item_entity_entity_fk', columns: [t.reality_id, t.entity_id], foreignColumns: [entity.reality_id, entity.entity_id] }).onDelete('restrict'),
  index('item_entity_reverse_idx').using('btree', t.reality_id, t.entity_id, t.item_id),
]);

export type ItemEntityRow = typeof itemEntity.$inferSelect;
export type NewItemEntity = typeof itemEntity.$inferInsert;
