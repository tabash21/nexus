import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import avro from 'avsc';
import { gunzipSync } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Kafka } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash, itemIdentity } from '@nexus/contracts';
import { createItemDatabase, ingest } from '@nexus/database';
import { adapt, deterministicEventId } from '../apps/worker/src/adapters/index.js';
import { WorkerService, createResources as createWorkerResources } from '../apps/worker/dist/worker.service.js';
import { EnrichmentService } from '../apps/enrichment-worker/dist/enrichment.service.js';
import { createResources as createWriterResources } from '../apps/enrichment-worker/dist/resources.js';
import { event, collectorEvent } from './fixtures.js';
import { disposablePostgres } from './helpers/postgres.js';
import { createTestTopics } from './helpers/kafka.js';

const enabled = process.env.RUN_PIPELINE_INTEGRATION === 'true' && !!process.env.INTEGRATION_DATABASE_URL;
const brokers = (process.env.PIPELINE_KAFKA_BROKERS ?? 'localhost:9092').split(',');
const endpoint = process.env.PIPELINE_S3_ENDPOINT ?? 'http://localhost:4566';
const bucket = process.env.PIPELINE_S3_BUCKET ?? 'nexus-raw';
async function until<T>(read: () => Promise<T | undefined>, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout;
  do { const result = await read(); if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() < deadline);
  throw new Error('Timed out waiting for pipeline result');
}

describe.skipIf(!enabled)('Kafka → worker → S3 and silver → writer → PostgreSQL', () => {
  let f: Awaited<ReturnType<typeof disposablePostgres>>;
  let worker: WorkerService;
  let writer: EnrichmentService;
  const group = 'nexus-pipeline-' + randomUUID();
  const kafka = new Kafka({ clientId: group, brokers });
  const admin = kafka.admin();
  const producer = kafka.producer();
  const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  const source = { platform: 'telegram', topic: 'raw.' + group, groupId: group + '.raw',
    mode: 'real', adapter: 'provisional.v1' };
  const topics = [source.topic, group + '.silver', group + '.quarantine'];
  beforeAll(async () => {
    await admin.connect();
    await createTestTopics(admin, topics);
    await producer.connect();
    // Simulate the last record already acknowledged by the pre-cutover worker.
    await producer.send({ topic: source.topic, acks: -1, messages: [{ value: '{old-record}' }] });
    await admin.setOffsets({ groupId: source.groupId, topic: source.topic,
      partitions: [{ partition: 0, offset: '1' }] });
    f = await disposablePostgres(process.env.INTEGRATION_DATABASE_URL!);
    const env = { ...process.env, DATABASE_URL: f.url, KAFKA_STREAM_ID: group, KAFKA_BROKERS: brokers.join(','),
      KAFKA_SECURITY_PROTOCOL: 'PLAINTEXT', KAFKA_SOURCES: JSON.stringify([source]),
      KAFKA_SILVER_TOPIC: topics[1], KAFKA_DLQ_TOPIC: topics[2],
      KAFKA_SILVER_GROUP_ID: group + '.silver', S3_BUCKET: bucket, S3_ENDPOINT: endpoint,
      S3_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' };
    writer = new EnrichmentService(createWriterResources(env));
    worker = new WorkerService(createWorkerResources(env), async () => { throw new Error('Worker crashed'); });
    await writer.onModuleInit();
    await worker.onModuleInit();
  }, 120000);
  afterAll(async () => {
    await worker?.onApplicationShutdown(); await writer?.onApplicationShutdown();
    await producer.disconnect(); s3.destroy();
    try { await admin.deleteGroups([source.groupId, group + '.silver']); await admin.deleteTopics({ topics }); }
    finally { await admin.disconnect(); await f?.close(); }
  }, 30000);
  it('archives unchanged bytes and persists one engagement observation for an exact replay', async () => {
    const observation = { ...event(), engagement: { views: '12', capturedAt: '2026-01-02T12:00:00.000Z' } };
    const bytes = Buffer.from(JSON.stringify(collectorEvent(observation)));
    await producer.send({ topic: source.topic, acks: -1, messages: [{ value: bytes }, { value: bytes }] });
    const itemId = itemIdentity(observation).itemId;
    const uri = await until(async () => {
      const result = await f.pool.query<{ raw_uri: string }>(
        'SELECT raw_uri FROM core.item WHERE item_id=$1', [itemId]);
      return result.rows[0]?.raw_uri ?? undefined;
    });
    await until(async () => {
      const result = await f.pool.query('SELECT 1 FROM ingest.deliveries WHERE event_id=$1', [observation.eventId]);
      return result.rowCount === 2 ? true : undefined;
    });
    expect((await f.pool.query('SELECT 1 FROM core.engagement_snapshot WHERE item_id=$1', [itemId])).rowCount).toBe(1);
    expect((await f.pool.query('SELECT 1 FROM ingest.processing_receipts WHERE event_id=$1', [observation.eventId])).rowCount).toBe(1);
    const key = uri.replace(`s3://${bucket}/`, '').replace(/#L1$/, '');
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const line = JSON.parse(gunzipSync(Buffer.from(await object.Body!.transformToByteArray())).toString('utf8')) as {
      valueBase64: string; topic: string; offset: string };
    expect(Buffer.from(line.valueBase64, 'base64')).toEqual(bytes);
    expect(line.topic).toBe(source.topic);
    expect(line.offset).toMatch(/^\d+$/);
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket,
      Prefix: `raw/${group}/${source.topic}/partition=0/` }));
    expect(objects.Contents).toHaveLength(2);
    expect(objects.Contents?.some(object => object.Key?.includes('/0-'))).toBe(false);
  }, 120000);
  it('preserves equal-time and late native observations and deduplicates bronze replay', async () => {
    const raw = { className: 'Message', id: 42, peerId: { channelId: group, className: 'PeerChannel' },
      date: 1791958850, message: 'Native observation', views: 10 };
    const timestamp = '1791959000000';
    await producer.send({ topic: source.topic, acks: -1, messages: [
      { value: JSON.stringify(raw), timestamp },
      { value: JSON.stringify({ ...raw, views: 20 }), timestamp },
      { value: JSON.stringify({ ...raw, views: 5 }), timestamp: String(Number(timestamp) - 1000) },
    ] });
    const itemId = await until(async () => {
      const result = await f.pool.query<{ item_id: string }>(
        'SELECT item_id FROM core.item WHERE native_id=$1', [JSON.stringify([group, '42'])]);
      const id = result.rows[0]?.item_id;
      if (!id) return undefined;
      const snapshots = await f.pool.query('SELECT 1 FROM core.engagement_snapshot WHERE item_id=$1', [id]);
      return snapshots.rowCount === 3 ? id : undefined;
    });
    const current = await f.pool.query<{ views: string }>('SELECT views FROM core.item_ds WHERE item_id=$1', [itemId]);
    expect(Number(current.rows[0]?.views)).toBe(20);
    const uri = (await f.pool.query<{ raw_uri: string }>(
      'SELECT raw_uri FROM ingest.deliveries d JOIN ingest.processing_receipts r USING(event_id) WHERE r.item_id=$1 ORDER BY d.offset_value LIMIT 1', [itemId])).rows[0]?.raw_uri;
    if (!uri) throw new Error('Missing bronze URI');
    const key = uri.replace(`s3://${bucket}/`, '').replace(/#L1$/, '');
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const directory = await mkdtemp(join(tmpdir(), 'nexus-bronze-replay-'));
    const file = join(directory, 'archive.jsonl.gz');
    try {
      await writeFile(file, await object.Body!.transformToByteArray());
      await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/maintenance/replay.ts', file, source.topic], {
        cwd: process.cwd(), env: { ...process.env, KAFKA_BROKERS: brokers.join(','),
          KAFKA_SECURITY_PROTOCOL: 'PLAINTEXT', KAFKA_SOURCES: JSON.stringify([source]) },
      });
      await until(async () => (await f.pool.query(
        'SELECT 1 FROM ingest.deliveries d JOIN ingest.processing_receipts r USING(event_id) WHERE r.item_id=$1', [itemId])).rowCount === 4 ? true : undefined);
      expect((await f.pool.query('SELECT 1 FROM core.engagement_snapshot WHERE item_id=$1', [itemId])).rowCount).toBe(3);
      expect((await f.pool.query('SELECT 1 FROM ingest.processing_receipts WHERE item_id=$1', [itemId])).rowCount).toBe(3);
    } finally { await unlink(file); await rmdir(directory); }
  }, 120000);
  it('keeps newer Telegram content while storing engagement from stale source versions', async () => {
    const raw = { className: 'Message', id: 43, peerId: { channelId: group }, date: 1791958850,
      message: 'Newest content', editDate: 1791958870, views: 10 };
    const time = 1791959100000;
    await producer.send({ topic: source.topic, acks: -1, messages: [
      { value: JSON.stringify(raw), timestamp: String(time) },
      { value: JSON.stringify({ ...raw, message: 'Stale content', editDate: raw.editDate - 10, views: 20 }), timestamp: String(time + 1000) },
      { value: JSON.stringify({ ...raw, message: 'Ambiguous edit', views: 30 }), timestamp: String(time + 2000) },
    ] });
    const itemId = itemIdentity(adapt(raw, { ...source, mode: 'real', realityId: 0 })).itemId;
    await until(async () => (await f.pool.query('SELECT 1 FROM core.engagement_snapshot WHERE item_id=$1', [itemId])).rowCount === 3 ? true : undefined);
    const result = await f.pool.query<{ content_text: string; content_revision: string; views: string }>(
      'SELECT content_text,content_revision,views FROM core.item_ds WHERE item_id=$1', [itemId]);
    expect(result.rows[0]?.content_text).toBe(raw.message);
    expect(Number(result.rows[0]?.content_revision)).toBe(1);
    expect(Number(result.rows[0]?.views)).toBe(30);
  }, 120000);
  it('replays legacy Avro using the stored event identity without collapsing new observations', async () => {
    const raw = { className: 'Message', id: 44, peerId: { channelId: group }, date: 1791958850,
      message: 'Legacy observation', views: 10 };
    const original = { ...adapt(raw, { ...source, mode: 'real', realityId: 0 }),
      eventId: deterministicEventId('telegram', group, '44') };
    const itemId = itemIdentity(original).itemId;
    await ingest(createItemDatabase(f.pool), original, { streamId: group, topic: source.topic,
      partition: 0, offset: '1000000000' }, hash(raw));
    const directory = await mkdtemp(join(tmpdir(), 'nexus-legacy-replay-'));
    const file = join(directory, 'archive.avro');
    try {
      await pipeline(Readable.from([Buffer.from(JSON.stringify(raw))]), avro.createFileEncoder(file, 'bytes'));
      await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/maintenance/replay.ts', file, source.topic], {
        cwd: process.cwd(), env: { ...process.env, KAFKA_BROKERS: brokers.join(','),
          KAFKA_SECURITY_PROTOCOL: 'PLAINTEXT', KAFKA_SOURCES: JSON.stringify([source]) },
      });
      await until(async () => (await f.pool.query('SELECT 1 FROM ingest.deliveries WHERE event_id=$1 AND topic=$2',
        [original.eventId, topics[1]])).rowCount === 1 ? true : undefined);
      expect((await f.pool.query('SELECT 1 FROM ingest.processing_receipts WHERE item_id=$1', [itemId])).rowCount).toBe(1);
      expect((await f.pool.query('SELECT 1 FROM core.engagement_snapshot WHERE item_id=$1', [itemId])).rowCount).toBe(1);
      await producer.send({ topic: source.topic, acks: -1, messages: [{ value: JSON.stringify(raw) }] });
      await until(async () => (await f.pool.query('SELECT 1 FROM core.engagement_snapshot WHERE item_id=$1', [itemId])).rowCount === 2 ? true : undefined);
    } finally { await unlink(file); await rmdir(directory); }
  }, 120000);
});
