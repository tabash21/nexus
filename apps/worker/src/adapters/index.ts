import { eventSchema, sourceReality, type OsintEvent, type SourceSubscription } from '@nexus/contracts';
import { AdapterRegistry, type SourceAdapter } from './types.js';
import { telegramAdapter } from './telegram/index.js';
import { provisionalAdapter } from './provisional/index.js';
import { newsAdapter } from './news/index.js';
import { truthSocialAdapter } from './truthsocial/index.js';

export * from './types.js';
export * from './telegram/index.js';
export * from './provisional/index.js';
export * from './news/index.js';
export * from './truthsocial/index.js';

export const defaultRegistry = new AdapterRegistry();
defaultRegistry.register(provisionalAdapter);
defaultRegistry.register(telegramAdapter);
defaultRegistry.register(newsAdapter);
defaultRegistry.register(truthSocialAdapter);

/**
 * Registers a new source adapter into the default worker registry.
 * Use this to add support for any future source (e.g. X, Reddit, Facebook).
 */
export function registerAdapter(adapter: SourceAdapter): void {
  defaultRegistry.register(adapter);
}

/**
 * Resolves an adapter for a given payload and source subscription.
 */
export function resolveAdapter(payload: unknown, source: SourceSubscription): SourceAdapter {
  return defaultRegistry.resolve(payload, source);
}

/**
 * Adapts raw message payload from Kafka into a validated OsintEvent ready for database persistence.
 */
export function adapt(
  value: unknown,
  source: SourceSubscription,
  registry: AdapterRegistry = defaultRegistry,
): OsintEvent {
  const adapter = registry.resolve(value, source);
  const collectorEvent = adapter.parse(value, source);
  const event = eventSchema.parse({ ...collectorEvent, realityId: sourceReality(source) });
  if (event.platform !== source.platform) {
    throw new Error('Payload platform differs from topic platform');
  }
  if ((source.mode === 'real') !== (event.realityId === 0)) {
    throw new Error('Reality does not match configured source mode');
  }
  return event;
}
