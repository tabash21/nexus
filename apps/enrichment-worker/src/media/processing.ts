import { rm } from 'node:fs/promises';
import type { ClaimedMediaJob } from '@nexus/database';
import { MEDIA_POLICY } from './policy.js';
import { MediaError, classifyMediaError } from './errors.js';
import type { MediaResources } from './types.js';
import { createMediaTemporaryDirectory } from './temporary.js';

export async function processMediaJob(
  resources: MediaResources,
  job: ClaimedMediaJob,
  shutdown: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([shutdown, controller.signal, AbortSignal.timeout(MEDIA_POLICY.attemptMs)]);
  const directory = await createMediaTemporaryDirectory(resources.temporaryScope, job.job_id, job.claim_token);
  let renewing: Promise<void> | undefined;
  const renew = setInterval(() => {
    if (renewing) return;
    renewing = resources
      .renew(job)
      .then(
        owned => {
          if (!owned) controller.abort();
        },
        () => controller.abort(),
      )
      .finally(() => {
        renewing = undefined;
      });
  }, 30000);
  renew.unref();
  try {
    if (job.media_type !== 'image' && job.media_type !== 'document') throw new MediaError('unsupported_format');
    if (!job.archive_uri && !job.source_url) throw new MediaError('missing_url');
    const media = job.archive_uri
      ? await resources.readArchive(job, directory, signal)
      : await resources.download(job.source_url!, directory, signal);
    if (!job.archive_uri) {
      const uri = await resources.archive(job, media, signal);
      if ((await resources.checkpoint(job, uri)) !== 'accepted') return;
    }
    const text = await resources.ocr(media, directory, signal);
    signal.throwIfAborted();
    await resources.complete(job, text);
  } catch (error) {
    // Infrastructure failures in persistence must propagate to the supervisor, never become success.
    await resources.fail(job, classifyMediaError(error, signal));
  } finally {
    clearInterval(renew);
    await renewing;
    await rm(directory, { recursive: true, force: true });
  }
}
