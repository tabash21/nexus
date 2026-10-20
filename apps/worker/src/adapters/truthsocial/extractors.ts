import type { CollectorEvent } from '@nexus/contracts';
import type { TruthSocialMessage } from './schema.js';

export function extractAccount(url: string, nativeId: string): { id: string; handle: string; url: string } {
  const parsed = new URL(url);
  const match = /^\/@([A-Za-z0-9_]+)\/(\d+)\/?$/.exec(parsed.pathname);
  if (
    parsed.protocol !== 'https:' ||
    !['truthsocial.com', 'www.truthsocial.com'].includes(parsed.hostname) ||
    !match ||
    match[2] !== nativeId
  ) {
    throw new Error('Truth Social URL must identify the account and match the post ID');
  }
  const handle = match[1]!;
  return { id: handle.toLowerCase(), handle, url: `https://truthsocial.com/@${handle}` };
}

export function extractMedia(media: TruthSocialMessage['media']): CollectorEvent['media'] {
  return media?.map((url, index) => {
    const path = new URL(url).pathname.toLowerCase();
    const type = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(path)
      ? 'image'
      : /\.(mp4|webm|mov|m4v)$/.test(path)
        ? 'video'
        : /\.(mp3|wav|ogg|m4a|flac)$/.test(path)
          ? 'audio'
          : 'document';
    return { index, type, url };
  });
}

export function extractEngagement(msg: TruthSocialMessage, observedAt: string): CollectorEvent['engagement'] {
  if (msg.replies_count === undefined && msg.reblogs_count === undefined && msg.favourites_count === undefined) {
    return undefined;
  }
  return {
    capturedAt: observedAt,
    ...(msg.replies_count !== undefined ? { replies: String(msg.replies_count) } : {}),
    ...(msg.reblogs_count !== undefined ? { reposts: String(msg.reblogs_count) } : {}),
    ...(msg.favourites_count !== undefined ? { likes: String(msg.favourites_count), likesKind: 'like' as const } : {}),
  };
}
