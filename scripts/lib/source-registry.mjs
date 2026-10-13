export const DEFAULT_PLATFORMS = ['telegram','x','news','reddit','threads','instagram','tiktok','youtube','bluesky','facebook'];
export function sourceSubscriptions(env = process.env) {
  const platforms = (env.KAFKA_PLATFORMS || DEFAULT_PLATFORMS.join(',')).split(',').map(x => x.trim());
  const defaults = platforms.flatMap(platform => [
    { platform, topic: 'raw.' + platform + '.v1', groupId: (env.KAFKA_GROUP_ID || 'nexus-items-v1') + '.' + platform, mode: 'real', adapter: 'provisional.v1' },
    ...(env.KAFKA_SIMULATION_ENABLED === 'true' ? [{ platform, topic: 'sim.' + platform + '.v1', groupId: (env.KAFKA_GROUP_ID || 'nexus-items-v1') + '.sim.' + platform, mode: 'simulation', adapter: 'provisional.v1' }] : []),
  ]);
  const result = env.KAFKA_SOURCES ? JSON.parse(env.KAFKA_SOURCES) : defaults;
  if (!Array.isArray(result) || !result.length || result.some(s => !s || !/^[a-z][a-z0-9_-]{0,49}$/.test(s.platform)
    || typeof s.topic !== 'string' || !/^[a-zA-Z0-9._-]{1,249}$/.test(s.topic) || ['.','..'].includes(s.topic)
    || typeof s.groupId !== 'string' || !s.groupId.trim() || !['real','simulation'].includes(s.mode)
    || s.adapter !== 'provisional.v1')) throw new Error('Invalid KAFKA_SOURCES configuration');
  if (new Set(result.map(s => s.topic)).size !== result.length || new Set(result.map(s => s.groupId)).size !== result.length) throw new Error('Each source topic and consumer group must be unique');
  return result;
}
