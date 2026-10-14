import { S3Client } from '@aws-sdk/client-s3';
import { createPool } from '@nexus/database';
import { testProcessor, ProcessorRegistry, type EnrichmentProcessor } from './processors/index.js';

export const ENRICHMENT_RESOURCES = Symbol('ENRICHMENT_RESOURCES');

export interface EnrichmentResources {
  pool: ReturnType<typeof createPool>;
  s3: S3Client;
  rawBucket: string;
  processors: readonly EnrichmentProcessor[];
  registry: ProcessorRegistry;
  concurrency: number;
}

export function createResources(env: NodeJS.ProcessEnv = process.env): EnrichmentResources {
  if (!env.DATABASE_URL || !env.S3_BUCKET) {
    throw new Error('DATABASE_URL and S3_BUCKET are required');
  }

  const concurrency = Number(env.ENRICHMENT_CONCURRENCY ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error('Invalid ENRICHMENT_CONCURRENCY');
  }

  const s3 = new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
  });

  const registry = new ProcessorRegistry([testProcessor]);

  return {
    pool: createPool(env.DATABASE_URL),
    s3,
    rawBucket: env.S3_BUCKET,
    processors: registry.getAll(),
    registry,
    concurrency,
  };
}
