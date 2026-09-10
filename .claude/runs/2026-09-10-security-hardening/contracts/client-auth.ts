/**
 * Run 2026-09-10-security-hardening — frozen client contract (design.md §14).
 *
 * REFERENCE ARTIFACT. Not compiled by the build.
 *
 * TYPE OWNERSHIP (§14.5): the three wire types below are copied into
 * `client/src/types.ts`, which already mirrors the server's wire shapes by
 * hand (there is no shared package and this design does not introduce one).
 * They must stay byte-identical to the definitions in `src/types.ts`
 * (contracts/auth-types.ts).
 */

export interface SessionUser {
  username: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export type SessionResponse =
  | { authenticated: true; user: SessionUser }
  | { authenticated: false; user: null };

/* ── client/src/utils/api.ts — owned additions (§14.2) ───────────────────── */

/**
 * Thrown by apiFetch/download when the server answers 401. Distinguishable by
 * `instanceof`, so a caller can tell "logged out" from "request failed".
 * apiFetch's existing behaviour for every other non-2xx is unchanged: it still
 * throws Error(body.error ?? statusText) (§19 item 6).
 */
export declare class UnauthorizedError extends Error {
  readonly status: 401;
}

/**
 * Registered once by <RequireAuth> (§14.3). apiFetch calls it before throwing
 * UnauthorizedError. Never registered on a /print/* route — see §13.4.
 */
export declare function setUnauthorizedHandler(fn: (() => void) | null): void;

/* ── client/src/hooks/useSession.ts — new file (§14.3) ───────────────────── */

export interface SessionState {
  /** null while the first GET /api/auth/session is still in flight. */
  status: 'loading' | 'authenticated' | 'anonymous';
  user: SessionUser | null;
  /** POST /api/auth/login. Resolves on 200, rejects with Error(body.error). */
  login(username: string, password: string): Promise<void>;
  /** POST /api/auth/logout. Always resolves; drives the redirect to /login. */
  logout(): Promise<void>;
}

export declare function useSession(): SessionState;

/* ── client/src/components/RequireAuth.tsx — new file (§14.3) ────────────── */

/**
 * Wraps <AppShell/>. Renders nothing while status === 'loading', redirects to
 * /login when 'anonymous', renders children when 'authenticated'.
 * /login, /print/flight/:id and /print/trip/:id are NOT wrapped (§13.4, §14.4).
 */
export declare function RequireAuth(props: { children: unknown }): unknown;

/* ── client/src/pages/Login.tsx — new file (§14.1) ───────────────────────── */

/**
 * Username + password form. On success navigates to the `from` location the
 * redirect carried, defaulting to '/'. On 401 renders the server's message
 * verbatim ('Invalid username or password'); on 429 renders the server's
 * message including retryAfterSec. Never distinguishes unknown-user from
 * wrong-password, because the server does not either (§9.2).
 */
export declare function Login(): unknown;
