import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../schema/index.js';
export type IngestDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export type IngestTransaction = Parameters<Parameters<IngestDatabase['transaction']>[0]>[0];
