import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { loadConfig, ConfigError } from './config';
import { initDb, closeDb, getAuthUser, sessionSweep } from './db';
import { initAirports } from './airports';
import { ensureFlightPlansDir } from './flightPlans';
import { FlightManager } from './flightManager';
import { createServer } from './server';

// Configuration is read and validated before anything else — before the
// database is opened, before any listener — so a misconfigured deployment
// writes nothing (design.md §7.3, §12.2).
let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    // Some ConfigError messages (e.g. the missing-INGEST_TOKEN one, §12.2)
    // already carry a `[Config] ` prefix on every line; others are a single
    // unprefixed line. Prefix only the lines that don't already have it, so
    // stderr always ends up as one `[Config] ` line per sentence.
    for (const line of err.message.split('\n')) {
      console.error(line.startsWith('[Config]') ? line : `[Config] ${line}`);
    }
    process.exit(1);
  }
  throw err;
}

initDb();
console.log('[DB] Database ready');

// The server refuses to start with no operator account — there is no HTTP
// setup flow (design.md §6.4).
const authUser = getAuthUser();
if (!authUser) {
  console.error('[Auth] Refusing to start: no operator account exists.');
  console.error('[Auth] Run `npm run set-password` to create one (README § First run).');
  process.exit(1);
}

// Sweep expired sessions once at startup, then every 6 hours. The interval is
// unref'd so it never holds the process open at shutdown (design.md §10.5,
// §19 item 11).
const sweptAtStartup = sessionSweep(Date.now());
if (sweptAtStartup > 0) {
  console.log(`[Auth] Swept ${sweptAtStartup} expired sessions`);
}
setInterval(() => {
  const swept = sessionSweep(Date.now());
  if (swept > 0) {
    console.log(`[Auth] Swept ${swept} expired sessions`);
  }
}, 6 * 60 * 60 * 1000).unref();

ensureFlightPlansDir();

// Non-blocking: airport data will be ready well before the first flight starts
initAirports().catch(err => console.warn('[Airports] Init error:', err));

// Flight data arrives from the Windows-side agent (see /agent), which connects
// to SimConnect locally and pushes frames to /api/ingest.
const flightManager = new FlightManager();
console.log('[Ingest] Waiting for agent data on /api/ingest');

const app = createServer(flightManager);

// One port, one protocol: HTTPS when TLS is configured, plaintext HTTP
// otherwise. There is no second listener redirecting HTTP to HTTPS
// (design.md §11.4).
let server: http.Server | https.Server;
if (config.tls.enabled) {
  const key = fs.readFileSync(config.tls.keyFile);
  const cert = fs.readFileSync(config.tls.certFile);
  server = https.createServer(
    { key, cert, passphrase: config.tls.passphrase ?? undefined },
    app
  );
} else {
  server = http.createServer(app);
}

server.listen(config.port, config.bindHost, () => {
  const scheme = config.tls.enabled ? 'https' : 'http';
  console.log(`[HTTP] Server running at ${scheme}://${config.bindHost}:${config.port}`);
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
