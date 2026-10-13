import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface Migration {
  version: number;
  sql: string;
  checksum: string;
}
export interface MigrationConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function loadMigrations(): Promise<Migration[]> {
  const legacy = await readFile(new URL('./migrations/0001_legacy.sql', import.meta.url), 'utf8');
  const entries = parseJournal(JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')));
  const result: Migration[] = [{ version: 1, sql: legacy, checksum: digest(legacy) }];
  for (const [position, entry] of entries.entries()) {
    if (position !== entry.idx) throw new Error('Migration journal must be ordered and contiguous');
    const sql = await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
    result.push({ version: entry.idx + 2, sql, checksum: digest(sql) });
  }
  return result;
}

/** One lock and transaction protect both the DDL and its recorded checksums. */
export async function applyMigrations(client: MigrationConnection, migrations: readonly Migration[]): Promise<number[]> {
  const applied: number[] = [];
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL statement_timeout = '0'");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock(78234623)');
    await client.query('SET LOCAL search_path = public');
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version integer PRIMARY KEY, applied_at timestamptz DEFAULT now(), checksum text)`);
    await client.query('ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    const existing = await client.query('SELECT version, checksum FROM public.schema_migrations ORDER BY version');
    const byVersion = new Map(existing.rows.map(row => [Number(row.version), row.checksum]));
    if (existing.rows.some((row, index) => migrations[index]?.version !== Number(row.version))) {
      throw new Error('Database migration history is not a prefix of this release');
    }
    for (const migration of migrations) {
      if (byVersion.has(migration.version)) {
        const checksum = byVersion.get(migration.version);
        // The previous runner recorded only version 1, without checksums.
        if (checksum == null && migration.version === 1) {
          await client.query('UPDATE public.schema_migrations SET checksum=$2 WHERE version=$1', [1, migration.checksum]);
        } else if (checksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.version} has changed`);
        }
        continue;
      }
      if (migration.version === 2) await checkExtensions(client);
      await client.query(migration.sql);
      await client.query('INSERT INTO public.schema_migrations(version,checksum) VALUES($1,$2)', [migration.version, migration.checksum]);
      applied.push(migration.version);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function checkExtensions(client: MigrationConnection): Promise<void> {
  const required = ['postgis', 'vector', 'pg_trgm'];
  const available = await client.query('SELECT name FROM pg_available_extensions WHERE name = ANY($1::text[])', [required]);
  const missing = required.filter(name => !available.rows.some(row => row.name === name));
  if (missing.length) throw new Error(`PostgreSQL extensions unavailable: ${missing.join(', ')}. See docs/database/README.md.`);
}

function digest(sql: string): string {
  return createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
}

function parseJournal(value: unknown): { idx: number; tag: string }[] {
  if (typeof value !== 'object' || value === null || !('entries' in value) || !Array.isArray(value.entries)) {
    throw new Error('Invalid migration journal');
  }
  return value.entries.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('idx' in entry) || !('tag' in entry)
      || typeof entry.idx !== 'number' || !Number.isInteger(entry.idx) || entry.idx < 0
      || typeof entry.tag !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(entry.tag)) {
      throw new Error('Invalid migration journal entry');
    }
    return { idx: entry.idx, tag: entry.tag };
  });
}
