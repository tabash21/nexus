import { sql } from 'drizzle-orm';
import { bigint, char, check, foreignKey, index, integer, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { core, geographyPoint } from './base.js';
import { reality } from './reality.js';

export const entity = core.table('entity', {
  entity_id: text('entity_id').notNull(),
  type: text('type').notNull(),
  canonical_name: text('canonical_name').notNull(),
  country: char('country', { length: 2 }),
  admin1: text('admin1'),
  geonames_id: bigint('geonames_id', { mode: 'bigint' }),
  geom: geographyPoint('geom'),
  reality_id: integer('reality_id').notNull().default(sql`0`),
}, t => [
  primaryKey({ name: 'entity_pk', columns: [t.reality_id, t.entity_id] }),
  foreignKey({ name: 'entity_reality_fk', columns: [t.reality_id], foreignColumns: [reality.reality_id] }).onDelete('restrict'),
  check('entity_type_allowed', sql`type IN ('PER','ORG','LOC')`),
  check('entity_place_properties', sql`type = 'LOC' OR (country IS NULL AND admin1 IS NULL AND geonames_id IS NULL AND geom IS NULL)`),
  unique('entity_identity_type').on(t.reality_id, t.entity_id, t.type),
  index('entity_geom_idx').using('gist', t.geom),
]);

export type EntityRow = typeof entity.$inferSelect;
export type NewEntity = typeof entity.$inferInsert;
