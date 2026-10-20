import { lstat, mkdir, mkdtemp, opendir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const attemptName = new RegExp(`^(${uuid})-(${uuid})-[a-zA-Z0-9]{6}$`);

async function temporaryRoot(scope: string): Promise<string> {
  if (!/^[a-f0-9]{32}$/.test(scope)) throw new Error('Invalid media temporary scope');
  const root = join(tmpdir(), `nexus-media-${scope}`);
  await mkdir(root, { mode: 0o700 }).catch((error: unknown) => {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
  });
  const info = await lstat(root);
  if (!info.isDirectory() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
    throw new Error('Media temporary root must be a private owned directory');
  }
  return root;
}

export async function createMediaTemporaryDirectory(scope: string, jobId: string, claimToken: string): Promise<string> {
  if (!new RegExp(`^${uuid}$`).test(jobId) || !new RegExp(`^${uuid}$`).test(claimToken)) {
    throw new Error('Invalid media temporary identity');
  }
  return mkdtemp(join(await temporaryRoot(scope), `${jobId}-${claimToken}-`));
}

/** Scope isolates databases; ownership/name checks exclude unrelated files and symbolic links. */
export async function reclaimMediaTemporaryFiles(
  scope: string,
  isActive: (jobId: string, claimToken: string) => Promise<boolean>,
): Promise<void> {
  const root = await temporaryRoot(scope);
  let scanned = 0;
  let removed = 0;
  for await (const entry of await opendir(root)) {
    if (++scanned > 256 || removed >= 100) break;
    const match = attemptName.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const path = join(root, entry.name);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isDirectory() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)))
      continue;
    if (!(await isActive(match[1]!, match[2]!))) {
      await rm(path, { recursive: true, force: true });
      removed++;
    }
  }
}
