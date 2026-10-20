import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import {
  checkpointMediaArchive,
  claimMediaJobs,
  failMediaJob,
  finishMediaJob,
  renewMediaJob,
  isMediaClaimActive,
  type IngestDatabase,
} from '@nexus/database';
import { archiveMedia, readArchivedMedia } from './archive.js';
import { downloadMedia } from './downloader.js';
import { extractVisibleText } from './ocr.processor.js';
import { requireMediaTools } from './process.js';
import type { MediaResources } from './types.js';
import { reclaimMediaTemporaryFiles } from './temporary.js';

export function createMediaResources(db: IngestDatabase, env: NodeJS.ProcessEnv): MediaResources | undefined {
  if (env.MEDIA_OCR_ENABLED === 'false') return undefined;
  const bucket = env.S3_BUCKET;
  if (!bucket)
    throw new Error('S3_BUCKET is required for media OCR; set MEDIA_OCR_ENABLED=false to disable processing');
  const s3 = new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
          },
        }
      : {}),
  });
  const allowedHosts = (env.MEDIA_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
  const database = new URL(env.DATABASE_URL!);
  const temporaryScope = createHash('sha256')
    .update(`${database.protocol}//${database.hostname}:${database.port || '5432'}${database.pathname}`)
    .digest('hex')
    .slice(0, 32);
  return {
    temporaryScope,
    cleanupTemporary: () =>
      reclaimMediaTemporaryFiles(temporaryScope, (id, token) => isMediaClaimActive(db, id, token)),
    claim: () => claimMediaJobs(db),
    renew: job => renewMediaJob(db, job),
    checkpoint: (job, uri) => checkpointMediaArchive(db, job, uri),
    complete: (job, text) => finishMediaJob(db, job, text),
    fail: (job, failure) => failMediaJob(db, job, failure),
    download: (url, directory, signal) => downloadMedia(url, directory, signal, allowedHosts),
    archive: (job, media, signal) => archiveMedia(s3, bucket, job, media, signal),
    readArchive: (job, directory, signal) => readArchivedMedia(s3, bucket, job, directory, signal),
    ocr: extractVisibleText,
    ready: async () => {
      const signal = AbortSignal.timeout(15000);
      await requireMediaTools(signal);
      await s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
    },
    close: () => s3.destroy(),
  };
}
