import { describe, it, expect } from 'vitest';
import {
  extractMetaFromSilver,
  generateEntityId,
  type ExtractedEntity,
} from '../apps/enrichment-worker/src/processors/implementations/entity-mentions.processor.js';
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

describe('meta extractor', () => {
  it('extracts people and places', () => {
    const entities = extractMetaFromSilver(mockSilver);
    const surfaces = entities.map(e => e.surface_form);
    expect(surfaces).toContain('Alice');
    expect(surfaces.some(s => /Central Park/i.test(s))).toBe(true);
  });

  it('generates stable ids', () => {
    const id1 = generateEntityId('PER', 'Alice');
    const id2 = generateEntityId('PER', 'Alice');
    expect(id1).toBe(id2);
  });
});
