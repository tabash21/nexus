import { collectorEventSchema, eventSchema, type CollectorEvent, type OsintEvent } from '@nexus/contracts';
import { sourceReality, type SourceSubscription } from '../../../../scripts/lib/source-registry.mjs';
export interface SourceAdapter { parse(value: unknown): CollectorEvent }
const adapters: Record<string, SourceAdapter> = { 'provisional.v1': { parse: value => collectorEventSchema.parse(value) } };
export function adapt(value: unknown, source: SourceSubscription): OsintEvent {
  const adapter = adapters[source.adapter];
  if (!adapter) throw new Error('Source adapter is not registered');
  const event = eventSchema.parse({ ...adapter.parse(value), realityId: sourceReality(source) });
  if (event.platform !== source.platform) throw new Error('Payload platform differs from topic platform');
  if ((source.mode === 'real') !== (event.realityId === 0)) throw new Error('Reality does not match configured source mode');
  return event;
}
