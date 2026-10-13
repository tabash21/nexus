import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index.js';
import { inArray } from 'drizzle-orm';
import type { IngestDatabase } from './ingestion/types.js';

export type ItemDatabase = NodePgDatabase<typeof schema>;

/** Share the caller-owned pool; its NestJS resource owner remains responsible for shutdown. */
export function createItemDatabase(pool: pg.Pool): ItemDatabase {
  return drizzle(pool, { schema });
}

export async function requireRealities(db: IngestDatabase, realityIds: readonly number[]): Promise<void> {
  const ids = [...new Set(realityIds)];
  if (!ids.length) return;
  const registered = await db.select().from(schema.reality).where(inArray(schema.reality.reality_id, ids));
  const missing = ids.filter(id => !registered.some(row => row.reality_id === id));
  if (missing.length) throw new Error('Configured realities must be registered before consuming: ' + missing.join(', '));
}
