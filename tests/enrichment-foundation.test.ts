import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import avro from 'avsc';
import { GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hash, itemIdentity } from '@nexus/contracts';
import type { SourceSubscription } from '@nexus/contracts';
import { backfillProcessor, claimJobs, completeJob, failJob, ingest, itemRepository, retryJob, type createPool } from '@nexus/database';
import { archiveCoordinates, reconcileArchive } from '../apps/enrichment-worker/src/archive.js';
import { testProcessor } from '../apps/enrichment-worker/src/processors.js';
import { adapt, deterministicEventId } from '../apps/worker/src/adapters/index.js';
import { event, delivery } from './fixtures.js';
import { createItemTestDatabase } from './helpers/item-database.js';

let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { f = await createItemTestDatabase(); }, 120000);
beforeEach(async () => { await f.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE'); });
afterAll(async () => { await f?.pg.close(); });

function bridge(): ReturnType<typeof createPool> {
  const query = async (statement: string, values?: unknown[]) => {
    const result = await f.pg.query<Record<string, unknown>>(statement, values);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  return { query, connect: async () => ({ query, release: () => undefined }) } as unknown as ReturnType<typeof createPool>;
}

async function avroBytes(bytes: Buffer[]): Promise<Buffer> {
  const encoder = new avro.streams.BlockEncoder(avro.Type.forSchema('bytes'));
  const chunks: Buffer[] = [];
  encoder.on('data', (chunk: Buffer) => chunks.push(chunk));
  for (const record of bytes) encoder.write(record);
  encoder.end();
  await new Promise<void>((resolve, reject) => { encoder.on('end', resolve); encoder.on('error', reject); });
  return Buffer.concat(chunks);
}

describe('enrichment foundation', () => {
  it('commits one item and equivalent job on redelivery, before any archive object exists', async () => {
    const e = event();
    const raw = Buffer.from(JSON.stringify(e));
    const first = { ...delivery('0'), value: raw };
    await ingest(f.db, e, first, hash(e));
    await ingest(f.db, e, first, hash(e));
    const second = { ...delivery('1'), value: raw };
    await ingest(f.db, e, second, hash(e));
    expect((await f.pg.query('SELECT * FROM core.item')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.enrichment_jobs')).rows).toHaveLength(1);
    expect((await f.pg.query('SELECT * FROM ingest.delivery_snapshots')).rows).toHaveLength(2);
    const snapshots = await f.pg.query<{ raw_bytes: Uint8Array }>('SELECT raw_bytes FROM ingest.input_snapshots');
    expect(Buffer.from(snapshots.rows[0]!.raw_bytes)).toEqual(raw);
    const archive = await f.pg.query<{ raw_uri: string | null }>('SELECT raw_uri FROM core.item');
    expect(archive.rows[0]?.raw_uri).toBeNull();
  });

  it('creates a new revision and job for a newer changed observation, while hiding prior results', async () => {
    const first = event();
    await ingest(f.db, first, delivery('0'), hash(first));
    const itemId = itemIdentity(first).itemId;
    const oldJob = await f.pg.query<{ job_id: string; input_hash: string }>('SELECT job_id,input_hash FROM ingest.enrichment_jobs');
    await f.pg.query(`INSERT INTO ingest.enrichment_results
      (job_id,item_id,content_revision,job_type,processor_version,input_hash,result)
      VALUES ($1,$2,1,'test','test.v1',$3,'{"marker":"old"}')`,
    [oldJob.rows[0]!.job_id, itemId, oldJob.rows[0]!.input_hash]);
    await f.pg.query("UPDATE ingest.enrichment_jobs SET status='succeeded' WHERE job_id=$1", [oldJob.rows[0]!.job_id]);
    const newer = { ...first, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z',
      item: { ...first.item, text: 'Updated Telegram text' } };
    await ingest(f.db, newer, delivery('1'), hash(newer));
    const older = { ...first, eventId: randomUUID(), observedAt: '2026-01-01T00:00:00Z',
      item: { ...first.item, text: 'Late old text' } };
    await ingest(f.db, older, delivery('2'), hash(older));
    const rows = await f.pg.query<{ current_event_id: string; content_revision: string }>('SELECT current_event_id,content_revision FROM core.item');
    expect(rows.rows[0]?.current_event_id).toBe(newer.eventId);
    expect(Number(rows.rows[0]?.content_revision)).toBe(2);
    const visible = await itemRepository(f.db).getItemEnrichment(itemId, 0);
    expect(visible).toHaveLength(1);
    expect(visible?.[0]?.result).toBeNull();
  });

  it('queues title-only changes but not newer engagement or media metadata', async () => {
    const first = event();
    await ingest(f.db, first, delivery('0'), hash(first));
    const engagement = { ...first, eventId: randomUUID(), observedAt: '2026-01-03T00:00:00Z',
      engagement: { views: '20' }, media: [{ index: 0, type: 'image' as const }] };
    await ingest(f.db, engagement, delivery('1'), hash(engagement));
    expect((await f.pg.query('SELECT * FROM ingest.enrichment_jobs')).rows).toHaveLength(1);
    const title = { ...engagement, eventId: randomUUID(), observedAt: '2026-01-04T00:00:00Z',
      item: { ...first.item, title: 'Changed title' } };
    await ingest(f.db, title, delivery('2'), hash(title));
    expect((await f.pg.query('SELECT * FROM ingest.enrichment_jobs')).rows).toHaveLength(2);
    expect((await f.pg.query<{ content_revision: number }>('SELECT content_revision FROM core.item')).rows[0]?.content_revision).toBe(2);
  });

  it('refuses a result after the claim lease expires', async () => {
    const e = event(); await ingest(f.db, e, delivery(), hash(e));
    const pool = bridge();
    const [job] = await claimJobs(pool, 1);
    expect(job).toBeDefined();
    await f.pg.query("UPDATE ingest.enrichment_jobs SET lease_until=now()-interval '1 second' WHERE job_id=$1", [job!.job_id]);
    expect(await completeJob(pool, job!, { values: { stale: true } })).toBe('lost');
    expect((await f.pg.query('SELECT * FROM ingest.enrichment_results')).rows).toHaveLength(0);
  });

  it('exposes the test processor as a diagnostic, not an analysis result', async () => {
    const e = event(); await ingest(f.db, e, delivery(), hash(e));
    const [job] = (await claimJobs(bridge(), 1));
    expect(job).toBeDefined();
    const output = await testProcessor.process({ job: job!, signal: new AbortController().signal });
    await f.pg.query(`INSERT INTO ingest.enrichment_results
      (job_id,item_id,content_revision,job_type,processor_version,input_hash,result)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [job!.job_id, job!.item_id, job!.content_revision,
      job!.job_type, job!.processor_version, job!.input_hash, JSON.stringify(output.values)]);
    await f.pg.query("UPDATE ingest.enrichment_jobs SET status='succeeded' WHERE job_id=$1", [job!.job_id]);
    const [visible] = (await itemRepository(f.db).getItemEnrichment(itemIdentity(e).itemId, 0)) ?? [];
    expect(visible?.result).toBeNull();
    expect(visible?.diagnostic).toMatchObject({ kind: 'lifecycle-diagnostic', inputHash: job!.input_hash });
  });

  it('exposes exhausted failures, supports manual retry and idempotent version backfill', async () => {
    const e = event(); await ingest(f.db, e, delivery(), hash(e));
    await f.pg.query('UPDATE ingest.enrichment_jobs SET max_attempts=1');
    const pool = bridge();
    const [job] = await claimJobs(pool, 1);
    expect(await failJob(pool, job!, 'missing source credential')).toBe(true);
    const failed = await f.pg.query<{ status: string; last_error: string }>('SELECT status,last_error FROM ingest.enrichment_jobs');
    expect(failed.rows[0]).toMatchObject({ status: 'failed', last_error: 'missing source credential' });
    expect(await retryJob(pool, job!.job_id)).toBe(true);
    expect(await backfillProcessor(pool, 'test', 'test.v2')).toBe(1);
    expect(await backfillProcessor(pool, 'test', 'test.v2')).toBe(0);
  });

  it('preserves historical Telegram identity and only edits text with a strictly newer editDate', async () => {
    const source: SourceSubscription = { platform: 'telegram', topic: 'raw.telegram.v1',
      groupId: 'test', mode: 'real', realityId: 0, adapter: 'telegram.v1' };
    const nativeId = '7123';
    const raw = { className: 'Message', peerId: { channelId: '42', className: 'PeerChannel' },
      id: Number(nativeId), date: 1791958850, message: 'Headline\nOriginal body', views: 1,
      media: { className: 'MessageMediaPhoto' } };
    const saveRaw = async (value: typeof raw & { editDate?: number }, offset: string, legacy = false) => {
      const adapted = adapt(value, source);
      const e = legacy ? { ...adapted, eventId: deterministicEventId('telegram', '42', nativeId) } : adapted;
      const transport = { ...delivery(offset), value: Buffer.from(JSON.stringify(value)) };
      await ingest(f.db, e, transport, hash(value));
      return e;
    };
    const first = await saveRaw(raw, '10', true);
    const replay = await saveRaw(raw, '11');
    expect(replay.eventId).not.toBe(first.eventId);
    expect((await f.pg.query('SELECT event_id FROM ingest.ingest_events')).rows).toEqual([{ event_id: first.eventId }]);
    expect((await f.pg.query('SELECT * FROM ingest.enrichment_jobs')).rows).toHaveLength(1);
    const edited = await saveRaw({ ...raw, message: 'New headline\nEdited body', editDate: raw.date + 20 }, '12');
    await saveRaw({ ...raw, views: 5, message: 'New headline\nEdited body', editDate: raw.date + 20 }, '13');
    await saveRaw({ ...raw, message: 'Ambiguous edit', editDate: raw.date + 20 }, '14');
    await saveRaw({ ...raw, message: 'Older edit', editDate: raw.date + 10 }, '15');
    await saveRaw({ ...raw, message: 'Missing edit time' }, '16');
    const [item] = (await f.pg.query<{ content_text: string; title: string; current_event_id: string; content_revision: number }>(
      'SELECT content_text,title,current_event_id,content_revision FROM core.item')).rows;
    expect(item).toMatchObject({ content_text: 'New headline\nEdited body', title: 'New headline',
      current_event_id: edited.eventId, content_revision: 2 });
    expect((await f.pg.query('SELECT * FROM ingest.enrichment_jobs')).rows).toHaveLength(2);
    expect((await f.pg.query('SELECT * FROM ingest.delivery_snapshots')).rows).toHaveLength(7);
    expect((await f.pg.query('SELECT * FROM core.item_media')).rows).toHaveLength(1);
  });

  it('links an exact archived Avro record and rejects changed bytes', async () => {
    const e = event();
    const raw = Buffer.from(JSON.stringify(e));
    const transport = { ...delivery('42'), value: raw };
    await ingest(f.db, e, transport, hash(e));
    const second = { ...e, eventId: randomUUID(), observedAt: '2026-01-01T00:00:00Z' };
    const secondTransport = { ...delivery('43'), value: Buffer.from(JSON.stringify(second)) };
    await ingest(f.db, second, secondTransport, hash(second));
    const key = 'raw/raw.telegram.v1/partition=0/raw.telegram.v1+0+0000000042.avro';
    expect(archiveCoordinates(key)).toEqual({ topic: 'raw.telegram.v1', partition: 0, startOffset: 42n });
    const object = await avroBytes([raw, Buffer.from('incorrect archive bytes')]);
    const s3 = { send: async (command: unknown) => command instanceof ListObjectsV2Command
      ? { Contents: [{ Key: key, LastModified: new Date(0) }] }
      : command instanceof GetObjectCommand
        ? { Body: Readable.from([object]), VersionId: 'version-1' }
        : Promise.reject(new Error('Unexpected S3 call')) } as unknown as S3Client;
    expect(await reconcileArchive(bridge(), s3, 'nexus-raw', 0)).toEqual({ scanned: 2, linked: 1, mismatched: 1 });
    const linked = await f.pg.query<{ raw_uri: string }>('SELECT raw_uri FROM core.item');
    expect(linked.rows[0]?.raw_uri).toContain('versionId=version-1#record=0');
    expect((await f.pg.query('SELECT * FROM ingest.archive_links')).rows).toHaveLength(1);
  });
});
