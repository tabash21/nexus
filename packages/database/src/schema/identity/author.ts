import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { core } from '../base.js';
import { reality } from '../registry/reality.js';
import { platform } from '../registry/platform.js';
import { entity } from './entity.js';

export const author = core.table(
  'author',
  {
    author_id: text('author_id').notNull(),
    native_user_id: text('native_user_id'),
    handle: text('handle'),
    display_name: text('display_name'),
    bio: text('bio'),
    profile_location: text('profile_location'),
    profile_place_id: text('profile_place_id'),
    followers: bigint('followers', { mode: 'bigint' }),
    following: bigint('following', { mode: 'bigint' }),
    posts_count: bigint('posts_count', { mode: 'bigint' }),
    verified: boolean('verified'),
    verified_type: text('verified_type'),
    account_created_at: timestamp('account_created_at', { withTimezone: true, mode: 'string' }),
    is_automated: boolean('is_automated'),
    bot_score: real('bot_score'),
    profile_seen_at: timestamp('profile_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
    reality_id: integer('reality_id')
      .notNull()
      .default(sql`0`),
    platform: text('platform').notNull(),
  },
  t => [
    primaryKey({ name: 'author_pk', columns: [t.reality_id, t.author_id] }),
    foreignKey({ name: 'author_reality_fk', columns: [t.reality_id], foreignColumns: [reality.reality_id] }).onDelete(
      'restrict',
    ),
    foreignKey({ name: 'author_platform_fk', columns: [t.platform], foreignColumns: [platform.platform] }).onDelete(
      'restrict',
    ),
    check('author_bot_score_range', sql`bot_score >= 0 AND bot_score <= 1`),
    check('author_followers_nonnegative', sql`followers >= 0`),
    check('author_following_nonnegative', sql`following >= 0`),
    check('author_posts_count_nonnegative', sql`posts_count >= 0`),
    unique('author_identity_platform').on(t.reality_id, t.author_id, t.platform),
    foreignKey({
      name: 'author_profile_place_fk',
      columns: [t.reality_id, t.profile_place_id],
      foreignColumns: [entity.reality_id, entity.entity_id],
    }).onDelete('restrict'),
    index('author_profile_place_idx').using('btree', t.reality_id, t.profile_place_id),
  ],
);

export type AuthorRow = typeof author.$inferSelect;
export type NewAuthor = typeof author.$inferInsert;
