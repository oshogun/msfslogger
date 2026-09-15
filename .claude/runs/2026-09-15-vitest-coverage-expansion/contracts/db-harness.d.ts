// Frozen signatures for tests/helpers/db.ts — design.md §7.
//
// Reference artifact. Not wired into the build, not imported by anything.
// T-006 writes tests/helpers/db.ts to match this and owns that file; no other
// task edits it (§7.1). tests/helpers/index.ts must never import it.

import type Database from 'better-sqlite3';

// ── Lifecycle (§7.4) ─────────────────────────────────────────────────────────

export interface ScratchDb {
  /** The open handle — the same object src/db/connection.ts's getDb() returns. */
  db: Database.Database;
  /** Absolute path of the database file, i.e. <dir>/flights.db. */
  file: string;
  /** The temp directory holding it; removed whole by destroyScratchDb(). */
  dir: string;
}

/**
 * mkdtemp under scratchDbRoot(), then the REAL initDb(file) from '../../src/db'
 * — so applySchema(), WAL and foreign_keys all run on the production path and
 * every src/db/*.ts module finds the handle through getDb(). Sets no
 * environment variable. ~3.5 ms on tmpfs, ~400 ms on ext4 (§1.3).
 */
export function createScratchDb(): ScratchDb;

/**
 * The REAL closeDb() (WAL checkpoint included), then
 * fs.rmSync(h.dir, { recursive: true, force: true }). Idempotent; safe when the
 * database is already closed. Mandatory in afterEach (§7.6).
 */
export function destroyScratchDb(h: ScratchDb): void;

/** '/dev/shm' when it exists and is writable, else os.tmpdir(). Memoised (§7.3). */
export function scratchDbRoot(): string;

/**
 * Points FLIGHTS_DB_PATH at `file`; the returned function restores the previous
 * value, deleting the key if it was unset. Only the four CLI-script test files
 * need this (§8.2).
 */
export function useScratchDbEnv(file: string): () => void;

/**
 * DELETE FROM every application table plus sqlite_sequence, in one transaction,
 * foreign_keys off for the duration. ~0.33 ms. Only for the per-file pattern
 * permitted by §7.6.
 */
export function resetScratchDb(h: ScratchDb): void;

// ── Seed helpers (§7.5) ──────────────────────────────────────────────────────
//
// Raw-SQL inserts, never through the module under test. Each returns the new
// row id. Defaults are frozen in §7.5's table; T0/KSBA/KMRY are imported from
// ./index (sibling design §4.6, §4.7), not re-declared.

export interface SeedFlight {
  aircraft: string | null;
  start_time: string;
  end_time: string | null;
  departure_lat: number | null;
  departure_lon: number | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
  departure_icao: string | null;
  departure_name: string | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  max_airspeed_kts: number | null;
  point_count: number | null;
  notes: string | null;
  trip_id: number | null;
  flight_plan_name: string | null;
  planned_leg_id: number | null;
  planned_leg_link_source: 'auto' | 'manual' | null;
  planned_leg_prev_trip_id: number | null;
}

export function seedFlight(db: Database.Database, over?: Partial<SeedFlight>): number;

export interface SeedPoint {
  ts: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  airspeed_kts: number;
  ground_speed_kts: number;
  heading_deg: number;
  vertical_speed_fpm: number;
  on_ground: 0 | 1;
}

/** `ts` is always explicit: the gap between points is what backfill-durations decides on. */
export function seedPoints(
  db: Database.Database,
  flightId: number,
  points: Array<Partial<SeedPoint> & { ts: string }>,
): void;

export interface SeedTrip {
  name: string;
  notes: string | null;
  created_at: string;
  is_active: 0 | 1;
}

export function seedTrip(db: Database.Database, over?: Partial<SeedTrip>): number;

export interface SeedPlannedLeg {
  trip_id: number;
  seq: number;
  status: 'planned' | 'flown' | 'diverted' | 'skipped';
  departure_ident: string;
  departure_lat: number;
  departure_lon: number;
  departure_is_airport: 0 | 1;
  destination_ident: string;
  destination_lat: number;
  destination_lon: number;
  destination_is_airport: 0 | 1;
  source_filename: string;
  source_sha256: string;
  imported_at: string;
}

/** trip_id is required: a planned leg with no trip is not a reachable state. */
export function seedPlannedLeg(
  db: Database.Database,
  over: Partial<SeedPlannedLeg> & { trip_id: number },
): number;

export interface SeedAcarsMessage {
  flight_id: number | null;
  planned_leg_id: number | null;
  direction: 'in' | 'out';
  category: string;
  body: string;
  sent_at: string;
  dedup_key: string | null;
  correlation_id: number | null;
}

export function seedAcarsMessage(db: Database.Database, over?: Partial<SeedAcarsMessage>): number;

// planned_waypoints, planned_alternates, auth_user, auth_session, app_secret
// and app_setting have no seeder on purpose: they have one caller each, and
// that caller writes inline SQL in its own test file (§7.5).
