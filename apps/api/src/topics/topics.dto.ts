import { z } from 'zod';
import { itemQuerySchema } from '../items/items.dto.js';

export const topicQuerySchema = z.object({
  active: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const topicIdSchema = z.string().min(1).max(128);
export const topicItemsQuerySchema = itemQuerySchema;
