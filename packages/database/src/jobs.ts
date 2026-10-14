import type pg from 'pg';

export interface ClaimedJob {
  job_id: string;
  item_id: string;
  content_revision: string;
  event_id: string;
  job_type: string;
  processor_version: string;
  input_hash: string;
  claim_token: string;
  attempts: number;
  raw_bytes: Buffer;
  raw_payload: Record<string, unknown>;
  platform: string;
  // Silver layer canonical fields for topic-agnostic processors
  title?: string | null;
  content_text?: string;
  lang?: string | null;
  url?: string | null;
  published_at?: string;
  source_id?: string;
  author_id?: string | null;
}

export interface ProcessorResult {
  values: Record<string, unknown>;
}

export interface JobStatusStat {
  status: string;
  count: string;
  oldest: string | null;
}

/**
 * Atomically claims up to `limit` pending or lease-expired enrichment jobs using `SKIP LOCKED`.
 * Returns the claimed jobs joined with their input snapshot and Silver item content.
 */
export async function claimJobs(
  pool: pg.Pool,
  limit: number,
  leaseSeconds = 90,
): Promise<ClaimedJob[]> {
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

/**
 * Fenced completion of an enrichment job.
 * Ensures the lease is active, verifies item content revision hasn't moved forward,
 * records the result, and marks the job succeeded.
 */
export async function completeJob(
  pool: pg.Pool,
  job: ClaimedJob,
  result: ProcessorResult,
): Promise<'succeeded' | 'stale' | 'lost'> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify active claim lease
    const claimed = await client.query<{ status: string }>(
      `
      SELECT status
      FROM ingest.enrichment_jobs
      WHERE job_id = $1
        AND claim_token = $2
        AND status = 'running'
        AND lease_until > now()
      FOR UPDATE
      `,
      [job.job_id, job.claim_token],
    );

    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return 'lost';
    }

    // 2. Verify current revision on item
    const current = await client.query<{ content_revision: string }>(
      `
      SELECT content_revision::text
      FROM core.item
      WHERE item_id = $1
      FOR UPDATE
      `,
      [job.item_id],
    );

    if (current.rows[0]?.content_revision !== job.content_revision) {
      await client.query(
        `
        UPDATE ingest.enrichment_jobs
        SET
          status = 'stale',
          claim_token = NULL,
          lease_until = NULL,
          updated_at = now()
        WHERE job_id = $1
        `,
        [job.job_id],
      );
      await client.query('COMMIT');
      return 'stale';
    }

    // 3. Insert enrichment result
    await client.query(
      `
      INSERT INTO ingest.enrichment_results (
        job_id,
        item_id,
        content_revision,
        job_type,
        processor_version,
        input_hash,
        result
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (job_id) DO NOTHING
      `,
      [
        job.job_id,
        job.item_id,
        job.content_revision,
        job.job_type,
        job.processor_version,
        job.input_hash,
        JSON.stringify(result.values),
      ],
    );

    // 4. Mark job succeeded
    await client.query(
      `
      UPDATE ingest.enrichment_jobs
      SET
        status = 'succeeded',
        claim_token = NULL,
        lease_until = NULL,
        updated_at = now()
      WHERE job_id = $1
      `,
      [job.job_id],
    );

    await client.query('COMMIT');
    return 'succeeded';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Records a job attempt failure.
 * Marks the job stale if revision changed, failed if attempts exhausted, or pending with exponential backoff.
 */
export async function failJob(
  pool: pg.Pool,
  job: ClaimedJob,
  reason: string,
): Promise<boolean> {
  const query = `
    UPDATE ingest.enrichment_jobs j
    SET
      status = CASE
        WHEN i.content_revision <> j.content_revision THEN 'stale'
        WHEN attempts >= max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      next_run_at = now() + (LEAST(3600, 5 * power(2, LEAST(attempts, 10))) * interval '1 second'),
      claim_token = NULL,
      lease_until = NULL,
      last_error = $3,
      updated_at = now()
    FROM core.item i
    WHERE j.job_id = $1
      AND j.claim_token = $2
      AND j.status = 'running'
      AND j.lease_until > now()
      AND i.item_id = j.item_id
  `;

  const result = await pool.query(query, [job.job_id, job.claim_token, reason.slice(0, 1000)]);
  return result.rowCount === 1;
}

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
export async function backfillProcessor(
  pool: pg.Pool,
  jobType: string,
  processorVersion: string,
): Promise<number> {
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
