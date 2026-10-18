import type pg from 'pg';
import type { JobStatusStat } from './job.types.js';

/**
 * Resets a failed job to pending for retry, provided it still matches the item's current revision.
 */
export async function retryJob(pool: pg.Pool, jobId: string): Promise<boolean> {
  const query = `
    UPDATE ingest.enrichment_jobs j
    SET
      status = 'pending',
      attempts = 0,
      next_run_at = now(),
      claim_token = NULL,
      lease_until = NULL,
      last_error = NULL,
      updated_at = now()
    FROM core.item i
    WHERE j.job_id = $1
      AND j.status = 'failed'
      AND i.item_id = j.item_id
      AND i.content_revision = j.content_revision
  `;

  const result = await pool.query(query, [jobId]);
  return result.rowCount === 1;
}

/**
 * Idempotently schedules backfill jobs for a given processor across all items at their current revision.
 */
export async function backfillProcessor(pool: pg.Pool, jobType: string, processorVersion: string): Promise<number> {
  const query = `
    INSERT INTO ingest.enrichment_jobs (
      item_id,
      content_revision,
      event_id,
      job_type,
      processor_version,
      input_hash
    )
    SELECT
      i.item_id,
      i.content_revision,
      s.event_id,
      $1,
      $2,
      s.input_hash
    FROM core.item i
    JOIN ingest.input_snapshots s ON s.event_id = i.current_event_id
    ON CONFLICT ON CONSTRAINT job_identity DO NOTHING
  `;

  const result = await pool.query(query, [jobType, processorVersion]);
  return result.rowCount ?? 0;
}

/**
 * Returns summary counts and oldest creation timestamps for enrichment jobs grouped by status.
 */
export async function jobStats(pool: pg.Pool): Promise<JobStatusStat[]> {
  const query = `
    SELECT
      status,
      count(*)::text,
      min(created_at)::text AS oldest
    FROM ingest.enrichment_jobs
    GROUP BY status
  `;

  const result = await pool.query<JobStatusStat>(query);
  return result.rows;
}
