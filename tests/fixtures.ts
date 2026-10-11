import { randomUUID } from 'node:crypto';
import type { OsintEvent, Delivery } from '@nexus/contracts';
export function event(): OsintEvent {
  return { schemaVersion: 1, eventId: randomUUID(), source: { id: 'test-source', name: 'Test source' },
    observedAt: '2026-01-02T12:00:00.000Z', document: { externalId: 'doc-1', title: 'Example',
      text: 'Example text', url: 'https://example.com/doc-1', attributes: {} } };
}
export function delivery(offset = '0'): Delivery { return { streamId: 'test', topic: 'osint.raw.v1', partition: 0, offset }; }
