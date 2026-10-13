import { z } from 'zod';
import { realityQuerySchema } from '../items/items.dto.js';

export const collectionQueryFilterSchema = realityQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  platform: z.string().max(50).optional(),
  active: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});

export const queryIdSchema = z.string().min(1).max(512);
