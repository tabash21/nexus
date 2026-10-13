import { sql } from 'drizzle-orm';
import { boolean, primaryKey, text } from 'drizzle-orm/pg-core';
import { core } from './base.js';

export const topic = core.table('topic', {
  topic_id: text('topic_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(sql`true`),
}, t => [
  primaryKey({ name: 'topic_pk', columns: [t.topic_id] }),
]);

export type TopicRow = typeof topic.$inferSelect;
export type NewTopic = typeof topic.$inferInsert;
