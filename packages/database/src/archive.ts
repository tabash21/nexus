import type pg from 'pg';

export interface UnlinkedDeliveryCandidate {
  stream_id: string;
  event_id: string;
  raw_bytes: Buffer;
  raw_sha256: string;
}

export interface ArchiveRecordLink {
  streamId: string;
  eventId: string;
  topic: string;
  partition: number;
  offset: string;
  key: string;
  versionId: string;
  position: number;
  digest: string;
  bucket: string;
}

/**
 * Finds deliveries matching the specified transport coordinates that have a delivery snapshot
 * but have not yet been linked to an archived S3 Avro object.
 */
export async function findUnlinkedArchiveCandidates(
  pool: pg.Pool,
  topic: string,
  partition: number,
  offset: string,
): Promise<UnlinkedDeliveryCandidate[]> {
  const query = `
    SELECT
      d.stream_id,
      d.event_id,
      s.raw_bytes,
      s.raw_sha256
    FROM ingest.deliveries d
    JOIN ingest.delivery_snapshots s
      USING (stream_id, topic, partition, offset_value)
    LEFT JOIN ingest.archive_links a
      USING (stream_id, topic, partition, offset_value)
    WHERE d.topic = $1
      AND d.partition = $2
      AND d.offset_value = $3
      AND a.object_key IS NULL
  `;

  const result = await pool.query<UnlinkedDeliveryCandidate>(query, [topic, partition, offset]);
  return result.rows;
}

/**
 * Atomically links an archived Avro record to ingest.archive_links, ingest.deliveries,
 * and core.item once exact byte parity is verified.
 */
export async function linkArchiveRecord(pool: pg.Pool, record: ArchiveRecordLink): Promise<void> {
  const client = await pool.connect();
  const uri = `s3://${record.bucket}/${record.key}?versionId=${encodeURIComponent(record.versionId)}#record=${record.position}`;

  try {
    await client.query('BEGIN');

    await client.query(
      `
      INSERT INTO ingest.archive_links (
        stream_id,
        topic,
        partition,
        offset_value,
        object_key,
        version_id,
        record_position,
        raw_sha256
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
      `,
      [
        record.streamId,
        record.topic,
        record.partition,
        record.offset,
        record.key,
        record.versionId,
        record.position,
        record.digest,
      ],
    );

    await client.query(
      `
      UPDATE ingest.deliveries
      SET raw_uri = $5
      WHERE stream_id = $1
        AND topic = $2
        AND partition = $3
        AND offset_value = $4
        AND raw_uri IS NULL
      `,
      [record.streamId, record.topic, record.partition, record.offset, uri],
    );

    await client.query(
      `
      UPDATE core.item
      SET raw_uri = $2
      WHERE current_event_id = $1
        AND raw_uri IS NULL
      `,
      [record.eventId, uri],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
