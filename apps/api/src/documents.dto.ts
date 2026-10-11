import { z } from 'zod';

export const cursorSchema = z.object({
  time: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export const documentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    source: z.string().max(100).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().max(1000).optional(),
  })
  .strict()
  .refine(
    value => !value.from || !value.to || new Date(value.from) < new Date(value.to),
    'from must be earlier than to',
  );

export const documentIdSchema = z.string().uuid();

export type CursorPayload = z.infer<typeof cursorSchema>;
export type DocumentQueryParams = z.infer<typeof documentQuerySchema>;
