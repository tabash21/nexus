import { and, asc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { item, mediaJobs } from '../schema/index.js';
import type { IngestDatabase } from '../types.js';
import { MEDIA_PROCESSOR_VERSION, type ClaimedMediaJob } from './types.js';

export async function claimMediaJobs(db: IngestDatabase, limit = 1, leaseSeconds = 90): Promise<ClaimedMediaJob[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 16 || leaseSeconds < 1)
    throw new Error('Invalid media claim limits');
  return db.transaction(async tx => {
    await tx
      .update(mediaJobs)
      .set({
        status: 'failed',
        claim_token: null,
        lease_until: null,
        outcome: 'timeout',
        last_error: 'Lease expired after final attempt',
        updated_at: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(mediaJobs.status, 'running'),
          lt(mediaJobs.lease_until, sql`clock_timestamp()`),
          gte(mediaJobs.attempts, mediaJobs.max_attempts),
        ),
      );

    const due = await tx
      .select()
      .from(mediaJobs)
      .where(
        and(
          eq(mediaJobs.processor_version, MEDIA_PROCESSOR_VERSION),
          lt(mediaJobs.attempts, mediaJobs.max_attempts),
          or(
            and(eq(mediaJobs.status, 'pending'), lte(mediaJobs.next_run_at, sql`clock_timestamp()`)),
            and(eq(mediaJobs.status, 'running'), lt(mediaJobs.lease_until, sql`clock_timestamp()`)),
          ),
        ),
      )
      .orderBy(asc(mediaJobs.created_at), asc(mediaJobs.job_id))
      .limit(limit)
      .for('update', { skipLocked: true });
    const claimed: ClaimedMediaJob[] = [];
    for (const job of due) {
      const [owner] = await tx.select({ realityId: item.reality_id }).from(item).where(eq(item.item_id, job.item_id));
      if (!owner) continue;
      const [row] = await tx
        .update(mediaJobs)
        .set({
          status: 'running',
          attempts: job.attempts + 1,
          claim_token: sql`gen_random_uuid()`,
          lease_until: sql`clock_timestamp() + ${leaseSeconds} * interval '1 second'`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(eq(mediaJobs.job_id, job.job_id))
        .returning();
      if (row?.claim_token) claimed.push({ ...row, claim_token: row.claim_token, reality_id: owner.realityId });
    }
    return claimed;
  });
}

export async function renewMediaJob(db: IngestDatabase, job: ClaimedMediaJob, leaseSeconds = 90): Promise<boolean> {
  const rows = await db
    .update(mediaJobs)
    .set({
      lease_until: sql`clock_timestamp() + ${leaseSeconds} * interval '1 second'`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(mediaJobs.job_id, job.job_id),
        eq(mediaJobs.claim_token, job.claim_token),
        eq(mediaJobs.status, 'running'),
        sql`${mediaJobs.lease_until} > clock_timestamp()`,
      ),
    )
    .returning({ id: mediaJobs.job_id });
  return rows.length === 1;
}
