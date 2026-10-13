import { randomUUID } from 'node:crypto';
import { eventSchema, type OsintEvent, type Delivery } from '@nexus/contracts';
import type { SourceSubscription } from '../scripts/lib/source-registry.mjs';
export const source: SourceSubscription = { platform: 'telegram', topic: 'raw.telegram.v1', groupId: 'test.telegram', mode: 'real', adapter: 'provisional.v1' };
export function event(): OsintEvent {
  return eventSchema.parse({ schemaVersion: 'provisional.v1', eventId: randomUUID(), platform: 'telegram',
    collector: 'test', provider: 'test', observedAt: '2026-01-02T12:00:00.000Z',
    source: { id: 'test-channel', kind: 'channel', name: 'Test source' },
    item: { nativeId: 'item-1', title: 'Example', text: 'Example #OSINT text', url: 'https://example.com/item-1' } });
}
export function delivery(offset = '0'): Delivery { return { streamId: 'test', topic: source.topic, partition: 0, offset }; }
