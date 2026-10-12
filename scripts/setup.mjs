import { setupTopics } from './topics.mjs';

await import('../packages/database/dist/migrate.js');
await setupTopics();
await import('./register-archive.mjs');
