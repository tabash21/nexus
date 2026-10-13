import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const kit = path.join(path.dirname(require.resolve('drizzle-kit')), 'bin.cjs');
const scratchRoot = path.resolve('.turbo');
await mkdir(scratchRoot, { recursive: true });
const directory = await mkdtemp(path.join(scratchRoot, 'nexus-migration-check-'));
try {
  await cp('packages/database/drizzle', directory, { recursive: true });
  const journal = path.join(directory, 'meta/_journal.json');
  const before = await readFile(journal, 'utf8');
  execFileSync(process.execPath, [kit, 'check', '--config', 'packages/database/drizzle.config.ts'], { stdio: 'inherit' });
  const result = execFileSync(process.execPath, [kit, 'generate', '--dialect', 'postgresql',
    '--schema', './packages/database/dist/schema/index.js', '--out', path.relative(process.cwd(), directory).replaceAll(path.sep, '/'), '--name', 'uncommitted_changes'],
    { encoding: 'utf8', input: '', timeout: 60000 });
  if (before !== await readFile(journal, 'utf8') || !result.includes('No schema changes')) {
    throw new Error('Drizzle models have changes without a committed migration. Run npm run db:generate.');
  }
  console.log('Drizzle model snapshot matches migration history');
} finally {
  if (!path.resolve(directory).startsWith(scratchRoot + path.sep)) throw new Error('Unexpected cleanup path');
  await rm(directory, { recursive: true, force: true });
}
