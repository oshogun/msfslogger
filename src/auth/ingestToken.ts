import { createHash, timingSafeEqual } from 'crypto';

/** Fixed-width digest of a token or header value, so the ingest-token check
 *  can use crypto.timingSafeEqual. */
export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The configured token's digest, computed once. null iff no token is
 *  configured (unauthenticated ingest was explicitly opted into). */
export function ingestTokenDigest(token: string | null): Buffer | null {
  return token ? sha256(token) : null;
}

/**
 * Compares a request's x-ingest-token header against the configured token's
 * precomputed digest. Both sides are always 32-byte SHA-256 digests, so
 * timingSafeEqual cannot throw on a length mismatch and the comparison leaks
 * nothing about the token's length. A missing or empty header is false
 * without comparing.
 */
export function ingestTokenMatches(header: string | undefined, tokenDigest: Buffer): boolean {
  if (!header) return false;
  return timingSafeEqual(sha256(header), tokenDigest);
}
