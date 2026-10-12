import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const srcPublic = new URL('../src/public', import.meta.url);
const distPublic = new URL('../dist/public', import.meta.url);

if (existsSync(srcPublic)) {
  await mkdir(distPublic, { recursive: true });
  await cp(srcPublic, distPublic, { recursive: true });
}
