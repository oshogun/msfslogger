import express, { Router, Request, Response } from 'express';
import { getAuthUser } from '../db';
import { verifyPassword, DUMMY_PASSWORD_HASH } from './password';
import { LoginThrottle, SESSION_COOKIE_NAME } from './middleware';
import type { LoginResponse, SessionResponse } from '../types';

/**
 * /api/auth — never behind requireAuth. Mounted by src/server.ts
 * before `app.use('/api', requireAuth)`.
 */
export function createAuthRouter(): Router {
  const router = express.Router();
  const throttle = new LoginThrottle();

  const ipOf = (req: Request): string => req.socket.remoteAddress ?? 'unknown';

  // Login evaluation, step by step.
  router.post('/login', (req: Request, res: Response) => {
    const body = req.body as { username?: unknown; password?: unknown };

    // Step 1.
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    // Step 2 — username is trimmed; the password is not (whitespace is part
    // of it).
    const username = body.username.trim();
    const password = body.password;
    const ip = ipOf(req);

    // Step 3 — the throttle is checked before any DB read, so a throttled
    // client costs nothing.
    const wait = throttle.check(ip, Date.now());
    if (wait !== null) {
      console.log(`[Auth] Login throttled for ${ip} (${wait}s remaining)`);
      res.set('Retry-After', String(wait));
      res.status(429).json({
        error: `Too many login attempts. Try again in ${wait} seconds.`,
        retryAfterSec: wait,
      });
      return;
    }

    // Step 4.
    const row = getAuthUser();
    const fail = (): void => {
      throttle.recordFailure(ip, Date.now());
      console.log(`[Auth] Login FAILED for "${username}" from ${ip}`);
      res.status(401).json({ error: 'Invalid username or password' });
    };

    if (row === null) {
      // No operator account: still spend one full scrypt derivation so an
      // unconfigured deployment is not distinguishable by timing either.
      verifyPassword(password, DUMMY_PASSWORD_HASH);
      fail();
      return;
    }
    if (row.username !== username) {
      verifyPassword(password, DUMMY_PASSWORD_HASH);
      fail();
      return;
    }
    if (!verifyPassword(password, row.password_hash)) {
      fail();
      return;
    }

    // Step 5 — success. Regenerate BEFORE setting req.session.user: that
    // order is what defeats session fixation, and it is not optional.
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) {
        res.status(500).json({ error: String(regenerateErr) });
        return;
      }
      req.session.user = { username: row.username };
      req.session.save((saveErr) => {
        if (saveErr) {
          res.status(500).json({ error: String(saveErr) });
          return;
        }
        throttle.recordSuccess(ip);
        console.log(`[Auth] Login OK for "${row.username}" from ${ip}`);
        const responseBody: LoginResponse = { user: { username: row.username } };
        res.status(200).json(responseBody);
      });
    });
  });

  // Always 204, idempotent by construction: a logout with an expired
  // cookie is still a 204.
  router.post('/logout', (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.status(204).end();
    });
  });

  // Always 200, never 401, so the SPA can ask "am I logged in?"
  // without triggering its own 401 handling.
  router.get('/session', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const user = req.session.user;
    const body: SessionResponse = user
      ? { authenticated: true, user: { username: user.username } }
      : { authenticated: false, user: null };
    res.status(200).json(body);
  });

  return router;
}
