import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { ingestSchema } from '../base.js';
import { ingestEvents } from './ingest-events.js';

export const deliveries = ingestSchema.table(
  'deliveries',
  {
    stream_id: text('stream_id').notNull(),
    topic: text('topic').notNull(),
    partition: integer('partition').notNull(),
    offset_value: bigint('offset_value', { mode: 'bigint' }).notNull(),
    event_id: uuid('event_id').notNull(),
    raw_uri: text('raw_uri'),
  },
  t => [
    primaryKey({ name: 'deliveries_pk', columns: [t.stream_id, t.topic, t.partition, t.offset_value] }),
    check('deliveries_partition_nonnegative', sql`partition >= 0`),
    check('deliveries_offset_value_nonnegative', sql`offset_value >= 0`),
    foreignKey({ name: 'delivery_event_fk', columns: [t.event_id], foreignColumns: [ingestEvents.event_id] }).onDelete(
      'restrict',
    ),
    index('delivery_event_idx').using('btree', t.event_id),
  ],
);

export type DeliveriesRow = typeof deliveries.$inferSelect;
export type NewDeliveries = typeof deliveries.$inferInsert;
