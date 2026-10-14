export interface SourceSubscription {
  platform: string;
  topic: string;
  groupId: string;
  mode: 'real' | 'simulation';
  realityId: number;
  adapter: 'provisional.v1';
}
type SourceEnv = Record<string, string | undefined>;
type SourceInput = Pick<SourceSubscription, 'topic' | 'mode'> & { realityId?: unknown };

export const DEFAULT_PLATFORMS: string[] = ['telegram', 'x', 'news', 'reddit', 'threads', 'instagram', 'tiktok', 'youtube', 'bluesky', 'facebook'];

export function sourceReality(source: SourceInput): 0 | 1 {
  const topicMode = source.topic.startsWith('sim.') ? 'simulation' : source.topic.startsWith('raw.') ? 'real' : source.mode;
  if (topicMode !== source.mode) throw new Error('Topic prefix does not match source mode');
  const realityId = topicMode === 'simulation' ? 1 : 0;
  if (source.realityId !== undefined && source.realityId !== realityId) {
    throw new Error('Real sources use realityId 0 and simulation sources always use realityId 1');
  }
  return realityId;
}

function isValidSource(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return typeof s.platform === 'string' && /^[a-z][a-z0-9_-]{0,49}$/.test(s.platform)
    && typeof s.topic === 'string' && /^[a-zA-Z0-9._-]{1,249}$/.test(s.topic) && !['.', '..'].includes(s.topic)
    && typeof s.groupId === 'string' && s.groupId.trim() !== '' && (s.mode === 'real' || s.mode === 'simulation')
    && s.adapter === 'provisional.v1';
}

export function sourceSubscriptions(env: SourceEnv = process.env): SourceSubscription[] {
  const platforms = (env.KAFKA_PLATFORMS || DEFAULT_PLATFORMS.join(',')).split(',').map(x => x.trim());
  const group = env.KAFKA_GROUP_ID || 'nexus-items-v1';
  const defaults: SourceSubscription[] = platforms.flatMap(platform => [
    { platform, topic: `raw.${platform}.v1`, groupId: `${group}.${platform}`, mode: 'real' as const, realityId: 0, adapter: 'provisional.v1' as const },
    { platform, topic: `sim.${platform}.v1`, groupId: `${group}.sim.${platform}`, mode: 'simulation' as const, realityId: 1, adapter: 'provisional.v1' as const },
  ]);
  const result: unknown = env.KAFKA_SOURCES ? JSON.parse(env.KAFKA_SOURCES) : defaults;
  if (!Array.isArray(result) || !result.length || !result.every(isValidSource)) throw new Error('Invalid KAFKA_SOURCES configuration');
  const sources = result as SourceSubscription[];
  if (new Set(sources.map(s => s.topic)).size !== sources.length || new Set(sources.map(s => s.groupId)).size !== sources.length) {
    throw new Error('Each source topic and consumer group must be unique');
  }
  return sources.map(source => ({ ...source, realityId: sourceReality(source) }));
}
