import { describe, expect, it } from 'vitest';
import { sourceSubscriptions } from '../scripts/lib/source-registry.mjs';
import { buildArchiveConfig } from '../scripts/lib/archive-config.mjs';
describe('Extensible source registry', () => {
  it('uses the same custom topics in consumers and Connect', () => {
    const config = { platform: 'newsource', topic: 'raw.newsource.v1', groupId: 'newsource-v1', mode: 'real', adapter: 'provisional.v1' };
    const env = { KAFKA_SOURCES: JSON.stringify([config]) };
    expect(sourceSubscriptions(env)).toEqual([{ ...config, realityId: 0 }]);
    expect(buildArchiveConfig({ 's3.bucket.name': 'nexus-raw', 's3.region': 'us-east-1' }, env).topics).toBe(config.topic);
  });
  it('creates independent simulation subscriptions when enabled', () => {
    const entries = sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram,x', KAFKA_SIMULATION_ENABLED: 'true', KAFKA_SIMULATION_REALITY_ID: '42' });
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map(source => source.groupId)).size).toBe(4);
    expect(entries.filter(source => source.mode === 'simulation').map(source => source.realityId)).toEqual([42, 42]);
    expect(entries.filter(source => source.mode === 'simulation').map(source => source.topic)).toEqual(['sim.telegram.v1', 'sim.x.v1']);
  });
  it('rejects duplicate topic/group configuration', () => {
    expect(() => sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram,telegram' })).toThrow('unique');
  });
  it('requires a configured positive simulation reality', () => {
    for (const realityId of ['0', '-1', '1.5', '2147483648']) {
      expect(() => sourceSubscriptions({ KAFKA_SIMULATION_ENABLED: 'true', KAFKA_SIMULATION_REALITY_ID: realityId })).toThrow('KAFKA_SIMULATION_REALITY_ID');
    }
  });
  it('supports explicit realities per simulation subscription and rejects invalid real-source assignments', () => {
    const config = { platform: 'telegram', topic: 'sim.telegram.exercise42', groupId: 'exercise42', mode: 'simulation', realityId: 42, adapter: 'provisional.v1' };
    expect(sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([config]) })).toEqual([config]);
    expect(() => sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([{ ...config, mode: 'real' }]) })).toThrow('realityId');
    const { realityId: _ignored, ...missing } = config;
    expect(sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([missing]) })).toEqual([{ ...missing, realityId: 1 }]);
  });
  it('defaults raw.telegram.v1 to reality 0 and sim.telegram.v1 to reality 1', () => {
    const entries = sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram', KAFKA_SIMULATION_ENABLED: 'true' });
    expect(entries.map(({ topic, realityId }) => ({ topic, realityId }))).toEqual([
      { topic: 'raw.telegram.v1', realityId: 0 }, { topic: 'sim.telegram.v1', realityId: 1 },
    ]);
  });
});
