import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../packages/database/src/schema/index.js';
import { createItemTestDatabase, seedItem } from './helpers/item-database.js';

let fixture: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { fixture = await createItemTestDatabase(); }, 120000);
afterAll(async () => { await fixture?.pg.close(); });

describe('Artemis relationships and native PostgreSQL types', () => {
  it('enforces location types and preserves the selected location country as unknown', async () => {
    const item = await seedItem(fixture.db);
    const personId = randomUUID();
    const placeId = randomUUID();
    await fixture.db.insert(schema.entity).values([
      { entity_id: personId, type: 'PER', canonical_name: 'Person' },
      { entity_id: placeId, type: 'LOC', canonical_name: 'Place', geom: 'SRID=4326;POINT(35.2 31.8)' },
    ]);
    const link = { reality_id: 0, item_id: item.itemId, content_revision: 1n, geo_kind: 'geotag' as const };
    await expect(fixture.db.insert(schema.itemLocation).values({ ...link, place_id: personId })).rejects.toThrow();
    await fixture.db.insert(schema.itemLocation).values({ ...link, place_id: placeId });
    await fixture.db.update(schema.source).set({ home_country: 'US' }).where(eq(schema.source.source_id, item.sourceId));
    const view = await fixture.pg.query<{ lat: number; lon: number; country: string | null }>(
      'SELECT lat,lon,geo_country AS country FROM core.item_ds WHERE item_id=$1', [item.itemId]);
    expect(view.rows[0]).toEqual({ lat: 31.8, lon: 35.2, country: null });
    await expect(fixture.db.insert(schema.itemEntity).values({ reality_id: 0, item_id: item.itemId, entity_id: placeId, surface_form: 'Place', content_revision: 1n })).rejects.toThrow();
    await expect(fixture.db.update(schema.entity).set({ type: 'PER' }).where(eq(schema.entity.entity_id, placeId))).rejects.toThrow();
  });

  it('rejects query matches from another platform', async () => {
    const item = await seedItem(fixture.db);
    const queryId = randomUUID();
    await fixture.db.insert(schema.collectionQuery).values({ reality_id: 0, query_id: queryId, platform: 'x', query_text: 'news' });
    await expect(fixture.db.insert(schema.itemQueryMatch).values({ reality_id: 0, item_id: item.itemId, query_id: queryId, matched_at: item.observedAt })).rejects.toThrow();
    await expect(fixture.db.update(schema.collectionQuery).set({ platform: 'telegram' }).where(eq(schema.collectionQuery.query_id, queryId))).rejects.toThrow();
  });

  it('allows duplicate roots but rejects chains and cycles', async () => {
    const a = await seedItem(fixture.db);
    const b = await seedItem(fixture.db);
    const c = await seedItem(fixture.db);
    await fixture.db.update(schema.item).set({ dup_of: a.itemId }).where(eq(schema.item.item_id, b.itemId));
    await expect(fixture.db.update(schema.item).set({ dup_of: b.itemId }).where(eq(schema.item.item_id, c.itemId))).rejects.toThrow();
    await expect(fixture.db.update(schema.item).set({ dup_of: b.itemId }).where(eq(schema.item.item_id, a.itemId))).rejects.toThrow();
    await expect(fixture.db.update(schema.item).set({ dup_of: c.itemId }).where(eq(schema.item.item_id, a.itemId))).rejects.toThrow();
  });

  it('stores 1024-dimensional vectors and generates searchable text', async () => {
    const item = await seedItem(fixture.db);
    await fixture.db.insert(schema.embedding).values({ item_id: item.itemId, model: 'fixture', content_revision: 1n, embedded_at: item.observedAt, content_vec: Array<number>(1024).fill(0.1) });
    const result = await fixture.pg.query<{ dimensions: number; matches: boolean }>(
      "SELECT vector_dims(e.content_vec) AS dimensions, i.tsv @@ plainto_tsquery('simple','Jerusalem') AS matches FROM core.embedding e JOIN core.item i USING(item_id) WHERE i.item_id=$1", [item.itemId]);
    expect(result.rows[0]).toEqual({ dimensions: 1024, matches: true });
    await expect(fixture.db.update(schema.embedding).set({ content_vec: [0.1] }).where(eq(schema.embedding.item_id, item.itemId))).rejects.toThrow();
  });
});
