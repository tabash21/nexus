import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Kafka } from 'kafkajs';
import pg from 'pg';
import { eventSchema } from '@nexus/contracts';

const execFileAsync = promisify(execFile);
const port = Number(process.env.DASHBOARD_PORT || process.env.PORT || 3001);
const databaseUrl = process.env.DATABASE_URL || 'postgresql://nexus:nexus_local@localhost:5432/nexus';
const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
const s3Endpoint = process.env.S3_ENDPOINT || 'http://localhost:4566';
const s3Bucket = process.env.S3_BUCKET || 'nexus-raw';
const apiEndpoint = process.env.API_ENDPOINT || 'http://localhost:3000';
const apiToken = process.env.API_TOKEN || 'local-development-token-change-me';

// Database pool
const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

// Kafka client
const kafka = new Kafka({
  clientId: 'nexus-dashboard',
  brokers: kafkaBrokers,
  retry: { retries: 3 },
});
const producer = kafka.producer();
let producerConnected = false;

async function getProducer() {
  if (!producerConnected) {
    await producer.connect();
    producerConnected = true;
  }
  return producer;
}

// Helper to find public directory in both src (dev) and dist (compiled)
function getPublicFile(relativePath: string): string | null {
  const distPath = fileURLToPath(new URL('./public/' + relativePath, import.meta.url));
  if (existsSync(distPath)) return distPath;

  const srcPath = fileURLToPath(new URL('../src/public/' + relativePath, import.meta.url));
  if (existsSync(srcPath)) return srcPath;

  return null;
}

// Fetch Docker Containers status
async function getContainers() {
  try {
    const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
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
async function getKafkaStats() {
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
async function getDatabaseStats() {
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
async function getS3Stats() {
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

// Parse request body JSON
async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

// HTTP Server
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  try {
    // API Routes
    if (url.pathname === '/api/status') {
      const [containers, kafkaStats, dbStats, s3Stats] = await Promise.all([
        getContainers(),
        getKafkaStats(),
        getDatabaseStats(),
        getS3Stats(),
      ]);
      sendJson(res, 200, {
        timestamp: new Date().toISOString(),
        containers,
        kafka: kafkaStats,
        database: dbStats,
        s3: s3Stats,
      });
      return;
    }

    if (url.pathname === '/api/containers') {
      const containers = await getContainers();
      sendJson(res, 200, { containers });
      return;
    }

    if (url.pathname === '/api/kafka') {
      const stats = await getKafkaStats();
      sendJson(res, 200, stats);
      return;
    }

    if (url.pathname === '/api/documents') {
      const stats = await getDatabaseStats();
      sendJson(res, 200, stats);
      return;
    }

    if (url.pathname === '/api/s3') {
      const stats = await getS3Stats();
      sendJson(res, 200, stats);
      return;
    }

    if (url.pathname === '/api/publish' && req.method === 'POST') {
      const body = await parseJsonBody(req) as Record<string, string>;
      const eventId = randomUUID();
      const event = eventSchema.parse({
        schemaVersion: 1,
        eventId,
        source: {
          id: body.sourceId || 'demo-dashboard',
          name: body.sourceName || 'Nexus Flow Monitor',
        },
        observedAt: new Date().toISOString(),
        document: {
          externalId: body.externalId || `art-${Date.now().toString(36)}`,
          url: body.url || `https://nexus.local/news/${Date.now().toString(36)}`,
          title: body.title || 'Simulated OSINT Intelligence Report',
          text: body.text || 'Real-time OSINT document telemetry stream verification payload.',
          language: body.language || 'en',
          attributes: { simulator: 'dashboard-ui', timestamp: Date.now() },
        },
      });

      const p = await getProducer();
      const topic = process.env.KAFKA_TOPIC || 'osint.raw.v1';
      await p.send({
        topic,
        acks: -1,
        messages: [
          {
            key: `${event.source.id}:${event.document.externalId}`,
            value: JSON.stringify(event),
          },
        ],
      });

      sendJson(res, 201, {
        success: true,
        eventId: event.eventId,
        externalId: event.document.externalId,
        topic,
        observedAt: event.observedAt,
      });
      return;
    }

    // Static Assets
    let filePath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const resolvedPath = getPublicFile(filePath);

    if (resolvedPath && existsSync(resolvedPath)) {
      const content = await readFile(resolvedPath);
      const ext = filePath.split('.').pop()?.toLowerCase();
      const contentType = ext === 'css' ? 'text/css'
        : ext === 'js' ? 'application/javascript'
        : ext === 'svg' ? 'image/svg+xml'
        : ext === 'json' ? 'application/json'
        : 'text/html';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return;
    }

    // Fallback 404
    sendJson(res, 404, { error: 'Not found' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Please stop the existing process or run with DASHBOARD_PORT=<port>.`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`Nexus Flow Monitor UI running at http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  await pool.end().catch(() => {});
  if (producerConnected) await producer.disconnect().catch(() => {});
  process.exit(0);
});
