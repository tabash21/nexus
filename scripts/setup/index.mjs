import { setupTopics } from './topics.mjs';

await import('../../packages/database/dist/migrate.js');
if (process.env.VERIFY_DATABASE_SCHEMA === 'true') await import('../database/verify.mjs');
await setupTopics();
