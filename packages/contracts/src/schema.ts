import { z } from 'zod';

export const eventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  source: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
    name: z.string().min(1).max(200),
  }).strict(),
  observedAt: z.string().datetime({ offset: true }),
  document: z.object({
    externalId: z.string().min(1).max(500),
    url: z.string().url().max(4000),
    title: z.string().max(2000),
    text: z.string().max(1_000_000),
    language: z.string().max(35).optional(),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    attributes: z.record(z.unknown()).default({}),
  }).strict(),
}).strict();

export type OsintEvent = z.infer<typeof eventSchema>;
export type Delivery = { streamId: string; topic: string; partition: number; offset: string };
export const PROCESSOR_VERSION = '1';
