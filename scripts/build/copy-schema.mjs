import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../../packages/database/src/schema.sql', import.meta.url), new URL('../../packages/database/dist/schema.sql', import.meta.url));
