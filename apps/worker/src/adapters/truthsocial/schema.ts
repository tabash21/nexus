import { z } from 'zod';

const count = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/)]);

export const truthSocialMessageSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
    id: z.string().regex(/^\d+$/),
    created_at: z.string().datetime({ offset: true }),
    content: z.string(),
    url: z.string().url(),
    media: z.array(z.string().url()).max(1000).optional(),
    replies_count: count.optional(),
    reblogs_count: count.optional(),
    favourites_count: count.optional(),
    sourceCategories: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((message, ctx) => {
    if ('realityId' in message) {
      ctx.addIssue({ code: 'custom', message: 'Reality must be assigned by the worker' });
    }
  });

export type TruthSocialMessage = z.infer<typeof truthSocialMessageSchema>;
