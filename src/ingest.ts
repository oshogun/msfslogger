import express, { Router, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import type { IngestConfig } from './config';
import type { FlightManager } from './flightManager';
import type { SimFrame, TrafficObject } from './types';
import { TrafficStore, roundCoord, roundAlt, normHeading, applyRetentionCap } from './trafficStore';

const STALE_TIMEOUT_MS = 10_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

// Server rejects a batch with more than this many objects (§4.5 row 5). The
// agent truncates to the same number before posting (agent/agent.js §3.8), so
// reaching this case in normal operation means something is wrong. design.md
// (run 2026-09-08-ai-traffic-map) §1.2.
const MAX_BATCH_OBJECTS = 200;

// Same name, same parsing rule as the agent's (design.md §3.5, §5.6): disabled
// iff the trimmed, lowercased value is exactly one of these; unset, empty, or
// anything else means enabled.
const TRAFFIC_DISABLED_VALUES = ['0', 'false', 'off', 'no'];
function parseTrafficEnabled(value: string | undefined): boolean {
  return !TRAFFIC_DISABLED_VALUES.includes(String(value ?? '').trim().toLowerCase());
}

function isValidFrame(body: unknown): body is SimFrame {
  if (typeof body !== 'object' || body === null) return false;
  const f = body as Record<string, unknown>;
  return (
    typeof f.lat === 'number' &&
    typeof f.lon === 'number' &&
    typeof f.altitudeFt === 'number' &&
    typeof f.airspeedKnots === 'number' &&
    typeof f.groundSpeedKnots === 'number' &&
    typeof f.headingDeg === 'number' &&
    typeof f.verticalSpeedFpm === 'number' &&
    typeof f.onGround === 'boolean' &&
    typeof f.simRunning === 'number' &&
    typeof f.aircraft === 'string'
  );
}

/**
 * One element of a traffic batch, treated as Record<string, unknown> (§4.6).
 * Number.isFinite rejects NaN, +/-Infinity, null, undefined, strings and
 * missing keys in one predicate. onGround is the only optional field.
 */
function isValidTrafficElement(o: unknown): o is Record<string, unknown> {
  if (typeof o !== 'object' || o === null) return false;
  const t = o as Record<string, unknown>;
  return (
    Number.isInteger(t.id) && (t.id as number) >= 0 &&
    Number.isFinite(t.lat as number) && (t.lat as number) >= -90 && (t.lat as number) <= 90 &&
    Number.isFinite(t.lon as number) && (t.lon as number) >= -180 && (t.lon as number) <= 180 &&
    Number.isFinite(t.altitudeFt as number) &&
    Number.isFinite(t.headingDeg as number) &&
    (t.onGround === undefined || typeof t.onGround === 'boolean')
  );
}

/** Builds the stored shape from a validated element (§4.6 step 1). A fresh
 *  object is constructed rather than spread, so unknown extra keys (§4.6,
 *  e.g. a stray "title") are dropped, not carried through. */
function normalizeTrafficElement(o: Record<string, unknown>): TrafficObject {
  return {
    id: o.id as number,
    lat: roundCoord(o.lat as number),
    lon: roundCoord(o.lon as number),
    altitudeFt: roundAlt(o.altitudeFt as number),
    headingDeg: normHeading(o.headingDeg as number),
    onGround: o.onGround === true,
  };
}

export type TrafficBatchResult =
  | { ok: true; objects: TrafficObject[] }
  | { ok: false; error: string };

/**
 * The body-shape and per-element checks of §4.5 rows 3-6 plus the §4.6
 * normalisation and de-duplication, as one pure function so
 * src/inspect-traffic.ts can drive it without HTTP. Does NOT apply the
 * retention cap (§5.5, applyRetentionCap in src/trafficStore.ts) — that step
 * needs flightManager.appState.lastFrame, which only the caller has — and
 * does not touch the store: a rejected batch must leave both completely
 * unchanged (§4.5).
 */
export function buildTrafficObjects(body: unknown): TrafficBatchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Traffic batch must be a JSON object' };
  }
  const { objects } = body as { objects?: unknown };
  if (!Array.isArray(objects)) {
    return { ok: false, error: 'Traffic batch requires an objects array' };
  }
  if (objects.length > MAX_BATCH_OBJECTS) {
    return { ok: false, error: `Traffic batch exceeds ${MAX_BATCH_OBJECTS} objects` };
  }
  for (let i = 0; i < objects.length; i++) {
    if (!isValidTrafficElement(objects[i])) {
      return { ok: false, error: `Invalid traffic object at index ${i}` };
    }
  }

  // De-duplicate by id through a Map: first-occurrence order, last-occurrence
  // value (§4.6 step 2) — re-setting an existing Map key updates its value
  // without moving its position, which is exactly this rule.
  const byId = new Map<number, TrafficObject>();
  for (const raw of objects as Record<string, unknown>[]) {
    const normalized = normalizeTrafficElement(raw);
    byId.set(normalized.id, normalized);
  }
  return { ok: true, objects: [...byId.values()] };
}

/** Fixed-width digest of a token or header value, so the ingest-token check can
 *  use crypto.timingSafeEqual (design.md §12.3). */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Receives flight data pushed over HTTP by the Windows-side agent (see /agent),
 * which talks to SimConnect locally on the MSFS machine. This is the only
 * supported way to get data in from a remote sim.
 */
export function createIngestRouter(
  flightManager: FlightManager,
  trafficStore: TrafficStore,
  ingestConfig: IngestConfig,
): Router {
  const router = express.Router();
  // The token comes from AppConfig, not process.env: src/config.ts is the only
  // module that reads the environment for security settings, and it already
  // refused to start unless the token is set or ALLOW_UNAUTHENTICATED_INGEST
  // opted out of it (design.md §7.4, §12.1, §12.2).
  const token = ingestConfig.token;
  const tokenDigest = token ? sha256(token) : null;
  let lastFrameAt = 0;

  // Read once, at construction — same rule as the agent's (design.md §3.5,
  // §5.6). Independent of INGEST_TOKEN: setting one does not imply the other.
  const trafficEnabled = parseTrafficEnabled(process.env.TRAFFIC_ENABLED);
  let trafficDisabledLogged = false;

  const checkAuth = (req: Request, res: Response): boolean => {
    // Reachable only through the explicit ALLOW_UNAUTHENTICATED_INGEST opt-out
    // — loadConfig() will not hand us a null token otherwise (§12.2).
    if (!tokenDigest) return true;
    const header = req.get('x-ingest-token');
    // Compared as SHA-256 digests so the two buffers are always the same
    // length: timingSafeEqual cannot throw on a length mismatch, and the
    // comparison leaks nothing about the token's length (§12.3).
    if (header && timingSafeEqual(sha256(header), tokenDigest)) return true;
    res.status(401).json({ error: 'Invalid or missing ingest token' });
    return false;
  };

  const markConnected = () => {
    if (!flightManager.appState.connected) {
      console.log('[Ingest] Agent connected');
    }
    flightManager.appState.connected = true;
    lastFrameAt = Date.now();
  };

  const markDisconnected = () => {
    if (flightManager.appState.connected) {
      console.log('[Ingest] Agent disconnected');
      flightManager.appState.connected = false;
      flightManager.onSimDisconnect();
    }
  };

  // The agent only sends an explicit "disconnected" event when it shuts down cleanly.
  // If it dies or the network drops, this catches the silence instead.
  setInterval(() => {
    if (flightManager.appState.connected && Date.now() - lastFrameAt > STALE_TIMEOUT_MS) {
      console.log('[Ingest] No data received recently — marking disconnected');
      markDisconnected();
    }
  }, STALE_CHECK_INTERVAL_MS);

  router.post('/frame', (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!isValidFrame(req.body)) {
      res.status(400).json({ error: 'Invalid frame payload' });
      return;
    }
    markConnected();
    flightManager.onFrame(req.body);
    res.status(204).end();
  });

  router.post('/event', (req, res) => {
    if (!checkAuth(req, res)) return;
    const { type, flags } = req.body as { type?: unknown; flags?: unknown };

    switch (type) {
      // Pause_EX1 bitmask from MSFS. Preferred over the legacy paused/unpaused
      // events below because those do NOT fire for Active Pause.
      case 'pause':
        if (typeof flags !== 'number' || !Number.isFinite(flags)) {
          res.status(400).json({ error: 'pause event requires a numeric flags field' });
          return;
        }
        markConnected();
        flightManager.setPaused(flags !== 0, flags);
        break;

      case 'connected':
        markConnected();
        break;
      case 'disconnected':
        markDisconnected();
        break;
      case 'paused':
        flightManager.setPaused(true);
        break;
      case 'unpaused':
        flightManager.setPaused(false);
        break;
      case 'crashed':
        console.log('[Ingest] Crash detected');
        flightManager.onCrash();
        break;
      default:
        res.status(400).json({ error: `Unknown event type: ${String(type)}` });
        return;
    }
    res.status(204).end();
  });

  // AI traffic: a one-way, memory-only channel beside the flight-data path
  // above. It never calls markConnected()/markDisconnected(), never touches
  // lastFrameAt, and never calls any FlightManager method (§4.7) — agent
  // connectivity is defined by the flight-data pipeline alone. Checked in
  // this exact order (§4.5): auth, then the kill switch, then validation; the
  // first failure wins and the store is left completely unchanged.
  router.post('/traffic', (req, res) => {
    if (!checkAuth(req, res)) return;

    if (!trafficEnabled) {
      if (!trafficDisabledLogged) {
        console.log('[Ingest] Traffic disabled (TRAFFIC_ENABLED) — discarding batch');
        trafficDisabledLogged = true;
      }
      res.status(204).end();
      return;
    }

    const result = buildTrafficObjects(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const capped = applyRetentionCap(result.objects, flightManager.appState.lastFrame);
    trafficStore.replace(capped);
    res.status(204).end();
  });

  return router;
}
