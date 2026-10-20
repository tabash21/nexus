import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { ingest, itemRepository, itemSchema } from '@nexus/database';
// Exercise the compiled NestJS decorators with the real embedded database repository.
import { buildApp } from '../apps/api/dist/app.js';
import { createItemTestDatabase } from './helpers/item-database.js';
import { delivery, event } from './fixtures.js';

const populated = {
  eng_translation: 'A report about Jerusalem',
  heb_translation: 'דיווח על ירושלים',
  heb_summary: 'תקציר בעברית',
  original_lang: 'ar',
};
const empty = { eng_translation: null, heb_translation: null, heb_summary: null, original_lang: null };
const token = 'language-test-token-at-least-24-characters';
let fixture: Awaited<ReturnType<typeof createItemTestDatabase>>;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let baseUrl: string;

beforeAll(async () => {
  fixture = await createItemTestDatabase();
  app = await buildApp(itemRepository(fixture.db), token);
  await app.listen(0, '127.0.0.1');
  baseUrl = 'http://127.0.0.1:' + (app.getHttpServer().address() as AddressInfo).port;
}, 120000);
beforeEach(async () => {
  await fixture.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE');
});
afterAll(async () => {
  await app?.close();
  await fixture?.pg.close();
});

const save = (observation: OsintEvent, offset = '0') =>
  ingest(fixture.db, observation, delivery(offset), hash(observation));
const current = async (id: string) =>
  (await fixture.db.select().from(itemSchema.item).where(eq(itemSchema.item.item_id, id)))[0];
async function request(path: string): Promise<unknown> {
  const response = await fetch(baseUrl + path, { headers: { authorization: 'Bearer ' + token } });
  expect(response.status, path).toBe(200);
  return response.json();
}

describe('Item language foundation', () => {
  it.each([empty, populated])(
    'serves stored language properties through database-backed HTTP routes: %j',
    async values => {
      const observation = event();
      observation.author = { id: 'language-author' };
      observation.item.text = 'تقرير عن القدس';
      observation.item.language = 'ar';
      await save(observation);
      const identity = itemIdentity(observation);
      await fixture.db.update(itemSchema.item).set(values).where(eq(itemSchema.item.item_id, identity.itemId));
      await fixture.db.insert(itemSchema.classification).values({
        item_id: identity.itemId,
        model: 'stored-model',
        prompt_version: '1',
        classified_at: observation.observedAt,
        content_revision: 1n,
        summary_en: 'Existing English summary',
      });
      await fixture.db
        .insert(itemSchema.topic)
        .values({ topic_id: 'language-test', name: 'Language test' })
        .onConflictDoNothing();
      await fixture.db.insert(itemSchema.itemTopic).values({
        item_id: identity.itemId,
        topic_id: 'language-test',
        score: 1,
        content_revision: 1n,
      });
      await fixture.db
        .insert(itemSchema.entity)
        .values({
          entity_id: 'language-place',
          reality_id: 0,
          type: 'ORG',
          canonical_name: 'Language organization',
        })
        .onConflictDoNothing();
      await fixture.db.insert(itemSchema.itemEntity).values({
        item_id: identity.itemId,
        entity_id: 'language-place',
        surface_form: 'Language organization',
        reality_id: 0,
        content_revision: 1n,
      });

      expect(await current(identity.itemId)).toMatchObject({ ...values, content_text: observation.item.text });
      const view = await fixture.pg.query(
        'SELECT eng_translation,heb_translation,heb_summary,original_lang FROM core.item_ds WHERE item_id=$1',
        [identity.itemId],
      );
      expect(view.rows).toEqual([values]);
      for (const path of [
        '/v1/items',
        '/v1/items?full=true',
        '/v1/sources/' + identity.sourceId + '/items',
        '/v1/authors/' + identity.authorId + '/items',
        '/v1/topics/language-test/items',
        '/v1/entities/language-place/items',
      ]) {
        expect(await request(path)).toMatchObject({ items: [expect.objectContaining(values)] });
      }
      expect(await request('/v1/items/' + identity.itemId)).toMatchObject({
        ...values,
        content_text: observation.item.text,
        classification: { summary_en: 'Existing English summary' },
      });
      expect(await request('/v1/items?ids=' + identity.itemId)).toMatchObject([values]);

      const related = { ...observation, eventId: randomUUID(), item: { ...observation.item, nativeId: 'related' } };
      await save(related, '1');
      await fixture.db
        .update(itemSchema.item)
        .set({
          ...values,
          reply_to_item_id: identity.itemId,
          quoted_item_id: identity.itemId,
          shared_from_item_id: identity.itemId,
          dup_of: identity.itemId,
        })
        .where(eq(itemSchema.item.item_id, itemIdentity(related).itemId));
      expect(await request('/v1/items/' + identity.itemId + '/thread')).toMatchObject({
        current: values,
        replies: [values],
      });
      expect(await request('/v1/items/' + identity.itemId + '/related')).toMatchObject({
        duplicates: [values],
        quotes: [values],
        shares: [values],
      });
    },
  );

  it('leaves language enrichment unknown even when the source reports a language', async () => {
    const observation = event();
    observation.item.language = 'he';
    await save(observation);
    expect(await current(itemIdentity(observation).itemId)).toMatchObject({
      ...empty,
      lang: null,
      lang_platform: 'he',
    });
  });

  it('preserves enriched values on replay, stale observations, and engagement-only updates', async () => {
    const observation = event();
    await save(observation);
    const id = itemIdentity(observation).itemId;
    await fixture.db.update(itemSchema.item).set(populated).where(eq(itemSchema.item.item_id, id));
    expect(await save(observation, '1')).toEqual({ duplicate: true });
    await save(
      {
        ...observation,
        eventId: randomUUID(),
        observedAt: '2026-01-01T00:00:00Z',
        item: { ...observation.item, text: 'Stale text' },
      },
      '2',
    );
    expect(await current(id)).toMatchObject({
      ...populated,
      content_revision: 1n,
      content_text: observation.item.text,
    });
    await save(
      { ...observation, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z', engagement: { views: '42' } },
      '3',
    );
    expect(await current(id)).toMatchObject({ ...populated, content_revision: 1n });
    expect(await fixture.db.select().from(itemSchema.processingReceipts)).toHaveLength(3);
    expect(await fixture.db.select().from(itemSchema.deliveries)).toHaveLength(4);
  });

  it.each(['text', 'title'] as const)('clears outdated values on an ingested %s edit', async field => {
    const observation = event();
    await save(observation);
    const id = itemIdentity(observation).itemId;
    await fixture.db.update(itemSchema.item).set(populated).where(eq(itemSchema.item.item_id, id));
    await save(
      {
        ...observation,
        eventId: randomUUID(),
        observedAt: '2026-01-03T00:00:00Z',
        item: { ...observation.item, [field]: 'Edited content' },
      },
      '1',
    );
    expect(await current(id)).toMatchObject({ ...empty, content_revision: 2n });
    expect(await request('/v1/items/' + id)).toMatchObject(empty);
  });

  it.each(['content_text', 'title'] as const)('enforces invalidation for direct database %s edits too', async field => {
    const observation = event();
    await save(observation);
    const id = itemIdentity(observation).itemId;
    await fixture.db.update(itemSchema.item).set(populated).where(eq(itemSchema.item.item_id, id));
    await expect(
      fixture.db
        .update(itemSchema.item)
        .set({ [field]: 'Edited content' })
        .where(eq(itemSchema.item.item_id, id)),
    ).rejects.toThrow();
    expect(await current(id)).toMatchObject(populated);
    await fixture.db
      .update(itemSchema.item)
      .set({ [field]: 'Edited content', content_revision: 2n })
      .where(eq(itemSchema.item.item_id, id));
    expect(await current(id)).toMatchObject({ ...empty, content_revision: 2n });
  });
});
