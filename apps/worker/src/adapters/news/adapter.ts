import { hash, sourceReality, type CollectorEvent, type SourceSubscription } from '@nexus/contracts';
import { deterministicEventId, type SourceAdapter } from '../types.js';
import { newsArticleSchema, type NewsArticle } from './schema.js';

export const newsAdapter: SourceAdapter<NewsArticle> = {
  name: 'news.v1',
  platform: 'news',

  supports(payload: unknown, source: SourceSubscription): boolean {
    if (source.platform !== 'news' || !payload || typeof payload !== 'object') return false;
    const raw = payload as Record<string, unknown>;
    return (
      raw.schemaVersion !== 'provisional.v1' && (source.adapter === 'news.v1' || ('feedUrl' in raw && 'itemId' in raw))
    );
  },

  parse(payload: unknown, source: SourceSubscription): CollectorEvent {
    const article = newsArticleSchema.parse(payload);
    const sourceId = article.feedUrl;
    const creator = article.creator || article['dc:creator'];

    return {
      schemaVersion: 'provisional.v1',
      // Collection time is part of the raw hash: a new scrape is a new observation,
      // while replaying its original bytes preserves event identity.
      eventId:
        article.eventId ?? deterministicEventId(`news-observation:${sourceReality(source)}`, sourceId, hash(payload)),
      platform: 'news',
      collector: 'news-kafka',
      provider: new URL(article.feedUrl).hostname,
      observedAt: article.collectedAt,
      source: { id: sourceId, kind: 'site', name: article.feedName, handleOrUrl: article.feedUrl },
      ...(creator ? { author: { id: hash([sourceId, creator]), name: creator } } : {}),
      item: {
        // Publisher-local IDs must not collide across feeds.
        nativeId: hash([sourceId, article.itemId]),
        type: 'article',
        url: article.link,
        title: article.title,
        text: article.contentSnippet ?? '',
        publishedAt: article.isoDate,
      },
      mediaComplete: false,
    };
  },
};
