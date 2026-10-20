import { z } from 'zod';
import { absentIfEmpty, creatorText } from './extractors.js';

const webUrl = z
  .string()
  .url()
  .max(4000)
  .refine(value => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Expected an HTTP or HTTPS URL');

/** RSS collector payload; original HTML and additional fields remain in bronze. */
export const newsArticleSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    itemId: z.string().min(1).max(1000),
    feedName: z.preprocess(absentIfEmpty, z.string().min(1).optional()),
    feedUrl: webUrl,
    title: z.string().max(2000).nullish(),
    link: webUrl,
    contentSnippet: z.string().max(1000000).nullish(),
    isoDate: z.preprocess(absentIfEmpty, z.string().datetime({ offset: true }).optional()),
    collectedAt: z.string().datetime({ offset: true }),
    creator: z.preprocess(creatorText, z.string().optional()),
    'dc:creator': z.preprocess(creatorText, z.string().optional()),
  })
  .passthrough()
  .superRefine((article, ctx) => {
    if (!article.title?.trim() && !article.contentSnippet?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'News article requires a nonblank title or contentSnippet' });
    }
    if ('realityId' in article) {
      ctx.addIssue({ code: 'custom', message: 'Reality must be assigned by the worker' });
    }
  });

export type NewsArticle = z.infer<typeof newsArticleSchema>;
