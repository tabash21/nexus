import { copyFile, cp } from 'node:fs/promises';
await copyFile(new URL('../../packages/database/src/schema.sql', import.meta.url), new URL('../../packages/database/dist/schema.sql', import.meta.url));
await cp(new URL('../../packages/database/src/migrations', import.meta.url), new URL('../../packages/database/dist/migrations', import.meta.url), { recursive: true });
