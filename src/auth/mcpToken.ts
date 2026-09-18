import { createHash, timingSafeEqual } from 'crypto';

// A deliberate, self-contained copy of ingestToken.ts's shape: no import edge
// to that file, not even for this 3-line digest helper, so that revoking or
// changing the policy of either credential never requires reading the other.

/** Fixed-width digest of a token or header value, so the MCP-token check can
 *  use crypto.timingSafeEqual. */
export function mcpSha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The configured MCP token's digest, computed once. null iff no MCP token is
 *  configured (the /mcp endpoint is then never mounted at all). */
export function mcpTokenDigest(token: string | null): Buffer | null {
  return token ? mcpSha256(token) : null;
}

/**
 * Compares a presented credential against the configured token's precomputed
 * digest. Both sides are always 32-byte SHA-256 digests, so timingSafeEqual
 * cannot throw on a length mismatch and the comparison leaks nothing about
 * the token's length. A missing or empty credential is false without
 * comparing.
 */
export function mcpTokenMatches(presented: string | undefined, tokenDigest: Buffer): boolean {
  if (!presented) return false;
  return timingSafeEqual(mcpSha256(presented), tokenDigest);
}
