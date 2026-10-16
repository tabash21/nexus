import { describe, expect, it } from 'vitest';
import { sourceSubscriptions } from '@nexus/contracts';
import { buildArchiveConfig } from '../scripts/setup/archive-config.mjs';
describe('Extensible source registry', () => {
  it('uses the same custom topics in consumers and Connect', () => {
    const config = { platform: 'newsource', topic: 'raw.newsource.v1', groupId: 'newsource-v1', mode: 'real', adapter: 'provisional.v1' };
    const env = { KAFKA_SOURCES: JSON.stringify([config]) };
    expect(sourceSubscriptions(env)).toEqual([{ ...config, realityId: 0 }]);
    expect(buildArchiveConfig({ 's3.bucket.name': 'nexus-raw', 's3.region': 'us-east-1' }, env).topics).toBe(config.topic);
  });
  it('always creates both subscriptions and ignores retired simulation switches', () => {
    const entries = sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram,x', KAFKA_SIMULATION_ENABLED: 'false', KAFKA_SIMULATION_REALITY_ID: '42' });
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map(source => source.groupId)).size).toBe(4);
    expect(entries.filter(source => source.mode === 'simulation').map(source => source.realityId)).toEqual([1, 1]);
    expect(entries.filter(source => source.mode === 'simulation').map(source => source.topic)).toEqual(['sim.telegram.v1', 'sim.x.v1']);
  });
  it('rejects duplicate topic/group configuration', () => {
    expect(() => sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram,telegram' })).toThrow('unique');
  });
  it('rejects any simulation reality override other than 1', () => {
    const config = { platform: 'telegram', topic: 'sim.telegram.v1', groupId: 'test.sim', mode: 'simulation', adapter: 'provisional.v1' };
    for (const realityId of [0, 42, -1, 1.5, '1']) {
      expect(() => sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([{ ...config, realityId }]) })).toThrow('realityId');
    }
  });
  it('enforces topic mode and fixed realities for custom subscriptions', () => {
    const config = { platform: 'telegram', topic: 'sim.telegram.v1', groupId: 'test.sim', mode: 'simulation', realityId: 1, adapter: 'provisional.v1' };
    expect(sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([config]) })).toEqual([config]);
    expect(() => sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([{ ...config, mode: 'real' }]) })).toThrow('prefix');
    const { realityId: _ignored, ...missing } = config;
    expect(sourceSubscriptions({ KAFKA_SOURCES: JSON.stringify([missing]) })).toEqual([{ ...missing, realityId: 1 }]);
  });
  it('defaults raw.telegram.v1 to reality 0 and sim.telegram.v1 to reality 1', () => {
    const entries = sourceSubscriptions({ KAFKA_PLATFORMS: 'telegram' });
    expect(entries.map(({ topic, realityId }) => ({ topic, realityId }))).toEqual([
      { topic: 'raw.telegram.v1', realityId: 0 }, { topic: 'sim.telegram.v1', realityId: 1 },
    ]);
  });
});
