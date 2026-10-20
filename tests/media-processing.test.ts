import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimedMediaJob } from '@nexus/database';
import { processMediaJob } from '../apps/enrichment-worker/src/media/processing.js';
import type { MediaResources } from '../apps/enrichment-worker/src/media/types.js';
import { MediaError } from '../apps/enrichment-worker/src/media/errors.js';
import type { DownloadedMedia } from '../apps/enrichment-worker/src/media/files.js';

function harness() {
  const job: ClaimedMediaJob = {
    job_id: randomUUID(),
    item_id: '0:telegram:test',
    position: 0,
    attachment_generation: randomUUID(),
    processor_version: 'media-ocr.v1',
    source_url: 'https://media.example/a.png',
    media_type: 'image',
    status: 'running',
    attempts: 1,
    max_attempts: 3,
    claim_token: randomUUID(),
    reality_id: 0,
    lease_until: new Date(Date.now() + 90000).toISOString(),
    next_run_at: new Date().toISOString(),
    archive_uri: null,
    outcome: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const file = { path: '/fixture/image', format: 'png' as const, size: 1, sha256: 'a'.repeat(64) };
  const resources = {
    temporaryScope: 'a'.repeat(32),
    cleanupTemporary: vi.fn(async () => undefined),
    claim: vi.fn(async () => [job]),
    renew: vi.fn(async () => true),
    checkpoint: vi.fn(async () => 'accepted' as const),
    complete: vi.fn(async () => 'accepted' as const),
    fail: vi.fn(async () => 'accepted' as const),
    download: vi.fn(async (_url: string, _directory: string, _signal: AbortSignal) => file),
    archive: vi.fn(async () => 's3://test/media/fixture'),
    readArchive: vi.fn(async () => file),
    ocr: vi.fn(async (_media: DownloadedMedia, _directory: string, _signal: AbortSignal) => 'Recognized'),
    ready: vi.fn(async () => undefined),
    close: vi.fn(),
  } satisfies MediaResources;
  return { job, resources };
}

describe('attachment processing orchestration', () => {
  it('archives/checkpoints before OCR and removes its private temporary directory', async () => {
    const { job, resources } = harness();
    await processMediaJob(resources, job, new AbortController().signal);
    expect(resources.archive.mock.invocationCallOrder[0]).toBeLessThan(resources.ocr.mock.invocationCallOrder[0]!);
    expect(resources.checkpoint.mock.invocationCallOrder[0]).toBeLessThan(resources.ocr.mock.invocationCallOrder[0]!);
    expect(resources.complete).toHaveBeenCalledWith(job, 'Recognized');
    await expect(stat(resources.download.mock.calls[0]![1])).rejects.toThrow();
  });
  it('reuses a durable archive checkpoint after a restart', async () => {
    const { job, resources } = harness();
    job.archive_uri = 's3://test/previous-checkpoint';
    await processMediaJob(resources, job, new AbortController().signal);
    expect(resources.readArchive).toHaveBeenCalledOnce();
    expect(resources.download).not.toHaveBeenCalled();
    expect(resources.archive).not.toHaveBeenCalled();
    expect(resources.complete).toHaveBeenCalledOnce();
  });
  it('discards a stale archive result before invoking OCR', async () => {
    const { job, resources } = harness();
    const r: MediaResources = { ...resources, checkpoint: async () => 'stale' };
    await processMediaJob(r, job, new AbortController().signal);
    expect(resources.ocr).not.toHaveBeenCalled();
    expect(resources.complete).not.toHaveBeenCalled();
  });
  it('stores a missing-URL outcome without invoking download', async () => {
    const { job, resources } = harness();
    job.source_url = null;
    await processMediaJob(resources, job, new AbortController().signal);
    expect(resources.download).not.toHaveBeenCalled();
    expect(resources.fail).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ outcome: 'missing_url', retryable: false }),
    );
  });
  it('keeps infrastructure failures unsuccessful and lets persistence failures propagate', async () => {
    const { job, resources } = harness();
    resources.ocr.mockRejectedValue(new MediaError('infrastructure', true));
    resources.fail.mockRejectedValue(new Error('Database connection lost'));
    await expect(processMediaJob(resources, job, new AbortController().signal)).rejects.toThrow(
      'Database connection lost',
    );
    expect(resources.complete).not.toHaveBeenCalled();
  });
  it('cancels in-flight work on shutdown', async () => {
    const { job, resources } = harness();
    resources.ocr.mockImplementation(
      async (_media, _directory, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const shutdown = new AbortController();
    const pending = processMediaJob(resources, job, shutdown.signal);
    await vi.waitFor(() => expect(resources.ocr).toHaveBeenCalledOnce());
    shutdown.abort();
    await pending;
    expect(resources.complete).not.toHaveBeenCalled();
    expect(resources.fail).toHaveBeenCalledWith(job, expect.objectContaining({ outcome: 'cancelled' }));
  });
});
