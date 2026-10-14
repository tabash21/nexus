import { sourceSubscriptions } from './source-registry.mjs';
export function buildArchiveConfig(base, env = process.env) {
  const target = env.S3_TARGET ?? 'local';
  if (!['local', 'aws'].includes(target)) throw new Error('S3_TARGET must be local or aws');
  if (target === 'aws' && (!env.S3_BUCKET?.trim() || !env.S3_REGION?.trim())) {
    throw new Error('AWS archival requires S3_BUCKET and S3_REGION');
  }
  if (target === 'aws' && env.S3_ENDPOINT?.trim()) {
    throw new Error('Leave S3_ENDPOINT empty for AWS S3');
  }

  const config = {
    ...base,
    topics: sourceSubscriptions(env).map(source => source.topic).join(','),
    's3.bucket.name': env.S3_BUCKET?.trim() || base['s3.bucket.name'],
    's3.region': env.S3_REGION?.trim() || base['s3.region'],
    's3.path.style.access.enabled': target === 'local' ? 'true' : 'false',
  };
  if (target === 'local') {
    if (config['s3.bucket.name'] !== 'nexus-raw' || config['s3.region'] !== 'us-east-1') {
      throw new Error('LocalStack initialization requires S3_BUCKET=nexus-raw and S3_REGION=us-east-1');
    }
    config['store.url'] = env.S3_ENDPOINT?.trim() || base['store.url'];
  } else {
    // Do not carry the LocalStack endpoint into an AWS registration.
    delete config['store.url'];
  }
  return config;
}
