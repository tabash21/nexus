import { sql } from 'drizzle-orm';
import { check, primaryKey, text } from 'drizzle-orm/pg-core';
import { core } from '../base.js';

export const platform = core.table('platform', {
  platform: text('platform').notNull(),
  display_name: text('display_name').notNull(),
}, t => [
  primaryKey({ name: 'platform_pk', columns: [t.platform] }),
  check('platform_code', sql`platform ~ '^[a-z][a-z0-9_]*$'`),
]);

export type PlatformRow = typeof platform.$inferSelect;
export type NewPlatform = typeof platform.$inferInsert;
