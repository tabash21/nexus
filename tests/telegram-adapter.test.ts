import { describe, expect, it, vi } from 'vitest';
import type { CollectorEvent, SourceSubscription } from '@nexus/contracts';
import {
  adapt,
  AdapterRegistry,
  deterministicEventId,
  telegramAdapter,
  telegramMessageSchema,
  type SourceAdapter,
} from '../apps/worker/src/adapters/index.js';
import { processMessage } from '../apps/worker/src/process.js';

const sampleTelegramMessage = {
  flags: 17536,
  out: false,
  mentioned: false,
  mediaUnread: false,
  silent: false,
  post: true,
  fromScheduled: false,
  legacy: false,
  editHide: false,
  pinned: false,
  noforwards: false,
  invertMedia: false,
  flags2: 0,
  offline: false,
  videoProcessingPending: false,
  id: 136222,
  fromId: null,
  fromBoostsApplied: null,
  peerId: {
    channelId: '1406113886',
    className: 'PeerChannel',
  },
  savedPeerId: null,
  fwdFrom: null,
  viaBotId: null,
  viaBusinessBotId: null,
  replyTo: null,
  date: 1791958850,
  message: 'התרעת פצצה בטיסה נוספת מניו יורק לישראל\n\nמטוס של חברת דלתא איירליינס, שהיה אמור להמריא מנמל התעופה JFK בניו יורק לישראל, עוכב לאחר שהתקבלה שיחת טלפון אנונימית על פצצה במטוס. לפי הדיווח, נבדק חשד כי אותו אדם אחראי גם להתרעה שהתקבלה בטיסה שנחתה בנתב״ג ביום שלישי.\n\nhttps://t.me/yediotnews25',
  media: null,
  replyMarkup: null,
  entities: [
    {
      offset: 0,
      length: 39,
      className: 'MessageEntityBold',
    },
    {
      offset: 263,
      length: 25,
      className: 'MessageEntityUrl',
    },
  ],
  views: 3,
  forwards: 0,
  replies: null,
  editDate: null,
  postAuthor: null,
  groupedId: null,
  reactions: null,
  restrictionReason: null,
  ttlPeriod: null,
  quickReplyShortcutId: null,
  effect: null,
  factcheck: null,
  reportDeliveryUntilDate: null,
  className: 'Message',
};

const telegramSource: SourceSubscription = {
  platform: 'telegram',
  topic: 'raw.telegram.v1',
  groupId: 'nexus-items-v1.telegram',
  mode: 'real',
  realityId: 0,
  adapter: 'telegram.v1',
};

describe('Telegram Schema & Adapter', () => {
  it('validates the raw MTProto message JSON strictly against telegramMessageSchema', () => {
    const parsed = telegramMessageSchema.parse(sampleTelegramMessage);
    expect(parsed.id).toBe(136222);
    expect(parsed.peerId.channelId).toBe('1406113886');
    expect(parsed.date).toBe(1791958850);
    expect(parsed.className).toBe('Message');
  });

  it('rejects malformed Telegram payloads', () => {
    expect(() => telegramMessageSchema.parse({ ...sampleTelegramMessage, id: 'not-a-number' })).toThrow();
    expect(() => telegramMessageSchema.parse({ ...sampleTelegramMessage, date: 'not-an-int' })).toThrow();
    expect(() => telegramMessageSchema.parse({ ...sampleTelegramMessage, peerId: null })).toThrow();
  });

  it('adapts the Telegram message into a canonical OsintEvent', () => {
    const event = adapt(sampleTelegramMessage, telegramSource);

    expect(event.platform).toBe('telegram');
    expect(event.realityId).toBe(0);
    expect(event.source.id).toBe('1406113886');
    expect(event.source.kind).toBe('channel');
    expect(event.item.nativeId).toBe('136222');
    expect(event.item.title).toBe('התרעת פצצה בטיסה נוספת מניו יורק לישראל');
    expect(event.item.text).toBe(sampleTelegramMessage.message);
    expect(event.item.links).toEqual(['https://t.me/yediotnews25']);
    expect(event.item.extra).toMatchObject({
      flags: 17536,
      className: 'Message',
      views: 3,
      forwards: 0,
    });
    expect(event.engagement?.views).toBe('3');
    expect(event.engagement?.reposts).toBe('0');
    expect(event.observedAt).toBe('2026-10-14T06:20:50.000Z');
    expect(event.item.publishedAt).toBe('2026-10-14T06:20:50.000Z');
  });

  it('generates deterministic eventId across identical replays', () => {
    const event1 = adapt(sampleTelegramMessage, telegramSource);
    const event2 = adapt(sampleTelegramMessage, telegramSource);
    expect(event1.eventId).toBe(event2.eventId);
    expect(event1.eventId).toBe(deterministicEventId('telegram', '1406113886', '136222'));
  });

  it('extracts author signature when postAuthor or fromId is present', () => {
    const withAuthor = {
      ...sampleTelegramMessage,
      postAuthor: 'Yediot Desk',
      fromId: { userId: '998877', className: 'PeerUser' },
    };
    const event = adapt(withAuthor, telegramSource);
    expect(event.author).toEqual({
      id: '998877',
      name: 'Yediot Desk',
    });
  });

  it('processes Telegram message end-to-end via processMessage', async () => {
    const ingest = vi.fn().mockResolvedValue({ duplicate: false });
    const quarantine = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn().mockResolvedValue(undefined);

    const message = {
      streamId: 'stream-1',
      topic: 'raw.telegram.v1',
      partition: 0,
      offset: '42',
      timestamp: '1791958850000',
      key: null,
      value: Buffer.from(JSON.stringify(sampleTelegramMessage)),
    };

    await processMessage(message, { source: telegramSource, ingest, quarantine, commit });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'telegram',
        realityId: 0,
        source: expect.objectContaining({ id: '1406113886' }),
        item: expect.objectContaining({ nativeId: '136222' }),
      }),
      message,
      expect.any(String),
    );
    expect(quarantine).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
  });
});

describe('Generic Extensible Adapter Architecture for Future Sources', () => {
  it('allows registering a future platform adapter (e.g. mock X/Twitter) without modifying consumer loops', () => {
    const registry = new AdapterRegistry();
    registry.register(telegramAdapter);

    // Mock future source schema and adapter
    const mockXAdapter: SourceAdapter = {
      name: 'x.v1',
      platform: 'x',
      parse(payload, source): CollectorEvent {
        const raw = payload as { tweet_id: string; author_username: string; full_text: string; created_time: string };
        return {
          schemaVersion: 'provisional.v1',
          eventId: deterministicEventId('x', raw.author_username, raw.tweet_id),
          platform: 'x',
          collector: 'x-collector',
          provider: 'x',
          observedAt: new Date(raw.created_time).toISOString(),
          source: { id: raw.author_username, kind: 'account' },
          author: { id: raw.author_username, handle: raw.author_username },
          item: {
            nativeId: raw.tweet_id,
            type: 'post',
            text: raw.full_text,
            publishedAt: new Date(raw.created_time).toISOString(),
          },
          mediaComplete: false,
        };
      },
      supports(payload, source) {
        return source.platform === 'x' || source.adapter === 'x.v1';
      },
    };

    registry.register(mockXAdapter);

    const xSource: SourceSubscription = {
      platform: 'x',
      topic: 'raw.x.v1',
      groupId: 'nexus-items-v1.x',
      mode: 'real',
      realityId: 0,
      adapter: 'x.v1',
    };

    const rawTweet = {
      tweet_id: '987654321',
      author_username: 'osint_analyst',
      full_text: 'Breaking news report on #OSINT analysis',
      created_time: '2026-10-14T06:00:00Z',
    };

    const adaptedEvent = adapt(rawTweet, xSource, registry);

    expect(adaptedEvent.platform).toBe('x');
    expect(adaptedEvent.source.id).toBe('osint_analyst');
    expect(adaptedEvent.item.nativeId).toBe('987654321');
    expect(adaptedEvent.item.text).toBe('Breaking news report on #OSINT analysis');
  });

  it('rejects unregistered platform adapters with an explicit error', () => {
    const registry = new AdapterRegistry();
    const unknownSource: SourceSubscription = {
      platform: 'unregistered_platform',
      topic: 'raw.unknown.v1',
      groupId: 'grp',
      mode: 'real',
      realityId: 0,
      adapter: 'unknown.v1',
    };
    expect(() => adapt({ some: 'data' }, unknownSource, registry)).toThrow('No adapter registered');
  });
});
