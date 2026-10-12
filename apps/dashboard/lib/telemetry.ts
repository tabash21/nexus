import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Kafka } from 'kafkajs';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL || 'postgresql://nexus:nexus_local@localhost:5432/nexus';
const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const s3Endpoint = process.env.S3_ENDPOINT || 'http://localhost:4566';
const s3Bucket = process.env.S3_BUCKET || 'nexus-raw';

// Database pool
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

// Kafka client
export const kafka = new Kafka({
  clientId: 'nexus-next-dashboard',
  brokers: kafkaBrokers,
  retry: { retries: 3 },
});

let producerInstance: ReturnType<typeof kafka.producer> | null = null;
let producerConnected = false;

export async function getKafkaProducer() {
  if (!producerInstance) {
    producerInstance = kafka.producer();
  }
  if (!producerConnected) {
    await producerInstance.connect();
    producerConnected = true;
  }
  return producerInstance;
}

function getRootDir(): string {
  const cwd = process.cwd();
  if (cwd.includes('apps') && cwd.includes('dashboard')) {
    return path.resolve(cwd, '../..');
  }
  return cwd;
}

// Fetch Docker Containers status
export async function getContainers() {
  try {
    const rootDir = getRootDir();
    const { stdout } = await execFileAsync(
      'docker',
      ['compose', '-f', 'compose.yaml', '-f', 'compose.local.yaml', 'ps', '--format', 'json'],
      { cwd: rootDir, timeout: 5000 }
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ error: 'Could not query Docker daemon', details: message }];
  }
}

// Fetch Kafka topics, offsets, and consumer groups
export async function getKafkaStats() {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    const relevantTopics = topics.filter(t => !t.startsWith('_'));

    const topicDetails = await Promise.all(
      relevantTopics.map(async (topic) => {
        try {
          const offsets = await admin.fetchTopicOffsets(topic);
          return { topic, partitions: offsets };
        } catch {
          return { topic, partitions: [] };
        }
      })
    );

    let groups: unknown[] = [];
    try {
      const groupList = await admin.listGroups();
      groups = await Promise.all(
        groupList.groups.map(async (g) => {
          try {
            const desc = await admin.describeGroups([g.groupId]);
            return { groupId: g.groupId, protocolType: g.protocolType, details: desc.groups[0] };
          } catch {
            return { groupId: g.groupId };
          }
        })
      );
    } catch {
      groups = [];
    }

    return { topics: topicDetails, groups, connected: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, connected: false };
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

// Fetch PostgreSQL documents and summary metrics
export async function getDatabaseStats() {
  try {
    const client = await pool.connect();
    try {
      const countsResult = await client.query(`
        SELECT
          (SELECT count(*)::int FROM sources) AS sources_count,
          (SELECT count(*)::int FROM ingest_events) AS events_count,
          (SELECT count(*)::int FROM documents) AS documents_count,
          (SELECT count(*)::int FROM document_versions) AS versions_count,
          (SELECT count(*)::int FROM processing_receipts) AS receipts_count,
          (SELECT count(*)::int FROM deliveries) AS deliveries_count
      `);

      const docsResult = await client.query(`
        SELECT
          d.id,
          d.source_id,
          d.external_id,
          d.current_version_id,
          d.last_seen_at,
          dv.title,
          dv.url,
          dv.language,
          dv.content_hash,
          d.first_seen_at,
          substring(dv.text from 1 for 180) AS text_preview
        FROM documents d
        LEFT JOIN document_versions dv ON d.current_version_id = dv.id
        ORDER BY d.last_seen_at DESC
        LIMIT 25
      `);

      const recentEventsResult = await client.query(`
        SELECT
          ie.id,
          ie.source_id,
          ie.observed_at,
          ie.ingested_at,
          ie.event_hash
        FROM ingest_events ie
        ORDER BY ie.ingested_at DESC
        LIMIT 10
      `);

      return {
        counts: countsResult.rows[0] || {},
        documents: docsResult.rows,
        recentEvents: recentEventsResult.rows,
        connected: true,
      };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, connected: false };
  }
}

// Fetch S3 Archived Objects from LocalStack
export async function getS3Stats() {
  try {
    const res = await fetch(`${s3Endpoint}/${s3Bucket}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { error: `S3 endpoint returned status ${res.status}`, objects: [], connected: false };
    }
    const text = await res.text();
    const contentsMatches = text.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    const objects = contentsMatches.map(c => {
      const key = (c.match(/<Key>(.*?)<\/Key>/) || [])[1] || '';
      const size = Number((c.match(/<Size>(.*?)<\/Size>/) || [])[1] || '0');
      const lastModified = (c.match(/<LastModified>(.*?)<\/LastModified>/) || [])[1] || '';
      return { key, size, lastModified };
    });

    return { bucket: s3Bucket, endpoint: s3Endpoint, objects, totalObjects: objects.length, connected: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, bucket: s3Bucket, objects: [], connected: false };
  }
}
