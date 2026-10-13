import type { OsintEvent } from './schema.js';

export function normalize(event: OsintEvent): OsintEvent {
  return {
    ...event,
    observedAt: new Date(event.observedAt).toISOString(),
    document: {
      ...event.document,
      ...(event.document.publishedAt ? { publishedAt: new Date(event.document.publishedAt).toISOString() } : {}),
    },
  };
}
