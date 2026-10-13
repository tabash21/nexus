import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index.js';

export type ItemDatabase = NodePgDatabase<typeof schema>;

/** Share the caller-owned pool; its NestJS resource owner remains responsible for shutdown. */
export function createItemDatabase(pool: pg.Pool): ItemDatabase {
  return drizzle(pool, { schema });
}
