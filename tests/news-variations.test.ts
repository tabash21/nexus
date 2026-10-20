import { describe, expect, it, vi } from 'vitest';
import { sourceSubscriptions } from '@nexus/contracts';
import { adapt } from '../apps/worker/src/adapters/index.js';
import { processMessage } from '../apps/worker/src/process.js';
import { newsArticle } from './fixtures/news.js';

const source = sourceSubscriptions({ KAFKA_PLATFORMS: 'news' })[0]!;
const xmlAttributes = { 'xmlns:dc': 'http://purl.org/dc/elements/1.1/' };

describe('RSS publisher variations', () => {
  it.each([undefined, null, '', '  '])('accepts an absent publication date %j', isoDate => {
    const event = adapt({ ...newsArticle, isoDate, pubDate: undefined }, source);
    expect(event.item.publishedAt).toBeUndefined();
    expect(event.observedAt).toBe(newsArticle.collectedAt);
  });

  it('falls back to a zoned RSS pubDate and prefers isoDate when available', () => {
    const pubDate = 'Tue, 20 Oct 2026 09:09:25 +0200';
    expect(adapt({ ...newsArticle, isoDate: undefined, pubDate }, source).item.publishedAt).toBe(newsArticle.isoDate);
    expect(adapt({ ...newsArticle, pubDate: 'Tue, 20 Oct 2026 09:09:25 GMT' }, source).item.publishedAt).toBe(
      newsArticle.isoDate,
    );
  });

  it.each([
    undefined,
    null,
    '',
    'invalid GMT',
    '2026-10-20T07:09:25',
    'Tue, 20 Oct 2026 07:09:25',
    'Ter, 20 out 2026 12:37:00 +0100',
    { _: 'Tue, 20 Oct 2026 07:09:25 GMT' },
  ])('leaves publication unknown for an unusable pubDate %j', pubDate => {
    expect(adapt({ ...newsArticle, isoDate: undefined, pubDate }, source).item.publishedAt).toBeUndefined();
  });

  it('accepts XML attribute-only authors from Il Sole 24 Ore without creating an author', () => {
    const event = adapt({ ...newsArticle, creator: { $: xmlAttributes }, 'dc:creator': { $: xmlAttributes } }, source);
    expect(event.author).toBeUndefined();
    expect(event.item.title).toBe(newsArticle.title);
  });

  it.each(['creator', 'dc:creator'])('extracts XML text from %s', field => {
    const event = adapt(
      { ...newsArticle, creator: undefined, 'dc:creator': undefined, [field]: { _: 'Reporter', $: xmlAttributes } },
      source,
    );
    expect(event.author?.name).toBe('Reporter');
  });

  it.each([undefined, null, '', '  ', { $: xmlAttributes }, { _: '  ' }, { name: 'Unknown' }, 123, []])(
    'tries dc:creator when creator has no usable text %j',
    creator => {
      expect(adapt({ ...newsArticle, creator, 'dc:creator': 'Reporter' }, source).author?.name).toBe('Reporter');
      expect(adapt({ ...newsArticle, creator, 'dc:creator': null }, source).author).toBeUndefined();
    },
  );

  it.each([undefined, null])('accepts omitted optional feed and headline metadata %j', missing => {
    const event = adapt({ ...newsArticle, feedName: missing, title: missing }, source);
    expect(event.source.id).toBe(newsArticle.feedUrl);
    expect(event.source.name).toBeUndefined();
    expect(event.item.title).toBeUndefined();
    expect(event.item.text).toBe(newsArticle.contentSnippet);
    expect(adapt({ ...newsArticle, contentSnippet: missing }, source).item.text).toBe('');
  });

  it.each([
    { itemId: undefined },
    { feedUrl: undefined },
    { feedUrl: 'ftp://example.com/feed' },
    { link: undefined },
    { link: 'javascript:alert(1)' },
    { collectedAt: undefined },
    { collectedAt: 'Tue, 20 Oct 2026 07:09:25 GMT' },
    { isoDate: 'invalid' },
    { title: null, contentSnippet: undefined },
    { title: undefined, contentSnippet: '  ' },
    { realityId: 0 },
  ])('still rejects invalid article boundaries %j', changes => {
    expect(() => adapt({ ...newsArticle, ...changes }, source)).toThrow();
  });

  it('publishes and commits an undated Le Parisien article while preserving replay identity', async () => {
    const raw = {
      ...newsArticle,
      feedName: 'Le Parisien',
      feedUrl: 'https://feeds.leparisien.fr/leparisien/rss',
      isoDate: undefined,
      pubDate: undefined,
      creator: { $: xmlAttributes },
      'dc:creator': { $: xmlAttributes },
    };
    const first = adapt(raw, source);
    expect(adapt(JSON.parse(JSON.stringify(raw)), source).eventId).toBe(first.eventId);
    const deps = {
      source,
      archive: vi.fn().mockResolvedValue({ rawUri: 's3://test/news', rawSha256: 'a'.repeat(64) }),
      publish: vi.fn().mockResolvedValue(undefined),
      quarantine: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    await processMessage(
      {
        streamId: 'test',
        topic: source.topic,
        partition: 0,
        offset: '3931',
        timestamp: '1792496583805',
        key: null,
        value: Buffer.from(JSON.stringify(raw)),
      },
      deps,
    );
    expect(deps.quarantine).not.toHaveBeenCalled();
    expect(deps.publish).toHaveBeenCalledOnce();
    expect(deps.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: expect.objectContaining({ eventId: first.eventId }) }),
    );
    expect(deps.archive.mock.invocationCallOrder[0]).toBeLessThan(deps.publish.mock.invocationCallOrder[0]!);
    expect(deps.publish.mock.invocationCallOrder[0]).toBeLessThan(deps.commit.mock.invocationCallOrder[0]!);
  });
});
