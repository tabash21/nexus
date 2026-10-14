import { z } from 'zod';
import type { CollectorEvent, SourceSubscription } from '@nexus/contracts';
import { telegramMessageSchema, type TelegramMessage, type TelegramEntity } from './telegram.schema.js';
import { deterministicEventId, type SourceAdapter } from './types.js';

function peerKind(className?: string): 'channel' | 'group' | 'account' {
  if (className === 'PeerChat') return 'group';
  if (className === 'PeerUser') return 'account';
  return 'channel';
}

function extractLinks(message: string, entities?: TelegramEntity[] | null): string[] | undefined {
  const links = new Set<string>();
  if (entities?.length) {
    for (const ent of entities) {
      if (ent.className === 'MessageEntityTextUrl' && ent.url) {
        try { links.add(new URL(ent.url).toString()); } catch {}
      } else if (ent.className === 'MessageEntityUrl') {
        const textUrl = message.slice(ent.offset, ent.offset + ent.length).trim();
        try { links.add(new URL(textUrl).toString()); } catch {}
      }
    }
  }
  // Fallback regex if entities omitted or empty
  if (!links.size) {
    const matched = message.matchAll(/https?:\/\/[^\s]+/g);
    for (const m of matched) {
      try { links.add(new URL(m[0]).toString()); } catch {}
    }
  }
  return links.size ? [...links] : undefined;
}

function extractTitle(message: string, entities?: TelegramEntity[] | null): string | undefined {
  if (entities?.length) {
    const boldTitle = entities.find(e => e.className === 'MessageEntityBold' && e.offset === 0);
    if (boldTitle) {
      const candidate = message.slice(0, boldTitle.length).trim();
      if (candidate.length > 0 && candidate.length <= 2000) return candidate;
    }
  }
  const firstLine = message.split('\n')[0]?.trim();
  if (firstLine && firstLine.length > 0 && firstLine.length <= 200 && firstLine !== message.trim()) {
    return firstLine;
  }
  return undefined;
}

function extractMedia(rawMedia: unknown): CollectorEvent['media'] {
  if (!rawMedia || typeof rawMedia !== 'object') return undefined;
  const mediaObj = rawMedia as Record<string, unknown>;
  const className = typeof mediaObj.className === 'string' ? mediaObj.className : '';
  if (className === 'MessageMediaPhoto') {
    return [{ index: 0, type: 'image' }];
  }
  if (className === 'MessageMediaDocument') {
    const doc = (mediaObj.document && typeof mediaObj.document === 'object') ? mediaObj.document as Record<string, unknown> : {};
    const mime = typeof doc.mimeType === 'string' ? doc.mimeType.toLowerCase() : '';
    const type = mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'document';
    return [{ index: 0, type, mimeType: mime || undefined }];
  }
  if (className === 'MessageMediaWebPage') {
    const wp = (mediaObj.webpage && typeof mediaObj.webpage === 'object') ? mediaObj.webpage as Record<string, unknown> : {};
    const url = typeof wp.url === 'string' ? wp.url : undefined;
    return [{ index: 0, type: 'link_card', url }];
  }
  return undefined;
}

export const telegramAdapter: SourceAdapter<TelegramMessage> = {
  name: 'telegram.v1',
  platform: 'telegram',

  supports(payload: unknown, source: SourceSubscription): boolean {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    // If it's already a provisional event, let provisional adapter handle it
    if (p.schemaVersion === 'provisional.v1') return false;
    // Recognize Telegram message by MTProto shape
    if (p.className === 'Message' || ('peerId' in p && 'date' in p && 'id' in p)) return true;
    return source.platform === 'telegram' || source.adapter === 'telegram.v1';
  },

  parse(payload: unknown, source: SourceSubscription): CollectorEvent {
    const msg = telegramMessageSchema.parse(payload);
    const peer = msg.peerId;
    const sourceIdRaw = peer.channelId ?? peer.chatId ?? peer.userId;
    if (sourceIdRaw === undefined || sourceIdRaw === null) {
      throw new Error('Telegram message missing channelId, chatId, or userId in peerId');
    }
    const sourceId = String(sourceIdRaw);
    const nativeId = String(msg.id);

    // If an explicit UUID eventId is provided, honor it; otherwise generate a deterministic UUID
    const explicitEventId = typeof (payload as Record<string, unknown>)?.eventId === 'string'
      ? (payload as Record<string, unknown>).eventId as string : undefined;
    const eventId = explicitEventId && z.string().uuid().safeParse(explicitEventId).success
      ? explicitEventId
      : deterministicEventId('telegram', sourceId, nativeId);

    const observedAt = new Date(msg.date * 1000).toISOString();
    const publishedAt = observedAt;
    const editedAt = msg.editDate ? new Date(msg.editDate * 1000).toISOString() : undefined;
    const links = extractLinks(msg.message, msg.entities);
    const title = extractTitle(msg.message, msg.entities);
    const media = extractMedia(msg.media);

    const fromIdRaw = msg.fromId?.userId ?? msg.fromId?.channelId ?? msg.fromId?.chatId;
    const author = fromIdRaw !== undefined && fromIdRaw !== null
      ? { id: String(fromIdRaw), ...(msg.postAuthor ? { name: msg.postAuthor } : {}) }
      : (msg.postAuthor ? { id: msg.postAuthor, name: msg.postAuthor } : undefined);

    const hasViews = msg.views !== null && msg.views !== undefined;
    const hasForwards = msg.forwards !== null && msg.forwards !== undefined;
    const hasReplies = msg.replies?.replies !== null && msg.replies?.replies !== undefined;
    const engagement = (hasViews || hasForwards || hasReplies) ? {
      capturedAt: observedAt,
      views: hasViews ? String(msg.views) : undefined,
      reposts: hasForwards ? String(msg.forwards) : undefined,
      replies: hasReplies ? String(msg.replies!.replies) : undefined,
    } : undefined;

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
