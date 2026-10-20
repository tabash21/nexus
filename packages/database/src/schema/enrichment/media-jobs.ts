import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { ingestSchema } from '../base.js';
import { item } from '../items/item.js';

/** Attachment jobs deliberately survive replacement/removal of their original media row. */
export const mediaJobs = ingestSchema.table(
  'media_jobs',
  {
    job_id: uuid('job_id').defaultRandom().primaryKey(),
    item_id: text('item_id').notNull(),
    position: smallint('position').notNull(),
    attachment_generation: uuid('attachment_generation').notNull(),
    processor_version: text('processor_version').notNull(),
    source_url: text('source_url'),
    media_type: text('media_type').notNull(),
    status: text('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    max_attempts: integer('max_attempts').default(3).notNull(),
    next_run_at: timestamp('next_run_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    claim_token: uuid('claim_token'),
    lease_until: timestamp('lease_until', { withTimezone: true, mode: 'string' }),
    archive_uri: text('archive_uri'),
    outcome: text('outcome'),
    last_error: text('last_error'),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  t => [
    foreignKey({ name: 'media_job_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('cascade'),
    unique('media_job_identity').on(t.item_id, t.position, t.attachment_generation, t.processor_version),
    check('media_job_position_valid', sql`position >= 0`),
    check('media_job_attempts_valid', sql`attempts >= 0 AND max_attempts > 0`),
    check('media_job_status_valid', sql`status IN ('pending','running','succeeded','failed','stale')`),
    check('media_job_lease_valid', sql`(status = 'running') = (claim_token IS NOT NULL AND lease_until IS NOT NULL)`),
    index('media_job_due_idx').on(t.status, t.next_run_at, t.created_at),
  ],
);

export type MediaJobRow = typeof mediaJobs.$inferSelect;
