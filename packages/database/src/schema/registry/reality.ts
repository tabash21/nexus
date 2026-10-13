import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { core } from '../base.js';

export const reality = core.table('reality', {
  reality_id: integer('reality_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, t => [
  primaryKey({ name: 'reality_pk', columns: [t.reality_id] }),
  check('reality_id_nonnegative', sql`reality_id >= 0`),
]);

export type RealityRow = typeof reality.$inferSelect;
export type NewReality = typeof reality.$inferInsert;
