import { fileURLToPath } from 'node:url';
import { readMigrationFiles, type MigrationConfig, type MigrationMeta } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

export const migrationConfig: MigrationConfig = {
  migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
};
export const loadMigrations = (): MigrationMeta[] => readMigrationFiles(migrationConfig);
export interface MigrationConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
/** Drizzle applies migrations; this guard detects edited or missing deployed history. */
export async function verifyMigrationHistory(client: MigrationConnection, complete = false): Promise<void> {
  const migrations = loadMigrations();
  const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
  const history = exists.rows[0]?.name
    ? (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows
    : [];
  if (
    history.some(
      (row, index) =>
        row.hash !== migrations[index]?.hash || Number(row.created_at) !== migrations[index]?.folderMillis,
    )
  ) {
    throw new Error('Database migration history differs from this release (checksum/order mismatch)');
  }
  if (complete && history.length !== migrations.length) throw new Error('Database has pending migrations');
}

export async function applyMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // A session lock wraps the built-in migrator, which manages its own transaction.
    await client.query('SET statement_timeout=0');
    await client.query("SET lock_timeout='30s'");
    await client.query('SELECT pg_advisory_lock(78234623)');
    await verifyMigrationHistory(client);
    await migrate(drizzle(client), migrationConfig);
    await verifyMigrationHistory(client, true);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(78234623)');
    } finally {
      client.release(true);
    }
  }
}
