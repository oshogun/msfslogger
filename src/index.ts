import { initDb, closeDb } from './db';
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
const server = app.listen(PORT, () => {
  console.log(`[HTTP] Server running at http://localhost:${PORT}`);
});

// Close the database on the way out so the WAL is checkpointed back into
// flights.db; otherwise a hard kill can strand recent flights in the -wal file.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Shutdown] ${signal} — closing database...`);
    server.close(() => {
      closeDb();
      console.log('[Shutdown] Clean.');
      process.exit(0);
    });
    // Don't hang forever on lingering keep-alive connections
    setTimeout(() => { closeDb(); process.exit(0); }, 3000).unref();
  });
}
