import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest } from '@nexus/database';
import { eventSchema, goldItemMessageSchema, hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { buildGoldMessage } from '../apps/enrichment-worker/src/gold.builder.js';
import { delivery, event } from './fixtures.js';
import { createItemTestDatabase } from './helpers/item-database.js';

let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { f = await createItemTestDatabase(); }, 120000);
beforeEach(async () => { await f.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE'); });
afterAll(async () => { await f?.pg.close(); });

const save = (e: OsintEvent, offset = '0') => ingest(f.db, e, delivery(offset), hash(e), `s3://test/raw/${offset}#L1`);
const observe = (base: OsintEvent, observedAt: string, text = base.item.text) =>
  eventSchema.parse({ ...base, eventId: randomUUID(), observedAt, item: { ...base.item, text } });

describe('gold.v1 projection of the committed item', () => {
  it('maps the stored core.item row into a valid gold envelope', async () => {
    const e = eventSchema.parse({ ...event(), item: { ...event().item, language: 'en', publishedAt: '2026-01-02T11:00:00+02:00' } });
    const gold = buildGoldMessage(await save(e));
    expect(goldItemMessageSchema.parse(gold)).toEqual(gold);
    expect(gold).toMatchObject({ stageVersion: 'gold.v1', eventId: e.eventId, item: {
      itemId: itemIdentity(e).itemId, realityId: 0, platform: 'telegram', title: 'Example', text: 'Example #OSINT text',
      langPlatform: 'en', contentRevision: '1', currentEventId: e.eventId, rawUri: 's3://test/raw/0#L1',
      publishedAt: '2026-01-02T09:00:00.000Z', publishedAtSource: 'platform', collectedAt: '2026-01-02T12:00:00.000Z',
    } });
  });
  it('returns the current item for duplicates so a missed publish can be recovered', async () => {
    const e = event();
    const first = await save(e);
    const redelivered = await save(e, '1');
    expect(redelivered.duplicate).toBe(true);
    expect(buildGoldMessage(redelivered)).toEqual(buildGoldMessage(first));
  });
  it('reflects engagement-only observations and content edits', async () => {
    const e = event();
    await save(e);
    const seenAgain = buildGoldMessage(await save(observe(e, '2026-01-02T13:00:00.000Z'), '1'));
    expect(seenAgain.item).toMatchObject({ contentRevision: '1', lastSeenAt: '2026-01-02T13:00:00.000Z' });
    const edited = buildGoldMessage(await save(observe(e, '2026-01-02T14:00:00.000Z', 'Edited text'), '2'));
    expect(edited.item).toMatchObject({ contentRevision: '2', text: 'Edited text' });
  });
});
