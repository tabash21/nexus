import type pg from 'pg';
import type { ClaimedJob, ProcessorResult } from './job.types.js';

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
export async function failJob(pool: pg.Pool, job: ClaimedJob, reason: string): Promise<boolean> {
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
