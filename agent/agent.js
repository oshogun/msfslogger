'use strict';

const {
  open,
  Protocol,
  SimConnectDataType,
  SimConnectPeriod,
} = require('node-simconnect');

const SERVER_URL = process.env.SERVER_URL;
const INGEST_TOKEN = process.env.INGEST_TOKEN;

if (!SERVER_URL) {
  console.error('SERVER_URL environment variable is required, e.g. http://192.168.0.30:3000');
  process.exit(1);
}

const RECONNECT_DELAY_MS = 5000;

const DEF_FLIGHT_DATA = 0;
const REQ_FLIGHT_DATA = 0;

const EVT_PAUSED = 1;
const EVT_UNPAUSED = 2;
const EVT_CRASHED = 3;
const EVT_FLIGHT_LOADED = 4;

const OBJECT_USER = 0;

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

async function tryConnect() {
  try {
    console.log('[Agent] Connecting to SimConnect...');
    // Protocol.KittyHawk targets MSFS 2020. Use Protocol.SunRise for MSFS 2024.
    // No `options` passed to open() — this connects locally, the same way any
    // other SimConnect client on this machine does. No SimConnect.xml or
    // firewall configuration needed.
    const { recvOpen, handle } = await open('msfslogger-agent', Protocol.KittyHawk);
    console.log(`[Agent] Connected to SimConnect — ${recvOpen.applicationName} ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`);

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

    handle.on('simObjectData', ({ requestID, data }) => {
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
    });

    handle.on('event', ({ clientEventId }) => {
      switch (clientEventId) {
        case EVT_PAUSED:
          sendEvent('paused');
          break;
        case EVT_UNPAUSED:
          sendEvent('unpaused');
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
      console.log('[Agent] SimConnect disconnected — retrying in 5s...');
      sendEvent('disconnected');
      setTimeout(tryConnect, RECONNECT_DELAY_MS);
    };

    handle.on('quit', handleDisconnect);
    handle.on('close', handleDisconnect);
    handle.on('error', (err) => {
      console.error('[Agent] SimConnect error:', err.message);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[Agent] Could not connect to SimConnect (${msg}) — retrying in 5s...`);
    setTimeout(tryConnect, RECONNECT_DELAY_MS);
  }
}

console.log(`[Agent] msfslogger agent starting — forwarding data to ${SERVER_URL}`);
tryConnect();
