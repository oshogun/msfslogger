import { initDb } from './db';
import { initAirports } from './airports';
import { ensureFlightPlansDir } from './flightPlans';
import { FlightManager } from './flightManager';
import { startSimConnect } from './simconnect';
import { createServer } from './server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

initDb();
console.log('[DB] Database ready');

ensureFlightPlansDir();

// Non-blocking: airport data will be ready well before the first flight starts
initAirports().catch(err => console.warn('[Airports] Init error:', err));

const flightManager = new FlightManager();

// Legacy/optional: connect directly to a remote SimConnect TCP listener.
// Only used when SIMCONNECT_HOST is explicitly set — the default (and recommended)
// setup instead has the Windows-side agent (see /agent) push data to /api/ingest.
if (process.env.SIMCONNECT_HOST) {
  startSimConnect(flightManager);
} else {
  console.log('[SimConnect] SIMCONNECT_HOST not set — waiting for agent data on /api/ingest');
}

const app = createServer(flightManager);
app.listen(PORT, () => {
  console.log(`[HTTP] Server running at http://localhost:${PORT}`);
});
