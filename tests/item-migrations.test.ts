import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationConfig, verifyMigrationHistory } from '../packages/database/src/migrations.js';
import { createItemTestDatabase } from './helpers/item-database.js';
let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { f = await createItemTestDatabase(); }, 120000);
afterAll(async () => { await f?.pg.close(); });
describe('Built-in Drizzle migration lifecycle', () => {
  it('reruns without applying migrations again', async () => {
    await migrate(f.db, migrationConfig);
    await verifyMigrationHistory(f.connection, true);
    expect((await f.pg.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(f.migrations.length);
  });
  it('rejects edited migration checksums', async () => {
    await f.pg.query("UPDATE drizzle.__drizzle_migrations SET hash='changed' WHERE created_at=$1", [f.migrations[0]!.folderMillis]);
    await expect(verifyMigrationHistory(f.connection)).rejects.toThrow('checksum/order mismatch');
    await f.pg.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE created_at=$2', [f.migrations[0]!.hash, f.migrations[0]!.folderMillis]);
  });
  it('rolls back DDL and migration records after failure', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-migration-test-'));
    try {
      await cp(migrationConfig.migrationsFolder, directory, { recursive: true });
      const file = path.join(directory, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(file, 'utf8')) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
      journal.entries.push({ idx: journal.entries.length, version: '7', when: journal.entries.at(-1)!.when + 1, tag: 'failure_probe', breakpoints: true });
      await writeFile(file, JSON.stringify(journal));
      await writeFile(path.join(directory, 'failure_probe.sql'), 'CREATE TABLE core.rollback_probe(id integer);\n--> statement-breakpoint\nSELECT * FROM core.nonexistent_probe;');
      await expect(migrate(f.db, { migrationsFolder: directory })).rejects.toThrow();
      expect((await f.pg.query<{ relation: string | null }>("SELECT to_regclass('core.rollback_probe')::text AS relation")).rows[0]?.relation).toBeNull();
      await verifyMigrationHistory(f.connection, true);
    } finally {
      if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unexpected cleanup path');
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects database history from a newer release', async () => {
    const time = f.migrations.at(-1)!.folderMillis + 1;
    await f.pg.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES('future',$1)", [time]);
    await expect(verifyMigrationHistory(f.connection)).rejects.toThrow('checksum/order mismatch');
    await f.pg.query('DELETE FROM drizzle.__drizzle_migrations WHERE created_at=$1', [time]);
  });
});
