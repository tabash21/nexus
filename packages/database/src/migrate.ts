import { createPool } from './pool.js';
import { applyMigrations } from './migrations.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url);
try { await applyMigrations(pool); console.log('Drizzle migrations applied and history verified'); }
finally { await pool.end(); }
