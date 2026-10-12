import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildArchiveConfig } from '../scripts/lib/archive-config.mjs';

const base = JSON.parse(await readFile(new URL('../infra/connect/s3-sink.local.json', import.meta.url), 'utf8'));

describe('archive environment switching', () => {
  it('defaults to LocalStack without environment presets', () => {
    const config = buildArchiveConfig(base, {});
    expect(config['store.url']).toBe('http://s3:4566');
    expect(config['s3.bucket.name']).toBe('nexus-raw');
  });

  it('removes the local endpoint when AWS settings are injected', () => {
    const config = buildArchiveConfig(base, {
      S3_TARGET: 'aws', S3_BUCKET: 'archive',
      S3_REGION: 'eu-west-1', KAFKA_TOPIC: 'configured-topic',
    });
    expect(config).not.toHaveProperty('store.url');
    expect(config['s3.bucket.name']).toBe('archive');
    expect(config['s3.region']).toBe('eu-west-1');
    expect(config['s3.path.style.access.enabled']).toBe('false');
    expect(config.topics).toBe('configured-topic');
    expect(base['store.url']).toBe('http://s3:4566');
  });

  it('rejects incomplete AWS settings before contacting Connect', () => {
    expect(() => buildArchiveConfig(base, { S3_TARGET: 'aws' }))
      .toThrow('AWS archival requires S3_BUCKET and S3_REGION');
  });

  it('rejects an accidentally retained LocalStack endpoint in AWS mode', () => {
    expect(() => buildArchiveConfig(base, {
      S3_TARGET: 'aws', S3_BUCKET: 'archive', S3_REGION: 'eu-west-1', S3_ENDPOINT: 'http://s3:4566',
    })).toThrow('Leave S3_ENDPOINT empty');
  });

  it('rejects an uninitialized local bucket', () => {
    expect(() => buildArchiveConfig(base, { S3_BUCKET: 'missing' }))
      .toThrow('LocalStack initialization requires');
  });

  it('rejects a misspelled archive target', () => {
    expect(() => buildArchiveConfig(base, { S3_TARGET: 'awss' })).toThrow('S3_TARGET must');
  });
});
