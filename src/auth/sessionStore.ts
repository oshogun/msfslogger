import session from 'express-session';
import type { SessionData } from 'express-session';
import { sessionGet, sessionSet, sessionDestroy } from '../db';

/**
 * express-session Store backed by the auth_session table via the src/db.ts
 * accessors. No MemoryStore (leaks memory, logs the operator out on every
 * restart) and no second native sqlite driver — this is ~40 lines over the
 * accessors this project already has.
 *
 * `length` and `clear` are intentionally not implemented — express-session
 * never calls them.
 */
export class SqliteSessionStore extends session.Store {
  private readonly maxAgeMs: number;

  constructor(maxAgeMs: number) {
    super();
    this.maxAgeMs = maxAgeMs;
  }

  /**
   * A missing row, an expired row, and a JSON.parse failure are all reported
   * as "no session" (cb(null, null)), never as an error — one corrupt or
   * stale row must not wedge every request. An expired row is also deleted
   * here.
   */
  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    try {
      const row = sessionGet(sid);
      if (!row) {
        callback(null, null);
        return;
      }
      if (row.expires_at <= Date.now()) {
        sessionDestroy(sid);
        callback(null, null);
        return;
      }
      let parsed: SessionData;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        callback(null, null);
        return;
      }
      callback(null, parsed);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: SessionData, callback?: (err?: unknown) => void): void {
    try {
      sessionSet(sid, JSON.stringify(sessionData), this.expiryFor(sessionData));
      if (callback) callback();
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      sessionDestroy(sid);
      if (callback) callback();
    } catch (err) {
      if (callback) callback(err);
    }
  }

  /**
   * Delegates to set() — this is what makes `rolling: true` extend the stored
   * expiry, not just the cookie.
   */
  touch(sid: string, sessionData: SessionData, callback?: () => void): void {
    this.set(sid, sessionData, callback);
  }

  /**
   * Derived from session.cookie.expires when present; an absent or Invalid
   * Date (NaN) falls back to now + maxAgeMs, so a malformed cookie object can
   * never write NaN into the INTEGER NOT NULL expires_at column.
   */
  private expiryFor(sessionData: SessionData): number {
    const expires = sessionData.cookie?.expires;
    if (expires) {
      const t = new Date(expires).getTime();
      if (!Number.isNaN(t)) return t;
    }
    return Date.now() + this.maxAgeMs;
  }
}
