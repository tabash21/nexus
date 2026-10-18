import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import avro from 'avsc';
import { GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { findUnlinkedArchiveCandidates, linkArchiveRecord, type createPool } from '@nexus/database';
import { archiveCoordinates } from './coordinates.js';

type Pool = ReturnType<typeof createPool>;

export interface ArchiveStats {
  scanned: number;
  linked: number;
  mismatched: number;
}

/**
 * Reconciles raw Avro archives stored in S3 by Kafka Connect against PostgreSQL delivery snapshots.
 * Verifies exact byte identity and SHA-256 before recording the permanent archive link.
 */
export async function reconcileArchive(
  pool: Pool,
  s3: S3Client,
  bucket: string,
  minAgeSeconds = 20,
): Promise<ArchiveStats> {
  const stats: ArchiveStats = { scanned: 0, linked: 0, mismatched: 0 };
  let continuation: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'raw/',
        ContinuationToken: continuation,
      }),
    );

    for (const object of page.Contents ?? []) {
      if (!object.Key || !object.LastModified || Date.now() - object.LastModified.getTime() < minAgeSeconds * 1000) {
        continue;
      }

      const coordinates = archiveCoordinates(object.Key);
      if (!coordinates) continue;

      const body = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
      if (!body.Body || !body.VersionId) {
        throw new Error('Raw archive bucket must have versioning enabled');
      }

      const decoder = Readable.from(body.Body as AsyncIterable<Uint8Array>).pipe(new avro.streams.BlockDecoder());

      let position = 0;
      for await (const value of decoder) {
        stats.scanned++;
        if (!Buffer.isBuffer(value)) {
          throw new Error('Connect archive record is not raw bytes');
        }

        const offset = (coordinates.startOffset + BigInt(position)).toString();
        position++;

        const candidates = await findUnlinkedArchiveCandidates(pool, coordinates.topic, coordinates.partition, offset);

        for (const candidate of candidates) {
          const digest = createHash('sha256').update(value).digest('hex');
          if (digest !== candidate.raw_sha256 || !value.equals(candidate.raw_bytes)) {
            stats.mismatched++;
            continue;
          }

          await linkArchiveRecord(pool, {
            streamId: candidate.stream_id,
            eventId: candidate.event_id,
            topic: coordinates.topic,
            partition: coordinates.partition,
            offset,
            key: object.Key,
            versionId: body.VersionId,
            position: position - 1,
            digest,
            bucket,
          });

          stats.linked++;
        }
      }
    }

    continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuation);

  return stats;
}
