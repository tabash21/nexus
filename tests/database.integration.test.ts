import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, ingest } from '@nexus/database';
import { event, delivery } from './fixtures.js';
const url = process.env.INTEGRATION_DATABASE_URL;
const schema = 'test_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: '-c search_path=' + schema });
describe.skipIf(!url)('concurrent ingestion on PostgreSQL server', () => {
  beforeAll(async () => {
    await admin.query('CREATE SCHEMA ' + schema);
    await pool.query(await readFile(new URL('../packages/database/src/schema.sql', import.meta.url), 'utf8'));
  });
  afterAll(async () => {
    await pool.end();
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  });
  it('serializes concurrent duplicate events into one committed observation', async () => {
    const e = event();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => ingest(pool, e, delivery(String(i)))));
    expect(results.filter(r => !r.duplicate)).toHaveLength(1);
    expect((await pool.query('SELECT * FROM processing_receipts')).rows).toHaveLength(1);
    expect((await pool.query('SELECT * FROM deliveries')).rows).toHaveLength(5);
  });
});
