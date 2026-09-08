'use strict';

// ── AI traffic — pure, dependency-free logic ─────────────────────────────────
//
// design.md (run 2026-09-08-ai-traffic-map), Amendment #3 and §3.5/§3.8: this
// file must NOT require('node-simconnect') or anything else, so it — and
// agent/inspect-traffic.js, which drives it — can run under plain `node` on a
// machine where node-simconnect is not installed. All SimConnect wiring
// (the data definition, the request, decoding the buffer) lives in
// agent/agent.js, which requires this file for the pure parts.

// ── §3.5 — env vars, read once at process start ──────────────────────────────

const DISABLE_VALUES = ['0', 'false', 'off', 'no'];

const TRAFFIC_ENABLED = !DISABLE_VALUES.includes(
  String(process.env.TRAFFIC_ENABLED ?? '').trim().toLowerCase()
);

const TRAFFIC_RADIUS_M_DEFAULT = 40000;
const TRAFFIC_RADIUS_M_MIN = 1000;
const TRAFFIC_RADIUS_M_MAX = 200000;

function parseTrafficRadiusM(value) {
  if (value === undefined) return TRAFFIC_RADIUS_M_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    console.warn(`[Agent] Invalid TRAFFIC_RADIUS_M (${value}) — using default ${TRAFFIC_RADIUS_M_DEFAULT}`);
    return TRAFFIC_RADIUS_M_DEFAULT;
  }
  const rounded = Math.round(n);
  return Math.min(TRAFFIC_RADIUS_M_MAX, Math.max(TRAFFIC_RADIUS_M_MIN, rounded));
}

const trafficRadiusM = parseTrafficRadiusM(process.env.TRAFFIC_RADIUS_M);

// ── §1.2 — server also enforces this; the agent truncates to it so it never
// trips the server's 400 (§3.8 step 6) ───────────────────────────────────────

const MAX_BATCH_OBJECTS = 200;

// ── §3.8 — buildTrafficBatch ─────────────────────────────────────────────────
//
// `sweep` is an array of
// { id, lat, lon, altitudeFt, headingDeg, groundSpeedKnots, onGround }
// as decoded from the buffer by agent/agent.js. Returns TrafficObject[]
// (§2.1) — no rounding here, that is the server's job (§2.4).

const USER_POSITION_GUARD_DEG = 0.0001;
const PARKED_SPEED_KNOTS = 1;

function buildTrafficBatch(sweep, userObjectId, userLat, userLon) {
  const survivors = [];

  for (const o of sweep) {
    // 1. Drop the user's own aircraft by object id (§3.4 guard 1).
    if (o.id === userObjectId) continue;

    // 2. Drop the user's own aircraft by position (§3.4 guard 2).
    if (
      Math.abs(o.lat - userLat) <= USER_POSITION_GUARD_DEG &&
      Math.abs(o.lon - userLon) <= USER_POSITION_GUARD_DEG
    ) {
      continue;
    }

    // 3. Drop malformed records.
    if (!Number.isInteger(o.id) || o.id < 0) continue;
    if (
      !Number.isFinite(o.lat) ||
      !Number.isFinite(o.lon) ||
      !Number.isFinite(o.altitudeFt) ||
      !Number.isFinite(o.headingDeg)
    ) {
      continue;
    }

    // 4. Drop parked/gate-held aircraft (§3.7).
    if (o.onGround === true && o.groundSpeedKnots < PARKED_SPEED_KNOTS) continue;

    survivors.push(o);
  }

  // 5. De-duplicate by id: first occurrence's position, last occurrence's
  // value — exactly what Map + repeated .set() does.
  const byId = new Map();
  for (const o of survivors) {
    byId.set(o.id, o);
  }

  // 6. Truncate to MAX_BATCH_OBJECTS in that (first-occurrence) order.
  const deduped = Array.from(byId.values()).slice(0, MAX_BATCH_OBJECTS);

  // 7. Emit as TrafficObject — groundSpeedKnots dropped, onGround carried.
  return deduped.map((o) => ({
    id: o.id,
    lat: o.lat,
    lon: o.lon,
    altitudeFt: o.altitudeFt,
    headingDeg: o.headingDeg,
    onGround: o.onGround === true,
  }));
}

module.exports = { buildTrafficBatch, TRAFFIC_ENABLED, trafficRadiusM, MAX_BATCH_OBJECTS };
