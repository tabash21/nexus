import type pg from 'pg';

export type ListOptions = {
  limit: number;
  source?: string;
  from?: string;
  to?: string;
  cursor?: { time: string; id: string };
};

export interface DocumentListItem {
  id: string;
  source_id: string;
  external_id: string;
  last_seen_at: Date | string;
  version_id: string;
  title: string;
  url: string;
  language: string | null;
}

export interface DocumentDetail {
  id: string;
  source_id: string;
  external_id: string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  version_id: string;
  title: string;
  url: string;
  text: string;
  language: string | null;
  published_at: Date | string | null;
  attributes: Record<string, unknown>;
}

export function repository(pool: pg.Pool) {
  return {
    ready: async (): Promise<void> => {
      await pool.query('SELECT 1 FROM processing_receipts LIMIT 1');
    },
    list: async (options: ListOptions): Promise<DocumentListItem[]> => {
      const args: unknown[] = [];
      const conditions: string[] = [];
      const param = (value: unknown): string => {
        args.push(value);
        return '$' + args.length;
      };
      if (options.source) conditions.push('d.source_id=' + param(options.source));
      if (options.from) conditions.push('d.last_seen_at>=' + param(options.from));
      if (options.to) conditions.push('d.last_seen_at<' + param(options.to));
      if (options.cursor) {
        conditions.push('(d.last_seen_at,d.id)<(' + param(options.cursor.time) + ',' + param(options.cursor.id) + ')');
      }
      const limit = param(options.limit + 1);
      const result = await pool.query<DocumentListItem>(
        `SELECT d.id,d.source_id,d.external_id,d.last_seen_at,v.id AS version_id,v.title,v.url,v.language
         FROM documents d JOIN document_versions v ON v.id=d.current_version_id
         ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
         ORDER BY d.last_seen_at DESC,d.id DESC LIMIT ${limit}`,
        args,
      );
      return result.rows;
    },
    get: async (id: string): Promise<DocumentDetail | null> => {
      const result = await pool.query<DocumentDetail>(
        `SELECT d.id,d.source_id,d.external_id,d.first_seen_at,d.last_seen_at,
                v.id AS version_id,v.title,v.url,v.text,v.language,v.published_at,v.attributes
         FROM documents d JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=$1`,
        [id],
      );
      return result.rows[0] ?? null;
    },
  };
}

export type DocumentRepository = ReturnType<typeof repository>;
