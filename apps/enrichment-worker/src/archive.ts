import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import avro from 'avsc';
import { GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import type { createPool } from '@nexus/database';
type Pool = ReturnType<typeof createPool>;

export interface ArchiveStats { scanned: number; linked: number; mismatched: number }

/** Connect names an object by its first offset; records inside it retain subsequent offsets. */
export function archiveCoordinates(key: string): { topic: string; partition: number; startOffset: bigint } | null {
  const match = /(?:^|\/)([^/]+)\+(\d+)\+(\d+)\.avro$/.exec(key);
  return match ? { topic: match[1]!, partition: Number(match[2]), startOffset: BigInt(match[3]!) } : null;
}

export async function reconcileArchive(pool: Pool, s3: S3Client, bucket: string,
  minAgeSeconds = 20): Promise<ArchiveStats> {
  const stats: ArchiveStats = { scanned: 0, linked: 0, mismatched: 0 };
  let continuation: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'raw/', ContinuationToken: continuation }));
    for (const object of page.Contents ?? []) {
      if (!object.Key || !object.LastModified || Date.now() - object.LastModified.getTime() < minAgeSeconds * 1000) continue;
      const coordinates = archiveCoordinates(object.Key);
      if (!coordinates) continue;
      const body = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
      if (!body.Body || !body.VersionId) throw new Error('Raw archive bucket must have versioning enabled');
      const decoder = Readable.from(body.Body as AsyncIterable<Uint8Array>).pipe(new avro.streams.BlockDecoder());
      let position = 0;
      for await (const value of decoder) {
        stats.scanned++;
        if (!Buffer.isBuffer(value)) throw new Error('Connect archive record is not raw bytes');
        const offset = (coordinates.startOffset + BigInt(position)).toString();
        position++;
        const candidates = await pool.query<{ stream_id: string; event_id: string; raw_bytes: Buffer; raw_sha256: string }>(
          `SELECT d.stream_id,d.event_id,s.raw_bytes,s.raw_sha256 FROM ingest.deliveries d
           JOIN ingest.delivery_snapshots s USING(stream_id,topic,partition,offset_value)
           LEFT JOIN ingest.archive_links a USING(stream_id,topic,partition,offset_value)
           WHERE d.topic=$1 AND d.partition=$2 AND d.offset_value=$3 AND a.object_key IS NULL`,
          [coordinates.topic, coordinates.partition, offset]);
        for (const candidate of candidates.rows) {
          const digest = createHash('sha256').update(value).digest('hex');
          if (digest !== candidate.raw_sha256 || !value.equals(candidate.raw_bytes)) { stats.mismatched++; continue; }
          await linkRecord(pool, { streamId: candidate.stream_id, eventId: candidate.event_id,
            topic: coordinates.topic, partition: coordinates.partition, offset,
            key: object.Key, versionId: body.VersionId, position: position - 1, digest, bucket });
          stats.linked++;
        }
      }
    }
    continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuation);
  return stats;
}

async function linkRecord(pool: Pool, record: { streamId: string; eventId: string; topic: string;
  partition: number; offset: string; key: string; versionId: string; position: number;
  digest: string; bucket: string }): Promise<void> {
  const client = await pool.connect();
  const uri = `s3://${record.bucket}/${record.key}?versionId=${encodeURIComponent(record.versionId)}#record=${record.position}`;
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO ingest.archive_links
      (stream_id,topic,partition,offset_value,object_key,version_id,record_position,raw_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [record.streamId, record.topic, record.partition, record.offset, record.key,
      record.versionId, record.position, record.digest]);
    await client.query(`UPDATE ingest.deliveries SET raw_uri=$5
      WHERE stream_id=$1 AND topic=$2 AND partition=$3 AND offset_value=$4 AND raw_uri IS NULL`,
    [record.streamId, record.topic, record.partition, record.offset, uri]);
    await client.query(`UPDATE core.item SET raw_uri=$2 WHERE current_event_id=$1 AND raw_uri IS NULL`,
      [record.eventId, uri]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
