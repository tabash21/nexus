import { eventSchema, type OsintEvent } from '@nexus/contracts';

/** Synchronous, deterministic, bounded transformations before persistence. */
export interface QuickProcessor {
  readonly name: string;
  readonly version: string;
  process(event: Readonly<OsintEvent>): OsintEvent;
}

export function runQuickProcessors(event: OsintEvent, processors: readonly QuickProcessor[]): OsintEvent {
  return processors.reduce((current, processor) => {
    const next = eventSchema.parse(processor.process(current));
    if (next.eventId !== current.eventId || next.observedAt !== current.observedAt) {
      throw new Error(`Quick processor ${processor.name} changed immutable observation identity`);
    }
    return next;
  }, event);
}
