export const DEFAULT_PLATFORMS = ['telegram','x','news','reddit','threads','instagram','tiktok','youtube','bluesky','facebook'];
export function sourceSubscriptions(env = process.env) {
  const platforms = (env.KAFKA_PLATFORMS || DEFAULT_PLATFORMS.join(',')).split(',').map(x => x.trim());
  const simulationRealityId = Number(env.KAFKA_SIMULATION_REALITY_ID || '1');
  if (!env.KAFKA_SOURCES && env.KAFKA_SIMULATION_ENABLED === 'true'
    && (!Number.isInteger(simulationRealityId) || simulationRealityId <= 0 || simulationRealityId > 2147483647)) {
    throw new Error('Set KAFKA_SIMULATION_REALITY_ID to a registered positive reality ID');
  }
  const defaults = platforms.flatMap(platform => [
    { platform, topic: 'raw.' + platform + '.v1', groupId: (env.KAFKA_GROUP_ID || 'nexus-items-v1') + '.' + platform, mode: 'real', realityId: 0, adapter: 'provisional.v1' },
    ...(env.KAFKA_SIMULATION_ENABLED === 'true' ? [{ platform, topic: 'sim.' + platform + '.v1', groupId: (env.KAFKA_GROUP_ID || 'nexus-items-v1') + '.sim.' + platform, mode: 'simulation', realityId: simulationRealityId, adapter: 'provisional.v1' }] : []),
  ]);
  const result = env.KAFKA_SOURCES ? JSON.parse(env.KAFKA_SOURCES) : defaults;
  if (!Array.isArray(result) || !result.length || result.some(s => !s || !/^[a-z][a-z0-9_-]{0,49}$/.test(s.platform)
    || typeof s.topic !== 'string' || !/^[a-zA-Z0-9._-]{1,249}$/.test(s.topic) || ['.','..'].includes(s.topic)
    || typeof s.groupId !== 'string' || !s.groupId.trim() || !['real','simulation'].includes(s.mode)
    || s.adapter !== 'provisional.v1')) throw new Error('Invalid KAFKA_SOURCES configuration');
  if (new Set(result.map(s => s.topic)).size !== result.length || new Set(result.map(s => s.groupId)).size !== result.length) throw new Error('Each source topic and consumer group must be unique');
  const sources = result.map(source => ({ ...source, realityId: source.realityId ?? (source.mode === 'real' ? 0 : 1) }));
  if (sources.some(source => !Number.isInteger(source.realityId) || source.realityId < 0 || source.realityId > 2147483647
    || (source.mode === 'real' ? source.realityId !== 0 : source.realityId === 0))) {
    throw new Error('Real sources require realityId 0; simulation sources require a registered positive realityId');
  }
  return sources;
}
