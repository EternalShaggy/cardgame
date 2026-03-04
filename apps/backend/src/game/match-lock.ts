import { createHash } from 'crypto';

/**
 * Convert a match UUID to a deterministic 64-bit advisory lock key.
 * Postgres advisory locks use a bigint key.
 */
export function matchLockKey(matchId: string): bigint {
  const hash = createHash('sha256').update(matchId).digest();
  // Read first 8 bytes as signed big-endian 64-bit integer
  return hash.readBigInt64BE(0);
}
