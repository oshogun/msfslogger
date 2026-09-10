/**
 * Module augmentation for `express-session` (design.md §4.4, run
 * 2026-09-10-security-hardening).
 *
 * This is the ONLY place `SessionData` is augmented anywhere in the tree —
 * no other file declares `declare module 'express-session'`.
 */
import 'express-session';
import type { SessionUser } from '../types';

declare module 'express-session' {
  interface SessionData {
    /** Present iff the session is logged in (§10.1). */
    user?: SessionUser;
  }
}
