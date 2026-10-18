import type { CollectorEvent } from '@nexus/contracts';
import type { TelegramEntity, TelegramMessage } from './schema.js';

export function peerKind(className?: string): 'channel' | 'group' | 'account' {
  if (className === 'PeerChat') return 'group';
  if (className === 'PeerUser') return 'account';
  return 'channel';
}

function addUrl(links: Set<string>, candidate: string): void {
  try {
    links.add(new URL(candidate).toString());
  } catch {
    // Ignore malformed candidate URLs
  }
}

export function extractLinks(message: string, entities?: TelegramEntity[] | null): string[] | undefined {
  const links = new Set<string>();
  if (entities?.length) {
    for (const ent of entities) {
      if (ent.className === 'MessageEntityTextUrl' && ent.url) {
        addUrl(links, ent.url);
      } else if (ent.className === 'MessageEntityUrl') {
        const textUrl = message.slice(ent.offset, ent.offset + ent.length).trim();
        addUrl(links, textUrl);
      }
    }
  }
  if (!links.size) {
    const matched = message.matchAll(/https?:\/\/[^\s]+/g);
    for (const m of matched) {
      addUrl(links, m[0]);
    }
  }
  return links.size ? [...links] : undefined;
}

export function extractTitle(message: string, entities?: TelegramEntity[] | null): string | undefined {
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

export function extractMedia(rawMedia: unknown): CollectorEvent['media'] {
  if (!rawMedia || typeof rawMedia !== 'object') return undefined;
  const mediaObj = rawMedia as Record<string, unknown>;
  const className = typeof mediaObj.className === 'string' ? mediaObj.className : '';
  if (className === 'MessageMediaPhoto') {
    return [{ index: 0, type: 'image' }];
  }
  if (className === 'MessageMediaDocument') {
    const doc =
      mediaObj.document && typeof mediaObj.document === 'object' ? (mediaObj.document as Record<string, unknown>) : {};
    const mime = typeof doc.mimeType === 'string' ? doc.mimeType.toLowerCase() : '';
    const type = mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'document';
    return [{ index: 0, type, mimeType: mime || undefined }];
  }
  if (className === 'MessageMediaWebPage') {
    const wp =
      mediaObj.webpage && typeof mediaObj.webpage === 'object' ? (mediaObj.webpage as Record<string, unknown>) : {};
    const url = typeof wp.url === 'string' ? wp.url : undefined;
    return [{ index: 0, type: 'link_card', url }];
  }
  return undefined;
}

export function extractAuthor(msg: TelegramMessage): CollectorEvent['author'] {
  const fromIdRaw = msg.fromId?.userId ?? msg.fromId?.channelId ?? msg.fromId?.chatId;
  if (fromIdRaw !== undefined && fromIdRaw !== null) {
    return { id: String(fromIdRaw), ...(msg.postAuthor ? { name: msg.postAuthor } : {}) };
  }
  return msg.postAuthor ? { id: msg.postAuthor, name: msg.postAuthor } : undefined;
}

export function extractEngagement(msg: TelegramMessage, observedAt: string): CollectorEvent['engagement'] {
  const hasViews = msg.views !== null && msg.views !== undefined;
  const hasForwards = msg.forwards !== null && msg.forwards !== undefined;
  const hasReplies = msg.replies?.replies !== null && msg.replies?.replies !== undefined;

  if (!hasViews && !hasForwards && !hasReplies) {
    return undefined;
  }

  return {
    capturedAt: observedAt,
    views: hasViews ? String(msg.views) : undefined,
    reposts: hasForwards ? String(msg.forwards) : undefined,
    replies: hasReplies ? String(msg.replies!.replies) : undefined,
  };
}
