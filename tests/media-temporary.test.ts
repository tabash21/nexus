import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMediaTemporaryDirectory,
  reclaimMediaTemporaryFiles,
} from '../apps/enrichment-worker/src/media/temporary.js';

const scope = () => randomUUID().replaceAll('-', '');

describe('media temporary file crash recovery', () => {
  it('reclaims files after an actual process kill skips finally', async () => {
    const namespace = scope();
    const script = `
      import { createMediaTemporaryDirectory } from './apps/enrichment-worker/dist/media/temporary.js';
      import { writeFile } from 'node:fs/promises';
      const directory = await createMediaTemporaryDirectory(process.argv[1], process.argv[2], process.argv[3]);
      await writeFile(directory + '/source', Buffer.alloc(1024 * 1024));
      process.stdout.write(directory + '\\n');
      setInterval(() => {}, 1000);
    `;
    const job = randomUUID();
    const token = randomUUID();
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, namespace, job, token], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let directory: string | undefined;
    try {
      const [data] = (await once(child.stdout!, 'data', { signal: AbortSignal.timeout(5000) })) as [Buffer];
      directory = data.toString('utf8').trim();
      child.kill('SIGKILL');
      await exited;
      expect((await stat(join(directory, 'source'))).size).toBe(1024 * 1024);
      await reclaimMediaTemporaryFiles(namespace, async (jobId, claimToken) => {
        expect(jobId).toBe(job);
        expect(claimToken).toBe(token);
        return false;
      });
      await expect(stat(directory)).rejects.toThrow();
    } finally {
      child.kill('SIGKILL');
      await exited;
      if (directory) await rm(dirname(directory), { recursive: true, force: true });
    }
  });

  it('preserves live claims, other database scopes, and symbolic-link targets', async () => {
    const namespace = scope();
    const otherNamespace = scope();
    const liveToken = randomUUID();
    const staleToken = randomUUID();
    const live = await createMediaTemporaryDirectory(namespace, randomUUID(), liveToken);
    const stale = await createMediaTemporaryDirectory(namespace, randomUUID(), staleToken);
    const other = await createMediaTemporaryDirectory(otherNamespace, randomUUID(), randomUUID());
    const link = join(dirname(live), `${randomUUID()}-${randomUUID()}-Ab1234`);
    try {
      await writeFile(join(other, 'source'), 'other deployment');
      await symlink(other, link, 'dir');
      await reclaimMediaTemporaryFiles(namespace, async (_job, token) => token === liveToken);
      expect((await stat(live)).isDirectory()).toBe(true);
      expect((await stat(join(other, 'source'))).isFile()).toBe(true);
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      await expect(stat(stale)).rejects.toThrow();
    } finally {
      await rm(dirname(live), { recursive: true, force: true });
      await rm(dirname(other), { recursive: true, force: true });
    }
  });
});
