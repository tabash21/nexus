import { z } from 'zod';
export const timestamp = z.string().datetime({ offset: true });
const id = z.string().min(1).max(1000);
const count = z.string().regex(/^\d+$/).or(z.number().int().nonnegative().safe()).transform(String).refine(value => BigInt(value) <= 9223372036854775807n, 'Count exceeds PostgreSQL bigint');
export const mediaSchema = z.object({
  index: z.number().int().min(0).max(32767), type: z.enum(['image','video','audio','document','link_card']),
  url: z.string().url().optional(), mimeType: z.string().optional(),
  width: z.number().int().positive().max(2147483647).optional(), height: z.number().int().positive().max(2147483647).optional(),
  duration: z.number().finite().nonnegative().optional(), altText: z.string().optional(),
}).strict();
/** Provisional collector envelope. Provider-specific adapters can replace it independently. */
export const eventSchema = z.object({
  schemaVersion: z.literal('provisional.v1'), eventId: z.string().uuid(),
  platform: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/), realityId: z.number().int().min(0).max(2147483647).default(0),
  observedAt: timestamp, collector: z.string().min(1), provider: z.string().min(1),
  source: z.object({ id, kind: z.enum(['channel','site','subreddit','page','group','account','search']),
    name: z.string().optional(), handleOrUrl: z.string().optional(), subscribers: count.optional(),
  }).strict(),
  author: z.object({ id, name: z.string().optional(), handle: z.string().optional(),
    followers: count.optional(), verified: z.boolean().optional(),
  }).strict().optional(),
  item: z.object({ nativeId: id, type: z.enum(['post','reply','quote','repost','forward','comment','article','video','story']).default('post'),
    url: z.string().url().max(4000).optional(), title: z.string().max(2000).optional(), text: z.string().max(1000000),
    publishedAt: timestamp.optional(), editedAt: timestamp.optional(), language: z.string().max(35).optional(),
    hashtags: z.array(z.string()).optional(), mentions: z.array(z.string()).optional(), links: z.array(z.string().url()).optional(),
    sensitive: z.boolean().optional(), extra: z.record(z.unknown()).optional(),
  }).strict(),
  media: z.array(mediaSchema).max(1000).optional(), mediaComplete: z.boolean().default(false),
  engagement: z.object({ capturedAt: timestamp.optional(), views: count.optional(),
    likes: z.string().regex(/^-?\d+$/).or(z.number().int().safe()).transform(String).refine(value => BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n, 'Score exceeds PostgreSQL bigint').optional(),
    likesKind: z.enum(['like','score']).optional(), reposts: count.optional(), replies: count.optional(),
    quotes: count.optional(), saves: count.optional(),
  }).strict().optional(),
  queryIds: z.array(id).optional(),
}).strict().superRefine((event, ctx) => {
  if (new Set(event.media?.map(media => media.index)).size !== (event.media?.length ?? 0)) ctx.addIssue({ code:'custom', message:'Duplicate media index' });
  if (event.engagement?.likes?.startsWith('-') && event.engagement.likesKind !== 'score') ctx.addIssue({ code:'custom', message:'Negative likes require score semantics' });
});
export type OsintEvent = z.infer<typeof eventSchema>;
export type Delivery = { streamId: string; topic: string; partition: number; offset: string };
export const PROCESSOR_VERSION = 'artemis.provisional.1';
