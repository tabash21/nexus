import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createItemDatabase, ingest, repository } from '@nexus/database';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../apps/api/dist/app.js';
import { hash, itemIdentity } from '@nexus/contracts';
import { applyMigrations, verifyMigrationHistory } from '../packages/database/src/migrations.js';
import { readCatalog, catalogDifferences } from '../packages/database/src/verification/catalog.js';
import { event, delivery } from './fixtures.js';
import { disposablePostgres } from './helpers/postgres.js';
const url = process.env.INTEGRATION_DATABASE_URL;
describe.skipIf(!url)('Artemis on real PostgreSQL', () => {
  let f: Awaited<ReturnType<typeof disposablePostgres>>;
  beforeAll(async () => { f = await disposablePostgres(url!); }, 120000);
  afterAll(async () => { await f?.close(); });
  it('serializes concurrent redelivery into one receipt', async () => {
    const e = event();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => ingest(createItemDatabase(f.pool), e, delivery(String(i)), hash(e))));
    expect(results.filter(r => !r.duplicate)).toHaveLength(1);
    expect((await f.pool.query('SELECT * FROM ingest.processing_receipts WHERE event_id=$1', [e.eventId])).rows).toHaveLength(1);
    expect((await f.pool.query('SELECT * FROM ingest.deliveries WHERE event_id=$1', [e.eventId])).rows).toHaveLength(5);
  });
  it('preserves the newest observation under concurrent updates', async () => {
    const base = event(); base.item.nativeId = randomUUID();
    await Promise.all(Array.from({ length: 5 }, (_, i) => {
      const e = { ...base, eventId: randomUUID(), observedAt: `2026-03-0${i + 1}T00:00:00Z`, item: { ...base.item, text: 'Version ' + i } };
      return ingest(createItemDatabase(f.pool), e, delivery(String(10 + i)), hash(e));
    }));
    const result = await f.pool.query('SELECT content_text FROM core.item WHERE item_id=$1', [itemIdentity(base).itemId]);
    expect(result.rows[0]?.content_text).toBe('Version 4');
  });
  it('serializes simultaneous migration invocations', async () => {
    await Promise.all([applyMigrations(f.pool), applyMigrations(f.pool)]);
    await verifyMigrationHistory(f.pool, true);
    expect((await f.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(3);
  });
  it('paginates real PostgreSQL timestamps through the authenticated API', async () => {
    const token = 'integration-token-at-least-24-characters';
    const app = await buildApp(repository(f.pool), token);
    try {
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const request = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: 'Bearer ' + token } });
      const first = await (await request('/v1/items?limit=1')).json() as { items: { item_id: string; content_revision: string }[]; nextCursor: string };
      expect(first.items).toHaveLength(1); expect(typeof first.items[0]?.content_revision).toBe('string');
      expect(first.nextCursor).toBeTruthy();
      const response = await request('/v1/items?limit=1&cursor=' + first.nextCursor);
      expect(response.status).toBe(200);
      const next = await response.json() as { items: { item_id: string }[] };
      expect(next.items[0]?.item_id).not.toBe(first.items[0]?.item_id);
      expect((await request('/v1/items?realityId=1&cursor=' + first.nextCursor)).status).toBe(400);
    } finally { await app.close(); }
  });
  it('detects live index and trigger drift, not merely a changed migration ledger', async () => {
    const original = await readCatalog(f.pool);
    await f.pool.query('DROP INDEX core.item_tsv_idx');
    await f.pool.query('ALTER TABLE core.item DISABLE TRIGGER item_revision');
    expect(catalogDifferences(await readCatalog(f.pool), original)).toEqual(['index:core.item_tsv_idx', 'trigger:core.item.item_revision']);
    await f.pool.query('CREATE INDEX item_tsv_idx ON core.item USING gin(tsv)');
    await f.pool.query('ALTER TABLE core.item ENABLE TRIGGER item_revision');
    expect(catalogDifferences(await readCatalog(f.pool), original)).toEqual([]);
  });
});
