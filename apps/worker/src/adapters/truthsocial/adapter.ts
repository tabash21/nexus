import { hash, sourceReality, type CollectorEvent, type SourceSubscription } from '@nexus/contracts';
import { deterministicEventId, type SourceAdapter } from '../types.js';
import { extractAccount, extractEngagement, extractMedia } from './extractors.js';
import { truthSocialMessageSchema, type TruthSocialMessage } from './schema.js';

export const truthSocialAdapter: SourceAdapter<TruthSocialMessage> = {
  name: 'truthsocial.v1',
  platform: 'truthsocial',

  supports(payload: unknown, source: SourceSubscription): boolean {
    if (typeof payload !== 'object' || payload === null) return false;
    if ((payload as Record<string, unknown>).schemaVersion === 'provisional.v1') return false;
    return source.platform === 'truthsocial' || source.adapter === 'truthsocial.v1';
  },

  parse(payload: unknown, source: SourceSubscription): CollectorEvent {
    const msg = truthSocialMessageSchema.parse(payload);
    const {
      eventId,
      observedAt: collectedAt,
      id,
      created_at,
      content,
      url,
      media: rawMedia,
      replies_count: _replies,
      reblogs_count: _reblogs,
      favourites_count: _favourites,
      ...extra
    } = msg;
    const account = extractAccount(url, id);
    const publishedAt = new Date(created_at).toISOString();
    const observedAt = collectedAt ? new Date(collectedAt).toISOString() : publishedAt;
    const media = extractMedia(rawMedia);
    const engagement = extractEngagement(msg, observedAt);

    return {
      schemaVersion: 'provisional.v1',
      eventId:
        eventId?.toLowerCase() ??
        deterministicEventId(`truthsocial-observation:${sourceReality(source)}`, account.id, `${id}:${hash(payload)}`),
      platform: 'truthsocial',
      collector: 'truthsocial-kafka',
      provider: 'truthsocial',
      observedAt,
      source: { id: account.id, kind: 'account', handleOrUrl: account.url },
      author: { id: account.id, handle: account.handle },
      item: { nativeId: id, type: 'post', text: content, url, publishedAt, extra },
      ...(media ? { media } : {}),
      mediaComplete: rawMedia !== undefined,
      ...(engagement ? { engagement } : {}),
    };
  },
};
