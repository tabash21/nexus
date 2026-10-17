import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { Message } from './process.js';

export interface ArchivedRaw { rawUri: string; rawSha256: string }

/** Archive the original Kafka delivery before attempting to decode it. */
export async function archiveRaw(s3: S3Client, bucket: string, message: Message): Promise<ArchivedRaw> {
  const bytes = message.value ?? Buffer.alloc(0);
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `raw/${encodeURIComponent(message.streamId)}/${message.topic}/partition=${message.partition}/${message.offset}-${rawSha256}.jsonl.gz`;
  const headers = Object.fromEntries(Object.entries(message.headers ?? {}).map(([name, value]) => [
    name, Array.isArray(value)
      ? value.map(part => Buffer.isBuffer(part) ? part.toString('base64') : Buffer.from(part).toString('base64'))
      : value === undefined ? null : Buffer.isBuffer(value) ? value.toString('base64') : Buffer.from(value).toString('base64'),
  ]));
  const line = JSON.stringify({ streamId: message.streamId, topic: message.topic,
    partition: message.partition, offset: message.offset, timestamp: message.timestamp,
    keyBase64: message.key?.toString('base64') ?? null,
    valueBase64: message.value?.toString('base64') ?? null, headers }) + '\n';
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key,
    Body: gzipSync(Buffer.from(line)), ContentType: 'application/x-ndjson', ContentEncoding: 'gzip' }));
  return { rawUri: `s3://${bucket}/${key}#L1`, rawSha256 };
}
