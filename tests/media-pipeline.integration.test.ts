import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Kafka } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemIdentity } from '@nexus/contracts';
import { createItemDatabase, itemRepository } from '@nexus/database';
import { buildApp } from '../apps/api/dist/app.js';
import { WorkerService, createResources as createWorkerResources } from '../apps/worker/dist/worker.service.js';
import { EnrichmentService } from '../apps/enrichment-worker/dist/enrichment.service.js';
import { createResources } from '../apps/enrichment-worker/dist/resources.js';
import { ENRICHMENT_RESOURCES } from '../apps/enrichment-worker/dist/enrichment.tokens.js';
import { MediaProcessingService } from '../apps/enrichment-worker/dist/media/media.service.js';
import { MediaError } from '../apps/enrichment-worker/dist/media/errors.js';
import { runMediaTool } from '../apps/enrichment-worker/src/media/process.js';
import { collectorEvent, event } from './fixtures.js';
import { blankMediaPng, mediaPdf } from './helpers/media-fixtures.js';
import { createMediaFixtureServer } from './helpers/media-server.js';
import { disposablePostgres } from './helpers/postgres.js';
import { createTestTopics } from './helpers/kafka.js';

const enabled = process.env.RUN_MEDIA_E2E === 'true' && !!process.env.INTEGRATION_DATABASE_URL;
const group = 'nexus-media-' + randomUUID();
const kafka = new Kafka({
  clientId: group,
  brokers: (process.env.PIPELINE_KAFKA_BROKERS ?? 'localhost:9092').split(','),
});
const admin = kafka.admin();
const producer = kafka.producer();
const bucket = process.env.PIPELINE_S3_BUCKET ?? 'nexus-raw';
const endpoint = process.env.PIPELINE_S3_ENDPOINT ?? 'http://localhost:4566';
const source = {
  platform: 'telegram',
  topic: 'raw.' + group,
  groupId: group + '.raw',
  mode: 'real',
  adapter: 'provisional.v1',
};
const topics = [source.topic, group + '.silver', group + '.quarantine'];
const token = 'media-e2e-token-with-at-least-24-characters';

async function until<T>(read: () => Promise<T | undefined>, timeout = 90000): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for media pipeline');
}

describe.skipIf(!enabled)('raw Kafka → bronze → silver → TLS download → S3 → real OCR → PostgreSQL → API', () => {
  let f: Awaited<ReturnType<typeof disposablePostgres>>;
  let server: Awaited<ReturnType<typeof createMediaFixtureServer>>;
  let worker: WorkerService;
  let context: INestApplicationContext;
  let api: Awaited<ReturnType<typeof buildApp>>;
  let apiUrl: string;
  let directory: string;
  let resources: ReturnType<typeof createResources>;
  const files = new Map<string, Buffer>();
  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-media-e2e-'));
    const pdf = mediaPdf(['NEXUS ATTACHMENT ONE', 'NEXUS ATTACHMENT TWO']);
    const pdfPath = join(directory, 'fixture.pdf');
    await writeFile(pdfPath, pdf);
    for (const format of ['png', 'jpeg']) {
      const prefix = join(directory, format);
      await runMediaTool(
        'pdftoppm',
        ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '1800', `-${format}`, pdfPath, prefix],
        AbortSignal.timeout(30000),
      );
      files.set('/' + format, await readFile(prefix + (format === 'jpeg' ? '.jpg' : '.png')));
    }
    files.set('/pdf', pdf);
    files.set('/blank', blankMediaPng());
    files.set('/broken', Buffer.from('%PDF-broken'));
    files.set('/old', mediaPdf(['OLD ATTACHMENT']));
    files.set('/new', mediaPdf(['NEW ATTACHMENT']));
    files.set('/retry', mediaPdf(['RETRY CHECKPOINT']));
    server = await createMediaFixtureServer(files);
    await admin.connect();
    await createTestTopics(admin, topics);
    await producer.connect();
    f = await disposablePostgres(process.env.INTEGRATION_DATABASE_URL!);
    const env = {
      ...process.env,
      DATABASE_URL: f.url,
      KAFKA_STREAM_ID: group,
      KAFKA_BROKERS: process.env.PIPELINE_KAFKA_BROKERS ?? 'localhost:9092',
      KAFKA_SECURITY_PROTOCOL: 'PLAINTEXT',
      KAFKA_SOURCES: JSON.stringify([source]),
      KAFKA_SILVER_TOPIC: topics[1],
      KAFKA_DLQ_TOPIC: topics[2],
      KAFKA_SILVER_GROUP_ID: group + '.silver',
      S3_BUCKET: bucket,
      S3_ENDPOINT: endpoint,
      S3_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      MEDIA_OCR_ENABLED: 'true',
    };
    resources = createResources(env);
    resources.media!.download = server.download;
    class FixtureModule {}
    Module({
      providers: [EnrichmentService, MediaProcessingService, { provide: ENRICHMENT_RESOURCES, useValue: resources }],
    })(FixtureModule);
    context = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
    worker = new WorkerService(createWorkerResources(env), async () => {
      throw new Error('Mapper crashed');
    });
    await worker.onModuleInit();
    api = await buildApp(itemRepository(createItemDatabase(f.pool)), token);
    await api.listen(0, '127.0.0.1');
    apiUrl = 'http://127.0.0.1:' + (api.getHttpServer().address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    await worker?.onApplicationShutdown();
    await context?.close();
    await api?.close();
    await producer.disconnect();
    await server?.close();
    s3.destroy();
    try {
      await admin.deleteGroups([source.groupId, group + '.silver']);
      await admin.deleteTopics({ topics });
    } finally {
      await admin.disconnect();
      await f?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }, 60000);

  it('stores per-attachment outcomes, exact archived bytes, and unchanged source text; replay deduplicates', async () => {
    const e = {
      ...event(),
      item: { ...event().item, nativeId: randomUUID(), text: 'Source caption only' },
      mediaComplete: true,
      media: ['/png', '/jpeg', '/pdf', '/blank', '/missing', '/broken', '/redirect-private'].map((path, index) => ({
        index,
        type: 'document' as const,
        url: 'https://media.nexus.test' + path,
      })),
    };
    e.media.push({ index: 7, type: 'document', url: '' });
    const payload = collectorEvent({
      ...e,
      media: e.media.map(media => (media.url ? media : { index: media.index, type: media.type })),
    });
    const bytes = Buffer.from(JSON.stringify(payload));
    await producer.send({ topic: source.topic, acks: -1, messages: [{ value: bytes }] });
    const itemId = itemIdentity(e).itemId;
    const jobs = await until(async () => {
      const rows = (
        await f.pool.query<{ position: number; status: string; outcome: string }>(
          'SELECT position,status,outcome FROM ingest.media_jobs WHERE item_id=$1 ORDER BY position',
          [itemId],
        )
      ).rows;
      return rows.length === 8 && rows.every(row => ['succeeded', 'failed'].includes(row.status)) ? rows : undefined;
    });
    expect(jobs.map(job => job.outcome)).toEqual([
      'text',
      'text',
      'text',
      'no_text',
      'missing',
      'unreadable',
      'unsafe_url',
      'missing_url',
    ]);
    const response = await fetch(`${apiUrl}/v1/items/${encodeURIComponent(itemId)}`, {
      headers: { authorization: 'Bearer ' + token },
    });
    expect(response.status).toBe(200);
    const item = (await response.json()) as {
      content_text: string;
      media: { position: number; s3_uri: string | null; ocr_text: string | null }[];
    };
    expect(item.content_text).toBe('Source caption only');
    const media = item.media.sort((a, b) => a.position - b.position);
    expect(media[0]?.ocr_text).toContain('NEXUS ATTACHMENT ONE');
    expect(media[1]?.ocr_text).toContain('NEXUS ATTACHMENT ONE');
    expect(media[2]?.ocr_text).toContain('NEXUS ATTACHMENT TWO');
    expect(media[3]?.ocr_text).toBe('');
    for (const position of [0, 1, 2, 3, 5]) {
      const uri = media[position]!.s3_uri!;
      expect(uri).toContain(`s3://${bucket}/media/0/`);
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: uri.slice(`s3://${bucket}/`.length) }));
      expect(Buffer.from(await object.Body!.transformToByteArray())).toEqual(
        files.get(['/png', '/jpeg', '/pdf', '/blank', '', '/broken'][position]!),
      );
    }
    await producer.send({ topic: source.topic, acks: -1, messages: [{ value: bytes }] });
    await until(async () =>
      (await f.pool.query('SELECT 1 FROM ingest.deliveries WHERE event_id=$1', [e.eventId])).rowCount === 2
        ? true
        : undefined,
    );
    expect((await f.pool.query('SELECT 1 FROM ingest.media_jobs WHERE item_id=$1', [itemId])).rowCount).toBe(8);
    expect(
      (await f.pool.query('SELECT 1 FROM ingest.processing_receipts WHERE event_id=$1', [e.eventId])).rowCount,
    ).toBe(1);
  }, 120000);

  it('discards OCR when Kafka delivers a replacement while native OCR is running', async () => {
    const originalOcr = resources.media!.ocr;
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    resources.media!.ocr = async (...args) => {
      const text = await originalOcr(...args);
      if (text.includes('OLD ATTACHMENT')) {
        started();
        await blocked;
      }
      return text;
    };
    const e = {
      ...event(),
      item: { ...event().item, nativeId: randomUUID() },
      mediaComplete: true,
      media: [{ index: 0, type: 'document' as const, url: 'https://media.nexus.test/old' }],
    };
    const publish = async (value: typeof e) =>
      producer.send({ topic: source.topic, acks: -1, messages: [{ value: JSON.stringify(collectorEvent(value)) }] });
    try {
      await publish(e);
      await entered;
      const itemId = itemIdentity(e).itemId;
      await publish({
        ...e,
        eventId: randomUUID(),
        observedAt: '2026-01-03T00:00:00Z',
        media: [{ index: 0, type: 'document', url: 'https://media.nexus.test/new' }],
      });
      await until(async () =>
        (
          await f.pool.query<{ media_url: string }>('SELECT media_url FROM core.item_media WHERE item_id=$1', [itemId])
        ).rows[0]?.media_url.endsWith('/new')
          ? true
          : undefined,
      );
      release();
      await until(async () =>
        (
          await f.pool.query<{ ocr_text: string | null }>('SELECT ocr_text FROM core.item_media WHERE item_id=$1', [
            itemId,
          ])
        ).rows[0]?.ocr_text?.includes('NEW ATTACHMENT')
          ? true
          : undefined,
      );
      expect(
        (
          await f.pool.query<{ status: string }>(
            'SELECT status FROM ingest.media_jobs WHERE item_id=$1 ORDER BY created_at',
            [itemId],
          )
        ).rows.map(row => row.status),
      ).toEqual(['stale', 'succeeded']);
    } finally {
      release();
      resources.media!.ocr = originalOcr;
    }
  }, 120000);

  it('recovers OCR from its S3 checkpoint after the source URL expires', async () => {
    const originalOcr = resources.media!.ocr;
    let failed = false;
    resources.media!.ocr = async (...args) => {
      if (!failed) {
        failed = true;
        throw new MediaError('timeout', true);
      }
      return originalOcr(...args);
    };
    const e = {
      ...event(),
      item: { ...event().item, nativeId: randomUUID() },
      media: [{ index: 0, type: 'document' as const, url: 'https://media.nexus.test/retry' }],
    };
    const itemId = itemIdentity(e).itemId;
    try {
      await producer.send({ topic: source.topic, acks: -1, messages: [{ value: JSON.stringify(collectorEvent(e)) }] });
      await until(async () =>
        (
          await f.pool.query(
            'SELECT 1 FROM ingest.media_jobs WHERE item_id=$1 AND status=$2 AND archive_uri IS NOT NULL',
            [itemId, 'pending'],
          )
        ).rowCount === 1
          ? true
          : undefined,
      );
      server.expired.add('/retry');
      await f.pool.query('UPDATE ingest.media_jobs SET next_run_at=now() WHERE item_id=$1', [itemId]);
      await until(async () =>
        (
          await f.pool.query<{ ocr_text: string | null }>('SELECT ocr_text FROM core.item_media WHERE item_id=$1', [
            itemId,
          ])
        ).rows[0]?.ocr_text?.includes('RETRY CHECKPOINT')
          ? true
          : undefined,
      );
      expect(server.requests.get('/retry')).toBe(1);
    } finally {
      resources.media!.ocr = originalOcr;
    }
  }, 120000);
});
