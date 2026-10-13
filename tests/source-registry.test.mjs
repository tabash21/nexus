import { describe, expect, it } from 'vitest';
import { sourceSubscriptions } from '../scripts/lib/source-registry.mjs';
import { buildArchiveConfig } from '../scripts/lib/archive-config.mjs';
describe('Extensible source registry', () => {
  it('uses the same custom topics in consumers and Connect', () => {
    const config = { platform: 'newsource', topic: 'raw.newsource.v1', groupId: 'newsource-v1', mode: 'real', adapter: 'provisional.v1' };
    const env = { KAFKA_SOURCES: JSON.stringify([config]) };
    expect(sourceSubscriptions(env)).toEqual([config]);
    expect(buildArchiveConfig({ 's3.bucket.name': 'nexus-raw', 's3.region': 'us-east-1' }, env).topics).toBe(config.topic);
  });
  it('creates independent simulation subscriptions when enabled', () => {
    const entries = sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram,x', KAFKA_SIMULATION_ENABLED: 'true' });
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map(source => source.groupId)).size).toBe(4);
  });
  it('rejects duplicate topic/group configuration', () => {
    expect(() => sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram,telegram' })).toThrow('unique');
  });
});
