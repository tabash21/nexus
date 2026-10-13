import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../../packages/database/src/schema/index.js';
import { applyMigrations, loadMigrations } from '../../packages/database/src/migrations.js';

export async function createItemTestDatabase() {
  const pg = new PGlite({ extensions: { postgis, vector, pg_trgm } });
  try {
    const connection = {
      query: async (text: string, values?: unknown[]) => values
        ? pg.query<Record<string, unknown>>(text, values)
        : { rows: (await pg.exec(text)).flatMap(result => result.rows as Record<string, unknown>[]) },
    };
    const migrations = await loadMigrations();
    await applyMigrations(connection, migrations);
    return { pg, db: drizzle(pg, { schema }), connection, migrations };
  } catch (error) { await pg.close(); throw error; }
}

export async function seedItem(db: PgliteDatabase<typeof schema>, realityId = 0, nativeId: string = randomUUID()) {
  const eventId = randomUUID();
  const itemId = `${realityId}:telegram:${nativeId}`;
  const sourceId = 'telegram:channel-1';
  const observedAt = '2026-10-13T09:00:00Z';
  if (realityId) await db.insert(schema.reality).values({ reality_id: realityId, name: `Exercise ${realityId}` }).onConflictDoNothing();
  await db.insert(schema.source).values({ reality_id: realityId, source_id: sourceId, platform: 'telegram', source_kind: 'channel' }).onConflictDoNothing();
  await db.insert(schema.ingestEvents).values({ event_id: eventId, event_hash: 'hash', reality_id: realityId, schema_version: 'item.v1', observed_at: observedAt });
  await db.insert(schema.item).values({
    item_id: itemId, reality_id: realityId, platform: 'telegram', native_id: nativeId,
    source_id: sourceId, item_type: 'post', published_at: observedAt,
    published_at_source: 'platform', collected_at: observedAt, last_seen_at: observedAt,
    content_text: 'A message about Jerusalem', content_hash: 'text-hash',
    collector: 'test', provider: 'test', raw_uri: `s3://test/${eventId}`, current_event_id: eventId,
  });
  return { eventId, itemId, sourceId, observedAt, realityId };
}
