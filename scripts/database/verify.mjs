import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { applyMigrations, verifyMigrationHistory } from '../../packages/database/dist/migrations.js';
import { readCatalog, catalogDifferences } from '../../packages/database/dist/verification/catalog.js';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const target = new pg.Pool({ connectionString: url, options: '-c search_path=public' });
const name = 'nexus_verify_' + randomUUID().replaceAll('-', '');
let reference;
let created = false;
try {
  await verifyMigrationHistory(target, true);
  const referenceUrl = new URL(process.env.SCHEMA_REFERENCE_DATABASE_URL || url);
  if (!process.env.SCHEMA_REFERENCE_DATABASE_URL) {
    // The identifier is generated here, never taken from user data.
    await target.query('CREATE DATABASE "' + name + '"');
    created = true;
    referenceUrl.pathname = '/' + name;
  }
  reference = new pg.Pool({ connectionString: referenceUrl.toString(), options: '-c search_path=public' });
  if (created) await applyMigrations(reference);
  await verifyMigrationHistory(reference, true);
  const differences = catalogDifferences(await readCatalog(target), await readCatalog(reference));
  if (differences.length) throw new Error('Database schema drift: ' + differences.join(', '));
  console.log('Live PostgreSQL schema and migration history match the release');
} finally {
  await reference?.end();
  try { if (created) await target.query('DROP DATABASE "' + name + '"'); }
  finally { await target.end(); }
}
