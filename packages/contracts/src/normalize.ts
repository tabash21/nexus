import { hash } from './hash.js';
import type { OsintEvent } from './schema.js';

const cleanText = (text: string): string => text.normalize('NFC').replace(/\r\n?/g, '\n').trim();

const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort();

function extractMatches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(match => match[1]!);
}

export function normalize(event: OsintEvent): OsintEvent {
  const hashtags = event.item.hashtags ?? extractMatches(event.item.text, /#([\p{L}\p{N}_]+)/gu);
  const mentions = event.item.mentions ?? extractMatches(event.item.text, /@([\p{L}\p{N}_]+)/gu);

  return {
    ...event,
    observedAt: new Date(event.observedAt).toISOString(),
    item: {
      ...event.item,
      text: cleanText(event.item.text),
      ...(event.item.title !== undefined ? { title: cleanText(event.item.title) } : {}),
      ...(event.item.publishedAt ? { publishedAt: new Date(event.item.publishedAt).toISOString() } : {}),
      ...(event.item.editedAt ? { editedAt: new Date(event.item.editedAt).toISOString() } : {}),
      hashtags: uniqueSorted(hashtags),
      mentions: uniqueSorted(mentions),
      ...(event.item.links !== undefined ? { links: uniqueSorted(event.item.links) } : {}),
    },
  };
}

export function itemIdentity(event: OsintEvent): {
  itemId: string;
  nativeId: string;
  sourceId: string;
  authorId?: string;
} {
  const nativeId =
    event.platform === 'telegram' ? JSON.stringify([event.source.id, event.item.nativeId]) : event.item.nativeId;

  return {
    itemId: hash([event.realityId, event.platform, nativeId]),
    nativeId,
    sourceId: `${event.platform}:${event.source.id}`,
    ...(event.author ? { authorId: `${event.platform}:${event.author.id}` } : {}),
  };
}
