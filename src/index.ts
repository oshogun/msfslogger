import { initDb } from './db';
import { initAirports } from './airports';
import { ensureFlightPlansDir } from './flightPlans';
import { FlightManager } from './flightManager';
import { createServer } from './server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

initDb();
console.log('[DB] Database ready');

ensureFlightPlansDir();

// Non-blocking: airport data will be ready well before the first flight starts
initAirports().catch(err => console.warn('[Airports] Init error:', err));

// Flight data arrives from the Windows-side agent (see /agent), which connects
// to SimConnect locally and pushes frames to /api/ingest.
const flightManager = new FlightManager();
console.log('[Ingest] Waiting for agent data on /api/ingest');

const app = createServer(flightManager);
app.listen(PORT, () => {
  console.log(`[HTTP] Server running at http://localhost:${PORT}`);
});
