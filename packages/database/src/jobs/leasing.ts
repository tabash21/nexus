import type pg from 'pg';
import type { ClaimedJob } from './job.types.js';

/**
 * Atomically claims up to `limit` pending or lease-expired enrichment jobs using `SKIP LOCKED`.
 * Returns the claimed jobs joined with their input snapshot and Silver item content.
 */
export async function claimJobs(pool: pg.Pool, limit: number, leaseSeconds = 90): Promise<ClaimedJob[]> {
  // Mark expired running jobs that reached max attempts as failed before claiming
  await pool.query(
    `
    UPDATE ingest.enrichment_jobs
    SET
      status = 'failed',
      claim_token = NULL,
      lease_until = NULL,
      last_error = COALESCE(last_error, 'Lease expired after final attempt'),
      updated_at = now()
    WHERE status = 'running'
      AND lease_until < now()
      AND attempts >= max_attempts
    `,
  );

  const query = `
    WITH due AS (
      SELECT job_id
      FROM ingest.enrichment_jobs
      WHERE (
        (status = 'pending' AND next_run_at <= now())
        OR (status = 'running' AND lease_until < now())
      )
      AND attempts < max_attempts
      ORDER BY created_at, job_id
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    ),
    claimed AS (
      UPDATE ingest.enrichment_jobs j
      SET
        status = 'running',
        attempts = j.attempts + 1,
        claim_token = gen_random_uuid(),
        lease_until = now() + ($2::int * interval '1 second'),
        updated_at = now()
      FROM due
      WHERE j.job_id = due.job_id
      RETURNING j.*
    )
    SELECT
      c.job_id::text,
      c.item_id,
      c.content_revision::text,
      c.event_id,
      c.job_type,
      c.processor_version,
      c.input_hash,
      c.claim_token::text,
      c.attempts,
      s.raw_bytes,
      s.raw_payload,
      i.platform,
      i.title,
      i.content_text,
      i.lang,
      i.url,
      i.published_at::text,
      i.source_id,
      i.author_id
    FROM claimed c
    JOIN ingest.input_snapshots s ON s.event_id = c.event_id
    JOIN core.item i ON i.item_id = c.item_id
    ORDER BY c.created_at, c.job_id
  `;

  const result = await pool.query<ClaimedJob>(query, [limit, leaseSeconds]);
  return result.rows;
}

/**
 * Extends the lease timeout for an active running job.
 * Returns true if the lease was successfully renewed, or false if the claim was lost.
 */
export async function renewJob(
  pool: pg.Pool,
  job: Pick<ClaimedJob, 'job_id' | 'claim_token'>,
  leaseSeconds = 90,
): Promise<boolean> {
  const query = `
    UPDATE ingest.enrichment_jobs
    SET
      lease_until = now() + ($3::int * interval '1 second'),
      updated_at = now()
    WHERE job_id = $1
      AND claim_token = $2
      AND status = 'running'
      AND lease_until > now()
  `;

  const result = await pool.query(query, [job.job_id, job.claim_token, leaseSeconds]);
  return result.rowCount === 1;
}
