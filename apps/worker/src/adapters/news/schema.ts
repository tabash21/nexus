import { z } from 'zod';

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
    feedName: z.string().min(1),
    feedUrl: webUrl,
    title: z.string().max(2000),
    link: webUrl,
    contentSnippet: z.string().max(1000000).optional(),
    isoDate: z.string().datetime({ offset: true }),
    collectedAt: z.string().datetime({ offset: true }),
    creator: z.string().optional(),
    'dc:creator': z.string().optional(),
  })
  .passthrough()
  .superRefine((article, ctx) => {
    if (!article.title.trim() && !article.contentSnippet?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'News article requires a nonblank title or contentSnippet' });
    }
    if ('realityId' in article) {
      ctx.addIssue({ code: 'custom', message: 'Reality must be assigned by the worker' });
    }
  });

export type NewsArticle = z.infer<typeof newsArticleSchema>;
