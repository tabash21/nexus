import { sql } from 'drizzle-orm';
import { foreignKey, integer, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { ingestSchema } from '../base.js';
import { reality } from '../registry/reality.js';

export const ingestEvents = ingestSchema.table(
  'ingest_events',
  {
    event_id: uuid('event_id').notNull(),
    event_hash: text('event_hash').notNull(),
    schema_version: text('schema_version').notNull(),
    reality_id: integer('reality_id').notNull(),
    observed_at: timestamp('observed_at', { withTimezone: true, mode: 'string' }).notNull(),
    ingested_at: timestamp('ingested_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`now()`),
  },
  t => [
    primaryKey({ name: 'ingest_events_pk', columns: [t.event_id] }),
    foreignKey({
      name: 'ingest_events_reality_fk',
      columns: [t.reality_id],
      foreignColumns: [reality.reality_id],
    }).onDelete('restrict'),
    unique('ingest_event_reality_identity').on(t.event_id, t.reality_id),
  ],
);

export type IngestEventsRow = typeof ingestEvents.$inferSelect;
export type NewIngestEvents = typeof ingestEvents.$inferInsert;
