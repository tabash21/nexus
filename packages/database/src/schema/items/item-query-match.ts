import { foreignKey, index, integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { core } from '../base.js';
import { reality } from '../registry/reality.js';
import { item } from './item.js';
import { collectionQuery } from '../registry/collection-query.js';

export const itemQueryMatch = core.table(
  'item_query_match',
  {
    item_id: text('item_id').notNull(),
    query_id: text('query_id').notNull(),
    matched_at: timestamp('matched_at', { withTimezone: true, mode: 'string' }).notNull(),
    reality_id: integer('reality_id').notNull(),
  },
  t => [
    primaryKey({ name: 'item_query_match_pk', columns: [t.item_id, t.query_id] }),
    foreignKey({
      name: 'item_query_match_reality_fk',
      columns: [t.reality_id],
      foreignColumns: [reality.reality_id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'item_query_match_item_fk',
      columns: [t.reality_id, t.item_id],
      foreignColumns: [item.reality_id, item.item_id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'item_query_match_query_fk',
      columns: [t.reality_id, t.query_id],
      foreignColumns: [collectionQuery.reality_id, collectionQuery.query_id],
    }).onDelete('restrict'),
    index('item_query_reverse_idx').using('btree', t.reality_id, t.query_id, t.item_id),
  ],
);

export type ItemQueryMatchRow = typeof itemQueryMatch.$inferSelect;
export type NewItemQueryMatch = typeof itemQueryMatch.$inferInsert;
