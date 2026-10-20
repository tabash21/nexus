import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest, itemRepository, requireRealities, EventConflictError, itemSchema } from '@nexus/database';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { event, delivery, source, collectorEvent } from './fixtures.js';
import { processMessage } from '../apps/worker/src/process.js';
import { adapt, deterministicEventId } from '../apps/worker/src/adapters/index.js';
import { createItemTestDatabase } from './helpers/item-database.js';
import { newsArticle } from './fixtures/news.js';
let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => {
  f = await createItemTestDatabase();
}, 120000);
beforeEach(async () => {
  await f.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE');
});
afterAll(async () => {
  await f?.pg.close();
});
const save = (e: OsintEvent, offset = '0') => ingest(f.db, e, delivery(offset), hash(e));
const nativeSource = { ...source, adapter: 'telegram.v1' };
const nativeRaw = {
  className: 'Message',
  id: 42,
  peerId: { channelId: '42' },
  date: 1791958800,
  message: 'Original',
  views: 1,
};
async function projectNative(
  raw: typeof nativeRaw & { editDate?: number },
  offset: string,
  time: number,
  legacyReplay = false,
) {
  await processMessage(
    {
      ...delivery(offset),
      timestamp: String(time),
      key: null,
      value: Buffer.from(JSON.stringify(raw)),
      ...(legacyReplay ? { headers: { 'nexus-legacy-replay': Buffer.from('1') } } : {}),
    },
    {
      source: nativeSource,
      archive: async () => ({ rawUri: `s3://test/${offset}`, rawSha256: 'a'.repeat(64) }),
      publish: async (_key, silver) => {
        await ingest(
          f.db,
          silver.event,
          { ...delivery(offset), topic: 'items.silver' },
          silver.eventHash,
          silver.rawUri,
          {
            contentVersionAt: silver.contentVersionAt,
            legacySourceTopic: silver.legacyReplay ? silver.sourceDelivery.topic : undefined,
          },
        );
      },
      quarantine: async record => {
        throw new Error(JSON.stringify(record));
      },
      commit: async () => undefined,
    },
  );
}
describe('Artemis transactional ingestion', () => {
  it('persists undated RSS news with collection-time provenance and deduplicates replay', async () => {
    const raw = {
      ...newsArticle,
      isoDate: undefined,
      pubDate: undefined,
      creator: { $: { 'xmlns:dc': 'http://purl.org/dc/elements/1.1/' } },
      'dc:creator': null,
    };
    const subscription = { ...source, platform: 'news', topic: 'raw.news.v1', adapter: 'news.v1' };
    const article = adapt(raw, subscription);
    expect(await ingest(f.db, article, { ...delivery('0'), topic: 'items.silver' }, hash(raw))).toEqual({
      duplicate: false,
    });
    expect(
      await ingest(f.db, adapt(raw, subscription), { ...delivery('1'), topic: 'items.silver' }, hash(raw)),
    ).toEqual({ duplicate: true });
    const [stored] = await f.db.select().from(itemSchema.item);
    expect(stored?.published_at_source).toBe('collected_at_fallback');
    expect(new Date(stored!.published_at).toISOString()).toBe(newsArticle.collectedAt);
    expect(stored?.author_id).toBeNull();
    expect((await f.pg.query('SELECT * FROM ingest.processing_receipts')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.deliveries')).rows).toHaveLength(2);
  });
  it('persists headline-only news with empty body text', async () => {
    const { contentSnippet: _snippet, ...raw } = newsArticle;
    const article = adapt(raw, { ...source, platform: 'news', topic: 'raw.news.v1', adapter: 'news.v1' });
    await ingest(f.db, article, { ...delivery('0'), topic: 'items.silver' }, hash(raw), 's3://test/headline');
    const [stored] = await f.db.select().from(itemSchema.item);
    expect(stored).toMatchObject({ title: newsArticle.title, content_text: '', item_type: 'article' });
  });
  it('persists news articles and deduplicates replay through the existing writer', async () => {
    const subscription = { ...source, platform: 'news', topic: 'raw.news.v1', adapter: 'news.v1' };
    const article = adapt(newsArticle, subscription);
    const firstDelivery = { ...delivery('0'), topic: 'items.silver' };
    const replayDelivery = { ...delivery('1'), topic: 'items.silver' };
    expect(await ingest(f.db, article, firstDelivery, hash(newsArticle), 's3://test/news')).toEqual({
      duplicate: false,
    });
    expect(await ingest(f.db, article, replayDelivery, hash(newsArticle), 's3://test/replay')).toEqual({
      duplicate: true,
    });
    const [stored] = await f.db.select().from(itemSchema.item);
    expect(stored).toMatchObject({
      platform: 'news',
      item_type: 'article',
      content_text: newsArticle.contentSnippet,
      title: newsArticle.title,
      raw_uri: 's3://test/news',
    });
    expect((await f.pg.query('SELECT * FROM ingest.processing_receipts')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.deliveries')).rows).toHaveLength(2);
    const simulation = adapt(newsArticle, { ...subscription, topic: 'sim.news.v1', mode: 'simulation', realityId: 1 });
    expect(
      await ingest(f.db, simulation, { ...firstDelivery, offset: '2' }, hash(newsArticle), 's3://test/sim-news'),
    ).toEqual({ duplicate: false });
    expect(
      await ingest(f.db, simulation, { ...firstDelivery, offset: '3' }, hash(newsArticle), 's3://test/sim-replay'),
    ).toEqual({ duplicate: true });
    expect((await f.pg.query('SELECT reality_id FROM core.item ORDER BY reality_id')).rows).toEqual([
      { reality_id: 0 },
      { reality_id: 1 },
    ]);
  });
  it('preserves native content across stale, equal-version, and missing-edit observations while retaining engagement', async () => {
    const time = 1791959000000;
    await projectNative({ ...nativeRaw, message: 'Newest', editDate: nativeRaw.date + 20 }, '0', time);
    await projectNative({ ...nativeRaw, message: 'Stale', editDate: nativeRaw.date + 10, views: 2 }, '1', time + 1000);
    await projectNative(
      { ...nativeRaw, message: 'Ambiguous', editDate: nativeRaw.date + 20, views: 3 },
      '2',
      time + 2000,
    );
    await projectNative({ ...nativeRaw, views: 4 }, '3', time + 3000);
    const before = (await f.db.select().from(itemSchema.item))[0];
    expect(before?.content_text).toBe('Newest');
    expect(before?.content_revision).toBe(1n);
    expect(new Date(before!.last_seen_at).toISOString()).toBe(new Date(time + 3000).toISOString());
    expect(Number((await f.pg.query<{ views: number }>('SELECT views FROM core.item_ds')).rows[0]?.views)).toBe(4);
    await projectNative(
      { ...nativeRaw, message: 'Later edit', editDate: nativeRaw.date + 30, views: 5 },
      '4',
      time - 1000,
    );
    const after = (await f.db.select().from(itemSchema.item))[0];
    expect(after?.content_text).toBe('Later edit');
    expect(after?.content_revision).toBe(2n);
    expect(after?.last_seen_at).toBe(before?.last_seen_at);
    expect(await f.db.select().from(itemSchema.engagementSnapshot)).toHaveLength(5);
    expect(Number((await f.pg.query<{ views: number }>('SELECT views FROM core.item_ds')).rows[0]?.views)).toBe(4);
  });
  it('resolves only legacy replay to the pre-cutover identity and keeps new identical observations distinct', async () => {
    const adapted = adapt(nativeRaw, nativeSource);
    const legacy = { ...adapted, eventId: deterministicEventId('telegram', '42', '42') };
    await ingest(f.db, legacy, delivery('0'), hash(nativeRaw));
    await projectNative(nativeRaw, '1', 1791959000000, true);
    expect((await f.pg.query('SELECT event_id FROM ingest.ingest_events')).rows).toEqual([
      { event_id: legacy.eventId },
    ]);
    expect(await f.db.select().from(itemSchema.engagementSnapshot)).toHaveLength(1);
    await projectNative(nativeRaw, '2', 1791959001000);
    expect(await f.db.select().from(itemSchema.engagementSnapshot)).toHaveLength(2);
  });
  it('does not merge legacy replay with an unrelated new silver observation sharing its raw hash', async () => {
    await projectNative(nativeRaw, '0', 1791959000000);
    await projectNative(nativeRaw, '1', 1791959001000, true);
    await projectNative(nativeRaw, '2', 1791959002000, true);
    expect(await f.db.select().from(itemSchema.engagementSnapshot)).toHaveLength(2);
  });
  it('keeps separate engagement observations at one time and ignores replay', async () => {
    const first = { ...event(), engagement: { views: '10', capturedAt: '2026-01-02T12:00:00Z' } };
    const second = {
      ...first,
      eventId: randomUUID(),
      engagement: { views: '20', capturedAt: first.engagement.capturedAt },
    };
    await save(first, '0');
    await save(second, '1');
    await save(second, '2');
    const snapshots = await f.pg.query<{ views: bigint }>(
      'SELECT views FROM core.engagement_snapshot ORDER BY snapshot_id',
    );
    expect(snapshots.rows.map(row => Number(row.views))).toEqual([10, 20]);
    const current = await f.pg.query<{ views: bigint }>('SELECT views FROM core.item_ds');
    expect(Number(current.rows[0]?.views)).toBe(20);
    await expect(
      save({ ...second, engagement: { views: '30', capturedAt: first.engagement.capturedAt } }, '3'),
    ).rejects.toBeInstanceOf(EventConflictError);
  });
  it('persists the worker-assigned simulation reality throughout the transaction', async () => {
    await requireRealities(f.db, [0, 1]);
    await expect(requireRealities(f.db, [2147483647])).rejects.toThrow('must be registered');
    const payload = collectorEvent({ ...event(), author: { id: 'sim-author', name: 'Exercise author' } });
    const subscription = { ...source, mode: 'simulation' as const, topic: 'sim.telegram.v1', realityId: 1 };
    const message = {
      ...delivery(),
      topic: subscription.topic,
      value: Buffer.from(JSON.stringify(payload)),
      key: null,
      timestamp: '1',
    };
    let committed = false;
    await processMessage(message, {
      source: subscription,
      archive: async () => ({ rawUri: 's3://test/raw/observation#L1', rawSha256: 'a'.repeat(64) }),
      publish: async (_key, silver) => {
        await ingest(f.db, silver.event, { ...delivery(), topic: 'items.silver' }, silver.eventHash, silver.rawUri);
      },
      quarantine: async () => {
        throw new Error('Unexpected quarantine');
      },
      commit: async () => {
        committed = true;
      },
    });
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
    expect(item?.raw_uri).toBeNull();
    expect(item?.hashtags).toEqual(['OSINT']);
    expect(item?.lang).toBeNull();
    expect(item?.published_at_source).toBe('collected_at_fallback');
  });
  it('preserves current state on older or equal-time observations and avoids needless revisions', async () => {
    const e = event();
    await save(e);
    await save(
      { ...e, eventId: randomUUID(), item: { ...e.item, text: 'Late data' }, observedAt: '2026-01-01T00:00:00Z' },
      '1',
    );
    await save({ ...e, eventId: randomUUID(), item: { ...e.item, text: 'Equal time' } }, '2');
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z' }, '3');
    const [item] = await f.db.select().from(itemSchema.item);
    expect(item?.content_text).toBe(e.item.text);
    expect(item?.content_revision).toBe(1n);
    expect((await f.pg.query('SELECT * FROM ingest.processing_receipts')).rows).toHaveLength(4);
  });
  it('rejects event and transport conflicts without committing partial records', async () => {
    const e = event();
    await save(e);
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
    const a = event();
    await save(a);
    await save({ ...a, eventId: randomUUID(), source: { ...a.source, id: 'other-channel' } }, '1');
    await f.db.insert(itemSchema.reality).values({ reality_id: 7, name: 'Test exercise' }).onConflictDoNothing();
    await save({ ...a, eventId: randomUUID(), realityId: 7 }, '2');
    const repo = itemRepository(f.db);
    expect(await repo.list({ limit: 25, realityId: 0 })).toHaveLength(2);
    expect(await repo.list({ limit: 25, realityId: 7 })).toHaveLength(1);
    expect(await repo.get(itemIdentity(a).itemId, 7)).toBeNull();
  });
  it('preserves absent profile fields and ignores late metadata updates', async () => {
    const e = { ...event(), author: { id: 'a', name: 'Known', followers: '100' } };
    await save(e);
    await save(
      { ...e, eventId: randomUUID(), author: { id: 'a', followers: '110' }, observedAt: '2026-01-03T00:00:00Z' },
      '1',
    );
    await save(
      {
        ...e,
        eventId: randomUUID(),
        author: { id: 'a', name: 'Old', followers: '1' },
        observedAt: '2026-01-01T00:00:00Z',
      },
      '2',
    );
    const [author] = await f.db.select().from(itemSchema.author);
    expect(author?.display_name).toBe('Known');
    expect(author?.followers).toBe(110n);
  });
  it('updates media without invalidating text enrichment, retaining engagement history', async () => {
    const e = {
      ...event(),
      media: [{ index: 0, type: 'image' as const, url: 'https://example.com/a.jpg' }],
      mediaComplete: true,
    };
    await save(e);
    await save(
      { ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z', media: [], engagement: { views: '20' } },
      '1',
    );
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-01T00:00:00Z', engagement: { views: '10' } }, '2');
    expect(await f.db.select().from(itemSchema.itemMedia)).toHaveLength(0);
    expect((await f.db.select().from(itemSchema.item))[0]?.content_revision).toBe(1n);
    expect(await f.db.select().from(itemSchema.engagementSnapshot)).toHaveLength(2);
  });
  it('retains downloaded media when a complete newer observation has the same media', async () => {
    const e = {
      ...event(),
      media: [{ index: 0, type: 'image' as const, url: 'https://example.com/a.jpg' }],
      mediaComplete: true,
    };
    await save(e);
    await f.db.update(itemSchema.itemMedia).set({ s3_uri: 's3://nexus-media/a', ocr_text: 'read' });
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z' }, '1');
    const [media] = await f.db.select().from(itemSchema.itemMedia);
    expect(media?.s3_uri).toBe('s3://nexus-media/a');
    expect(media?.ocr_text).toBe('read');
    expect((await f.db.select().from(itemSchema.item))[0]?.content_revision).toBe(1n);
  });
  it('supports keyset pagination and parameterized filters', async () => {
    const e = event();
    await save(e);
    await save({ ...e, eventId: randomUUID(), item: { ...e.item, nativeId: '2' } }, '1');
    const repo = itemRepository(f.db);
    const rows = await repo.list({ limit: 1, realityId: 0 });
    expect(rows).toHaveLength(2);
    const page = await repo.list({
      limit: 1,
      realityId: 0,
      cursor: { time: rows[0]!.published_at, id: rows[0]!.item_id },
    });
    expect(page).toHaveLength(1);
    expect(page[0]!.item_id).not.toBe(rows[0]!.item_id);
    expect(await repo.list({ limit: 10, realityId: 0, source: "' OR 1=1 --" })).toEqual([]);
  });
});
