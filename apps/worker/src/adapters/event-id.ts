import { createHash } from 'node:crypto';

/**
 * Generates a deterministic UUID (RFC-4122 v5 variant) from a platform and native identity.
 * This ensures that replays and retries of the same raw message always produce the exact
 * same eventId for database idempotency.
 */
export function deterministicEventId(platform: string, sourceId: string, nativeId: string | number): string {
  const digest = createHash('sha256').update(`${platform}:${sourceId}:${nativeId}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    '5' + digest.slice(13, 16),
    ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + digest.slice(18, 20),
    digest.slice(20, 32),
  ].join('-');
}
