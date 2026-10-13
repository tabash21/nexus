import { z } from 'zod';
import { realityQuerySchema, itemQuerySchema } from '../items/items.dto.js';

export const authorQuerySchema = realityQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  platform: z.string().max(50).optional(),
  verified: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  isAutomated: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  cursor: z.string().max(512).optional(),
});

export const authorIdSchema = z.string().min(1).max(512);
export const authorItemsQuerySchema = itemQuerySchema;
