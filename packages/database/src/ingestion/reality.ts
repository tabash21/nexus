import { eq, inArray } from 'drizzle-orm';
import type { OsintEvent } from '@nexus/contracts';
import { EventConflictError } from '../errors.js';
import { reality } from '../schema/index.js';
import type { IngestDatabase, IngestTransaction } from '../types.js';

/**
 * Rejects events targeting a reality (tenant/workspace) that has not been registered.
 */
export async function assertRealityRegistered(
  tx: IngestTransaction,
  realityId: OsintEvent['realityId'],
): Promise<void> {
  const [realm] = await tx.select().from(reality).where(eq(reality.reality_id, realityId));
  if (!realm) throw new EventConflictError('Reality must be registered before ingestion');
}

/**
 * Asserts that all configured reality partitions are initialized in the database before starting consumption.
 */
export async function requireRealities(db: IngestDatabase, realityIds: readonly number[]): Promise<void> {
  const ids = [...new Set(realityIds)];
  if (!ids.length) return;

  const registered = await db.select().from(reality).where(inArray(reality.reality_id, ids));
  const missing = ids.filter(id => !registered.some(row => row.reality_id === id));
  if (missing.length) {
    throw new Error(`Configured realities must be registered before consuming: ${missing.join(', ')}`);
  }
}
