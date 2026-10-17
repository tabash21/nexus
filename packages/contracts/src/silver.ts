import { z } from 'zod';
import { eventSchema, timestamp } from './schema.js';

const deliverySchema = z.object({
  streamId: z.string().min(1),
  topic: z.string().min(1),
  partition: z.number().int().nonnegative(),
  offset: z.string().regex(/^\d+$/),
});

/** One archived source observation, ready for the PostgreSQL projection. */
export const silverObservationSchema = z.object({
  stageVersion: z.literal('silver.v1'),
  event: eventSchema,
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
  rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rawUri: z.string().startsWith('s3://'),
  sourceDelivery: deliverySchema,
  /** Native source content version, independent of when engagement was observed. */
  contentVersionAt: timestamp.optional(),
  legacyReplay: z.literal(true).optional(),
}).strict();

export type SilverObservation = z.infer<typeof silverObservationSchema>;
