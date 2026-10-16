import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, customType, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { ingestSchema } from '../base.js';
import { ingestEvents } from '../ingestion/ingest-events.js';
import { deliveries } from '../ingestion/deliveries.js';
import { item } from '../items/item.js';
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const inputSnapshots = ingestSchema.table('input_snapshots', {
  event_id: uuid('event_id').primaryKey(),
  item_id: text('item_id').notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
  observed_at: timestamp('observed_at', { withTimezone: true, mode: 'string' }).notNull(),
  stream_id: text('stream_id').notNull(),
  topic: text('topic').notNull(),
  partition: integer('partition').notNull(),
  offset_value: bigint('offset_value', { mode: 'bigint' }).notNull(),
  raw_bytes: bytea('raw_bytes').notNull(),
  raw_sha256: text('raw_sha256').notNull(),
  raw_payload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  input_hash: text('input_hash').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: 'snapshot_event_fk', columns: [t.event_id], foreignColumns: [ingestEvents.event_id] }).onDelete('restrict'),
  foreignKey({ name: 'snapshot_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('restrict'),
  foreignKey({ name: 'snapshot_delivery_fk', columns: [t.stream_id, t.topic, t.partition, t.offset_value], foreignColumns: [deliveries.stream_id, deliveries.topic, deliveries.partition, deliveries.offset_value] }).onDelete('restrict'),
  check('snapshot_revision_positive', sql`content_revision > 0`),
  index('snapshot_item_revision_idx').using('btree', t.item_id, t.content_revision),
]);

export const deliverySnapshots = ingestSchema.table('delivery_snapshots', {
  stream_id: text('stream_id').notNull(),
  topic: text('topic').notNull(),
  partition: integer('partition').notNull(),
  offset_value: bigint('offset_value', { mode: 'bigint' }).notNull(),
  event_id: uuid('event_id').notNull(),
  raw_bytes: bytea('raw_bytes').notNull(),
  raw_sha256: text('raw_sha256').notNull(),
}, t => [
  primaryKey({ name: 'delivery_snapshots_pk', columns: [t.stream_id, t.topic, t.partition, t.offset_value] }),
  foreignKey({ name: 'delivery_snapshot_fk', columns: [t.stream_id, t.topic, t.partition, t.offset_value], foreignColumns: [deliveries.stream_id, deliveries.topic, deliveries.partition, deliveries.offset_value] }).onDelete('restrict'),
  foreignKey({ name: 'delivery_snapshot_event_fk', columns: [t.event_id], foreignColumns: [ingestEvents.event_id] }).onDelete('restrict'),
]);

export const enrichmentJobs = ingestSchema.table('enrichment_jobs', {
  job_id: bigserial('job_id', { mode: 'bigint' }).primaryKey(),
  item_id: text('item_id').notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
  event_id: uuid('event_id').notNull(),
  job_type: text('job_type').notNull(),
  processor_version: text('processor_version').notNull(),
  input_hash: text('input_hash').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  max_attempts: integer('max_attempts').notNull().default(5),
  next_run_at: timestamp('next_run_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  lease_until: timestamp('lease_until', { withTimezone: true, mode: 'string' }),
  claim_token: uuid('claim_token'),
  last_error: text('last_error'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: 'job_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('restrict'),
  foreignKey({ name: 'job_snapshot_fk', columns: [t.event_id], foreignColumns: [inputSnapshots.event_id] }).onDelete('restrict'),
  unique('job_identity').on(t.item_id, t.content_revision, t.job_type, t.processor_version),
  check('job_revision_positive', sql`content_revision > 0`),
  check('job_attempts_valid', sql`attempts >= 0 AND max_attempts > 0`),
  check('job_status_valid', sql`status IN ('pending','running','succeeded','failed','stale')`),
  index('job_due_idx').using('btree', t.status, t.next_run_at, t.created_at),
]);

export const enrichmentResults = ingestSchema.table('enrichment_results', {
  job_id: bigint('job_id', { mode: 'bigint' }).primaryKey(),
  item_id: text('item_id').notNull(),
  content_revision: bigint('content_revision', { mode: 'bigint' }).notNull(),
  job_type: text('job_type').notNull(),
  processor_version: text('processor_version').notNull(),
  input_hash: text('input_hash').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  produced_at: timestamp('produced_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: 'result_job_fk', columns: [t.job_id], foreignColumns: [enrichmentJobs.job_id] }).onDelete('restrict'),
  foreignKey({ name: 'result_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('restrict'),
  index('result_item_revision_idx').using('btree', t.item_id, t.content_revision),
]);

export const archiveLinks = ingestSchema.table('archive_links', {
  stream_id: text('stream_id').notNull(),
  topic: text('topic').notNull(),
  partition: integer('partition').notNull(),
  offset_value: bigint('offset_value', { mode: 'bigint' }).notNull(),
  object_key: text('object_key').notNull(),
  version_id: text('version_id').notNull(),
  record_position: integer('record_position').notNull(),
  raw_sha256: text('raw_sha256').notNull(),
  verified_at: timestamp('verified_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, t => [
  primaryKey({ name: 'archive_links_pk', columns: [t.stream_id, t.topic, t.partition, t.offset_value] }),
  foreignKey({ name: 'archive_delivery_fk', columns: [t.stream_id, t.topic, t.partition, t.offset_value], foreignColumns: [deliveries.stream_id, deliveries.topic, deliveries.partition, deliveries.offset_value] }).onDelete('restrict'),
  check('archive_position_nonnegative', sql`record_position >= 0`),
  index('archive_object_idx').using('btree', t.object_key, t.version_id),
]);
