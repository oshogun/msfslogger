#!/usr/bin/env node
// seed-many-legs.mjs — creates one trip holding exactly 45 flights in a
// scratch flights.db, by direct better-sqlite3 INSERT, for the T-001
// (2026-09-09-sidebar-nav-legs-paging) legs-pagination acceptance criteria.
//
// The schema below is copied from src/db.ts's initDb() (read-only reference,
// not imported — src/ is read-only context for this run and this script must
// stand on its own against a brand-new scratch file). Only the columns that
// exist after every migration in initDb() are created, since a fresh file
// has no pre-migration rows to migrate around.
//
// Usage:
//   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
//   node .claude/runs/2026-09-09-sidebar-nav-legs-paging/tools/seed-many-legs.mjs <scratch>/flights.db
//
// Refuses to run against the repo's own flights.db (live logbook, never
// written to directly).

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// tools/ -> <run-id>/ -> runs/ -> .claude/ -> repo root
const repoRoot = path.resolve(scriptDir, '../../../..');
const liveFlightsDb = path.join(repoRoot, 'flights.db');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node seed-many-legs.mjs <path-to-scratch-flights.db>');
  process.exit(2);
}

const resolvedTarget = path.resolve(target);
if (resolvedTarget === path.resolve(liveFlightsDb)) {
  console.error(`Refusing to run against the repo's own flights.db: ${liveFlightsDb}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });

const db = new Database(resolvedTarget);
db.pragma('journal_mode = WAL');

// ── Schema (final shape, post-migration — src/db.ts initDb() is the source
// of truth this was copied from) ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    notes      TEXT,
    created_at TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS planned_legs (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id                INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    seq                    INTEGER NOT NULL,
    status                 TEXT    NOT NULL DEFAULT 'planned'
                             CHECK (status IN ('planned', 'flown', 'diverted', 'skipped')),
    departure_ident        TEXT    NOT NULL,
    departure_name         TEXT,
    departure_lat          REAL    NOT NULL,
    departure_lon          REAL    NOT NULL,
    departure_is_airport   INTEGER NOT NULL DEFAULT 0,
    departure_start        TEXT,
    departure_start_type   TEXT,
    departure_pos_lat      REAL,
    departure_pos_lon      REAL,
    destination_ident      TEXT    NOT NULL,
    destination_name       TEXT,
    destination_lat        REAL    NOT NULL,
    destination_lon        REAL    NOT NULL,
    destination_is_airport INTEGER NOT NULL DEFAULT 0,
    is_snippet             INTEGER NOT NULL DEFAULT 0,
    cruise_alt_ft          REAL,
    flightplan_type        TEXT,
    aircraft_type          TEXT,
    sid_name               TEXT,
    sid_runway             TEXT,
    sid_transition         TEXT,
    sid_type               TEXT,
    sid_custom_distance_nm REAL,
    star_name              TEXT,
    star_runway            TEXT,
    star_transition        TEXT,
    approach_name          TEXT,
    approach_runway        TEXT,
    approach_transition    TEXT,
    approach_type          TEXT,
    approach_arinc         TEXT,
    approach_suffix        TEXT,
    approach_transition_type TEXT,
    approach_custom_distance_nm REAL,
    approach_custom_altitude_ft REAL,
    approach_custom_offset_deg  REAL,
    waypoint_count         INTEGER NOT NULL DEFAULT 0,
    alternate_count        INTEGER NOT NULL DEFAULT 0,
    approx_distance_nm     REAL    NOT NULL DEFAULT 0,
    arrival_deviation_nm   REAL,
    remarks                TEXT,
    plan_created_at        TEXT,
    source_filename        TEXT    NOT NULL,
    source_sha256          TEXT    NOT NULL,
    source_program         TEXT,
    imported_at            TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS planned_waypoints (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    planned_leg_id    INTEGER NOT NULL REFERENCES planned_legs(id) ON DELETE CASCADE,
    seq               INTEGER NOT NULL,
    ident             TEXT    NOT NULL,
    name              TEXT,
    region            TEXT,
    airway            TEXT,
    track             TEXT,
    type              TEXT    NOT NULL,
    comment           TEXT,
    lat               REAL    NOT NULL,
    lon               REAL    NOT NULL,
    alt_ft            REAL
  );

  CREATE TABLE IF NOT EXISTS planned_alternates (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    planned_leg_id    INTEGER NOT NULL REFERENCES planned_legs(id) ON DELETE CASCADE,
    seq               INTEGER NOT NULL,
    ident             TEXT    NOT NULL,
    name              TEXT,
    type              TEXT,
    lat               REAL,
    lon               REAL,
    alt_ft            REAL
  );

  CREATE TABLE IF NOT EXISTS flights (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    aircraft                 TEXT,
    departure_lat            REAL,
    departure_lon            REAL,
    arrival_lat              REAL,
    arrival_lon              REAL,
    start_time               TEXT NOT NULL,
    end_time                 TEXT,
    duration_sec             INTEGER,
    distance_nm              REAL,
    max_altitude_ft          REAL,
    max_airspeed_kts         REAL,
    point_count              INTEGER,
    notes                    TEXT,
    departure_icao           TEXT,
    departure_name           TEXT,
    arrival_icao             TEXT,
    arrival_name             TEXT,
    trip_id                  INTEGER,
    flight_plan_name         TEXT,
    planned_leg_id           INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL,
    planned_leg_link_source  TEXT,
    planned_leg_prev_trip_id INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_flights_trip ON flights(trip_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_flights_planned_leg ON flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_active        ON trips(is_active)        WHERE is_active = 1;
`);

// ── Data: one trip, 45 flights (no planned legs — this fixture is purely
// for legs-table pagination, not the planned-leg feature) ─────────────────
const FLIGHT_COUNT = 45;
const now = new Date('2026-09-01T12:00:00Z');

const insertTrip = db.prepare('INSERT INTO trips (name, notes, created_at) VALUES (?, ?, ?)');
const insertFlight = db.prepare(`
  INSERT INTO flights (
    aircraft, departure_lat, departure_lon, arrival_lat, arrival_lon,
    start_time, end_time, duration_sec, distance_nm, max_altitude_ft,
    max_airspeed_kts, point_count, departure_icao, departure_name,
    arrival_icao, arrival_name, trip_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seed = db.transaction(() => {
  const tripId = insertTrip.run('T-001 seeded 45-leg trip', 'Fixture for legs-pagination acceptance testing', now.toISOString()).lastInsertRowid;

  for (let i = 0; i < FLIGHT_COUNT; i++) {
    const start = new Date(now.getTime() + i * 3600_000);
    const end = new Date(start.getTime() + 1800_000);
    insertFlight.run(
      'A320',
      37.6 + i * 0.01, -122.4 + i * 0.01,
      37.7 + i * 0.01, -122.5 + i * 0.01,
      start.toISOString(),
      end.toISOString(),
      1800,
      50 + i,
      35000,
      420,
      120,
      `K${String(i).padStart(3, '0')}`, `Airport ${i}`,
      `K${String(i + 1).padStart(3, '0')}`, `Airport ${i + 1}`,
      tripId
    );
  }

  return tripId;
});

const tripId = seed();
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

console.log(`Seeded trip ${tripId} with ${FLIGHT_COUNT} flights in ${resolvedTarget}`);
