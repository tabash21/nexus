import type { MigrationConnection } from '../migrations.js';
export interface CatalogEntry {
  kind: string;
  name: string;
  definition: string;
}
/** Compare PostgreSQL's actual definitions, including rules outside Drizzle's model snapshot. */
export async function readCatalog(client: MigrationConnection): Promise<CatalogEntry[]> {
  const result = await client.query(`
    WITH managed AS (SELECT oid,nspname FROM pg_namespace WHERE nspname IN ('core','ingest'))
    SELECT kind,name,definition FROM (
      SELECT 'relation' AS kind,n.nspname||'.'||c.relname AS name,
        jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity)::text AS definition
        FROM pg_class c JOIN managed n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S')
      UNION ALL
      SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,
        jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
          pg_get_expr(d.adbin,d.adrelid),coll.collname)::text
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN managed n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
        WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m')
      UNION ALL
      SELECT 'constraint',n.nspname||'.'||c.relname||'.'||k.conname,
        jsonb_build_array(pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)::text
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN managed n ON n.oid=c.relnamespace
      UNION ALL
      SELECT 'index',n.nspname||'.'||c.relname,
        jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)::text
        FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN managed n ON n.oid=c.relnamespace
      UNION ALL
      SELECT 'enum',n.nspname||'.'||t.typname,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)::text
        FROM pg_type t JOIN managed n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid GROUP BY n.nspname,t.typname
      UNION ALL
      SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
        FROM pg_proc p JOIN managed n ON n.oid=p.pronamespace
      UNION ALL
      SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled)::text
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN managed n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
      UNION ALL
      SELECT 'view',n.nspname||'.'||c.relname,pg_get_viewdef(c.oid)
        FROM pg_class c JOIN managed n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m')
      UNION ALL
      SELECT 'extension',e.extname,jsonb_build_array(n.nspname,e.extversion)::text
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('postgis','vector','pg_trgm')
    ) definitions ORDER BY kind,name`);
  return result.rows.map(row => ({
    kind: String(row.kind),
    name: String(row.name),
    definition: String(row.definition),
  }));
}
export function catalogDifferences(actual: CatalogEntry[], expected: CatalogEntry[]): string[] {
  const key = (row: CatalogEntry): string => row.kind + ':' + row.name;
  const a = new Map(actual.map(row => [key(row), row.definition]));
  const e = new Map(expected.map(row => [key(row), row.definition]));
  return [...new Set([...a.keys(), ...e.keys()])].filter(name => a.get(name) !== e.get(name)).sort();
}
