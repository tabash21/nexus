import { describe, it, expect } from 'vitest';
import { extractMetaFromSilver, type ExtractedEntity } from './meta.js';
import { generateEntityId } from './entityId.js';

import type { SilverObservation } from '@nexus/contracts';

const mockSilver = {
  stageVersion: 'silver.v1',
  event: {
    schemaVersion: 'provisional.v1',
    eventId: '00000000-0000-0000-0000-000000000000',
    platform: 'twitter',
    realityId: 0,
    observedAt: new Date().toISOString(),
    collector: 'collector',
    provider: 'provider',
    source: { id: 's1', kind: 'account', name: 'SourceName' },
    item: { nativeId: 'n1', text: 'Alice met Bob at Central Park' },
  },
  eventHash: 'a'.repeat(64),
  rawSha256: 'b'.repeat(64),
  rawUri: 's3://bucket/key',
  sourceDelivery: { streamId: 's', topic: 't', partition: 0, offset: '0' },
} as unknown as SilverObservation;

describe('extractMetaFromSilver', () => {
  it('extracts person and place surfaces and preserves exact wording', () => {
    const entities = extractMetaFromSilver(mockSilver);
    const surfaces = entities.map(e => e.surface_form);
    expect(surfaces).toContain('Alice');
    expect(surfaces.some(s => /Central Park/i.test(s))).toBe(true);
  });

  it('returns only supported entity types', () => {
    const entities = extractMetaFromSilver(mockSilver);
    for (const e of entities) {
      expect(['PER', 'ORG', 'LOC']).toContain(e.type);
    }
  });

  it('generates stable ids for entity type+surface', () => {
    const e: ExtractedEntity = { type: 'PER', surface_form: 'Alice' };
    const id1 = generateEntityId(e.type, e.surface_form);
    const id2 = generateEntityId(e.type, e.surface_form);
    expect(id1).toBe(id2);
    // Different surface -> different id
    const id3 = generateEntityId(e.type, 'Alice ');
    expect(id3).not.toBe(id1);
  });
});
