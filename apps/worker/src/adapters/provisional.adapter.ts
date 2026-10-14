import { collectorEventSchema, type CollectorEvent, type SourceSubscription } from '@nexus/contracts';
import type { SourceAdapter } from './types.js';

export const provisionalAdapter: SourceAdapter<CollectorEvent> = {
  name: 'provisional.v1',

  supports(payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return p.schemaVersion === 'provisional.v1';
  },

  parse(payload: unknown, _source: SourceSubscription): CollectorEvent {
    return collectorEventSchema.parse(payload);
  },
};
