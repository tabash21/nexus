import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blankMediaPng } from './helpers/media-fixtures.js';
import { createMediaFixtureServer } from './helpers/media-server.js';

describe('real HTTPS attachment retrieval', () => {
  let server: Awaited<ReturnType<typeof createMediaFixtureServer>>;
  const bytes = blankMediaPng();
  beforeAll(async () => {
    server = await createMediaFixtureServer(new Map([['/image', bytes]]));
  });
  afterAll(async () => {
    await server?.close();
  });

  it('streams exact attachment bytes over certificate-verified TLS', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-tls-test-'));
    try {
      const file = await server.download('https://media.nexus.test/image', directory, AbortSignal.timeout(5000));
      expect(await readFile(file.path)).toEqual(bytes);
      expect(file.format).toBe('png');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('classifies missing/expired files and blocks a private redirect over real HTTP responses', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexus-tls-errors-'));
    try {
      server.expired.add('/expired');
      for (const [path, outcome] of [
        ['/missing', 'missing'],
        ['/expired', 'forbidden_or_expired'],
        ['/redirect-private', 'unsafe_url'],
      ]) {
        await expect(
          server.download('https://media.nexus.test' + path, directory, AbortSignal.timeout(5000)),
        ).rejects.toThrow(outcome);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
