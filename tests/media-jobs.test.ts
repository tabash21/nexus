import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  backfillMediaJobs,
  checkpointMediaArchive,
  claimMediaJobs,
  failMediaJob,
  finishMediaJob,
  ingest,
  itemSchema,
  renewMediaJob,
  retryMediaJob,
  isMediaClaimActive,
} from '@nexus/database';
import { hash, itemIdentity, type OsintEvent } from '@nexus/contracts';
import { createItemTestDatabase } from './helpers/item-database.js';
import { event } from './fixtures.js';
import { buildMediaEnrichmentInput } from '../apps/enrichment-worker/src/media/enrichment-input.js';

let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
let offset = 0;
beforeAll(async () => {
  f = await createItemTestDatabase();
}, 120000);
afterAll(async () => {
  await f?.pg.close();
});
beforeEach(async () => {
  await f.db.delete(itemSchema.mediaJobs);
});
function observation(): OsintEvent {
  const e = event();
  return {
    ...e,
    item: { ...e.item, nativeId: randomUUID(), text: 'Original post' },
    media: [{ index: 0, type: 'image', url: 'https://media.example/a.png' }],
    mediaComplete: true,
  };
}
async function save(e: OsintEvent) {
  return ingest(
    f.db,
    e,
    { streamId: 'media-test', topic: 'items.silver', partition: 0, offset: String(offset++) },
    hash(e),
    's3://test/raw',
  );
}
async function current(e: OsintEvent) {
  return (
    await f.db
      .select()
      .from(itemSchema.itemMedia)
      .where(eq(itemSchema.itemMedia.item_id, itemIdentity(e).itemId))
  )[0]!;
}

describe('durable attachment jobs', () => {
  it('schedules from silver atomically, deduplicates replay, and preserves identical media', async () => {
    const e = observation();
    await save(e);
    await save(e);
    expect(await f.db.select().from(itemSchema.mediaJobs)).toHaveLength(1);
    const [job] = await claimMediaJobs(f.db);
    expect(await checkpointMediaArchive(f.db, job!, 's3://test/media/object')).toBe('accepted');
    expect(await finishMediaJob(f.db, job!, 'Visible text')).toBe('accepted');
    const before = await current(e);
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z' });
    expect(await current(e)).toEqual(before);
    expect(
      (await f.db.select().from(itemSchema.item).where(eq(itemSchema.item.item_id, before.item_id)))[0]?.content_text,
    ).toBe('Original post');
  });

  it('rejects old OCR and archive writes when media changes without a text revision', async () => {
    const e = observation();
    await save(e);
    const [job] = await claimMediaJobs(f.db);
    await save({
      ...e,
      eventId: randomUUID(),
      observedAt: '2026-01-03T00:00:00Z',
      media: [{ index: 0, type: 'image', url: 'https://media.example/b.png' }],
    });
    expect(await checkpointMediaArchive(f.db, job!, 's3://test/old')).toBe('stale');
    expect(await finishMediaJob(f.db, job!, 'Old text')).toBe('lost');
    expect((await current(e)).ocr_text).toBeNull();
    expect((await current(e)).s3_uri).toBeNull();
    expect(
      (await f.db.select().from(itemSchema.item).where(eq(itemSchema.item.item_id, job!.item_id)))[0]?.content_revision,
    ).toBe(1n);
  });

  it('rejects removed and re-added attachments even when their URL is identical', async () => {
    const e = observation();
    await save(e);
    const [job] = await claimMediaJobs(f.db);
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z', media: [] });
    await save({ ...e, eventId: randomUUID(), observedAt: '2026-01-04T00:00:00Z' });
    expect((await current(e)).attachment_generation).not.toBe(job!.attachment_generation);
    expect(await finishMediaJob(f.db, job!, 'Stale')).toBe('stale');
  });

  it('fences expired claims and allows a new owner to recover', async () => {
    const e = observation();
    await save(e);
    const [old] = await claimMediaJobs(f.db);
    expect(await isMediaClaimActive(f.db, old!.job_id, old!.claim_token)).toBe(true);
    await f.db.update(itemSchema.mediaJobs).set({ lease_until: sql`now() - interval '1 second'` });
    expect(await renewMediaJob(f.db, old!)).toBe(false);
    expect(await isMediaClaimActive(f.db, old!.job_id, old!.claim_token)).toBe(false);
    const [next] = await claimMediaJobs(f.db);
    expect(next!.claim_token).not.toBe(old!.claim_token);
    expect(await finishMediaJob(f.db, old!, 'Wrong owner')).toBe('lost');
    expect(await finishMediaJob(f.db, next!, '')).toBe('accepted');
    expect((await current(e)).ocr_text).toBe('');
    expect((await f.db.select().from(itemSchema.mediaJobs))[0]?.outcome).toBe('no_text');
  });

  it('retains archive checkpoints across retries and bounds attempts', async () => {
    const e = observation();
    await save(e);
    let [job] = await claimMediaJobs(f.db);
    await checkpointMediaArchive(f.db, job!, 's3://test/archived');
    await failMediaJob(f.db, job!, { outcome: 'transient', retryable: true });
    await f.db.update(itemSchema.mediaJobs).set({ next_run_at: sql`now()` });
    [job] = await claimMediaJobs(f.db);
    expect(job?.archive_uri).toBe('s3://test/archived');
    await f.db.update(itemSchema.mediaJobs).set({ max_attempts: 2 });
    await failMediaJob(f.db, { ...job!, max_attempts: 2 }, { outcome: 'timeout', retryable: true });
    expect(await claimMediaJobs(f.db)).toEqual([]);
    expect(await retryMediaJob(f.db, job!.job_id)).toBe(true);
  });

  it('backfills current attachments without legacy snapshots and is idempotent', async () => {
    const e = observation();
    await save(e);
    await f.db.delete(itemSchema.mediaJobs);
    expect(await backfillMediaJobs(f.db)).toBeGreaterThan(0);
    expect(await backfillMediaJobs(f.db)).toBe(0);
  });

  it('hashes OCR input changes without modifying the original post', async () => {
    const e = observation();
    await save(e);
    const item = { title: null, content_text: e.item.text, content_revision: 1n };
    const before = buildMediaEnrichmentInput(item, [await current(e)]);
    const [job] = await claimMediaJobs(f.db);
    await finishMediaJob(f.db, job!, 'OCR evidence');
    const after = buildMediaEnrichmentInput(item, [await current(e)]);
    expect(after.originalText).toBe(e.item.text);
    expect(after.combinedText).toContain('[Attachment 0]\nOCR evidence');
    expect(after.inputHash).not.toBe(before.inputHash);
  });

  it('rolls back scheduled work when the ingestion transaction fails later', async () => {
    const e = { ...observation(), queryIds: ['unregistered-query'] };
    await expect(save(e)).rejects.toThrow();
    expect(await f.db.select().from(itemSchema.mediaJobs)).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(itemSchema.itemMedia)
        .where(eq(itemSchema.itemMedia.item_id, itemIdentity(e).itemId)),
    ).toHaveLength(0);
  });
});
