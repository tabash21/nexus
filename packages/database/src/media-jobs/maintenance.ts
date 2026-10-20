import { and, asc, eq, sql } from 'drizzle-orm';
import { itemMedia, mediaJobs } from '../schema/index.js';
import type { IngestDatabase } from '../types.js';
import { MEDIA_PROCESSOR_VERSION } from './types.js';

/** Uses current media, not legacy input snapshots; safe to repeat after a partial backfill. */
export async function backfillMediaJobs(db: IngestDatabase): Promise<number> {
  let total = 0;
  let cursor: { itemId: string; position: number } | undefined;
  while (true) {
    const batch = await db
      .select({
        item_id: itemMedia.item_id,
        position: itemMedia.position,
        attachment_generation: itemMedia.attachment_generation,
        source_url: itemMedia.media_url,
        media_type: itemMedia.media_type,
      })
      .from(itemMedia)
      .where(
        cursor
          ? sql`(${itemMedia.item_id}, ${itemMedia.position}) > (${cursor.itemId}, ${cursor.position})`
          : undefined,
      )
      .orderBy(asc(itemMedia.item_id), asc(itemMedia.position))
      .limit(500);
    if (!batch.length) return total;
    const rows = await db
      .insert(mediaJobs)
      .values(batch.map(row => ({ ...row, processor_version: MEDIA_PROCESSOR_VERSION })))
      .onConflictDoNothing()
      .returning({ id: mediaJobs.job_id });
    total += rows.length;
    const last = batch.at(-1)!;
    cursor = { itemId: last.item_id, position: last.position };
  }
}

export async function retryMediaJob(db: IngestDatabase, jobId: string): Promise<boolean> {
  const rows = await db
    .update(mediaJobs)
    .set({
      status: 'pending',
      attempts: 0,
      next_run_at: sql`clock_timestamp()`,
      outcome: null,
      last_error: null,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(mediaJobs.job_id, jobId),
        eq(mediaJobs.status, 'failed'),
        sql`EXISTS (SELECT 1 FROM ${itemMedia} WHERE ${itemMedia.item_id} = ${mediaJobs.item_id}
      AND ${itemMedia.position} = ${mediaJobs.position}
      AND ${itemMedia.attachment_generation} = ${mediaJobs.attachment_generation})`,
      ),
    )
    .returning({ id: mediaJobs.job_id });
  return rows.length === 1;
}

export async function mediaJobStats(db: IngestDatabase) {
  return db
    .select({
      status: mediaJobs.status,
      outcome: mediaJobs.outcome,
      count: sql<number>`count(*)::int`,
      oldest: sql<string>`min(${mediaJobs.created_at})::text`,
    })
    .from(mediaJobs)
    .groupBy(mediaJobs.status, mediaJobs.outcome);
}
