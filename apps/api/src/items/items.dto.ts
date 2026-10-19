import { z } from 'zod';

const time = z.string().datetime({ offset: true });

export const itemIdSchema = z.string().min(1).max(512);

export const cursorSchema = z
  .object({
    time,
    id: z.string().min(1).max(512),
    scope: z.string(),
  })
  .strict();

export const realityQuerySchema = z
  .object({
    realityId: z.coerce.number().int().min(0).max(2147483647).default(0),
  })
  .strict();

export const itemQuerySchema = realityQuerySchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    source: z.string().max(1100).optional(),
    platform: z.string().max(50).optional(),
    author: z.string().max(512).optional(),
    topic: z.string().max(128).optional(),
    entityId: z.string().max(512).optional(),
    lang: z.string().max(10).optional(),
    itemType: z.string().max(50).optional(),
    from: time.optional(),
    to: time.optional(),
    cursor: z.string().max(2000).optional(),
    full: z.preprocess(v => v === 'true' || v === true, z.boolean()).optional(),
    ids: z
      .preprocess(value => {
        if (Array.isArray(value)) {
          return value
            .flatMap(entry => {
              if (typeof entry === 'string') return entry.split(',').map(id => id.trim());
              return [];
            })
            .filter(Boolean);
        }
        if (typeof value === 'string') return value.split(',').map(id => id.trim()).filter(Boolean);
        return [];
      }, z.array(itemIdSchema).max(100).optional()),
  })
  .refine(value => !value.from || !value.to || new Date(value.from) < new Date(value.to), 'from must be earlier than to');

export const itemIdsQuerySchema = z
  .object({
    realityId: z.coerce.number().int().min(0).max(2147483647).default(0),
    ids: z
      .preprocess(value => {
        if (Array.isArray(value)) {
          return value
            .flatMap(entry => {
              if (typeof entry === 'string') return entry.split(',').map(id => id.trim());
              return [];
            })
            .filter(Boolean);
        }
        if (typeof value === 'string') return value.split(',').map(id => id.trim()).filter(Boolean);
        return [];
      }, z.array(itemIdSchema).min(1).max(100)),
  })
  .strict();

export type CursorPayload = z.infer<typeof cursorSchema>;
export type ItemQuery = z.infer<typeof itemQuerySchema>;
