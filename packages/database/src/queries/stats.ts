import { count, eq, sql } from 'drizzle-orm';
import type { IngestDatabase } from '../types.js';
import { item, source, author } from '../schema/index.js';
import type { StatsResult, PlatformStat } from './types.js';

export async function getStats(db: IngestDatabase, realityId: number): Promise<StatsResult> {
  const [itemsCountResult, sourcesCountResult, authorsCountResult, platformStats] = await Promise.all([
    db.select({ count: count() }).from(item).where(eq(item.reality_id, realityId)),
    db.select({ count: count() }).from(source).where(eq(source.reality_id, realityId)),
    db.select({ count: count() }).from(author).where(eq(author.reality_id, realityId)),
    db
      .select({
        platform: item.platform,
        count: count(),
      })
      .from(item)
      .where(eq(item.reality_id, realityId))
      .groupBy(item.platform),
  ]);

  return {
    realityId,
    itemsCount: Number(itemsCountResult[0]?.count ?? 0),
    sourcesCount: Number(sourcesCountResult[0]?.count ?? 0),
    authorsCount: Number(authorsCountResult[0]?.count ?? 0),
    platforms: platformStats.map(p => ({
      platform: p.platform,
      count: Number(p.count),
    })),
  };
}
