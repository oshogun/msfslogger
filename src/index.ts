import { initDb } from './db';
import { initAirports } from './airports';
import { FlightManager } from './flightManager';
import { startSimConnect } from './simconnect';
import { createServer } from './server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

initDb();
console.log('[DB] Database ready');

// Non-blocking: airport data will be ready well before the first flight starts
initAirports().catch(err => console.warn('[Airports] Init error:', err));

const flightManager = new FlightManager();
startSimConnect(flightManager);

const app = createServer(flightManager);
app.listen(PORT, () => {
  console.log(`[HTTP] Server running at http://localhost:${PORT}`);
});
