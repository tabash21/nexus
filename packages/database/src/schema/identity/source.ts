import { sql } from 'drizzle-orm';
import { bigint, boolean, char, check, foreignKey, integer, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { core } from '../base.js';
import { reality } from '../registry/reality.js';
import { platform } from '../registry/platform.js';

export const source = core.table('source', {
  source_id: text('source_id').notNull(),
  platform: text('platform').notNull(),
  source_kind: text('source_kind').notNull(),
  handle_or_url: text('handle_or_url'),
  display_name: text('display_name'),
  arena: text('arena'),
  home_country: char('home_country', { length: 2 }),
  default_language: text('default_language'),
  subscribers: bigint('subscribers', { mode: 'bigint' }),
  tier: text('tier'),
  added_by: text('added_by'),
  reason: text('reason'),
  active: boolean('active').notNull().default(sql`true`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  reality_id: integer('reality_id').notNull().default(sql`0`),
  metadata_observed_at: timestamp('metadata_observed_at', { withTimezone: true, mode: 'string' }),
}, t => [
  primaryKey({ name: 'source_pk', columns: [t.reality_id, t.source_id] }),
  foreignKey({ name: 'source_reality_fk', columns: [t.reality_id], foreignColumns: [reality.reality_id] }).onDelete('restrict'),
  foreignKey({ name: 'source_platform_fk', columns: [t.platform], foreignColumns: [platform.platform] }).onDelete('restrict'),
  check('source_subscribers_nonnegative', sql`subscribers >= 0`),
  check('source_kind_allowed', sql`source_kind IN ('channel','site','subreddit','page','group','account','search')`),
  check('source_arena_allowed', sql`arena IN ('IL','ARAB','INTL')`),
  check('source_tier_allowed', sql`tier IN ('watchlist','discovery')`),
  unique('source_identity_platform').on(t.reality_id, t.source_id, t.platform),
]);

export type SourceRow = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
