import crypto from 'crypto';

/**
 * Password hashing for the single operator account
 * (run 2026-09-10-security-hardening, design.md §6.2).
 *
 * Pure: no database, no express, no I/O. scrypt from node:crypto rather than
 * bcrypt or argon2 because both of those are native addons, and this machine
 * already has one (better-sqlite3) that fails to load under the wrong Node —
 * adding a second doubles that failure mode for no security gain here.
 */

/** Frozen scrypt parameters. Changing them is a design amendment (§6.2). */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32, saltlen: 16 } as const;

/** Minimum/maximum accepted password length in UTF-16 code units (§6.3). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const USERNAME_MAX_LENGTH = 64;

/**
 * Returns `scrypt$N$r$p$<salt-b64>$<key-b64>` (§6.2). The parameters travel
 * with the hash, so they can be raised later without a migration: an old row
 * still verifies against its own N/r/p.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltlen);
  const key = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time verification. Returns false — never throws — for a malformed
 * or unknown-scheme `stored` value (§6.2, §16.1): a corrupt row must be a
 * failed login, not a 500.
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6) return false;
    const [scheme, nRaw, rRaw, pRaw, saltB64, keyB64] = parts;
    if (scheme !== 'scrypt') return false;

    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (N < 2 || r < 1 || p < 1) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const key = Buffer.from(keyB64, 'base64');
    if (salt.length === 0 || key.length === 0) return false;

    // Re-derive with the row's own parameters and the stored key's length.
    const derived = crypto.scryptSync(password, salt, key.length, { N, r, p });
    return crypto.timingSafeEqual(derived, key);
  } catch {
    // Bad base64, an N that scrypt rejects, an over-maxmem cost — all of them
    // are a failed login, never an exception out of the login route.
    return false;
  }
}

/**
 * A fixed, module-level hash of a random throwaway password, used to spend the
 * same ~45 ms when the username does not match, so a wrong username and a
 * wrong password are indistinguishable by timing (§16.1). Nothing can verify
 * against it: the password it was derived from is discarded here and now.
 */
export const DUMMY_PASSWORD_HASH: string = hashPassword(crypto.randomBytes(32).toString('base64'));
