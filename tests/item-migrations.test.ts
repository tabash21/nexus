import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { vector } from '@electric-sql/pglite/vector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationConfig, verifyMigrationHistory } from '../packages/database/src/migrations.js';
import { createItemTestDatabase } from './helpers/item-database.js';
let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => {
  f = await createItemTestDatabase();
}, 120000);
afterAll(async () => {
  await f?.pg.close();
});
describe('Built-in Drizzle migration lifecycle', () => {
  it('upgrades existing items and appends language fields without breaking dependent views', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-language-upgrade-'));
    const pg = new PGlite({ extensions: { postgis, vector, pg_trgm } });
    try {
      await cp(migrationConfig.migrationsFolder, directory, { recursive: true });
      const journalFile = path.join(directory, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalFile, 'utf8')) as { entries: { tag: string }[] };
      journal.entries = journal.entries.filter(entry => Number(entry.tag.slice(0, 4)) < 7);
      await writeFile(journalFile, JSON.stringify(journal));
      const db = drizzle(pg);
      await migrate(db, { migrationsFolder: directory });
      const eventId = randomUUID();
      await pg.query(
        "INSERT INTO core.source(reality_id,source_id,platform,source_kind) VALUES(0,$1,'telegram','channel')",
        ['upgrade-source'],
      );
      await pg.query(
        "INSERT INTO ingest.ingest_events(event_id,event_hash,schema_version,reality_id,observed_at) VALUES($1,'hash','item.v1',0,$2)",
        [eventId, '2026-10-13T09:00:00Z'],
      );
      await pg.query(
        `INSERT INTO core.item(item_id,reality_id,platform,native_id,item_type,source_id,
        published_at,published_at_source,collected_at,last_seen_at,content_text,content_hash,collector,provider,current_event_id)
        VALUES($1,0,'telegram','upgrade','post',$2,$3,'platform',$3,$3,$4,'hash','test','test',$5)`,
        ['upgrade-item', 'upgrade-source', '2026-10-13T09:00:00Z', 'טקסט מקורי', eventId],
      );
      await pg.query(
        `INSERT INTO core.classification(item_id,model,prompt_version,summary_en,classified_at,content_revision)
        VALUES($1,'test','1',$2,$3,1)`,
        ['upgrade-item', 'Existing English summary', '2026-10-13T09:00:00Z'],
      );
      await pg.exec('CREATE VIEW core.language_upgrade_probe AS SELECT item_id,summary_en FROM core.item_ds');
      const columns = () =>
        pg.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name='item_ds' ORDER BY ordinal_position",
        );
      const before = (await columns()).rows.map(row => row.column_name);

      await migrate(db, migrationConfig);
      await migrate(db, migrationConfig);

      expect((await columns()).rows.map(row => row.column_name)).toEqual([
        ...before,
        'eng_translation',
        'heb_translation',
        'heb_summary',
        'original_lang',
      ]);
      expect(
        (
          await pg.query(
            'SELECT item_id,content_text,content_revision,summary_en,eng_translation,heb_translation,heb_summary,original_lang FROM core.item_ds',
          )
        ).rows,
      ).toEqual([
        {
          item_id: 'upgrade-item',
          content_text: 'טקסט מקורי',
          content_revision: 1,
          summary_en: 'Existing English summary',
          eng_translation: null,
          heb_translation: null,
          heb_summary: null,
          original_lang: null,
        },
      ]);
      expect((await pg.query('SELECT * FROM core.language_upgrade_probe')).rows).toEqual([
        { item_id: 'upgrade-item', summary_en: 'Existing English summary' },
      ]);
      expect((await pg.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(f.migrations.length);
    } finally {
      await pg.close();
      if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
        throw new Error('Unexpected cleanup path');
      await rm(directory, { recursive: true, force: true });
    }
  }, 60000);

  it('reruns without applying migrations again', async () => {
    await migrate(f.db, migrationConfig);
    await verifyMigrationHistory(f.connection, true);
    expect((await f.pg.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(f.migrations.length);
  });
  it('rejects edited migration checksums', async () => {
    await f.pg.query("UPDATE drizzle.__drizzle_migrations SET hash='changed' WHERE created_at=$1", [
      f.migrations[0]!.folderMillis,
    ]);
    await expect(verifyMigrationHistory(f.connection)).rejects.toThrow('checksum/order mismatch');
    await f.pg.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE created_at=$2', [
      f.migrations[0]!.hash,
      f.migrations[0]!.folderMillis,
    ]);
  });
  it('rolls back DDL and migration records after failure', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nexus-migration-test-'));
    try {
      await cp(migrationConfig.migrationsFolder, directory, { recursive: true });
      const file = path.join(directory, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(file, 'utf8')) as {
        entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
      };
      journal.entries.push({
        idx: journal.entries.length,
        version: '7',
        when: journal.entries.at(-1)!.when + 1,
        tag: 'failure_probe',
        breakpoints: true,
      });
      await writeFile(file, JSON.stringify(journal));
      await writeFile(
        path.join(directory, 'failure_probe.sql'),
        'CREATE TABLE core.rollback_probe(id integer);\n--> statement-breakpoint\nSELECT * FROM core.nonexistent_probe;',
      );
      await expect(migrate(f.db, { migrationsFolder: directory })).rejects.toThrow();
      expect(
        (await f.pg.query<{ relation: string | null }>("SELECT to_regclass('core.rollback_probe')::text AS relation"))
          .rows[0]?.relation,
      ).toBeNull();
      await verifyMigrationHistory(f.connection, true);
    } finally {
      if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
        throw new Error('Unexpected cleanup path');
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
