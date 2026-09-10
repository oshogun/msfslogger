#!/usr/bin/env node
// seed-sidebar-fixture.mjs — T-003 verification fixture. The live flights.db
// (copied by scratch-server.sh) has exactly one trip with every flight
// grouped into it, which can't exercise the Sidebar's "Flights" (ungrouped)
// section or the "second, non-active trip" case. This adds, to a SCRATCH
// copy only:
//   - 3 standalone flights (no trip_id)
//   - a second, non-active trip with 2 flights
//
// Refuses to run against the repo's own flights.db, same guard as
// seed-many-legs.mjs (T-001).
//
// Usage:
//   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
//   node seed-sidebar-fixture.mjs <scratch>/flights.db

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const liveFlightsDb = path.join(repoRoot, 'flights.db');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node seed-sidebar-fixture.mjs <path-to-scratch-flights.db>');
  process.exit(2);
}

const resolvedTarget = path.resolve(target);
if (resolvedTarget === path.resolve(liveFlightsDb)) {
  console.error(`Refusing to run against the repo's own flights.db: ${liveFlightsDb}`);
  process.exit(1);
}

const db = new Database(resolvedTarget);
db.pragma('journal_mode = WAL');

const insertTrip = db.prepare('INSERT INTO trips (name, notes, created_at, is_active) VALUES (?, ?, ?, 0)');
const insertFlight = db.prepare(`
  INSERT INTO flights (
    aircraft, departure_lat, departure_lon, arrival_lat, arrival_lon,
    start_time, end_time, duration_sec, distance_nm, max_altitude_ft,
    max_airspeed_kts, point_count, departure_icao, departure_name,
    arrival_icao, arrival_name, trip_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const now = new Date('2026-09-09T12:00:00Z');

const seed = db.transaction(() => {
  // Second trip, not active, 2 flights.
  const tripId = insertTrip.run('Weekend hop', 'T-003 fixture', now.toISOString()).lastInsertRowid;
  for (let i = 0; i < 2; i++) {
    const start = new Date(now.getTime() + i * 3600_000);
    const end = new Date(start.getTime() + 1800_000);
    insertFlight.run(
      'C172', 47.6 + i * 0.01, -122.3 + i * 0.01, 47.7 + i * 0.01, -122.4 + i * 0.01,
      start.toISOString(), end.toISOString(), 1800, 20 + i, 8000, 110, 60,
      `KHOP${i}`, `Hop Airport ${i}`, `KHOP${i + 1}`, `Hop Airport ${i + 1}`, tripId
    );
  }

  // 3 standalone flights, no trip. One has no ICAO on either end, to exercise
  // the aircraft-name fallback.
  insertFlight.run(
    'Cessna 152', 40.1, -74.1, 40.2, -74.2,
    new Date(now.getTime() + 10 * 3600_000).toISOString(), null, 1200, 15, 4000, 90, 30,
    'KTEB', 'Teterboro', null, null, null
  );
  insertFlight.run(
    'Piper Cub', 40.3, -74.3, null, null,
    new Date(now.getTime() + 11 * 3600_000).toISOString(), null, 900, 8, 2500, 70, 20,
    null, null, null, null, null
  );
  insertFlight.run(
    null, null, null, null, null,
    new Date(now.getTime() + 12 * 3600_000).toISOString(), null, null, null, null, null, 0,
    null, null, null, null, null
  );

  return tripId;
});

const secondTripId = seed();
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

console.log(`Seeded second trip ${secondTripId} (2 flights) + 3 standalone flights in ${resolvedTarget}`);
