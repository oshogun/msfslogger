'use strict';

const {
  open,
  Protocol,
  SimConnectDataType,
  SimConnectPeriod,
  SimObjectType,
} = require('node-simconnect');

// Pure, dependency-free logic (buildTrafficBatch, TRAFFIC_ENABLED,
// trafficRadiusM parsing) lives in agent/traffic.js — design.md
// (run 2026-09-08-ai-traffic-map) §3.8, Amendment #3. It has no require of
// node-simconnect or anything else.
const { buildTrafficBatch, TRAFFIC_ENABLED, trafficRadiusM } = require('./traffic.js');

const SERVER_URL = process.env.SERVER_URL;
const INGEST_TOKEN = process.env.INGEST_TOKEN;

if (!SERVER_URL) {
  console.error('SERVER_URL environment variable is required, e.g. http://192.168.0.30:3000');
  process.exit(1);
}

// --sim/-s CLI flag — which MSFS/FSX SimConnect protocol revision to open
// with. Accepts space-separated ('--sim 2024') or equals-separated
// ('--sim=2024') forms, plus the '-s' short alias; case-insensitive.
// Omitting the flag keeps today's default (2020/Protocol.KittyHawk).
const SIM_PROTOCOLS = {
  '2020': { protocol: Protocol.KittyHawk, name: 'Protocol.KittyHawk' },
  '2024': { protocol: Protocol.SunRise,   name: 'Protocol.SunRise' },
  'fsx':  { protocol: Protocol.FSX_SP2,   name: 'Protocol.FSX_SP2' },
};

function parseSimArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sim' || arg === '-s') return argv[i + 1];
    if (arg.startsWith('--sim=')) return arg.slice('--sim='.length);
    if (arg.startsWith('-s=')) return arg.slice('-s='.length);
  }
  return undefined;
}

function resolveSimProtocol(argv) {
  const raw = parseSimArg(argv);
  if (raw === undefined) return SIM_PROTOCOLS['2020'];
  const match = SIM_PROTOCOLS[raw.toLowerCase()];
  if (!match) {
    console.error(`[Agent] Unrecognized --sim value "${raw}" — accepted values: 2020, 2024, fsx`);
    process.exit(1);
  }
  return match;
}

const SIM_PROTOCOL = resolveSimProtocol(process.argv.slice(2));

// Reconnect backoff — capped exponential, starting at the base delay and
// doubling on each consecutive failure up to the max (5s, 10s, 20s, 40s,
// 60s, 60s, ...). reconnectAttempt/reconnectScheduled live with the other
// module-level state below.
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60000;

const DEF_FLIGHT_DATA = 0;
const REQ_FLIGHT_DATA = 0;

// AI traffic — distinct data definition and request ids (design.md §1.2, §3.2, §3.3).
const DEF_TRAFFIC = 1;
const REQ_TRAFFIC = 1;
const TRAFFIC_SWEEP_MS = 2000;

const EVT_PAUSED = 1;
const EVT_UNPAUSED = 2;
const EVT_CRASHED = 3;
const EVT_FLIGHT_LOADED = 4;
const EVT_PAUSE_EX1 = 5;

const OBJECT_USER = 0;

// AI traffic — module-level sweep state, shared across reconnects (§3.4, §3.6).
let userObjectId = null;
let userLat = null;
let userLon = null;
let lastSweepAt = 0;
let sweepBuffer = [];

// Reconnect backoff state — reconnectAttempt counts consecutive failures
// since the last successful connect (reset to 0 on recvOpen) and drives
// nextReconnectDelayMs(); reconnectScheduled guards against scheduling more
// than one pending reconnect timer when SimConnect fires multiple
// disconnect-ish events (quit/close/error) for the same drop.
let reconnectAttempt = 0;
let reconnectScheduled = false;

/**
 * MSFS `Pause_EX1` bitmask (from the SimConnect SDK). The legacy Paused /
 * Unpaused events do NOT fire for Active Pause, which is why this event exists
 * and why the server prefers it.
 */
const PAUSE_FLAG_OFF        = 0;
const PAUSE_FLAG_FULL       = 1;   // regular full pause
const PAUSE_FLAG_WITH_SOUND = 2;   // legacy, rarely seen
const PAUSE_FLAG_ACTIVE     = 4;   // Active Pause — aircraft frozen, sim running
const PAUSE_FLAG_SIM        = 8;   // sim frozen (e.g. in a menu)

function describePause(flags) {
  if (flags === PAUSE_FLAG_OFF) return 'off';
  const parts = [];
  if (flags & PAUSE_FLAG_FULL)       parts.push('full');
  if (flags & PAUSE_FLAG_WITH_SOUND) parts.push('with-sound');
  if (flags & PAUSE_FLAG_ACTIVE)     parts.push('active');
  if (flags & PAUSE_FLAG_SIM)        parts.push('sim');
  return parts.join('+') || `unknown(${flags})`;
}

async function postJson(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (INGEST_TOKEN) headers['x-ingest-token'] = INGEST_TOKEN;

  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[Agent] Server responded ${res.status} for ${path}`);
    }
  } catch (err) {
    console.warn(`[Agent] Failed to reach server (${err.message})`);
  }
}

function sendEvent(type) {
  return postJson('/api/ingest/event', { type });
}

// AI traffic — decode one simObjectDataByType record (§3.2 read order) and
// post an assembled batch. A failed post is swallowed inside postJson, so a
// traffic push can never throw back into the SimConnect event handler and
// never interferes with the frame push or the reconnect logic.
function decodeTrafficRecord(objectID, data) {
  const lat              = data.readFloat64();
  const lon              = data.readFloat64();
  const altitudeFt       = data.readFloat64();
  const headingDeg       = data.readFloat64();
  const groundSpeedKnots = data.readFloat64();
  const onGround         = data.readInt32() !== 0;
  return { id: objectID, lat, lon, altitudeFt, headingDeg, groundSpeedKnots, onGround };
}

function postTrafficBatch(objects) {
  return postJson('/api/ingest/traffic', { objects });
}

function nextReconnectDelayMs(attempt) {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
}

// Schedules the next tryConnect() at the current backoff delay, unless one
// is already pending (see reconnectScheduled above). Bumps reconnectAttempt
// so the delay doubles next time; tryConnect() clears the guard when the
// attempt actually starts, and resets reconnectAttempt back to 0 once it
// succeeds.
function scheduleReconnect(reason) {
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  const delayMs = nextReconnectDelayMs(reconnectAttempt);
  reconnectAttempt++;
  console.log(`[Agent] ${reason} — retrying in ${delayMs / 1000}s (attempt ${reconnectAttempt})...`);
  setTimeout(tryConnect, delayMs);
}

async function tryConnect() {
  reconnectScheduled = false;
  try {
    console.log(`[Agent] Connecting to SimConnect (${SIM_PROTOCOL.name})...`);
    // Protocol is chosen by the --sim/-s CLI flag, resolved above (default
    // MSFS 2020/Protocol.KittyHawk). No `options` passed to open() — this
    // connects locally, the same way any other SimConnect client on this
    // machine does. No SimConnect.xml or firewall configuration needed.
    const { recvOpen, handle } = await open('msfslogger-agent', SIM_PROTOCOL.protocol);
    console.log(`[Agent] Connected to SimConnect — ${recvOpen.applicationName} ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`);

    // A successful open()+recvOpen means this disconnect episode is over —
    // the next one (unrelated) starts its backoff from the base delay again.
    reconnectAttempt = 0;

    await sendEvent('connected');

    // Data definition — read order below must match registration order exactly
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE LATITUDE',             'degrees',          SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE LONGITUDE',            'degrees',          SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE ALTITUDE',             'feet',             SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'AIRSPEED INDICATED',         'knots',            SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'GROUND VELOCITY',            'knots',            SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE HEADING DEGREES TRUE', 'degrees',          SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'VERTICAL SPEED',             'feet per minute',  SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'SIM ON GROUND',              'bool',             SimConnectDataType.INT32);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'IS SLEW ACTIVE',             'bool',             SimConnectDataType.INT32);
    handle.addToDataDefinition(DEF_FLIGHT_DATA, 'TITLE',                      null,               SimConnectDataType.STRING256);

    // AI traffic data definition (§3.2) — distinct id, registered only when
    // enabled. Read order below must match registration order exactly, same
    // rule as the flight-data definition above.
    if (TRAFFIC_ENABLED) {
      handle.addToDataDefinition(DEF_TRAFFIC, 'PLANE LATITUDE',             'degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_TRAFFIC, 'PLANE LONGITUDE',            'degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_TRAFFIC, 'PLANE ALTITUDE',             'feet',    SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_TRAFFIC, 'PLANE HEADING DEGREES TRUE', 'degrees', SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_TRAFFIC, 'GROUND VELOCITY',            'knots',   SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_TRAFFIC, 'SIM ON GROUND',              'bool',    SimConnectDataType.INT32);
    }

    handle.requestDataOnSimObject(
      REQ_FLIGHT_DATA,
      DEF_FLIGHT_DATA,
      OBJECT_USER,
      SimConnectPeriod.SECOND
    );

    handle.subscribeToSystemEvent(EVT_PAUSED,        'Paused');
    handle.subscribeToSystemEvent(EVT_UNPAUSED,      'Unpaused');
    handle.subscribeToSystemEvent(EVT_CRASHED,       'Crashed');
    handle.subscribeToSystemEvent(EVT_FLIGHT_LOADED, 'FlightLoaded');
    // Pause_EX1 reports Active Pause, which Paused/Unpaused do not
    handle.subscribeToSystemEvent(EVT_PAUSE_EX1,     'Pause_EX1');

    // Once Pause_EX1 is seen to work, the legacy events are redundant and would
    // fight it (they report a bare on/off that misses Active Pause).
    let usingPauseEx1 = false;

    handle.on('simObjectData', ({ requestID, objectID, data }) => {
      if (requestID !== REQ_FLIGHT_DATA) return;

      const lat              = data.readFloat64();
      const lon              = data.readFloat64();
      const altitudeFt       = data.readFloat64();
      const airspeedKnots    = data.readFloat64();
      const groundSpeedKnots = data.readFloat64();
      const headingDeg       = data.readFloat64();
      const verticalSpeedFpm = data.readFloat64();
      const onGround         = data.readInt32() !== 0;
      const isSlew           = data.readInt32() !== 0;
      const aircraft         = data.readString256() ?? 'Unknown';

      const frame = {
        lat,
        lon,
        altitudeFt,
        airspeedKnots,
        groundSpeedKnots,
        headingDeg,
        verticalSpeedFpm,
        onGround,
        simRunning: isSlew ? 3 : 2,
        aircraft,
      };

      postJson('/api/ingest/frame', frame);

      // AI traffic (§3.4, §3.6) — the user's own object id/position, and the
      // throttled re-issue of the traffic sweep, both driven off this same
      // 1 Hz tick rather than a separate timer.
      userObjectId = objectID;
      userLat = lat;
      userLon = lon;
      if (TRAFFIC_ENABLED && Date.now() - lastSweepAt >= TRAFFIC_SWEEP_MS) {
        lastSweepAt = Date.now();
        sweepBuffer = [];
        handle.requestDataOnSimObjectType(REQ_TRAFFIC, DEF_TRAFFIC, trafficRadiusM, SimObjectType.AIRCRAFT);
      }
    });

    if (TRAFFIC_ENABLED) {
      handle.on('simObjectDataByType', ({ requestID, objectID, entryNumber, outOf, data }) => {
        if (requestID !== REQ_TRAFFIC) return;
        if (outOf === 0) { postTrafficBatch([]); return; } // sweep found nothing
        if (entryNumber <= 1) sweepBuffer = []; // authoritative reset
        sweepBuffer.push(decodeTrafficRecord(objectID, data));
        if (entryNumber >= outOf) {
          postTrafficBatch(buildTrafficBatch(sweepBuffer, userObjectId, userLat, userLon));
          sweepBuffer = [];
        }
      });
    }

    handle.on('event', ({ clientEventId, data }) => {
      switch (clientEventId) {
        case EVT_PAUSE_EX1: {
          usingPauseEx1 = true;
          const flags = data | 0;
          console.log(`[Agent] Pause state: ${describePause(flags)}`);
          postJson('/api/ingest/event', { type: 'pause', flags });
          break;
        }
        case EVT_PAUSED:
          // Fallback only — Pause_EX1 is authoritative when available
          if (!usingPauseEx1) sendEvent('paused');
          break;
        case EVT_UNPAUSED:
          if (!usingPauseEx1) sendEvent('unpaused');
          break;
        case EVT_CRASHED:
          console.log('[Agent] Crash detected');
          sendEvent('crashed');
          break;
        case EVT_FLIGHT_LOADED:
          console.log('[Agent] Flight loaded');
          break;
      }
    });

    const handleDisconnect = () => {
      sendEvent('disconnected');
      scheduleReconnect('SimConnect disconnected');
    };

    handle.on('quit', handleDisconnect);
    handle.on('close', handleDisconnect);
    handle.on('error', (err) => {
      // node-simconnect / SimConnect commonly fire 'error' alongside
      // 'quit'/'close' for the same underlying drop — scheduleReconnect's
      // reconnectScheduled guard keeps this from double-scheduling.
      console.error('[Agent] SimConnect error:', err.message);
      sendEvent('disconnected');
      scheduleReconnect('SimConnect error');
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    scheduleReconnect(`Could not connect to SimConnect (${msg})`);
  }
}

console.log(`[Agent] msfslogger agent starting — forwarding data to ${SERVER_URL}`);
if (!TRAFFIC_ENABLED) console.log('[Agent] AI traffic gathering disabled (TRAFFIC_ENABLED)');
tryConnect();
