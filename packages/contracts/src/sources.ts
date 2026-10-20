import { PLATFORM_PATTERN, TOPIC_PATTERN } from './patterns.js';

export type SourceAdapterType = 'provisional.v1' | 'telegram.v1' | (string & {});

export interface SourceSubscription {
  platform: string;
  topic: string;
  groupId: string;
  mode: 'real' | 'simulation';
  realityId: number;
  adapter: SourceAdapterType;
}

type SourceEnv = Record<string, string | undefined>;
type SourceInput = Pick<SourceSubscription, 'topic' | 'mode'> & { realityId?: unknown };

export const DEFAULT_PLATFORMS: readonly string[] = [
  'telegram',
  'x',
  'news',
  'reddit',
  'threads',
  'instagram',
  'tiktok',
  'youtube',
  'bluesky',
  'facebook',
  'truthsocial',
];

export function sourceReality(source: SourceInput): 0 | 1 {
  const topicMode = source.topic.startsWith('sim.')
    ? 'simulation'
    : source.topic.startsWith('raw.')
      ? 'real'
      : source.mode;
  if (topicMode !== source.mode) {
    throw new Error('Topic prefix does not match source mode');
  }
  const realityId = topicMode === 'simulation' ? 1 : 0;
  if (source.realityId !== undefined && source.realityId !== realityId) {
    throw new Error('Real sources use realityId 0 and simulation sources always use realityId 1');
  }
  return realityId;
}

function isValidSource(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;

  const hasValidPlatform = typeof s.platform === 'string' && PLATFORM_PATTERN.test(s.platform);
  const hasValidTopic =
    typeof s.topic === 'string' && TOPIC_PATTERN.test(s.topic) && s.topic !== '.' && s.topic !== '..';
  const hasValidGroup = typeof s.groupId === 'string' && s.groupId.trim() !== '';
  const hasValidMode = s.mode === 'real' || s.mode === 'simulation';
  const hasValidAdapter = typeof s.adapter === 'string' && s.adapter.trim() !== '';

  return hasValidPlatform && hasValidTopic && hasValidGroup && hasValidMode && hasValidAdapter;
}

export function defaultAdapterForPlatform(platform: string): SourceAdapterType {
  if (platform === 'telegram') return 'telegram.v1';
  if (platform === 'truthsocial') return 'truthsocial.v1';
  return 'provisional.v1';
}

function createDefaultSubscriptions(platforms: string[], group: string): SourceSubscription[] {
  return platforms.flatMap(platform => [
    {
      platform,
      topic: `raw.${platform}.v1`,
      groupId: `${group}.${platform}`,
      mode: 'real' as const,
      realityId: 0,
      adapter: defaultAdapterForPlatform(platform),
    },
    {
      platform,
      topic: `sim.${platform}.v1`,
      groupId: `${group}.sim.${platform}`,
      mode: 'simulation' as const,
      realityId: 1,
      adapter: defaultAdapterForPlatform(platform),
    },
  ]);
}

export function sourceSubscriptions(env: SourceEnv = process.env): SourceSubscription[] {
  const platforms = (env.KAFKA_PLATFORMS || DEFAULT_PLATFORMS.join(',')).split(',').map(x => x.trim());
  const group = env.KAFKA_GROUP_ID || 'nexus-items-v1';
  const defaults = createDefaultSubscriptions(platforms, group);

  const result: unknown = env.KAFKA_SOURCES ? JSON.parse(env.KAFKA_SOURCES) : defaults;
  if (!Array.isArray(result) || !result.length || !result.every(isValidSource)) {
    throw new Error('Invalid KAFKA_SOURCES configuration');
  }

  const sources = result as SourceSubscription[];
  if (
    new Set(sources.map(s => s.topic)).size !== sources.length ||
    new Set(sources.map(s => s.groupId)).size !== sources.length
  ) {
    throw new Error('Each source topic and consumer group must be unique');
  }
  return sources.map(source => ({ ...source, realityId: sourceReality(source) }));
}
