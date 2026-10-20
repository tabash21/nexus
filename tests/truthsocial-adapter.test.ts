import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { itemIdentity, sourceSubscriptions, type SilverObservation, type SourceSubscription } from '@nexus/contracts';
import { adapt, resolveAdapter, truthSocialMessageSchema } from '../apps/worker/src/adapters/index.js';
import { processMessage, type Message } from '../apps/worker/src/process.js';
import { collectorEvent } from './fixtures.js';

const sample = {
  id: '117473326095036573',
  created_at: '2026-10-20T12:51:43.355Z',
  content: '',
  url: 'https://truthsocial.com/@realDonaldTrump/117473326095036573',
  media: [
    'https://static-assets-1.truthsocial.com/tmtg:prime-ts-assets/media_attachments/files/117/473/239/140/991/582/original/387d183982b818a8.jpg',
  ],
  replies_count: 0,
  reblogs_count: 1,
  favourites_count: 4,
  sourceCategories: ['official', 'trump'],
};

const source: SourceSubscription = {
  platform: 'truthsocial',
  topic: 'raw.truthsocial.v1',
  groupId: 'nexus-items-v1.truthsocial',
  mode: 'real',
  realityId: 0,
  adapter: 'truthsocial.v1',
};

const message = (payload: unknown = sample): Message => ({
  streamId: 'stream-1',
  topic: source.topic,
  partition: 0,
  offset: '42',
  timestamp: String(Date.parse('2026-10-20T13:00:00Z')),
  key: null,
  value: Buffer.from(JSON.stringify(payload)),
});

function dependencies() {
  return {
    source,
    archive: vi.fn().mockResolvedValue({ rawUri: 's3://test/raw/truthsocial#L1', rawSha256: 'a'.repeat(64) }),
    publish: vi.fn<(key: string, observation: SilverObservation) => Promise<void>>().mockResolvedValue(undefined),
    quarantine: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Truth Social source adapter', () => {
  it('registers real and simulation subscriptions using the existing topic and group conventions', () => {
    expect(sourceSubscriptions({})).toContainEqual(source);
    expect(sourceSubscriptions({ KAFKA_PLATFORMS: 'truthsocial' })).toEqual([
      source,
      {
        ...source,
        topic: 'sim.truthsocial.v1',
        groupId: 'nexus-items-v1.sim.truthsocial',
        mode: 'simulation',
        realityId: 1,
      },
    ]);
  });

  it('maps every supplied field, preserving a large native ID, empty text, and zero replies', () => {
    expect(truthSocialMessageSchema.parse(sample)).toEqual(sample);
    const event = adapt(sample, source);
    expect(event).toMatchObject({
      platform: 'truthsocial',
      realityId: 0,
      source: { id: 'realdonaldtrump', kind: 'account', handleOrUrl: 'https://truthsocial.com/@realDonaldTrump' },
      author: { id: 'realdonaldtrump', handle: 'realDonaldTrump' },
      item: {
        nativeId: sample.id,
        text: '',
        url: sample.url,
        publishedAt: sample.created_at,
        extra: { sourceCategories: sample.sourceCategories },
      },
      media: [{ index: 0, type: 'image', url: sample.media[0] }],
      mediaComplete: true,
      engagement: { replies: '0', reposts: '1', likes: '4', likesKind: 'like' },
    });
  });

  it('preserves additional collector fields without treating categories as canonical topics', () => {
    const event = adapt({ ...sample, language: 'en', collectorMetadata: { run: 'test' } }, source);
    expect(event.item.extra).toEqual({
      sourceCategories: ['official', 'trump'],
      language: 'en',
      collectorMetadata: { run: 'test' },
    });
    expect(event.queryIds).toBeUndefined();
  });

  it('handles absent measurements and distinguishes missing media from an explicitly empty list', () => {
    const {
      media: _media,
      replies_count: _replies,
      reblogs_count: _reblogs,
      favourites_count: _likes,
      ...partial
    } = sample;
    expect(adapt(partial, source)).toMatchObject({ mediaComplete: false });
    expect(adapt(partial, source).engagement).toBeUndefined();
    expect(adapt({ ...partial, media: [] }, source)).toMatchObject({ media: [], mediaComplete: true });
  });

  it('identifies video and audio URLs and retains unsupported attachments as documents', () => {
    const event = adapt(
      {
        ...sample,
        media: ['https://cdn.example/clip.mp4?token=1', 'https://cdn.example/sound.mp3', 'https://cdn.example/file'],
      },
      source,
    );
    expect(event.media?.map(media => [media.index, media.type])).toEqual([
      [0, 'video'],
      [1, 'audio'],
      [2, 'document'],
    ]);
  });

  it('accepts decimal-string counts without losing precision', () => {
    expect(adapt({ ...sample, favourites_count: '9007199254740993' }, source).engagement?.likes).toBe(
      '9007199254740993',
    );
  });

  it.each([
    { id: 117473326095036573 },
    { id: 'invalid' },
    { realityId: 0 },
    { realityId: 1 },
    { created_at: 'invalid' },
    { content: null },
    { media: ['invalid'] },
    { replies_count: -1 },
    { reblogs_count: 1.5 },
    { favourites_count: Number.MAX_SAFE_INTEGER + 1 },
    { favourites_count: '9223372036854775808' },
    { sourceCategories: 'official' },
    { url: 'https://example.com/@realDonaldTrump/117473326095036573' },
    { url: 'https://truthsocial.com/@realDonaldTrump/123' },
  ])('rejects malformed or mismatched native fields: %j', changes => {
    expect(() => adapt({ ...sample, ...changes }, source)).toThrow();
  });

  it('keeps payload identities deterministic while distinguishing changed measurements', () => {
    const first = adapt(sample, source);
    expect(adapt({ ...sample }, source).eventId).toBe(first.eventId);
    const changed = adapt({ ...sample, favourites_count: 5 }, source);
    expect(changed.eventId).not.toBe(first.eventId);
    expect(itemIdentity(changed).itemId).toBe(itemIdentity(first).itemId);
  });

  it('retains canonical provisional payload support', () => {
    const canonical = { ...collectorEvent(), platform: 'truthsocial' };
    expect(resolveAdapter(canonical, source).name).toBe('provisional.v1');
    expect(adapt(canonical, source).eventId).toBe(canonical.eventId);
  });

  it('assigns simulation reality from the subscription', () => {
    const simulated = adapt(sample, { ...source, topic: 'sim.truthsocial.v1', mode: 'simulation', realityId: 1 });
    expect(simulated.realityId).toBe(1);
    expect(simulated.eventId).not.toBe(adapt(sample, source).eventId);
  });
});

describe('Truth Social raw-to-silver processing', () => {
  it('archives and publishes silver before committing, using Kafka time for measurements', async () => {
    const deps = dependencies();
    await processMessage(message(), deps);
    expect(deps.quarantine).not.toHaveBeenCalled();
    const observation = deps.publish.mock.calls[0]![1];
    expect(observation).toMatchObject({
      stageVersion: 'silver.v1',
      rawUri: 's3://test/raw/truthsocial#L1',
      sourceDelivery: { streamId: 'stream-1', topic: source.topic, partition: 0, offset: '42' },
      event: {
        observedAt: '2026-10-20T13:00:00.000Z',
        engagement: { capturedAt: '2026-10-20T13:00:00.000Z' },
        item: { publishedAt: sample.created_at },
      },
    });
    expect(deps.archive.mock.invocationCallOrder[0]).toBeLessThan(deps.publish.mock.invocationCallOrder[0]!);
    expect(deps.publish.mock.invocationCallOrder[0]).toBeLessThan(deps.commit.mock.invocationCallOrder[0]!);
  });

  it('preserves replay identity and distinguishes identical payloads delivered as new observations', async () => {
    const first = dependencies();
    await processMessage(message(), first);
    const fresh = dependencies();
    await processMessage({ ...message(), offset: '43' }, fresh);
    expect(fresh.publish.mock.calls[0]![1].event.eventId).not.toBe(first.publish.mock.calls[0]![1].event.eventId);

    const replay = dependencies();
    const origin = { streamId: 'stream-1', topic: source.topic, partition: 0, offset: '42' };
    await processMessage(
      {
        ...message(),
        streamId: 'stream-2',
        offset: '99',
        headers: { 'nexus-replay-origin': Buffer.from(JSON.stringify(origin)) },
      },
      replay,
    );
    expect(replay.publish.mock.calls[0]![1].event).toEqual(first.publish.mock.calls[0]![1].event);
  });

  it('honors explicit collector event identity and observation time', async () => {
    const deps = dependencies();
    const eventId = randomUUID();
    const observedAt = '2026-10-20T14:00:00.000Z';
    await processMessage(message({ ...sample, eventId, observedAt }), deps);
    expect(deps.publish.mock.calls[0]![1].event).toMatchObject({
      eventId,
      observedAt,
      engagement: { capturedAt: observedAt },
    });
  });

  it('archives invalid payloads and publishes quarantine before committing', async () => {
    const deps = dependencies();
    await processMessage(message({ ...sample, created_at: 'invalid' }), deps);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.quarantine).toHaveBeenCalledWith(expect.objectContaining({ rawUri: 's3://test/raw/truthsocial#L1' }));
    expect(deps.archive.mock.invocationCallOrder[0]).toBeLessThan(deps.quarantine.mock.invocationCallOrder[0]!);
    expect(deps.quarantine.mock.invocationCallOrder[0]).toBeLessThan(deps.commit.mock.invocationCallOrder[0]!);
  });
});
