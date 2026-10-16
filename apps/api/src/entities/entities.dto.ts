import { z } from 'zod';
import { realityQuerySchema, itemQuerySchema } from '../items/items.dto.js';

export const entityQuerySchema = realityQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(['PER', 'ORG', 'LOC']).optional(),
  country: z.string().length(2).optional(),
  search: z.string().max(255).optional(),
  cursor: z.string().max(512).optional(),
});

export const entityIdSchema = z.string().min(1).max(512);
export const entityItemsQuerySchema = itemQuerySchema;
