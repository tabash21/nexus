export interface SourceSubscription { platform: string; topic: string; groupId: string; mode: 'real' | 'simulation'; realityId: number; adapter: 'provisional.v1' }
export const DEFAULT_PLATFORMS: string[];
export function sourceSubscriptions(env?: NodeJS.ProcessEnv): SourceSubscription[];
