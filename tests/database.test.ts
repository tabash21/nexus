import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest, repository, EventConflictError, type Pool } from '@nexus/database';
import { hash } from '@nexus/contracts';
import { event, delivery } from './fixtures.js';

const db = new PGlite();
// Use the real PostgreSQL engine, adapting its result shape to node-postgres.
const query = async (sql: string, params?: unknown[]) => {
  const result = await db.query(sql, params);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as InstanceType<typeof Pool>;
beforeAll(async () => { await db.exec(await readFile(new URL('../packages/database/src/schema.sql', import.meta.url), 'utf8')); }, 30000);
beforeEach(async () => { await db.exec('TRUNCATE sources,ingest_events,deliveries,documents,document_versions,event_documents,processing_receipts CASCADE'); });
afterAll(async () => { await db.close(); });
describe('transactional ingestion on embedded PostgreSQL', () => {
  it('deduplicates redelivery and replay while recording distinct deliveries', async () => {
    const e = event();
    expect(await ingest(pool, e, delivery())).toEqual({ duplicate: false });
    expect(await ingest(pool, e, delivery())).toEqual({ duplicate: true });
    expect(await ingest(pool, e, delivery('1'))).toEqual({ duplicate: true });
    expect((await db.query('SELECT * FROM documents')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM processing_receipts')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM deliveries')).rows).toHaveLength(2);
  });
  it('keeps observations but reuses identical content versions', async () => {
    const e = event(); await ingest(pool, e, delivery());
    await ingest(pool, { ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z' }, delivery('1'));
    expect((await db.query('SELECT * FROM document_versions')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM event_documents')).rows).toHaveLength(2);
  });
  it('does not replace the current version with a late older observation', async () => {
    const e = event(); await ingest(pool, e, delivery());
    await ingest(pool, { ...e, eventId: randomUUID(), observedAt: '2026-01-01T00:00:00Z', document: { ...e.document, title: 'Old title' } }, delivery('1'));
    const items = await repository(pool).list({ limit: 25 });
    expect(items[0]!.title).toBe('Example');
    expect((await db.query('SELECT * FROM document_versions')).rows).toHaveLength(2);
  });
  it('rolls back a conflicting event ID without another receipt or delivery', async () => {
    const e = event(); await ingest(pool, e, delivery());
    await expect(ingest(pool, { ...e, document: { ...e.document, text: 'Changed' } }, delivery('1'))).rejects.toBeInstanceOf(EventConflictError);
    expect((await db.query('SELECT * FROM deliveries')).rows).toHaveLength(1);
  });
  it('rolls back the receipt if a later database operation fails', async () => {
    await db.exec("ALTER TABLE document_versions ADD CONSTRAINT reject_title CHECK(title <> 'reject')");
    try {
      const e = event(); e.document.title = 'reject';
      await expect(ingest(pool, e, delivery())).rejects.toThrow();
      expect((await db.query('SELECT * FROM processing_receipts')).rows).toHaveLength(0);
      expect((await db.query('SELECT * FROM ingest_events')).rows).toHaveLength(0);
    } finally { await db.exec('ALTER TABLE document_versions DROP CONSTRAINT reject_title'); }
  });
  it('filters and paginates with a deterministic tie breaker', async () => {
    const e = event(); await ingest(pool, e, delivery());
    await ingest(pool, { ...e, eventId: randomUUID(), document: { ...e.document, externalId: 'doc-2' } }, delivery('1'));
    const repo = repository(pool); const rows = await repo.list({ limit: 1, source: 'test-source' });
    expect(rows).toHaveLength(2);
    const page = await repo.list({ limit: 1, cursor: { time: new Date(rows[0]!.last_seen_at).toISOString(), id: rows[0]!.id } });
    expect(page).toHaveLength(1); expect(page[0]!.id).not.toBe(rows[0]!.id);
    expect(await repo.list({ limit: 10, source: "' OR 1=1 --" })).toEqual([]);
  });
  it('hashes object keys independent of insertion order', () => {
    expect(hash({ a: 1, b: { x: 2, y: 3 } })).toBe(hash({ b: { y: 3, x: 2 }, a: 1 }));
  });
});
