import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ingestSchema } from '../base.js';
import { reality } from '../registry/reality.js';
import { ingestEvents } from './ingest-events.js';
import { item } from '../items/item.js';

export const processingReceipts = ingestSchema.table('processing_receipts', {
  event_id: uuid('event_id').notNull(),
  processor_version: text('processor_version').notNull(),
  reality_id: integer('reality_id').notNull(),
  item_id: text('item_id').notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, t => [
  primaryKey({ name: 'processing_receipts_pk', columns: [t.event_id, t.processor_version] }),
  foreignKey({ name: 'processing_receipts_reality_fk', columns: [t.reality_id], foreignColumns: [reality.reality_id] }).onDelete('restrict'),
  foreignKey({ name: 'receipt_event_fk', columns: [t.event_id, t.reality_id], foreignColumns: [ingestEvents.event_id, ingestEvents.reality_id] }).onDelete('restrict'),
  foreignKey({ name: 'receipt_item_fk', columns: [t.reality_id, t.item_id], foreignColumns: [item.reality_id, item.item_id] }).onDelete('restrict'),
  index('receipt_item_idx').using('btree', t.reality_id, t.item_id),
]);

export type ProcessingReceiptsRow = typeof processingReceipts.$inferSelect;
export type NewProcessingReceipts = typeof processingReceipts.$inferInsert;
