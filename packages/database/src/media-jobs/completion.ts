import { and, eq, sql } from 'drizzle-orm';
import { itemMedia, mediaJobs } from '../schema/index.js';
import type { IngestDatabase, IngestTransaction } from '../types.js';
import type { ClaimedMediaJob, MediaFailure, MediaOutcome, MediaWriteResult } from './types.js';

/** All media writes take the same item advisory lock as ingestion before locking job/media rows. */
async function fencedWrite(
  db: IngestDatabase,
  job: ClaimedMediaJob,
  write: (tx: IngestTransaction) => Promise<void>,
): Promise<MediaWriteResult> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${job.item_id},0))`);
    const [owned] = await tx
      .select()
      .from(mediaJobs)
      .where(
        and(
          eq(mediaJobs.job_id, job.job_id),
          eq(mediaJobs.claim_token, job.claim_token),
          eq(mediaJobs.status, 'running'),
          sql`${mediaJobs.lease_until} > clock_timestamp()`,
        ),
      )
      .for('update');
    if (!owned) return 'lost';
    const [media] = await tx
      .select()
      .from(itemMedia)
      .where(and(eq(itemMedia.item_id, job.item_id), eq(itemMedia.position, job.position)))
      .for('update');
    if (media?.attachment_generation !== job.attachment_generation) {
      await tx
        .update(mediaJobs)
        .set({ status: 'stale', claim_token: null, lease_until: null, updated_at: sql`clock_timestamp()` })
        .where(eq(mediaJobs.job_id, job.job_id));
      return 'stale';
    }
    await write(tx);
    return 'accepted';
  });
}

export async function checkpointMediaArchive(
  db: IngestDatabase,
  job: ClaimedMediaJob,
  uri: string,
): Promise<MediaWriteResult> {
  return fencedWrite(db, job, async tx => {
    await tx
      .update(itemMedia)
      .set({ s3_uri: uri })
      .where(and(eq(itemMedia.item_id, job.item_id), eq(itemMedia.position, job.position)));
    await tx
      .update(mediaJobs)
      .set({ archive_uri: uri, updated_at: sql`clock_timestamp()` })
      .where(eq(mediaJobs.job_id, job.job_id));
  });
}

export async function finishMediaJob(
  db: IngestDatabase,
  job: ClaimedMediaJob,
  text: string,
): Promise<MediaWriteResult> {
  return fencedWrite(db, job, async tx => {
    await tx
      .update(itemMedia)
      .set({ ocr_text: text })
      .where(and(eq(itemMedia.item_id, job.item_id), eq(itemMedia.position, job.position)));
    await tx
      .update(mediaJobs)
      .set({
        status: 'succeeded',
        outcome: text ? 'text' : 'no_text',
        claim_token: null,
        lease_until: null,
        last_error: null,
        updated_at: sql`clock_timestamp()`,
      })
      .where(eq(mediaJobs.job_id, job.job_id));
  });
}

/** Store stable error codes only: signed source URLs and native-tool output may contain secrets. */
export async function failMediaJob(
  db: IngestDatabase,
  job: ClaimedMediaJob,
  failure: MediaFailure,
): Promise<MediaWriteResult> {
  return fencedWrite(db, job, async tx => {
    const retry = failure.retryable && job.attempts < job.max_attempts;
    await tx
      .update(mediaJobs)
      .set({
        status: retry ? 'pending' : 'failed',
        outcome: failure.outcome,
        last_error: failure.outcome,
        claim_token: null,
        lease_until: null,
        next_run_at: sql`clock_timestamp() + ${Math.min(120, 5 * 2 ** (job.attempts - 1))} * interval '1 second'`,
        updated_at: sql`clock_timestamp()`,
      })
      .where(eq(mediaJobs.job_id, job.job_id));
  });
}

export function terminalMediaFailure(outcome: MediaOutcome): MediaFailure {
  return { outcome, retryable: false };
}
