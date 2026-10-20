import { and, eq, sql } from 'drizzle-orm';
import { mediaJobs } from '../schema/index.js';
import type { IngestDatabase } from '../types.js';

/** A retired claim token is never reused, so false also authorizes reclaiming its abandoned files. */
export async function isMediaClaimActive(db: IngestDatabase, jobId: string, claimToken: string): Promise<boolean> {
  const [active] = await db
    .select({ id: mediaJobs.job_id })
    .from(mediaJobs)
    .where(
      and(
        eq(mediaJobs.job_id, jobId),
        eq(mediaJobs.claim_token, claimToken),
        eq(mediaJobs.status, 'running'),
        sql`${mediaJobs.lease_until} > clock_timestamp()`,
      ),
    )
    .limit(1);
  return active !== undefined;
}
