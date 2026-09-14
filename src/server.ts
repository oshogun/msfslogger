import express from 'express';
import session from 'express-session';
import { MulterError } from 'multer';
import path from 'path';
import { randomBytes } from 'crypto';
import type { FlightManager } from './flightManager';
import { createIngestRouter } from './ingest';
import { TrafficStore } from './trafficStore';
import { getConfig } from './config';
import { getOrCreateAppSecret } from './db';
import { SqliteSessionStore } from './auth/sessionStore';
import { requireAuth, requireSameOrigin, SESSION_COOKIE_NAME } from './auth/middleware';
import { createAuthRouter } from './auth/routes';
import {
  MAX_FLIGHT_PLAN_BYTES, MAX_LNMPLN_BYTES, MAX_LNMPLN_FILES,
} from './routes/uploads';
import { createFlightsRouter } from './routes/flights';
import { createTripsRouter } from './routes/trips';
import { createSettingsRouter } from './routes/settings';
import { createPlannedLegsRouter } from './routes/plannedLegs';
import { createExportsRouter } from './routes/exports';

export function createServer(flightManager: FlightManager): express.Express {
  const app = express();
  const config = getConfig();

  // Middleware order is behaviour, and this order is frozen. Anything
  // registered after app.use('/api', requireAuth) below is gated by default,
  // including routes added later.
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(express.static(path.join(process.cwd(), 'client', 'dist')));

  // One instance per server (not a module-level singleton), so a scratch
  // server starts empty. Never persisted, never written to flights.db.
  const trafficStore = new TrafficStore();

  // Deliberately above the session middleware: the agent never sends a cookie,
  // and an ingest request must never allocate or touch the session store.
  // Authenticated by INGEST_TOKEN instead.
  app.use('/api/ingest', createIngestRouter(flightManager, trafficStore, config.ingest));

  // SESSION_SECRET when the operator set one, otherwise a random 32-byte secret
  // created on first run and stored in app_secret. There is no hard-coded
  // fallback anywhere: the server either finds a secret or makes one.
  const sessionSecret = config.sessionSecretFromEnv
    ?? getOrCreateAppSecret('session_secret', () => randomBytes(32).toString('base64'));

  // `trust proxy` is deliberately NOT set: X-Forwarded-For stays ignored, so a
  // spoofed header cannot poison the login throttle's key, and req.protocol
  // reflects the real connection.
  app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store: new SqliteSessionStore(config.sessionMaxAgeMs),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Tied to TLS, never hard-coded: a browser will not send a Secure cookie
      // over plaintext HTTP, and a non-Secure one would cross the network in
      // the clear on a TLS deployment.
      secure: config.tls.enabled,
      path: '/',
      maxAge: config.sessionMaxAgeMs,
    },
  }));

  // CSRF defence in depth behind SameSite=Lax; skips GET/HEAD/OPTIONS, non-/api
  // paths and /api/ingest/*.
  app.use(requireSameOrigin);

  // Public by name — it cannot require a session to create one.
  app.use('/api/auth', createAuthRouter());

  // The gate. One mount, not per-handler decoration, so every /api route below
  // — and any unmatched /api path — is 401 without a session.
  app.use('/api', requireAuth);

  app.get('/api/status', (_req, res) => {
    const { flightState, currentFlightId, connected, lastFrame, paused, pauseFlags } = flightManager.appState;
    // Only while FLYING, and only when the flight is actually linked — every
    // other case must leave the response byte-identical to before this key
    // existed, so it is spread in rather than ever sent as a literal null.
    const plannedLeg = flightState === 'FLYING' && lastFrame
      ? flightManager.getPlannedLegStatus(lastFrame.lat, lastFrame.lon)
      : null;
    // Present iff non-empty — never null, never [], absent instead, so an
    // unchanged AppState serialises byte-identically to before this key
    // existed. Same conditional-spread idiom as plannedLeg.
    const traffic = trafficStore.read();
    res.json({
      connected,
      flightState,
      currentFlightId,
      paused,
      pauseFlags,
      simRunning: lastFrame?.simRunning ?? 0,
      onGround: lastFrame?.onGround ?? true,
      aircraft: lastFrame?.aircraft ?? null,
      frame: lastFrame ? {
        lat:              lastFrame.lat,
        lon:              lastFrame.lon,
        altitudeFt:       lastFrame.altitudeFt,
        airspeedKnots:    lastFrame.airspeedKnots,
        groundSpeedKnots: lastFrame.groundSpeedKnots,
        headingDeg:       lastFrame.headingDeg,
        verticalSpeedFpm: lastFrame.verticalSpeedFpm,
        onGround:         lastFrame.onGround,
      } : null,
      ...(plannedLeg ? { plannedLeg } : {}),
      ...(traffic.length ? { traffic } : {}),
    });
  });

  // ── Flights ────────────────────────────────────────────────────────────────
  // Mounted where the first of these routes used to sit. The whole /api/flights
  // block travels together, including the flight-plan attachment routes that
  // used to be registered further down: nothing under /api/flights can ever be
  // matched by a /api/trips path, so only the order *inside* the router is
  // load-bearing — and that is preserved, POST /flights/combine still ahead of
  // /flights/:id.

  app.use('/api', createFlightsRouter(flightManager));

  // ── Trips ──────────────────────────────────────────────────────────────────
  // Same reasoning: the trip routes, /api/active-trip and the trip atlas are one
  // router, mounted in the position the first of them occupied.

  app.use('/api', createTripsRouter(flightManager));

  // ── Settings ───────────────────────────────────────────────────────────────
  // Mounted here, in the position the routes used to occupy, because
  // registration order is what express matches on.

  app.use('/api', createSettingsRouter());

  // ── Planned legs ───────────────────────────────────────────────────────────
  // Mounted after ── Trips ── and before ── PDF and KML export ──, in the
  // position the block occupied: every literal /api route must be registered
  // before the SPA catch-all below, or the catch-all swallows it.

  app.use('/api', createPlannedLegsRouter(flightManager));

  // ── PDF and KML export ────────────────────────────────────────────────────
  // Mounted before the SPA catch-all so these routes are not swallowed by it.

  app.use('/api', createExportsRouter());

  // Catch-all: let React Router handle client-side routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'client', 'dist', 'index.html'));
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        // err.field distinguishes which multer instance hit its limit: the
        // shared PDF message would be wrong (and misleadingly large) for an
        // oversized .lnmpln.
        const message = err.field === 'lnmpln'
          ? `File too large (max ${MAX_LNMPLN_BYTES / 1024}KB)`
          : `File too large (max ${MAX_FLIGHT_PLAN_BYTES / (1024 * 1024)}MB)`;
        res.status(400).json({ error: message });
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        res.status(400).json({ error: `Too many files (max ${MAX_LNMPLN_FILES})` });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    // express.json() rejects a malformed body before any route runs, so the
    // settings routes cannot answer it themselves. Scoped to /api/settings/ so
    // every other route keeps the default handling it has always had.
    if (err instanceof SyntaxError && 'body' in err && req.path.startsWith('/api/settings/')) {
      res.status(400).json({ error: 'Invalid request body', code: 'INVALID_BODY' });
      return;
    }
    next(err);
  });

  return app;
}
