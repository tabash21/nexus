import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import avro from 'avsc';
import { Kafka } from 'kafkajs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemIdentity } from '@nexus/contracts';
import { WorkerService, createResources } from '../apps/worker/dist/worker.service.js';
import { adapt } from '../apps/worker/src/adapters/index.js';
import { event, collectorEvent } from './fixtures.js';
import { disposablePostgres } from './helpers/postgres.js';
const enabled = process.env.RUN_PIPELINE_INTEGRATION === 'true' && !!process.env.INTEGRATION_DATABASE_URL;
const brokers = (process.env.PIPELINE_KAFKA_BROKERS ?? 'localhost:9092').split(',');
const endpoint = process.env.PIPELINE_S3_ENDPOINT ?? 'http://localhost:4566';
const bucket = process.env.PIPELINE_S3_BUCKET ?? 'nexus-raw';
async function until<T>(read: () => Promise<T | undefined>, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout;
  do { const result = await read(); if (result !== undefined) return result; await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() < deadline);
  throw new Error('Timed out waiting for pipeline result');
}
describe.skipIf(!enabled)('Kafka worker and independent Connect archive', () => {
  let f: Awaited<ReturnType<typeof disposablePostgres>>;
  let worker: WorkerService;
  const kafka = new Kafka({ clientId: 'nexus-pipeline-test', brokers });
  const producer = kafka.producer();
  const group = 'nexus-test-' + randomUUID();
  beforeAll(async () => {
    f = await disposablePostgres(process.env.INTEGRATION_DATABASE_URL!);
    const sources = ['telegram','x'].map(platform => ({ platform, topic: 'raw.' + platform + '.v1', groupId: group + '.' + platform, mode: 'real', adapter: 'provisional.v1' }));
    const resources = createResources({ DATABASE_URL: f.url, KAFKA_STREAM_ID: group, KAFKA_BROKERS: brokers.join(','),
      KAFKA_SECURITY_PROTOCOL: 'PLAINTEXT', KAFKA_SOURCES: JSON.stringify(sources) });
    worker = new WorkerService(resources, async () => { throw new Error('Worker crashed during integration test'); });
    await worker.onModuleInit();
    await producer.connect();
  }, 120000);
  afterAll(async () => {
    await worker?.onApplicationShutdown(); await producer.disconnect();
    const admin = kafka.admin();
    try { await admin.connect(); await admin.deleteGroups([group + '.telegram', group + '.x']); }
    finally { await admin.disconnect(); await f?.close(); }
  }, 30000);
  it('persists Telegram and X, deduplicates replay, and archives unchanged bytes via Connect', async () => {
    const telegram = event(); telegram.item.nativeId = randomUUID();
    const x = { ...event(), platform: 'x', item: { ...event().item, nativeId: randomUUID() } };
    const original = Buffer.from(JSON.stringify(collectorEvent(telegram)));
    const telegramRaw = { className: 'Message', id: Math.floor(Math.random() * 1000000000),
      peerId: { channelId: '42', className: 'PeerChannel' }, date: 1791958850,
      message: 'Unchanged producer text', views: 1 };
    const rawBytes = Buffer.from(JSON.stringify(telegramRaw));
    const adapted = adapt(telegramRaw, { platform: 'telegram', topic: 'raw.telegram.v1',
      groupId: group + '.telegram', mode: 'real', realityId: 0, adapter: 'telegram.v1' });
    expect(JSON.parse(original.toString())).not.toHaveProperty('realityId');
    await producer.send({ topic: 'raw.telegram.v1', acks: -1, messages: [{ value: original, partition: 0 },
      { value: original, partition: 0 }, { value: rawBytes, partition: 0 }, { value: rawBytes, partition: 0 }] });
    await producer.send({ topic: 'raw.x.v1', acks: -1, messages: [{ value: JSON.stringify(collectorEvent(x)) }] });
    await until(async () => {
      const result = await f.pool.query('SELECT item_id FROM core.item WHERE item_id=ANY($1::text[])', [[
        itemIdentity(telegram).itemId, itemIdentity(x).itemId, itemIdentity(adapted).itemId]]);
      return result.rowCount === 3 ? true : undefined;
    });
    await until(async () => {
      const result = await f.pool.query('SELECT * FROM ingest.deliveries WHERE event_id=$1', [telegram.eventId]);
      return result.rowCount === 2 ? true : undefined;
    });
    expect((await f.pool.query('SELECT * FROM ingest.processing_receipts WHERE event_id=$1', [telegram.eventId])).rowCount).toBe(1);
    await until(async () => (await f.pool.query('SELECT * FROM ingest.deliveries WHERE event_id=$1',
      [adapted.eventId])).rowCount === 2 ? true : undefined);
    expect((await f.pool.query('SELECT * FROM ingest.enrichment_jobs WHERE item_id=$1',
      [itemIdentity(adapted).itemId])).rowCount).toBe(1);
    expect((await f.pool.query('SELECT raw_uri FROM core.item WHERE item_id=$1', [itemIdentity(telegram).itemId])).rows[0]?.raw_uri).toBeNull();
    // Connect batches records. Stop the operational consumer and fill this partition so the
    // independent archive is forced to flush without changing the production connector config.
    await worker.onApplicationShutdown();
    await producer.send({ topic: 'raw.telegram.v1', acks: -1,
      messages: Array.from({ length: 1000 }, () => ({ value: '{}', partition: 0 })) });
    const inspected = new Set<string>();
    await until(async () => {
      // LocalStack test endpoint only; production S3 access belongs to Connect.
      const response = await fetch(`${endpoint}/${bucket}?list-type=2&prefix=raw/raw.telegram.v1/`);
      if (!response.ok) throw new Error('Could not list local archive');
      const xml = await response.text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match => match[1]!);
      for (const key of keys.filter(key => key.endsWith('.avro') && !inspected.has(key))) {
        inspected.add(key);
        const object = await fetch(`${endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
        if (!object.ok) throw new Error('Could not read archive object');
        const decoder = Readable.from([Buffer.from(await object.arrayBuffer())]).pipe(new avro.streams.BlockDecoder());
        for await (const record of decoder) if (Buffer.isBuffer(record) && record.equals(rawBytes)) return true;
      }
      return undefined;
    }, 90000);
  }, 120000);
});
