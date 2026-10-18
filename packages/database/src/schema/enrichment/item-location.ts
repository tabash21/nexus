import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, primaryKey, real, text } from 'drizzle-orm/pg-core';
import { core, geoKind } from '../base.js';
import { reality } from '../registry/reality.js';
import { item } from '../items/item.js';
import { entity } from '../identity/entity.js';

export const itemLocation = core.table(
  'item_location',
  {
    item_id: text('item_id').notNull(),
    place_id: text('place_id').notNull(),
    geo_kind: geoKind('geo_kind').notNull(),
    surface_form: text('surface_form'),
    confidence: real('confidence'),
    content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
    reality_id: integer('reality_id').notNull(),
  },
  t => [
    primaryKey({ name: 'item_location_pk', columns: [t.item_id, t.place_id, t.geo_kind] }),
    foreignKey({
      name: 'item_location_reality_fk',
      columns: [t.reality_id],
      foreignColumns: [reality.reality_id],
    }).onDelete('restrict'),
    check('item_location_confidence_range', sql`confidence >= 0 AND confidence <= 1`),
    check('item_location_revision_positive', sql`content_revision > 0`),
    foreignKey({
      name: 'item_location_item_fk',
      columns: [t.reality_id, t.item_id],
      foreignColumns: [item.reality_id, item.item_id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'item_location_place_fk',
      columns: [t.reality_id, t.place_id],
      foreignColumns: [entity.reality_id, entity.entity_id],
    }).onDelete('restrict'),
    index('item_location_place_idx').using('btree', t.reality_id, t.place_id, t.item_id),
  ],
);

export type ItemLocationRow = typeof itemLocation.$inferSelect;
export type NewItemLocation = typeof itemLocation.$inferInsert;
