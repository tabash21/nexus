import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest, itemRepository, requireRealities, EventConflictError, itemSchema } from '@nexus/database';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { event, delivery, source, collectorEvent } from './fixtures.js';
import { processMessage } from '../apps/worker/src/process.js';
import { createItemTestDatabase } from './helpers/item-database.js';
let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { f = await createItemTestDatabase(); }, 120000);
beforeEach(async () => { await f.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE'); });
afterAll(async () => { await f?.pg.close(); });
const save = (e: OsintEvent, offset = '0') => ingest(f.db, e, delivery(offset), hash(e));
describe('Artemis transactional ingestion', () => {
  it('persists the worker-assigned simulation reality throughout the transaction', async () => {
    await requireRealities(f.db, [0, 1]);
    await expect(requireRealities(f.db, [2147483647])).rejects.toThrow('must be registered');
    const payload = collectorEvent({ ...event(), author: { id: 'sim-author', name: 'Exercise author' } });
    const subscription = { ...source, mode: 'simulation' as const, topic: 'sim.telegram.v1', realityId: 1 };
    const message = { ...delivery(), topic: subscription.topic, value: Buffer.from(JSON.stringify(payload)), key: null, timestamp: '1' };
    let committed = false;
    await processMessage(message, { source: subscription, ingest: (observation, transport, eventHash) => ingest(f.db, observation, transport, eventHash),
      quarantine: async () => { throw new Error('Unexpected quarantine'); }, commit: async () => { committed = true; } });
    expect(committed).toBe(true);
    const result = await f.pg.query<{ reality_id: number }>(`SELECT reality_id FROM core.item
      UNION ALL SELECT reality_id FROM core.source UNION ALL SELECT reality_id FROM core.author
      UNION ALL SELECT reality_id FROM ingest.ingest_events UNION ALL SELECT reality_id FROM ingest.processing_receipts`);
    expect(result.rows).toEqual(Array.from({ length: 5 }, () => ({ reality_id: 1 })));
  });
  it('deduplicates redelivery and replay while recording each transport delivery', async () => {
    const e = event();
    expect(await save(e)).toEqual({ duplicate: false });
    expect(await save(e)).toEqual({ duplicate: true });
    expect(await save(e, '1')).toEqual({ duplicate: true });
    expect((await f.pg.query('SELECT * FROM core.item')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.processing_receipts')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.deliveries')).rows).toHaveLength(2);
    const [item] = await f.db.select().from(itemSchema.item);
    expect(item?.raw_uri).toBeNull(); expect(item?.hashtags).toEqual(['OSINT']);
    expect(item?.lang).toBeNull(); expect(item?.published_at_source).toBe('collected_at_fallback');
  });
  it('preserves current state on older or equal-time observations and avoids needless revisions', async () => {
    const e = event(); await save(e);
    await save({ ...e, eventId: randomUUID(), item: { ...e.item, text: 'Late data' }, observedAt: '2026-01-01T00:00:00Z' }, '1');
    await save({ ...e, eventId: randomUUID(), item: { ...e.item, text: 'Equal time' } }, '2');
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z' }, '3');
    const [item] = await f.db.select().from(itemSchema.item);
    expect(item?.content_text).toBe(e.item.text); expect(item?.content_revision).toBe(1n);
    expect((await f.pg.query('SELECT * FROM ingest.processing_receipts')).rows).toHaveLength(4);
  });
  it('rejects event and transport conflicts without committing partial records', async () => {
    const e = event(); await save(e);
    await expect(save({ ...e, item: { ...e.item, text: 'Changed' } }, '1')).rejects.toBeInstanceOf(EventConflictError);
    await expect(save({ ...e, eventId: randomUUID() })).rejects.toBeInstanceOf(EventConflictError);
    expect((await f.pg.query('SELECT * FROM ingest.deliveries')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.ingest_events')).rows).toHaveLength(1);
  });
  it('rolls back dimensions, item, receipt and event after a failed child write', async () => {
    await expect(save({ ...event(), queryIds: ['unregistered-query'] })).rejects.toBeInstanceOf(EventConflictError);
    expect((await f.pg.query('SELECT * FROM ingest.ingest_events')).rows).toHaveLength(0);
    expect((await f.pg.query('SELECT * FROM core.source')).rows).toHaveLength(0);
  });
  it('isolates Telegram channel identities and simulation realities', async () => {
    const a = event(); await save(a);
    await save({ ...a, eventId: randomUUID(), source: { ...a.source, id: 'other-channel' } }, '1');
    await f.db.insert(itemSchema.reality).values({ reality_id: 7, name: 'Test exercise' }).onConflictDoNothing();
    await save({ ...a, eventId: randomUUID(), realityId: 7 }, '2');
    const repo = itemRepository(f.db);
    expect(await repo.list({ limit: 25, realityId: 0 })).toHaveLength(2);
    expect(await repo.list({ limit: 25, realityId: 7 })).toHaveLength(1);
    expect(await repo.get(itemIdentity(a).itemId, 7)).toBeNull();
  });
  it('preserves absent profile fields and ignores late metadata updates', async () => {
    const e = { ...event(), author: { id: 'a', name: 'Known', followers: '100' } }; await save(e);
    await save({ ...e, eventId: randomUUID(), author: { id: 'a', followers: '110' }, observedAt: '2026-01-03T00:00:00Z' }, '1');
    await save({ ...e, eventId: randomUUID(), author: { id: 'a', name: 'Old', followers: '1' }, observedAt: '2026-01-01T00:00:00Z' }, '2');
    const [author] = await f.db.select().from(itemSchema.author);
    expect(author?.display_name).toBe('Known'); expect(author?.followers).toBe(110n);
  });
  it('updates media and revision only for current observations, retaining engagement history', async () => {
    const e = { ...event(), media: [{ index: 0, type: 'image' as const, url: 'https://example.com/a.jpg' }], mediaComplete: true };
    await save(e);
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z', media: [], engagement: { views: '20' } }, '1');
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-01T00:00:00Z', engagement: { views: '10' } }, '2');
    expect(await f.db.select().from(itemSchema.itemMedia)).toHaveLength(0);
    expect((await f.db.select().from(itemSchema.item))[0]?.content_revision).toBe(2n);
    expect(await f.db.select().from(itemSchema.engagementSnapshot)).toHaveLength(2);
  });
  it('supports keyset pagination and parameterized filters', async () => {
    const e = event(); await save(e);
    await save({ ...e, eventId: randomUUID(), item: { ...e.item, nativeId: '2' } }, '1');
    const repo = itemRepository(f.db); const rows = await repo.list({ limit: 1, realityId: 0 });
    expect(rows).toHaveLength(2);
    const page = await repo.list({ limit: 1, realityId: 0, cursor: { time: rows[0]!.published_at, id: rows[0]!.item_id } });
    expect(page).toHaveLength(1); expect(page[0]!.item_id).not.toBe(rows[0]!.item_id);
    expect(await repo.list({ limit: 10, realityId: 0, source: "' OR 1=1 --" })).toEqual([]);
  });
});
