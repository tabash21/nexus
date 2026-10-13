export const DEFAULT_PLATFORMS = ['telegram','x','news','reddit','threads','instagram','tiktok','youtube','bluesky','facebook'];
export function sourceReality(source) {
  const topicMode = source.topic.startsWith('sim.') ? 'simulation' : source.topic.startsWith('raw.') ? 'real' : source.mode;
  if (topicMode !== source.mode) throw new Error('Topic prefix does not match source mode');
  const realityId = topicMode === 'simulation' ? 1 : 0;
  if (source.realityId !== undefined && source.realityId !== realityId) {
    throw new Error('Real sources use realityId 0 and simulation sources always use realityId 1');
  }
  return realityId;
}
export function sourceSubscriptions(env = process.env) {
  const platforms = (env.KAFKA_PLATFORMS || DEFAULT_PLATFORMS.join(',')).split(',').map(x => x.trim());
  const defaults = platforms.flatMap(platform => [
    { platform, topic: 'raw.' + platform + '.v1', groupId: (env.KAFKA_GROUP_ID || 'nexus-items-v1') + '.' + platform, mode: 'real', realityId: 0, adapter: 'provisional.v1' },
    { platform, topic: 'sim.' + platform + '.v1', groupId: (env.KAFKA_GROUP_ID || 'nexus-items-v1') + '.sim.' + platform, mode: 'simulation', realityId: 1, adapter: 'provisional.v1' },
  ]);
  const result = env.KAFKA_SOURCES ? JSON.parse(env.KAFKA_SOURCES) : defaults;
  if (!Array.isArray(result) || !result.length || result.some(s => !s || !/^[a-z][a-z0-9_-]{0,49}$/.test(s.platform)
    || typeof s.topic !== 'string' || !/^[a-zA-Z0-9._-]{1,249}$/.test(s.topic) || ['.','..'].includes(s.topic)
    || typeof s.groupId !== 'string' || !s.groupId.trim() || !['real','simulation'].includes(s.mode)
    || s.adapter !== 'provisional.v1')) throw new Error('Invalid KAFKA_SOURCES configuration');
  if (new Set(result.map(s => s.topic)).size !== result.length || new Set(result.map(s => s.groupId)).size !== result.length) throw new Error('Each source topic and consumer group must be unique');
  return result.map(source => ({ ...source, realityId: sourceReality(source) }));
}
