import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Kafka } from 'kafkajs';
import type { KafkaConfig } from 'kafkajs';
import { kafkaOptions } from '@nexus/kafka';
import type { DocumentRow } from '@/types/telemetry';

const execFileAsync = promisify(execFile);

function getRootDir(): string {
  const cwd = process.cwd();
  if (cwd.includes('apps') && cwd.includes('dashboard')) {
    return path.resolve(cwd, '../..');
  }
  return cwd;
}

// Automatically load root .env if running standalone
try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(path.resolve(getRootDir(), '.env'));
  }
} catch {
  // Ignore if .env is missing or already loaded
}

const apiUrl = process.env.API_URL || 'http://localhost:3000';
const apiToken = process.env.API_TOKEN || 'local-development-token-change-me';
const s3Endpoint = process.env.S3_ENDPOINT || 'http://localhost:4566';
const s3Bucket = process.env.S3_BUCKET || 'nexus-raw';

export function getKafkaClientOptions(): KafkaConfig {
  return { clientId: 'nexus-next-dashboard', ...kafkaOptions(), retry: { retries: 3 } };
}
export function getKafka(): Kafka { return new Kafka(getKafkaClientOptions()); }

export const kafka = getKafka();

let producerInstance: ReturnType<typeof kafka.producer> | null = null;
let producerConnected = false;

export async function getKafkaProducer() {
  if (!producerInstance) {
    producerInstance = getKafka().producer();
  }
  if (!producerConnected) {
    await producerInstance.connect();
    producerConnected = true;
  }
  return producerInstance;
}

// Reusable Kafka Admin client with connection reuse
let adminInstance: ReturnType<typeof kafka.admin> | null = null;
let adminConnected = false;

async function getKafkaAdmin() {
  if (!adminInstance) {
    adminInstance = getKafka().admin();
  }
  if (!adminConnected) {
    await adminInstance.connect();
    adminConnected = true;
  }
  return adminInstance;
}

// --------------------------------------------------------------------------
// 1. Docker Containers Status (with 8s TTL cache to prevent CPU & I/O choking)
// --------------------------------------------------------------------------
let cachedContainers: unknown[] | null = null;
let lastContainersFetchTime = 0;
const CONTAINERS_CACHE_TTL = 8000;

export async function getContainers() {
  const now = Date.now();
  if (cachedContainers && (now - lastContainersFetchTime < CONTAINERS_CACHE_TTL)) {
    return cachedContainers;
  }

  try {
    const rootDir = getRootDir();
    const { stdout } = await execFileAsync(
      'docker',
      ['compose', '-f', 'compose.yaml', '-f', 'compose.local.yaml', 'ps', '--format', 'json'],
      { cwd: rootDir, timeout: 5000 }
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    const parsed = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    cachedContainers = parsed;
    lastContainersFetchTime = now;
    return parsed;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (cachedContainers) return cachedContainers;
    return [{ error: 'Could not query Docker daemon', details: message }];
  }
}

// --------------------------------------------------------------------------
// 2. Kafka Topics & Offsets (reused admin client & 2.5s TTL cache)
// --------------------------------------------------------------------------
let cachedKafkaStats: {
  brokers: string[];
  securityProtocol: string;
  topics: Array<{ topic: string; partitions: unknown[] }>;
  groups: unknown[];
  connected: boolean;
  error?: string;
} | null = null;
let lastKafkaFetchTime = 0;
const KAFKA_CACHE_TTL = 3500;

export async function getKafkaStats() {
  const now = Date.now();
  if (cachedKafkaStats && (now - lastKafkaFetchTime < KAFKA_CACHE_TTL)) {
    return cachedKafkaStats;
  }

  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(s => s.trim());
  const securityProtocol = process.env.KAFKA_SECURITY_PROTOCOL || 'PLAINTEXT';

  try {
    const admin = await getKafkaAdmin();
    const topics = await admin.listTopics();
    const relevantTopics = topics.filter(t => !t.startsWith('_'));
    const pipelineTopics = new Set(
      relevantTopics.filter(t => t.startsWith('raw.') || t.startsWith('sim.') || t.includes('osint') || t.includes('quarantine'))
    );

    const topicDetails = await Promise.all(
      relevantTopics.map(async (topic) => {
        if (!pipelineTopics.has(topic)) {
          return { topic, partitions: [] };
        }
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
      const groupIds = groupList.groups.map(g => g.groupId);
      if (groupIds.length > 0) {
        const desc = await admin.describeGroups(groupIds);
        const descMap = new Map(desc.groups.map(d => [d.groupId, d]));
        groups = groupList.groups.map(g => ({
          groupId: g.groupId,
          protocolType: g.protocolType,
          details: descMap.get(g.groupId),
        }));
      }
    } catch {
      groups = [];
    }

    const result = { brokers, securityProtocol, topics: topicDetails, groups, connected: true };
    cachedKafkaStats = result;
    lastKafkaFetchTime = now;
    return result;
  } catch (err: unknown) {
    adminConnected = false;
    const message = err instanceof Error ? err.message : String(err);
    if (cachedKafkaStats) {
      return { ...cachedKafkaStats, connected: false, error: message };
    }
    return { brokers, securityProtocol, topics: [], groups: [], error: message, connected: false };
  }
}

// --------------------------------------------------------------------------
// 3. API Services Data (NestJS Query API /v1/items and /v1/stats/overview)
// --------------------------------------------------------------------------
interface ApiItem {
  item_id: string;
  source_id: string;
  native_id: string;
  title?: string | null;
  url?: string | null;
  lang?: string | null;
  content_text?: string | null;
  content_hash?: string | null;
  collected_at?: string;
  published_at?: string;
  last_seen_at?: string;
  platform?: string;
  author_id?: string | null;
  author_name_raw?: string | null;
  item_type?: string;
  [key: string]: unknown;
}

interface ApiStatsOverview {
  realityId?: number;
  itemsCount?: number;
  sourcesCount?: number;
  authorsCount?: number;
  platforms?: Array<{ platform: string; count: number }>;
}

let cachedApiStats: {
  counts: {
    sources_count: number;
    documents_count: number;
    authors_count: number;
    events_count: number;
    media_count: number;
    receipts_count: number;
    deliveries_count: number;
    platforms: Array<{ platform: string; count: number }>;
  };
  documents: DocumentRow[];
  connected: boolean;
  error?: string;
  source: 'api';
} | null = null;
let lastApiFetchTime = 0;
const API_CACHE_TTL = 1500;

export async function getApiStats() {
  const now = Date.now();
  if (cachedApiStats && (now - lastApiFetchTime < API_CACHE_TTL)) {
    return cachedApiStats;
  }

  try {
    const headers = {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };

    const [statsRes, itemsRes] = await Promise.all([
      fetch(`${apiUrl}/v1/stats/overview?realityId=0`, {
        headers,
        signal: AbortSignal.timeout(3000),
      }),
      fetch(`${apiUrl}/v1/items?realityId=0&limit=25&full=true`, {
        headers,
        signal: AbortSignal.timeout(3000),
      }),
    ]);

    if (!statsRes.ok && !itemsRes.ok) {
      throw new Error(`API returned HTTP ${statsRes.status} / ${itemsRes.status}`);
    }

    const statsData: ApiStatsOverview = statsRes.ok ? await statsRes.json() : {};
    const itemsData: { items?: ApiItem[] } = itemsRes.ok ? await itemsRes.json() : { items: [] };

    const items = itemsData.items || [];
    const documents: DocumentRow[] = items.map(item => ({
      id: item.item_id,
      source_id: item.source_id,
      external_id: item.native_id,
      title: item.title ?? null,
      url: item.url ?? null,
      language: item.lang ?? null,
      content_hash: item.content_hash ?? null,
      first_seen_at: item.collected_at || item.published_at || new Date().toISOString(),
      last_seen_at: item.last_seen_at || item.published_at || new Date().toISOString(),
      text_preview: item.content_text
        ? (item.content_text.length > 180 ? item.content_text.slice(0, 180) + '...' : item.content_text)
        : null,
      platform: item.platform,
      author_id: item.author_id ?? null,
      author_name_raw: item.author_name_raw ?? null,
      item_type: item.item_type,
      raw: item,
    }));

    const itemsCount = Number(statsData.itemsCount ?? documents.length);
    const sourcesCount = Number(statsData.sourcesCount ?? (new Set(documents.map(d => d.source_id)).size));
    const authorsCount = Number(statsData.authorsCount ?? 0);

    const result = {
      counts: {
        sources_count: sourcesCount,
        documents_count: itemsCount,
        authors_count: authorsCount,
        events_count: itemsCount,
        media_count: 0,
        receipts_count: itemsCount,
        deliveries_count: itemsCount,
        platforms: statsData.platforms || [],
      },
      documents,
      connected: true,
      source: 'api' as const,
    };

    cachedApiStats = result;
    lastApiFetchTime = now;
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (cachedApiStats) {
      return { ...cachedApiStats, connected: false, error: message };
    }
    return {
      counts: {
        sources_count: 0,
        documents_count: 0,
        authors_count: 0,
        events_count: 0,
        media_count: 0,
        receipts_count: 0,
        deliveries_count: 0,
        platforms: [],
      },
      documents: [],
      connected: false,
      error: `NestJS Query API (${apiUrl}) unavailable: ${message}`,
      source: 'api' as const,
    };
  }
}

// Backward-compatibility alias for dashboard components expecting getDatabaseStats
export const getDatabaseStats = getApiStats;

// --------------------------------------------------------------------------
// 4. S3 LocalStack Archive (with 4s TTL cache)
// --------------------------------------------------------------------------
let cachedS3Stats: {
  bucket: string;
  endpoint: string;
  objects: Array<{ key: string; size: number; lastModified: string }>;
  totalObjects: number;
  connected: boolean;
  error?: string;
} | null = null;
let lastS3FetchTime = 0;
const S3_CACHE_TTL = 4000;

export async function getS3Stats() {
  const now = Date.now();
  if (cachedS3Stats && (now - lastS3FetchTime < S3_CACHE_TTL)) {
    return cachedS3Stats;
  }

  try {
    const res = await fetch(`${s3Endpoint}/${s3Bucket}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { bucket: s3Bucket, endpoint: s3Endpoint, error: `S3 endpoint returned status ${res.status}`, objects: [], totalObjects: 0, connected: false };
    }
    const text = await res.text();
    const contentsMatches = text.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    const objects = contentsMatches.map(c => {
      const key = (c.match(/<Key>(.*?)<\/Key>/) || [])[1] || '';
      const size = Number((c.match(/<Size>(.*?)<\/Size>/) || [])[1] || '0');
      const lastModified = (c.match(/<LastModified>(.*?)<\/LastModified>/) || [])[1] || '';
      return { key, size, lastModified };
    });

    const result = { bucket: s3Bucket, endpoint: s3Endpoint, objects, totalObjects: objects.length, connected: true };
    cachedS3Stats = result;
    lastS3FetchTime = now;
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (cachedS3Stats) return cachedS3Stats;
    return { error: message, bucket: s3Bucket, endpoint: s3Endpoint, objects: [], totalObjects: 0, connected: false };
  }
}
