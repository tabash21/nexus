import { randomUUID } from 'node:crypto';
import { Pool } from '@nexus/database';
import { applyMigrations } from '../../packages/database/src/migrations.js';
export async function disposablePostgres(url: string) {
  const name = 'nexus_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  try { await admin.query('CREATE DATABASE "' + name + '"'); }
  catch (error) { await admin.end(); throw error; }
  const connectionUrl = new URL(url); connectionUrl.pathname = '/' + name;
  const pool = new Pool({ connectionString: connectionUrl.toString() });
  const close = async (): Promise<void> => {
    await pool.end();
    try { await admin.query('DROP DATABASE "' + name + '"'); } finally { await admin.end(); }
  };
  try { await applyMigrations(pool); return { pool, url: connectionUrl.toString(), close }; }
  catch (error) { await close(); throw error; }
}
