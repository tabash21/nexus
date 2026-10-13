import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/database/dist/schema/index.js',
  out: './packages/database/drizzle',
  schemaFilter: ['core', 'ingest'],
  strict: true,
});
