import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { hash, itemIdentity, sourceSubscriptions } from '@nexus/contracts';
import { adapt, newsArticleSchema } from '../apps/worker/src/adapters/index.js';
import { processMessage } from '../apps/worker/src/process.js';
import { newsArticle } from './fixtures/news.js';

const source = sourceSubscriptions({ KAFKA_PLATFORMS: 'news' })[0]!;
const message = (raw: unknown = newsArticle) => ({
  streamId: 'test',
  topic: source.topic,
  partition: 0,
  offset: '1',
  timestamp: '1792479000000',
  key: null,
  value: Buffer.from(JSON.stringify(raw)),
});
const dependencies = () => ({
  source,
  archive: vi.fn().mockResolvedValue({ rawUri: 's3://test/news', rawSha256: 'a'.repeat(64) }),
  publish: vi.fn().mockResolvedValue(undefined),
  quarantine: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
});

describe('RSS news ingestion', () => {
  it('maps the sample fields through default subscriptions', () => {
    const event = adapt(newsArticle, source);
    expect(event).toMatchObject({
      platform: 'news',
      realityId: 0,
      observedAt: newsArticle.collectedAt,
      source: { id: newsArticle.feedUrl, kind: 'site', name: 'GB News' },
      author: { name: 'Georgia Pearce' },
      item: {
        type: 'article',
        title: newsArticle.title,
        text: newsArticle.contentSnippet,
        url: newsArticle.link,
        publishedAt: newsArticle.isoDate,
      },
      mediaComplete: false,
    });
    expect(event.engagement).toBeUndefined();
  });

  it('preserves observation identity on replay and distinguishes new collections and edits', () => {
    const first = adapt(newsArticle, source);
    expect(adapt({ ...newsArticle }, source).eventId).toBe(first.eventId);
    for (const changes of [{ collectedAt: '2026-10-20T08:00:00Z' }, { contentSnippet: 'Edited' }]) {
      const next = adapt({ ...newsArticle, ...changes }, source);
      expect(next.eventId).not.toBe(first.eventId);
      expect(itemIdentity(next).itemId).toBe(itemIdentity(first).itemId);
    }
    const eventId = randomUUID();
    expect(adapt({ ...newsArticle, eventId }, source).eventId).toBe(eventId);
  });

  it('accepts headline-only articles without inventing body text', async () => {
    const { contentSnippet: _snippet, ...headlineOnly } = newsArticle;
    const deps = dependencies();
    await processMessage(message(headlineOnly), deps);
    expect(deps.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: expect.objectContaining({
          item: expect.objectContaining({ title: newsArticle.title, text: '' }),
        }),
      }),
    );
    expect(deps.quarantine).not.toHaveBeenCalled();
    expect(deps.commit).toHaveBeenCalledOnce();
  });

  it('isolates feed-local article and author identities', () => {
    const first = adapt(newsArticle, source);
    const second = adapt({ ...newsArticle, feedUrl: 'https://other.example/feed' }, source);
    expect(itemIdentity(first).itemId).not.toBe(itemIdentity(second).itemId);
    expect(first.author?.id).not.toBe(second.author?.id);
  });

  it('supports the alternative creator field and absent authors', () => {
    const { creator: _creator, ...raw } = newsArticle;
    expect(adapt(raw, source).author?.name).toBe(newsArticle.creator);
    const { 'dc:creator': _dcCreator, ...anonymous } = raw;
    expect(adapt(anonymous, source).author).toBeUndefined();
  });

  it('preserves canonical provisional news messages', () => {
    const { realityId: _realityId, ...canonical } = adapt(newsArticle, source);
    expect(adapt(canonical, source)).toEqual({ ...canonical, realityId: 0 });
  });

  it('assigns simulation reality from the subscription', () => {
    const simulation = sourceSubscriptions({ KAFKA_PLATFORMS: 'news' })[1]!;
    expect(adapt(newsArticle, simulation).realityId).toBe(1);
    expect(adapt(newsArticle, simulation).eventId).not.toBe(adapt(newsArticle, source).eventId);
    expect(() => adapt({ ...newsArticle, realityId: 0 }, simulation)).toThrow('Reality');
  });

  it.each([
    { isoDate: 'invalid' },
    { collectedAt: 'invalid' },
    { link: 'javascript:alert(1)' },
    { feedUrl: 'invalid' },
    { itemId: '' },
    { title: ' ', contentSnippet: undefined },
    { title: ' ', contentSnippet: '\n' },
    { eventId: 'invalid' },
  ])('rejects invalid payload fields %j', changes => {
    expect(() => newsArticleSchema.parse({ ...newsArticle, ...changes })).toThrow();
  });

  it('archives before publishing silver, then commits', async () => {
    const deps = dependencies();
    await processMessage(message(), deps);
    expect(deps.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        eventHash: hash(newsArticle),
        rawUri: 's3://test/news',
        event: expect.objectContaining({ platform: 'news' }),
      }),
    );
    expect(deps.archive.mock.invocationCallOrder[0]).toBeLessThan(deps.publish.mock.invocationCallOrder[0]!);
    expect(deps.publish.mock.invocationCallOrder[0]).toBeLessThan(deps.commit.mock.invocationCallOrder[0]!);
    expect(deps.quarantine).not.toHaveBeenCalled();
  });

  it('quarantines malformed articles before committing', async () => {
    const deps = dependencies();
    await processMessage(message({ ...newsArticle, isoDate: 'bad' }), deps);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.quarantine).toHaveBeenCalledWith(expect.objectContaining({ rawUri: 's3://test/news' }));
    expect(deps.quarantine.mock.invocationCallOrder[0]).toBeLessThan(deps.commit.mock.invocationCallOrder[0]!);
  });

  it.each(['archive', 'publish', 'quarantine'] as const)('does not commit on %s failure', async operation => {
    const deps = dependencies();
    deps[operation].mockRejectedValue(new Error('unavailable'));
    const raw = operation === 'quarantine' ? {} : newsArticle;
    await expect(processMessage(message(raw), deps)).rejects.toThrow('unavailable');
    expect(deps.commit).not.toHaveBeenCalled();
  });
});
