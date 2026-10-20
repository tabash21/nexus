import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  checkpointMediaArchive,
  claimMediaJobs,
  createItemDatabase,
  finishMediaJob,
  ingest,
  itemSchema,
  renewMediaJob,
} from '@nexus/database';
import { hash } from '@nexus/contracts';
import { event } from './fixtures.js';
import { disposablePostgres } from './helpers/postgres.js';

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL)('real PostgreSQL media job concurrency', () => {
  let f: Awaited<ReturnType<typeof disposablePostgres>>;
  let db: ReturnType<typeof createItemDatabase>;
  beforeAll(async () => {
    f = await disposablePostgres(process.env.INTEGRATION_DATABASE_URL!);
    db = createItemDatabase(f.pool);
  }, 120000);
  afterAll(async () => {
    await f?.close();
  });

  it('claims disjoint jobs concurrently and fences an expired worker after reclaim', async () => {
    const e = {
      ...event(),
      item: { ...event().item, nativeId: randomUUID() },
      media: [0, 1].map(index => ({ index, type: 'image' as const, url: `https://media.example/${index}.png` })),
    };
    await ingest(
      db,
      e,
      { streamId: 'test', topic: 'items.silver', partition: 0, offset: '0' },
      hash(e),
      's3://test/raw',
    );
    const [first, second] = await Promise.all([claimMediaJobs(db), claimMediaJobs(db)]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.job_id).not.toBe(second[0]!.job_id);
    await db.update(itemSchema.mediaJobs).set({ lease_until: sql`now() - interval '1 second'` });
    const recovered = await claimMediaJobs(db, 2);
    expect(recovered).toHaveLength(2);
    expect(await renewMediaJob(db, first[0]!)).toBe(false);
    expect(await finishMediaJob(db, first[0]!, 'Old claim')).toBe('lost');
    const completions = await Promise.all(recovered.map(job => finishMediaJob(db, job, 'Current claim')));
    expect(completions).toEqual(['accepted', 'accepted']);
  });

  it('serializes replacement ingestion against concurrent checkpoint and completion', async () => {
    const e = {
      ...event(),
      item: { ...event().item, nativeId: randomUUID() },
      mediaComplete: true,
      media: [{ index: 0, type: 'image' as const, url: 'https://media.example/old.png' }],
    };
    const delivery = { streamId: 'race', topic: 'items.silver', partition: 0, offset: '0' };
    await ingest(db, e, delivery, hash(e), 's3://test/raw');
    const [job] = await claimMediaJobs(db);
    let entered!: () => void;
    let release!: () => void;
    const hasReplacementLock = new Promise<void>(resolve => {
      entered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const replacement = {
      ...e,
      eventId: randomUUID(),
      observedAt: '2026-01-03T00:00:00Z',
      media: [{ index: 0, type: 'image' as const, url: 'https://media.example/new.png' }],
    };
    const replacing = db.transaction(async tx => {
      await ingest(tx, replacement, { ...delivery, offset: '1' }, hash(replacement), 's3://test/new-raw');
      entered();
      await gate;
    });
    try {
      await hasReplacementLock;
      const checkpoint = checkpointMediaArchive(db, job!, 's3://test/stale');
      const completion = finishMediaJob(db, job!, 'STALE TEXT');
      release();
      await replacing;
      expect((await Promise.all([checkpoint, completion])).sort()).toEqual(['lost', 'stale']);
      const [media] = await db
        .select()
        .from(itemSchema.itemMedia)
        .where(eq(itemSchema.itemMedia.item_id, job!.item_id));
      expect(media?.media_url).toContain('/new.png');
      expect(media?.ocr_text).toBeNull();
      expect(media?.s3_uri).toBeNull();
    } finally {
      release();
      await replacing;
    }
  });
});
