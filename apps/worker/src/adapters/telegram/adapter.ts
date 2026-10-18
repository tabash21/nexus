import { hash, type CollectorEvent, type SourceSubscription } from '@nexus/contracts';
import { telegramMessageSchema, type TelegramMessage } from './schema.js';
import { deterministicEventId, type SourceAdapter } from '../types.js';
import { peerKind, extractLinks, extractTitle, extractMedia, extractAuthor, extractEngagement } from './extractors.js';

export const telegramAdapter: SourceAdapter<TelegramMessage> = {
  name: 'telegram.v1',
  platform: 'telegram',

  supports(payload: unknown, source: SourceSubscription): boolean {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    if (p.schemaVersion === 'provisional.v1') return false;
    if (p.className === 'Message' || ('peerId' in p && 'date' in p && 'id' in p)) return true;
    return source.platform === 'telegram' || source.adapter === 'telegram.v1';
  },

  parse(payload: unknown, _source: SourceSubscription): CollectorEvent {
    const msg = telegramMessageSchema.parse(payload);
    const peer = msg.peerId;
    const sourceIdRaw = peer.channelId ?? peer.chatId ?? peer.userId;
    if (sourceIdRaw === undefined || sourceIdRaw === null) {
      throw new Error('Telegram message missing channelId, chatId, or userId in peerId');
    }
    const sourceId = String(sourceIdRaw);
    const nativeId = String(msg.id);

    // The collector has no eventId. Include the entire canonical payload so changed observations
    // get distinct immutable identities while byte-for-byte replays retain theirs.
    const eventId =
      msg.eventId?.toLowerCase() ??
      deterministicEventId('telegram-observation', sourceId, `${nativeId}:${hash(payload)}`);

    const publishedAt = new Date(msg.date * 1000).toISOString();
    const editedAt = msg.editDate ? new Date(msg.editDate * 1000).toISOString() : undefined;
    const observedAt = msg.observedAt ? new Date(msg.observedAt).toISOString() : (editedAt ?? publishedAt);

    const links = extractLinks(msg.message, msg.entities);
    const title = extractTitle(msg.message, msg.entities);
    const media = extractMedia(msg.media);
    const author = extractAuthor(msg);
    const engagement = extractEngagement(msg, observedAt);

    return {
      schemaVersion: 'provisional.v1',
      eventId,
      platform: 'telegram',
      collector: 'telegram-kafka',
      provider: 'telegram',
      observedAt,
      source: {
        id: sourceId,
        kind: peerKind(peer.className),
      },
      ...(author ? { author } : {}),
      item: {
        nativeId,
        type: msg.fwdFrom ? 'forward' : msg.replyTo ? 'reply' : 'post',
        ...(title ? { title } : {}),
        text: msg.message,
        publishedAt,
        ...(editedAt ? { editedAt } : {}),
        ...(links ? { links } : {}),
        extra: {
          flags: msg.flags,
          className: msg.className,
          views: msg.views,
          forwards: msg.forwards,
          pinned: msg.pinned,
          silent: msg.silent,
          post: msg.post,
        },
      },
      ...(media ? { media } : {}),
      mediaComplete: false,
      ...(engagement ? { engagement } : {}),
    };
  },
};
