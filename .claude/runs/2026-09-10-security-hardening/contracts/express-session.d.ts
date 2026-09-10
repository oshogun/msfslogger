/**
 * Run 2026-09-10-security-hardening — module augmentation contract (§4.4).
 *
 * REFERENCE ARTIFACT. The Dispatcher copies this file to
 * `src/auth/express-session.d.ts`, where tsconfig's "include": ["src/**\/*"]
 * picks it up. It is the ONLY place `SessionData` is augmented; no other file
 * declares `declare module 'express-session'`.
 */
import 'express-session';
import type { SessionUser } from '../src/types';

declare module 'express-session' {
  interface SessionData {
    /** Present iff the session is logged in (§10.1). */
    user?: SessionUser;
  }
}
