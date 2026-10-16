import { z } from 'zod';
import { realityQuerySchema, itemQuerySchema } from '../items/items.dto.js';

export const sourceQuerySchema = realityQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  platform: z.string().max(50).optional(),
  arena: z.enum(['IL', 'ARAB', 'INTL']).optional(),
  tier: z.enum(['watchlist', 'discovery']).optional(),
  active: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  cursor: z.string().max(1100).optional(),
});

export const sourceIdSchema = z.string().min(1).max(1100);
export const sourceItemsQuerySchema = itemQuerySchema;
