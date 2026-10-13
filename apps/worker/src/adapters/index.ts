import { eventSchema, type OsintEvent } from '@nexus/contracts';
import type { SourceSubscription } from '../../../../scripts/lib/source-registry.mjs';
export interface SourceAdapter { parse(value: unknown): OsintEvent }
const adapters: Record<string, SourceAdapter> = { 'provisional.v1': { parse: value => eventSchema.parse(value) } };
export function adapt(value: unknown, source: SourceSubscription): OsintEvent {
  const adapter = adapters[source.adapter];
  if (!adapter) throw new Error('Source adapter is not registered');
  const event = adapter.parse(value);
  if (event.platform !== source.platform) throw new Error('Payload platform differs from topic platform');
  if ((source.mode === 'real') !== (event.realityId === 0)) throw new Error('Reality does not match topic mode');
  return event;
}
