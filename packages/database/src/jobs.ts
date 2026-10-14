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
}

export interface ProcessorResult {
  values: Record<string, unknown>;
}

/** SQL claims are atomic; SKIP LOCKED avoids waiting on another poller's row locks. */
export async function claimJobs(pool: pg.Pool, limit: number, leaseSeconds = 90): Promise<ClaimedJob[]> {
  await pool.query(`UPDATE ingest.enrichment_jobs SET status='failed',claim_token=NULL,lease_until=NULL,
    last_error=COALESCE(last_error,'Lease expired after final attempt'),updated_at=now()
    WHERE status='running' AND lease_until<now() AND attempts>=max_attempts`);
  const result = await pool.query<ClaimedJob>(`WITH due AS (
    SELECT job_id FROM ingest.enrichment_jobs
    WHERE ((status='pending' AND next_run_at<=now()) OR (status='running' AND lease_until<now()))
      AND attempts<max_attempts
    ORDER BY created_at,job_id FOR UPDATE SKIP LOCKED LIMIT $1
  ), claimed AS (
    UPDATE ingest.enrichment_jobs j SET status='running', attempts=j.attempts+1,
      claim_token=gen_random_uuid(), lease_until=now()+($2::int * interval '1 second'), updated_at=now()
    FROM due WHERE j.job_id=due.job_id RETURNING j.*
  ) SELECT c.job_id::text,c.item_id,c.content_revision::text,c.event_id,c.job_type,
    c.processor_version,c.input_hash,c.claim_token::text,c.attempts,s.raw_bytes,s.raw_payload,i.platform
    FROM claimed c JOIN ingest.input_snapshots s ON s.event_id=c.event_id
    JOIN core.item i ON i.item_id=c.item_id ORDER BY c.created_at,c.job_id`,
  [limit, leaseSeconds]);
  return result.rows;
}

export async function renewJob(pool: pg.Pool, job: ClaimedJob, leaseSeconds = 90): Promise<boolean> {
  const result = await pool.query(`UPDATE ingest.enrichment_jobs SET lease_until=now()+($3::int * interval '1 second'), updated_at=now()
    WHERE job_id=$1 AND claim_token=$2 AND status='running' AND lease_until>now()`,
  [job.job_id, job.claim_token, leaseSeconds]);
  return result.rowCount === 1;
}

/** A token, live lease and locked current revision fence every published result. */
export async function completeJob(pool: pg.Pool, job: ClaimedJob, result: ProcessorResult): Promise<'succeeded' | 'stale' | 'lost'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ status: string }>(`SELECT status FROM ingest.enrichment_jobs
      WHERE job_id=$1 AND claim_token=$2 AND status='running' AND lease_until>now() FOR UPDATE`, [job.job_id, job.claim_token]);
    if (!claimed.rowCount) { await client.query('ROLLBACK'); return 'lost'; }
    const current = await client.query<{ content_revision: string }>(
      'SELECT content_revision::text FROM core.item WHERE item_id=$1 FOR UPDATE', [job.item_id]);
    if (current.rows[0]?.content_revision !== job.content_revision) {
      await client.query("UPDATE ingest.enrichment_jobs SET status='stale',claim_token=NULL,lease_until=NULL,updated_at=now() WHERE job_id=$1", [job.job_id]);
      await client.query('COMMIT'); return 'stale';
    }
    await client.query(`INSERT INTO ingest.enrichment_results
      (job_id,item_id,content_revision,job_type,processor_version,input_hash,result)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (job_id) DO NOTHING`,
    [job.job_id, job.item_id, job.content_revision, job.job_type, job.processor_version, job.input_hash, JSON.stringify(result.values)]);
    await client.query("UPDATE ingest.enrichment_jobs SET status='succeeded',claim_token=NULL,lease_until=NULL,updated_at=now() WHERE job_id=$1", [job.job_id]);
    await client.query('COMMIT'); return 'succeeded';
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function failJob(pool: pg.Pool, job: ClaimedJob, reason: string): Promise<boolean> {
  const result = await pool.query(`UPDATE ingest.enrichment_jobs j SET
    status=CASE WHEN i.content_revision<>j.content_revision THEN 'stale'
      WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
    next_run_at=now()+(LEAST(3600,5*power(2,LEAST(attempts,10))) * interval '1 second'),
    claim_token=NULL,lease_until=NULL,last_error=$3,updated_at=now()
    FROM core.item i
    WHERE j.job_id=$1 AND j.claim_token=$2 AND j.status='running' AND j.lease_until>now()
      AND i.item_id=j.item_id`,
  [job.job_id, job.claim_token, reason.slice(0, 1000)]);
  return result.rowCount === 1;
}

export async function retryJob(pool: pg.Pool, jobId: string): Promise<boolean> {
  const result = await pool.query(`UPDATE ingest.enrichment_jobs j SET status='pending',attempts=0,
    next_run_at=now(),claim_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now()
    FROM core.item i WHERE j.job_id=$1 AND j.status='failed' AND i.item_id=j.item_id
      AND i.content_revision=j.content_revision`, [jobId]);
  return result.rowCount === 1;
}

export async function backfillProcessor(pool: pg.Pool, jobType: string, processorVersion: string): Promise<number> {
  const result = await pool.query(`INSERT INTO ingest.enrichment_jobs
    (item_id,content_revision,event_id,job_type,processor_version,input_hash)
    SELECT i.item_id,i.content_revision,s.event_id,$1,$2,s.input_hash
    FROM core.item i JOIN ingest.input_snapshots s ON s.event_id=i.current_event_id
    ON CONFLICT ON CONSTRAINT job_identity DO NOTHING`, [jobType, processorVersion]);
  return result.rowCount ?? 0;
}

export async function jobStats(pool: pg.Pool): Promise<{ status: string; count: string; oldest: string | null }[]> {
  const result = await pool.query<{ status: string; count: string; oldest: string | null }>(
    'SELECT status,count(*)::text, min(created_at)::text AS oldest FROM ingest.enrichment_jobs GROUP BY status');
  return result.rows;
}
