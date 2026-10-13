import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../packages/database/src/schema/index.js';
import { createItemTestDatabase, seedItem } from './helpers/item-database.js';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { vector } from '@electric-sql/pglite/vector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readCatalog, catalogDifferences } from '../packages/database/src/verification/catalog.js';

let fixture: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { fixture = await createItemTestDatabase(); }, 120000);
afterAll(async () => { await fixture?.pg.close(); });

describe('Artemis initial schema on PostgreSQL with PostGIS and pgvector', () => {
  it('contains all 19 tables, real-world seed and platform registry', async () => {
    const tables = await fixture.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('core','ingest') AND table_type='BASE TABLE'");
    expect(tables.rows[0]?.count).toBe(19);
    expect(await fixture.db.select().from(schema.platform)).toHaveLength(10);
    expect((await fixture.db.select().from(schema.reality))[0]?.reality_id).toBe(0);
  });

  it('retains all 123 columns from the supplied HTML contract', async () => {
    const original: Record<string, string[]> = JSON.parse(await readFile(new URL('./fixtures/artemis-html-columns.json', import.meta.url), 'utf8'));
    const actual = await fixture.pg.query<{ table_name: string; column_name: string }>(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='core'");
    expect(Object.values(original).flat()).toHaveLength(123);
    for (const [table, columns] of Object.entries(original)) {
      const stored = actual.rows.filter(row => row.table_name === table).map(row => row.column_name);
      expect(stored, table).toEqual(expect.arrayContaining(columns));
    }
  });

  it('saves and reads typed items while retaining unknown fields as null', async () => {
    const item = await seedItem(fixture.db);
    const [row] = await fixture.db.select().from(schema.item).where(eq(schema.item.item_id, item.itemId));
    expect(row?.url).toBeNull();
    expect(row?.lang).toBeNull();
    expect(row?.content_revision).toBe(1n);
    expect(row?.hashtags).toEqual([]);
    const result = await fixture.pg.query<{ topics: string[]; link_domains: string[]; has_media: boolean }>(
      'SELECT topics,link_domains,has_media FROM core.item_ds WHERE item_id=$1', [item.itemId]);
    expect(result.rows[0]).toEqual({ topics: [], link_domains: [], has_media: false });
  });

  it('isolates source metadata and rejects cross-reality references', async () => {
    const real = await seedItem(fixture.db, 0, 'shared-native');
    const sim = await seedItem(fixture.db, 1, 'shared-native');
    expect(real.itemId).not.toBe(sim.itemId);
    await fixture.db.insert(schema.author).values({ reality_id: 1, author_id: 'telegram:sim-only', platform: 'telegram', profile_seen_at: real.observedAt });
    await expect(fixture.db.update(schema.item).set({ author_id: 'telegram:sim-only' }).where(eq(schema.item.item_id, real.itemId))).rejects.toThrow();
    await expect(fixture.db.update(schema.item).set({ dup_of: sim.itemId }).where(eq(schema.item.item_id, real.itemId))).rejects.toThrow();
    await expect(fixture.db.update(schema.item).set({ current_event_id: sim.eventId }).where(eq(schema.item.item_id, real.itemId))).rejects.toThrow();
    await expect(fixture.db.update(schema.item).set({ reality_id: 1 }).where(eq(schema.item.item_id, real.itemId))).rejects.toThrow();
  });

  it('preserves simultaneous provider measurements and valid negative Reddit scores', async () => {
    const item = await seedItem(fixture.db);
    await fixture.db.insert(schema.engagementSnapshot).values([
      { item_id: item.itemId, captured_at: item.observedAt, provider: 'a', likes: -3n, likes_kind: 'score' },
      { item_id: item.itemId, captured_at: item.observedAt, provider: 'b', likes: 4n, likes_kind: 'like' },
    ]);
    await expect(fixture.db.insert(schema.engagementSnapshot).values({ item_id: item.itemId, captured_at: item.observedAt, provider: 'c', likes: -1n, likes_kind: 'like' })).rejects.toThrow();
    const latest = await fixture.pg.query<{ engagement_provider: string; likes: number }>('SELECT engagement_provider,likes FROM core.item_ds WHERE item_id=$1', [item.itemId]);
    expect(latest.rows[0]?.engagement_provider).toBe('a');
    expect(Number(latest.rows[0]?.likes)).toBe(-3);
  });

  it('rejects stale enrichment and hides analysis of an older content revision', async () => {
    const item = await seedItem(fixture.db);
    await fixture.db.insert(schema.classification).values({ item_id: item.itemId, model: 'test', prompt_version: '1', classified_at: item.observedAt, content_revision: 1n, relevance: 0.9 });
    await expect(fixture.db.update(schema.item).set({ content_text: 'Edited' }).where(eq(schema.item.item_id, item.itemId))).rejects.toThrow();
    await fixture.db.update(schema.item).set({ content_text: 'Edited', content_revision: 2n }).where(eq(schema.item.item_id, item.itemId));
    const view = await fixture.pg.query<{ relevance: number | null }>('SELECT relevance FROM core.item_ds WHERE item_id=$1', [item.itemId]);
    expect(view.rows[0]?.relevance).toBeNull();
    await expect(fixture.db.update(schema.classification).set({ relevance: 0.7 }).where(eq(schema.classification.item_id, item.itemId))).rejects.toThrow();
  });

  it('keeps the declarative snapshot equivalent to the applied migration chain', async () => {
    const snapshot = await readFile(new URL('../packages/database/src/schema.sql', import.meta.url), 'utf8');
    const pg = new PGlite({ extensions: { postgis, vector, pg_trgm } });
    try {
      await pg.exec(snapshot);
      const expected = await readCatalog({ query: (sql, values) => pg.query<Record<string, unknown>>(sql, values) });
      expect(catalogDifferences(await readCatalog(fixture.connection), expected)).toEqual([]);
    } finally { await pg.close(); }
  }, 60000);
});
