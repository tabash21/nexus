import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ClaimedMediaJob } from '@nexus/database';
import { spoolMedia, type DownloadedMedia } from './files.js';
import { MediaError } from './errors.js';
import { MEDIA_POLICY } from './policy.js';

function prefix(job: ClaimedMediaJob): string {
  const itemHash = createHash('sha256').update(job.item_id).digest('hex');
  return `media/${job.reality_id}/${itemHash}/${job.attachment_generation}/`;
}

export async function archiveMedia(
  s3: S3Client,
  bucket: string,
  job: ClaimedMediaJob,
  media: DownloadedMedia,
  signal: AbortSignal,
): Promise<string> {
  const key = prefix(job) + `${media.sha256}.${media.format}`;
  const body = createReadStream(media.path);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: media.size,
        ContentType: media.format === 'pdf' ? 'application/pdf' : `image/${media.format}`,
        Metadata: { sha256: media.sha256 },
      }),
      { abortSignal: signal },
    );
  } finally {
    body.destroy();
  }
  return `s3://${bucket}/${key}`;
}

export async function readArchivedMedia(
  s3: S3Client,
  bucket: string,
  job: ClaimedMediaJob,
  directory: string,
  signal: AbortSignal,
): Promise<DownloadedMedia> {
  const uriPrefix = `s3://${bucket}/${prefix(job)}`;
  if (!job.archive_uri?.startsWith(uriPrefix)) throw new MediaError('infrastructure', true);
  const suffix = job.archive_uri.slice(uriPrefix.length);
  const match = /^([a-f0-9]{64})\.(png|jpeg|pdf)$/.exec(suffix);
  if (!match) throw new MediaError('infrastructure', true);
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: prefix(job) + suffix }), {
    abortSignal: signal,
  });
  if (!(response.Body instanceof Readable)) throw new MediaError('infrastructure', true);
  if ((response.ContentLength ?? 0) > MEDIA_POLICY.maxBytes) {
    response.Body.destroy();
    throw new MediaError('download_limit');
  }
  const media = await spoolMedia(response.Body, join(directory, 'source'), signal);
  if (media.sha256 !== match[1] || media.format !== match[2]) throw new MediaError('infrastructure', true);
  return media;
}
