import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../packages/database/src/migrations.js';
import { createItemTestDatabase } from './helpers/item-database.js';

let fixture: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { fixture = await createItemTestDatabase(); }, 120000);
afterAll(async () => { await fixture?.pg.close(); });

describe('Artemis migration lifecycle', () => {
  it('reruns without applying migrations again and adopts the original checksum-free ledger', async () => {
    await fixture.pg.query('UPDATE public.schema_migrations SET checksum=NULL WHERE version=1');
    expect(await applyMigrations(fixture.connection, fixture.migrations)).toEqual([]);
    const result = await fixture.pg.query<{ checksum: string }>('SELECT checksum FROM public.schema_migrations WHERE version=1');
    expect(result.rows[0]?.checksum).toBe(fixture.migrations[0]?.checksum);
  });

  it('rejects changed migrations and releases its transaction after failure', async () => {
    const changed = fixture.migrations.map(migration => ({ ...migration, checksum: 'changed' }));
    await expect(applyMigrations(fixture.connection, changed)).rejects.toThrow('has changed');
    expect(await applyMigrations(fixture.connection, fixture.migrations)).toEqual([]);
  });

  it('rolls back both DDL and ledger records when a migration fails', async () => {
    const failing = { version: 3, sql: 'CREATE TABLE public.rollback_probe(id integer); SELECT * FROM public.nonexistent_probe;', checksum: 'test-only' };
    await expect(applyMigrations(fixture.connection, [...fixture.migrations, failing])).rejects.toThrow();
    const result = await fixture.pg.query<{ relation: string | null; count: number }>(
      "SELECT to_regclass('public.rollback_probe')::text AS relation, (SELECT count(*)::int FROM public.schema_migrations) AS count");
    expect(result.rows[0]).toEqual({ relation: null, count: 2 });
  });

  it('rejects database history from a newer release', async () => {
    await fixture.pg.query("INSERT INTO public.schema_migrations(version,checksum) VALUES(3,'future')");
    await expect(applyMigrations(fixture.connection, fixture.migrations)).rejects.toThrow('not a prefix');
    await fixture.pg.query('DELETE FROM public.schema_migrations WHERE version=3');
  });
});
