import { hash } from './hash.js';
import type { OsintEvent } from './schema.js';
const clean = (text: string): string => text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
const unique = (values: string[]): string[] => [...new Set(values)].sort();
export function normalize(event: OsintEvent): OsintEvent {
  return { ...event, observedAt: new Date(event.observedAt).toISOString(), item: {
    ...event.item, text: clean(event.item.text),
    ...(event.item.title !== undefined ? { title: clean(event.item.title) } : {}),
    ...(event.item.publishedAt ? { publishedAt: new Date(event.item.publishedAt).toISOString() } : {}),
    ...(event.item.editedAt ? { editedAt: new Date(event.item.editedAt).toISOString() } : {}),
    hashtags: unique(event.item.hashtags ?? [...event.item.text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(match => match[1]!)),
    mentions: unique(event.item.mentions ?? [...event.item.text.matchAll(/@([\p{L}\p{N}_]+)/gu)].map(match => match[1]!)),
    ...(event.item.links !== undefined ? { links: unique(event.item.links) } : {}),
  } };
}
export function itemIdentity(event: OsintEvent): { itemId: string; nativeId: string; sourceId: string; authorId?: string } {
  const nativeId = event.platform === 'telegram' ? JSON.stringify([event.source.id, event.item.nativeId]) : event.item.nativeId;
  return { itemId: hash([event.realityId, event.platform, nativeId]), nativeId,
    sourceId: event.platform + ':' + event.source.id,
    ...(event.author ? { authorId: event.platform + ':' + event.author.id } : {}),
  };
}
