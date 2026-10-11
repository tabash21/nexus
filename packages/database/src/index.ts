import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash, normalize, PROCESSOR_VERSION, type OsintEvent, type Delivery } from '@nexus/contracts';

export const { Pool } = pg;
export class EventConflictError extends Error {}
export function createPool(connectionString: string) {
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
}
export async function ingest(pool: pg.Pool, input: OsintEvent, delivery: Delivery) {
  const event = normalize(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO sources(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [event.source.id, event.source.name]);
    await client.query(`INSERT INTO ingest_events(id,source_id,event_hash,schema_version,observed_at,payload)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,
      [event.eventId, event.source.id, hash(event), event.schemaVersion, event.observedAt, event]);
    const existing = await client.query('SELECT event_hash FROM ingest_events WHERE id=$1', [event.eventId]);
    if (existing.rows[0]?.event_hash !== hash(event)) throw new EventConflictError('Event ID reused with different content');
    const delivered = await client.query(`INSERT INTO deliveries(stream_id,topic,partition,offset_value,event_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(stream_id,topic,partition,offset_value)
      DO UPDATE SET event_id=deliveries.event_id RETURNING event_id`,
      [delivery.streamId, delivery.topic, delivery.partition, delivery.offset, event.eventId]);
    if (delivered.rows[0]?.event_id !== event.eventId) throw new EventConflictError('Transport identity reused; check KAFKA_STREAM_ID');
    const receipt = await client.query(`INSERT INTO processing_receipts(event_id,processor_version)
      VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id`, [event.eventId, PROCESSOR_VERSION]);
    if (!receipt.rowCount) { await client.query('COMMIT'); return { duplicate: true }; }

    // Upsert locks the document row, serializing concurrent versions of the same document.
    const doc = await client.query(`INSERT INTO documents(id,source_id,external_id,first_seen_at,last_seen_at)
      VALUES($1,$2,$3,$4,$4) ON CONFLICT(source_id,external_id)
      DO UPDATE SET first_seen_at=LEAST(documents.first_seen_at,EXCLUDED.first_seen_at)
      RETURNING id,last_seen_at,current_version_id`, [randomUUID(), event.source.id, event.document.externalId, event.observedAt]);
    const document = doc.rows[0];
    const d = event.document;
    const version = await client.query(`INSERT INTO document_versions(id,document_id,content_hash,url,title,text,language,published_at,attributes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(document_id,content_hash)
      DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING id`,
      [randomUUID(), document.id, hash(d), d.url, d.title, d.text, d.language ?? null, d.publishedAt ?? null, d.attributes]);
    const versionId = version.rows[0].id;
    // Older observations must not overwrite the latest document. Equal timestamps use first arrival.
    if (!document.current_version_id || new Date(event.observedAt) > new Date(document.last_seen_at)) {
      await client.query('UPDATE documents SET current_version_id=$2,last_seen_at=$3 WHERE id=$1', [document.id, versionId, event.observedAt]);
    }
    await client.query('INSERT INTO event_documents(event_id,document_version_id,processor_version) VALUES($1,$2,$3)',
      [event.eventId, versionId, PROCESSOR_VERSION]);
    await client.query('COMMIT');
    return { duplicate: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export type ListOptions = { limit: number; source?: string; from?: string; to?: string; cursor?: { time: string; id: string } };
export function repository(pool: pg.Pool) {
  return {
    ready: async () => { await pool.query('SELECT 1 FROM processing_receipts LIMIT 1'); },
    list: async (options: ListOptions) => {
      const args: unknown[] = [];
      const conditions: string[] = [];
      const param = (value: unknown) => { args.push(value); return '$' + args.length; };
      if (options.source) conditions.push('d.source_id=' + param(options.source));
      if (options.from) conditions.push('d.last_seen_at>=' + param(options.from));
      if (options.to) conditions.push('d.last_seen_at<' + param(options.to));
      if (options.cursor) conditions.push('(d.last_seen_at,d.id)<(' + param(options.cursor.time) + ',' + param(options.cursor.id) + ')');
      const limit = param(options.limit + 1);
      const result = await pool.query(`SELECT d.id,d.source_id,d.external_id,d.last_seen_at,v.id AS version_id,v.title,v.url,v.language
        FROM documents d JOIN document_versions v ON v.id=d.current_version_id
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY d.last_seen_at DESC,d.id DESC LIMIT ${limit}`, args);
      return result.rows;
    },
    get: async (id: string) => {
      const result = await pool.query(`SELECT d.id,d.source_id,d.external_id,d.first_seen_at,d.last_seen_at,
        v.id AS version_id,v.title,v.url,v.text,v.language,v.published_at,v.attributes
        FROM documents d JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=$1`, [id]);
      return result.rows[0] ?? null;
    },
  };
}
