import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, foreignKey, index, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { core } from '../base.js';
import { item } from './item.js';

export const engagementSnapshot = core.table('engagement_snapshot', {
  snapshot_id: bigserial('snapshot_id', { mode: 'bigint' }).primaryKey(),
  event_id: uuid('event_id'),
  item_id: text('item_id').notNull(),
  captured_at: timestamp('captured_at', { withTimezone: true, mode: 'string' }).notNull(),
  views: bigint('views', { mode: 'bigint' }),
  likes: bigint('likes', { mode: 'bigint' }),
  likes_kind: text('likes_kind'),
  reposts: bigint('reposts', { mode: 'bigint' }),
  replies: bigint('replies', { mode: 'bigint' }),
  quotes: bigint('quotes', { mode: 'bigint' }),
  saves: bigint('saves', { mode: 'bigint' }),
  reactions: jsonb('reactions').$type<Record<string, unknown>>(),
  provider: text('provider').notNull(),
}, t => [
  unique('engagement_snapshot_event_uk').on(t.event_id),
  index('engagement_snapshot_latest_idx').on(t.item_id, t.captured_at.desc(), t.snapshot_id.desc()),
  check('engagement_snapshot_views_nonnegative', sql`views >= 0`),
  check('engagement_snapshot_reposts_nonnegative', sql`reposts >= 0`),
  check('engagement_snapshot_replies_nonnegative', sql`replies >= 0`),
  check('engagement_snapshot_quotes_nonnegative', sql`quotes >= 0`),
  check('engagement_snapshot_saves_nonnegative', sql`saves >= 0`),
  check('engagement_likes_kind', sql`likes_kind IN ('like','heart','score','reactions')`),
  check('engagement_likes_valid', sql`likes IS NULL OR (likes_kind IS NOT NULL AND (likes_kind = 'score' OR likes >= 0))`),
  check('engagement_reactions_object', sql`jsonb_typeof(reactions) = 'object'`),
  foreignKey({ name: 'engagement_snapshot_item_fk', columns: [t.item_id], foreignColumns: [item.item_id] }).onDelete('cascade'),
]);

export type EngagementSnapshotRow = typeof engagementSnapshot.$inferSelect;
export type NewEngagementSnapshot = typeof engagementSnapshot.$inferInsert;
