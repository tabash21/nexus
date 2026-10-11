import { readFile } from 'node:fs/promises';
import { createPool } from './index.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(78234623)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const existing = await client.query('SELECT version FROM schema_migrations WHERE version=1');
  if (!existing.rowCount) {
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await client.query('INSERT INTO schema_migrations(version) VALUES(1)');
  }
  await client.query('COMMIT');
  console.log('Database migrations applied');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
