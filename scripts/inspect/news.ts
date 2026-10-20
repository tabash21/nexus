import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { sourceSubscriptions } from '@nexus/contracts';
import { adapt } from '../../apps/worker/src/adapters/index.js';
import { inspectKafka } from './kafka.js';

const { values } = parseArgs({
  options: {
    archive: { type: 'string' },
    file: { type: 'string' },
    offset: { type: 'string' },
    partition: { type: 'string', default: '0' },
    limit: { type: 'string', default: '5' },
  },
});
const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be between 1 and 100');
if ([values.archive, values.file, values.offset].filter(value => value !== undefined).length > 1) {
  throw new Error('Choose one of --archive, --file, or --offset');
}
if (values.offset !== undefined && !/^\d+$/.test(values.offset)) throw new Error('--offset must be nonnegative');
if (!/^\d+$/.test(values.partition!)) throw new Error('--partition must be nonnegative');

const sources = sourceSubscriptions();
const source = sources.find(entry => entry.platform === 'news' && entry.mode === 'real');
const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  maxAttempts: 1,
});

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const errors: unknown[] = error.errors;
    return errors.map(errorMessage).join('; ') || error.name;
  }
  return error instanceof Error ? error.message || error.name : String(error);
}

function validate(payload: unknown, topic = source?.topic) {
  try {
    const subscription = sources.find(entry => entry.platform === 'news' && entry.topic === topic);
    if (!subscription)
      throw new Error('No matching news subscription configured; check KAFKA_PLATFORMS / KAFKA_SOURCES');
    return { valid: true, event: adapt(payload, subscription) };
  } catch (error) {
    process.exitCode = 1;
    return { valid: false, reason: errorMessage(error) };
  }
}

async function inspectArchive(uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== 's3:') throw new Error('--archive requires an s3:// URI from raw_uri or quarantine rawUri');
  const object = await s3.send(new GetObjectCommand({ Bucket: parsed.hostname, Key: parsed.pathname.slice(1) }), {
    abortSignal: AbortSignal.timeout(5000),
  });
  const bytes = await object.Body?.transformToByteArray();
  if (!bytes) throw new Error('Empty archive response');
  const records = gunzipSync(bytes).toString('utf8').trim().split('\n');
  if (parsed.hash && !/^#L[1-9]\d*$/.test(parsed.hash)) throw new Error('Invalid archive line fragment; expected #L1');
  const line = parsed.hash ? Number(parsed.hash.slice(2)) : 1;
  if (!Number.isInteger(line) || line < 1 || !records[line - 1]) throw new Error('Invalid archive line');
  const delivery = JSON.parse(records[line - 1]!) as Record<string, unknown>;
  if (typeof delivery.valueBase64 !== 'string') throw new Error('Archive has no source bytes');
  const rawText = Buffer.from(delivery.valueBase64, 'base64').toString('utf8');
  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    process.exitCode = 1;
    return { archive: uri, delivery, rawText, validation: { valid: false, reason: 'Invalid JSON' } };
  }
  const topic = typeof delivery.topic === 'string' ? delivery.topic : undefined;
  return { archive: uri, delivery, payload, validation: validate(payload, topic) };
}

async function archiveAtOffset(offset: string) {
  if (!source || !process.env.KAFKA_STREAM_ID || !process.env.S3_BUCKET) {
    throw new Error('A real news subscription, KAFKA_STREAM_ID, and S3_BUCKET are required');
  }
  const prefix = `raw/${encodeURIComponent(process.env.KAFKA_STREAM_ID)}/${source.topic}/partition=${values.partition}/${offset}-`;
  const objects = await s3.send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix, MaxKeys: 2 }),
    { abortSignal: AbortSignal.timeout(5000) },
  );
  const keys = objects.Contents?.flatMap(object => (object.Key ? [object.Key] : [])) ?? [];
  if (keys.length !== 1)
    throw new Error(`Found ${keys.length} archives at this partition/offset; use an exact --archive URI`);
  return inspectArchive(`s3://${process.env.S3_BUCKET}/${keys[0]}#L1`);
}

async function inspectDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    options: '-c default_transaction_read_only=on',
  });
  try {
    const counts = await pool.query<{ items: string; receipts: string; deliveries: string }>(
      `SELECT
        (SELECT count(*) FROM core.item WHERE platform = $1 AND reality_id = $2) AS items,
        (SELECT count(*) FROM ingest.processing_receipts r JOIN core.item i
          ON i.item_id = r.item_id AND i.reality_id = r.reality_id
          WHERE i.platform = $1 AND i.reality_id = $2) AS receipts,
        (SELECT count(*) FROM ingest.deliveries d WHERE EXISTS (
          SELECT 1 FROM ingest.processing_receipts r JOIN core.item i
            ON i.item_id = r.item_id AND i.reality_id = r.reality_id
          WHERE r.event_id = d.event_id AND i.platform = $1 AND i.reality_id = $2)) AS deliveries`,
      ['news', 0],
    );
    const items = await pool.query<Record<string, unknown>>(
      `SELECT * FROM core.item WHERE platform = $1 AND reality_id = $2
       ORDER BY published_at DESC, item_id DESC LIMIT $3`,
      ['news', 0, limit],
    );
    return { counts: counts.rows[0], items: items.rows };
  } finally {
    await pool.end();
  }
}

async function inspectApi() {
  const base = process.env.API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3000'}`;
  const response = await fetch(`${base}/v1/items?platform=news&realityId=0&full=true&limit=${limit}`, {
    headers: { Authorization: `Bearer ${process.env.API_TOKEN ?? ''}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Query API returned HTTP ${response.status}`);
  return (await response.json()) as unknown;
}

async function main() {
  if (values.file) {
    const payload: unknown = JSON.parse(await readFile(values.file, 'utf8'));
    return { file: values.file, payload, validation: validate(payload) };
  }
  if (values.archive) return inspectArchive(values.archive);
  if (values.offset !== undefined) return archiveAtOffset(values.offset);

  const checks = {
    kafka: () => inspectKafka(source, sources),
    database: inspectDatabase,
    api: inspectApi,
    archive: async () => {
      if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET is required');
      await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }), {
        abortSignal: AbortSignal.timeout(5000),
      });
      return { bucket: process.env.S3_BUCKET, reachable: true };
    },
  };
  const stages = await Promise.all(
    Object.entries(checks).map(async ([stage, check]) => {
      try {
        const data = { ok: true, data: await check() };
        report[stage] = data;
        return [stage, data];
      } catch (error) {
        process.exitCode = 1;
        const data = { ok: false, error: errorMessage(error) };
        report[stage] = data;
        return [stage, data];
      }
    }),
  );
  return {
    ...report,
    ...Object.fromEntries(stages),
  };
}

// Bound the entire diagnosis even when a broker accepts TCP but stops answering requests.
const report: Record<string, unknown> = {
  timestamp: new Date().toISOString(),
  source: source ?? 'News is not enabled; check KAFKA_PLATFORMS / KAFKA_SOURCES',
};
const deadline = setTimeout(() => {
  console.log(JSON.stringify({ ...report, timeout: 'Inspection exceeded 20 seconds' }, null, 2));
  console.error('Inspection exceeded 20 seconds. Check Kafka forwarding and local Docker engine health.');
  process.exit(1);
}, 20000);
try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  s3.destroy();
}
