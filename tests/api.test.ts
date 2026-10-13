import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
// Test compiled decorators and metadata exactly as the production application runs.
import { buildApp } from '../apps/api/dist/app.js';

const token = 'test-token-with-at-least-24-characters';
const headers = { authorization: 'Bearer ' + token };
const repo = () => ({
  ready: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(null),
  getItemMedia: vi.fn().mockResolvedValue([]),
  getItemThread: vi.fn().mockResolvedValue(null),
  getItemRelated: vi.fn().mockResolvedValue(null),
  listSources: vi.fn().mockResolvedValue([]),
  getSource: vi.fn().mockResolvedValue(null),
  getSourceItems: vi.fn().mockResolvedValue([]),
  listAuthors: vi.fn().mockResolvedValue([]),
  getAuthor: vi.fn().mockResolvedValue(null),
  getAuthorItems: vi.fn().mockResolvedValue([]),
  listPlatforms: vi.fn().mockResolvedValue([]),
  getPlatform: vi.fn().mockResolvedValue(null),
  listRealities: vi.fn().mockResolvedValue([]),
  getReality: vi.fn().mockResolvedValue(null),
  listTopics: vi.fn().mockResolvedValue([]),
  getTopic: vi.fn().mockResolvedValue(null),
  getTopicItems: vi.fn().mockResolvedValue([]),
  listEntities: vi.fn().mockResolvedValue([]),
  getEntity: vi.fn().mockResolvedValue(null),
  getEntityItems: vi.fn().mockResolvedValue([]),
  listQueries: vi.fn().mockResolvedValue([]),
  getQuery: vi.fn().mockResolvedValue(null),
  getStats: vi.fn().mockResolvedValue({ realityId: 0, itemsCount: 0, sourcesCount: 0, authorsCount: 0, platforms: [] }),
});
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup() {
  const db = repo();
  const app = await buildApp(db, token);
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return {
    db,
    app,
    request: (path: string, authenticated = true) =>
      fetch('http://127.0.0.1:' + address.port + path, {
        headers: authenticated ? headers : undefined,
      }),
  };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('NestJS item API', () => {
  it('requires authentication for items', async () => {
    const { request, db } = await setup();
    expect((await request('/v1/items', false)).status).toBe(401);
    expect(db.list).not.toHaveBeenCalled();
  });

  it('reports readiness failure without exposing database errors', async () => {
    const { request, db } = await setup();
    db.ready.mockRejectedValue(new Error('secret connection string'));
    const response = await request('/health/ready', false);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });

  it.each(['limit=101', 'cursor=invalid', 'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z'])('rejects invalid pagination or filters: %s', async query => {
    const { request, db } = await setup();
    expect((await request('/v1/items?' + query)).status).toBe(400);
    expect(db.list).not.toHaveBeenCalled();
  });

  it('returns and accepts a cursor without returning the look-ahead row', async () => {
    const { request, db } = await setup();
    const item = { item_id: 'test-item', published_at: '2026-01-01T00:00:00Z', content_revision: 1n };
    db.list.mockResolvedValueOnce([item, item]);
    const page = await (await request('/v1/items?limit=1')).json();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    await request('/v1/items?cursor=' + page.nextCursor);
    expect(db.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: expect.objectContaining({ time: item.published_at, id: item.item_id }) }));
  });

  it('returns 404 for an unknown item', async () => {
    const { request } = await setup();
    expect((await request('/v1/items/11111111-1111-4111-8111-111111111111')).status).toBe(404);
  });

  it('returns full item with all properties and relations', async () => {
    const { request, db } = await setup();
    const fullItem = {
      item_id: 'item-123',
      reality_id: 0,
      platform: 'telegram',
      native_id: 'n-123',
      url: 'https://t.me/c/1',
      item_type: 'post',
      schema_version: 'item.v1',
      source_id: 'ch-1',
      author_id: 'auth-1',
      author_name_raw: 'Author',
      published_at: '2026-01-01T00:00:00Z',
      published_at_source: 'platform',
      edited_at: null,
      collected_at: '2026-01-01T00:00:00Z',
      title: 'Title',
      content_text: 'Body text',
      lang: 'en',
      lang_confidence: 0.99,
      lang_platform: null,
      hashtags: ['news'],
      mentions: [],
      links: [],
      is_sensitive: false,
      reply_to_item_id: null,
      conversation_id: null,
      quoted_item_id: null,
      shared_from_item_id: null,
      shared_from_source: null,
      content_hash: 'hash-1',
      simhash: 123456789n,
      dup_of: null,
      deleted_at: null,
      collector: 'c',
      provider: 'p',
      raw_uri: null,
      platform_extra: {},
      last_seen_at: '2026-01-01T00:00:00Z',
      current_event_id: 'e1',
      content_revision: 1n,
      media: [{ item_id: 'item-123', position: 0, media_type: 'image', media_url: 'https://example.com/pic.jpg' }],
      topics: [{ item_id: 'item-123', topic_id: 'geopolitics', name: 'Geopolitics', description: 'World events', score: 0.9, content_revision: 1n }],
      locations: [{ item_id: 'item-123', place_id: 'loc-1', geo_kind: 'geotag', surface_form: 'London', confidence: 0.95, canonical_name: 'London', country: 'GB' }],
      entities: [{ item_id: 'item-123', entity_id: 'ent-1', surface_form: 'NATO', canonical_name: 'NATO', type: 'ORG', country: null }],
      queries: [{ item_id: 'item-123', query_id: 'q-1', matched_at: '2026-01-01T00:00:00Z', query_text: 'breaking', description: null }],
      classification: { item_id: 'item-123', model: 'm1', prompt_version: 'v1', relevance: 0.8, misinfo_score: 0.1, sentiment: 'neutral', summary_en: 'Summary' },
      engagement: { item_id: 'item-123', captured_at: '2026-01-01T00:00:00Z', views: 500n, likes: 50n, provider: 'telegram' },
      author: { author_id: 'auth-1', display_name: 'News Outlet', handle: 'news', verified: true, followers: 10000n },
      source: { source_id: 'ch-1', platform: 'telegram', display_name: 'Channel 1', arena: 'IL', tier: 'watchlist' },
      reality: { reality_id: 0, name: 'Operational', description: 'Live' },
      platformInfo: { platform: 'telegram', display_name: 'Telegram' },
      embeddings: [{ item_id: 'item-123', model: 'text-embedding', embedded_at: '2026-01-01T00:00:00Z', content_revision: 1n }],
      relations: { duplicateOf: null, replyTo: null, quoted: null, sharedFrom: null, replies: [], duplicates: [] },
    };
    db.get.mockResolvedValueOnce(fullItem);
    const res = await request('/v1/items/item-123');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item_id).toBe('item-123');
    expect(body.author.display_name).toBe('News Outlet');
    expect(body.source.display_name).toBe('Channel 1');
    expect(body.topics[0].name).toBe('Geopolitics');
    expect(body.media[0].media_url).toBe('https://example.com/pic.jpg');
    expect(body.engagement.views).toBe('500');
    expect(body.simhash).toBe('123456789');
  });

  it('fetches media, thread, and related items', async () => {
    const { request, db } = await setup();
    db.getItemMedia.mockResolvedValueOnce([{ position: 0, media_type: 'video' }]);
    db.getItemThread.mockResolvedValueOnce({ current: { item_id: 'it-1' }, parent: null, replies: [] });
    db.getItemRelated.mockResolvedValueOnce({ duplicates: [], quotes: [], shares: [] });

    expect(await (await request('/v1/items/it-1/media')).json()).toEqual([{ position: 0, media_type: 'video' }]);
    expect((await (await request('/v1/items/it-1/thread')).json()).current.item_id).toBe('it-1');
    expect((await (await request('/v1/items/it-1/related')).json()).duplicates).toEqual([]);
  });

  it('exposes sources listing, get, and items', async () => {
    const { request, db } = await setup();
    db.listSources.mockResolvedValueOnce([{ source_id: 'src-1', platform: 'telegram' }]);
    db.getSource.mockResolvedValueOnce({ source_id: 'src-1', platform: 'telegram', display_name: 'Source 1' });
    db.getSourceItems.mockResolvedValueOnce([{ item_id: 'it-1', source_id: 'src-1' }]);

    const list = await (await request('/v1/sources')).json();
    expect(list.sources).toHaveLength(1);

    const get = await (await request('/v1/sources/src-1')).json();
    expect(get.display_name).toBe('Source 1');

    const items = await (await request('/v1/sources/src-1/items')).json();
    expect(items.items).toHaveLength(1);
  });

  it('exposes authors listing, get, and items', async () => {
    const { request, db } = await setup();
    db.listAuthors.mockResolvedValueOnce([{ author_id: 'auth-1', platform: 'telegram' }]);
    db.getAuthor.mockResolvedValueOnce({ author_id: 'auth-1', display_name: 'Author 1' });
    db.getAuthorItems.mockResolvedValueOnce([{ item_id: 'it-1', author_id: 'auth-1' }]);

    const list = await (await request('/v1/authors')).json();
    expect(list.authors).toHaveLength(1);

    const get = await (await request('/v1/authors/auth-1')).json();
    expect(get.display_name).toBe('Author 1');

    const items = await (await request('/v1/authors/auth-1/items')).json();
    expect(items.items).toHaveLength(1);
  });

  it('exposes platforms and realities routes', async () => {
    const { request, db } = await setup();
    db.listPlatforms.mockResolvedValueOnce([{ platform: 'telegram', display_name: 'Telegram' }]);
    db.getPlatform.mockResolvedValueOnce({ platform: 'telegram', display_name: 'Telegram' });
    db.listRealities.mockResolvedValueOnce([{ reality_id: 0, name: 'Operational' }]);
    db.getReality.mockResolvedValueOnce({ reality_id: 0, name: 'Operational' });

    expect((await (await request('/v1/platforms')).json()).platforms).toHaveLength(1);
    expect((await (await request('/v1/platforms/telegram')).json()).display_name).toBe('Telegram');
    expect((await (await request('/v1/realities')).json()).realities).toHaveLength(1);
    expect((await (await request('/v1/realities/0')).json()).name).toBe('Operational');
  });

  it('exposes topics and entities routes', async () => {
    const { request, db } = await setup();
    db.listTopics.mockResolvedValueOnce([{ topic_id: 'news', name: 'News' }]);
    db.getTopic.mockResolvedValueOnce({ topic_id: 'news', name: 'News' });
    db.getTopicItems.mockResolvedValueOnce([{ item_id: 'it-1' }]);
    db.listEntities.mockResolvedValueOnce([{ entity_id: 'e-1', canonical_name: 'Entity 1' }]);
    db.getEntity.mockResolvedValueOnce({ entity_id: 'e-1', canonical_name: 'Entity 1' });
    db.getEntityItems.mockResolvedValueOnce([{ item_id: 'it-1' }]);

    expect((await (await request('/v1/topics')).json()).topics).toHaveLength(1);
    expect((await (await request('/v1/topics/news')).json()).name).toBe('News');
    expect((await (await request('/v1/topics/news/items')).json()).items).toHaveLength(1);
    expect((await (await request('/v1/entities')).json()).entities).toHaveLength(1);
    expect((await (await request('/v1/entities/e-1')).json()).canonical_name).toBe('Entity 1');
    expect((await (await request('/v1/entities/e-1/items')).json()).items).toHaveLength(1);
  });

  it('exposes queries and stats overview routes', async () => {
    const { request, db } = await setup();
    db.listQueries.mockResolvedValueOnce([{ query_id: 'q-1', query_text: 'nexus' }]);
    db.getQuery.mockResolvedValueOnce({ query_id: 'q-1', query_text: 'nexus' });
    db.getStats.mockResolvedValueOnce({ realityId: 0, itemsCount: 42, sourcesCount: 5, authorsCount: 10, platforms: [{ platform: 'telegram', count: 42 }] });

    expect((await (await request('/v1/queries')).json()).queries).toHaveLength(1);
    expect((await (await request('/v1/queries/q-1')).json()).query_text).toBe('nexus');
    const stats = await (await request('/v1/stats/overview')).json();
    expect(stats.itemsCount).toBe(42);
    expect(stats.platforms[0].platform).toBe('telegram');
  });

  it.each([
    '/v1/sources',
    '/v1/authors',
    '/v1/platforms',
    '/v1/realities',
    '/v1/topics',
    '/v1/entities',
    '/v1/queries',
    '/v1/stats/overview',
  ])('protects %s with Bearer authentication', async path => {
    const { request } = await setup();
    expect((await request(path, false)).status).toBe(401);
  });

  it('closes the database through the NestJS shutdown lifecycle', async () => {
    const closeDatabase = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(repo(), token, { closeDatabase });
    await app.init();
    await app.close();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });
});
