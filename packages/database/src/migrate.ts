import { createPool } from './pool.js';
import { applyMigrations, loadMigrations } from './migrations.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url);
const client = await pool.connect();
try {
  const versions = await applyMigrations(client, await loadMigrations());
  console.log(versions.length ? `Database migrations applied: ${versions.join(', ')}` : 'Database migrations already applied');
}
finally { client.release(); await pool.end(); }
