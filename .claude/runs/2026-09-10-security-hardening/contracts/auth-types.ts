/**
 * Run 2026-09-10-security-hardening — frozen server-side auth contract
 * (design.md §4, §6, §9, §10).
 *
 * REFERENCE ARTIFACT. Not compiled by the build.
 *
 * TYPE OWNERSHIP (§4.4) — the wire types below go in `src/types.ts` (the file
 * that already owns every shared wire shape). The row types go in `src/db.ts`
 * beside the other row interfaces. The function signatures below belong to the
 * module named in each comment. No other file re-declares any of them.
 */

/* ── src/types.ts — wire shapes, mirrored in client/src/types.ts ─────────── */

/** What a logged-in session holds. Persisted inside auth_session.data. */
export interface SessionUser {
  username: string;
}

/** POST /api/auth/login request body (§9.1). */
export interface LoginRequest {
  username: string;
  password: string;
}

/** POST /api/auth/login 200 body (§9.1). */
export interface LoginResponse {
  user: SessionUser;
}

/** GET /api/auth/session 200 body (§9.3). Always 200, never 401. */
export type SessionResponse =
  | { authenticated: true; user: SessionUser }
  | { authenticated: false; user: null };

/**
 * Every error body in this design. Identical in shape to the existing
 * `{ error: string }` used by every other route in src/server.ts (§9.5).
 * `retryAfterSec` appears only on the 429 (§9.2).
 */
export interface ApiErrorBody {
  error: string;
  retryAfterSec?: number;
}

/* ── src/db.ts — row shapes and accessors ────────────────────────────────── */

export interface AuthUserRow {
  id: 1;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/** null when the deployment has no operator account yet (§6.4). */
export declare function getAuthUser(): AuthUserRow | null;

/** Inserts or replaces row id=1. Used only by the set-password CLI (§6.4). */
export declare function setAuthUser(username: string, passwordHash: string): void;

/** app_secret accessors (§10.3). getOrCreateAppSecret is atomic per §16.4. */
export declare function getAppSecret(name: string): string | null;
export declare function getOrCreateAppSecret(name: string, generate: () => string): string;

/** auth_session accessors — the only DB access the session store performs (§10.2). */
export declare function sessionGet(sid: string): { data: string; expires_at: number } | null;
export declare function sessionSet(sid: string, data: string, expiresAt: number): void;
export declare function sessionDestroy(sid: string): void;
/** Deletes every row with expires_at <= now. Returns the number deleted (§10.5). */
export declare function sessionSweep(now: number): number;

/* ── src/auth/password.ts — pure, no DB, no express (§6.2) ───────────────── */

/** Frozen scrypt parameters. Changing them is a design amendment (§6.2). */
export declare const SCRYPT_PARAMS: { N: 16384; r: 8; p: 1; keylen: 32; saltlen: 16 };

/** Minimum/maximum accepted password length in UTF-16 code units (§6.3). */
export declare const PASSWORD_MIN_LENGTH: 12;
export declare const PASSWORD_MAX_LENGTH: 200;
export declare const USERNAME_MAX_LENGTH: 64;

/** Returns `scrypt$N$r$p$<salt-b64>$<key-b64>` (§6.2). */
export declare function hashPassword(password: string): string;

/**
 * Constant-time verification. Returns false — never throws — for a malformed
 * or unknown-scheme `stored` value (§6.2, §16.1).
 */
export declare function verifyPassword(password: string, stored: string): boolean;

/**
 * A fixed, module-level hash of a random throwaway password, used to spend the
 * same ~45 ms when the username does not match, so a wrong username and a
 * wrong password are indistinguishable by timing (§16.1).
 */
export declare const DUMMY_PASSWORD_HASH: string;

/* ── src/auth/sessionStore.ts (§10.2) ────────────────────────────────────── */

/**
 * express-session Store implemented on the src/db.ts accessors above.
 * Implements get/set/destroy/touch. `length` and `clear` are not implemented —
 * express-session does not require them.
 */
export declare class SqliteSessionStore {}

/* ── src/auth/middleware.ts (§8, §9.2, §16.2, §16.3) ─────────────────────── */

/** 401 { error: 'Authentication required' } when there is no session user. */
export declare function requireAuth(req: unknown, res: unknown, next: () => void): void;

/** The Origin/Host check of §16.3. 403 { error: 'Cross-origin request rejected' }. */
export declare function requireSameOrigin(req: unknown, res: unknown, next: () => void): void;

/** Per-IP login throttle of §16.2. In-memory, reset by a restart. */
export declare class LoginThrottle {
  /** null when allowed; otherwise the seconds the caller must wait. */
  check(ip: string, now: number): number | null;
  recordFailure(ip: string, now: number): void;
  recordSuccess(ip: string): void;
}

/* ── src/auth/routes.ts (§9) ─────────────────────────────────────────────── */

/** Mounted at /api/auth by src/server.ts. Public — never behind requireAuth. */
export declare function createAuthRouter(): unknown;
