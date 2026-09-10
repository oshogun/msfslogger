import type { Request, Response, NextFunction } from 'express';

/** The express-session cookie name (design.md §10.1). Read here and by
 *  whoever configures the session middleware (T-007) so the two never drift. */
export const SESSION_COOKIE_NAME = 'msfslogger.sid';

/**
 * 401 gate for every /api route except /api/auth/* and /api/ingest/* (§8.2,
 * mounted as `app.use('/api', requireAuth)` after those two are registered —
 * see §8.3). Body verbatim from contracts/samples/gated-401.json.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session && req.session.user) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}

/**
 * CSRF defence in depth, on top of SameSite=Lax (§16.3). The primary defence
 * is the cookie policy; this is the second layer for a browser or a future
 * cookie policy where Lax is not what was assumed.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  // Step 1 — safe methods never mutate; the gated exports are GETs and must
  // stay linkable.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  // Step 2 — only /api/* is in scope.
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  // Step 3 — the agent is not a browser, has no cookie, and is authenticated
  // by token instead.
  if (req.path.startsWith('/api/ingest/')) {
    next();
    return;
  }
  // Step 4 — a curl or the agent sends no Origin at all; rejecting
  // header-less clients would break every scripted use without adding
  // protection. A browser always sends Origin on a cross-origin request and
  // on any non-GET.
  const origin = req.get('origin');
  if (!origin) {
    next();
    return;
  }
  // Step 5.
  const expected = `${req.protocol}://${req.get('host')}`;
  if (origin === expected) {
    next();
    return;
  }
  res.status(403).json({ error: 'Cross-origin request rejected' });
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_ENTRIES = 1000;

interface ThrottleEntry {
  count: number;
  windowStart: number;
}

/**
 * Fixed-window login throttle, keyed on client IP only (§16.2). In-memory,
 * lost on restart — acceptable, since a restart is an operator action and the
 * attacker gains at most one more window.
 */
export class LoginThrottle {
  private readonly entries = new Map<string, ThrottleEntry>();

  /** null when allowed; otherwise the seconds the caller must wait. */
  check(ip: string, now: number): number | null {
    // Bounding: on each check, if the map has grown past 1000 entries, drop
    // every entry whose window has already elapsed. Deterministic and cheap;
    // the map cannot grow without bound from spoofed sources on a LAN.
    if (this.entries.size > MAX_ENTRIES) {
      for (const [key, entry] of this.entries) {
        if (now - entry.windowStart >= WINDOW_MS) {
          this.entries.delete(key);
        }
      }
    }

    const entry = this.entries.get(ip);
    if (!entry) return null;
    if (now - entry.windowStart >= WINDOW_MS) {
      this.entries.delete(ip);
      return null;
    }
    if (entry.count >= MAX_FAILURES) {
      return Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
    }
    return null;
  }

  recordFailure(ip: string, now: number): void {
    const entry = this.entries.get(ip);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.entries.set(ip, { count: 1, windowStart: now });
      return;
    }
    // The window start does not move — a locked-out attacker's clock still
    // runs down.
    entry.count += 1;
  }

  recordSuccess(ip: string): void {
    this.entries.delete(ip);
  }
}

/**
 * Parses req.headers.cookie for the msfslogger.sid pair, returning the value
 * exactly as it appears in the header — still percent-encoded, since
 * express-session decodes it itself (§13.2). undefined when there is no
 * cookie header or no matching pair.
 */
export function sessionCookieFrom(req: Request): { name: string; value: string } | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      return { name, value: part.slice(eq + 1).trim() };
    }
  }
  return undefined;
}
