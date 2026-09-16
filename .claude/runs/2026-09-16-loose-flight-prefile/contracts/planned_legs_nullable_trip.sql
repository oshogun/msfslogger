-- Frozen DDL for the planned_legs.trip_id NOT NULL -> nullable rebuild.
-- Run id 2026-09-16-loose-flight-prefile. Reference artifact: this file is not
-- read at runtime; src/db/schema.ts carries its own copy of these statements.
--
-- Two blocks:
--   (A) the canonical CREATE TABLE as it must read AFTER the change, for a
--       fresh database (the CREATE TABLE IF NOT EXISTS block in applySchema).
--   (B) the one-time rebuild for a database that already holds rows under the
--       old NOT NULL constraint, exactly as the migration must run it.
--
-- The ONLY difference between (A) and today's table is trip_id's NOT NULL.
-- Every other column, default, CHECK, and the AUTOINCREMENT primary key are
-- byte-for-byte what they are today.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) canonical table, fresh database
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planned_legs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL means "loose": a prefile that belongs to no trip. Still CASCADE, so
  -- deleting a trip still deletes its legs; a NULL row references nothing and
  -- no cascade can reach it.
  trip_id                INTEGER REFERENCES trips(id) ON DELETE CASCADE,
  -- 1-based within a trip, dense on import, gappy after a delete. Every read
  -- orders by (seq, id) so the order stays total even if two rows shared a
  -- seq. Loose legs form their own sequence, numbered the same way.
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

-- Unchanged. SQLite index keys admit NULL, so a loose leg indexes on
-- (NULL, seq) / (NULL, source_sha256) with no structural change.
CREATE INDEX IF NOT EXISTS idx_planned_legs_trip   ON planned_legs(trip_id, seq);
CREATE INDEX IF NOT EXISTS idx_planned_legs_source ON planned_legs(trip_id, source_sha256);

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) one-time rebuild, existing database
--
-- PRAGMA foreign_keys = OFF is NOT optional and NOT decoration: with it ON,
-- `DROP TABLE planned_legs` fires every ON DELETE action referencing it and
-- silently empties planned_waypoints, planned_alternates and the leg-scoped
-- acars_messages, and NULLs flights.planned_leg_id and
-- ground_sessions.planned_leg_id. Measured on a copy of the live database:
-- 188 waypoints, 7 alternates, 2 ACARS messages, 4 ground-session links and
-- 21 flight links all went to zero, and PRAGMA foreign_key_check reported
-- "ok" afterwards because the rows were gone rather than orphaned.
--
-- The pragma is a silent no-op inside a transaction (measured: it still reads
-- 1 after `PRAGMA foreign_keys = OFF` between BEGIN and COMMIT, including
-- inside better-sqlite3's db.transaction()), so it MUST be set before BEGIN
-- and restored after COMMIT, and its effect MUST be re-read before the
-- rebuild proceeds.
--
-- The old table is dropped and the new one renamed into its place — never the
-- reverse. Measured on SQLite 3.45.3: `ALTER TABLE parent RENAME TO
-- parent_old` rewrites every other table's REFERENCES clause to name
-- "parent_old", with foreign_keys ON *and* OFF, so renaming planned_legs out
-- of the way would leave five child tables pointing at the corpse.
-- ─────────────────────────────────────────────────────────────────────────────

-- outside any transaction: PRAGMA foreign_keys = OFF;  (and re-read it)
-- BEGIN;

CREATE TABLE planned_legs_new (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id                INTEGER REFERENCES trips(id) ON DELETE CASCADE,
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

-- Explicit column lists on BOTH sides, never SELECT *: this statement is
-- frozen against the 50 columns planned_legs has today, and a future
-- ALTER TABLE ADD COLUMN placed ahead of it in applySchema would otherwise
-- make SELECT * silently mismatch. Any such future migration goes AFTER this
-- block.
INSERT INTO planned_legs_new (
  id, trip_id, seq, status,
  departure_ident, departure_name, departure_lat, departure_lon,
  departure_is_airport, departure_start, departure_start_type, departure_pos_lat,
  departure_pos_lon, destination_ident, destination_name, destination_lat,
  destination_lon, destination_is_airport, is_snippet, cruise_alt_ft,
  flightplan_type, aircraft_type, sid_name, sid_runway,
  sid_transition, sid_type, sid_custom_distance_nm, star_name,
  star_runway, star_transition, approach_name, approach_runway,
  approach_transition, approach_type, approach_arinc, approach_suffix,
  approach_transition_type, approach_custom_distance_nm, approach_custom_altitude_ft, approach_custom_offset_deg,
  waypoint_count, alternate_count, approx_distance_nm, arrival_deviation_nm,
  remarks, plan_created_at, source_filename, source_sha256,
  source_program, imported_at
)
SELECT
  id, trip_id, seq, status,
  departure_ident, departure_name, departure_lat, departure_lon,
  departure_is_airport, departure_start, departure_start_type, departure_pos_lat,
  departure_pos_lon, destination_ident, destination_name, destination_lat,
  destination_lon, destination_is_airport, is_snippet, cruise_alt_ft,
  flightplan_type, aircraft_type, sid_name, sid_runway,
  sid_transition, sid_type, sid_custom_distance_nm, star_name,
  star_runway, star_transition, approach_name, approach_runway,
  approach_transition, approach_type, approach_arinc, approach_suffix,
  approach_transition_type, approach_custom_distance_nm, approach_custom_altitude_ft, approach_custom_offset_deg,
  waypoint_count, alternate_count, approx_distance_nm, arrival_deviation_nm,
  remarks, plan_created_at, source_filename, source_sha256,
  source_program, imported_at
FROM planned_legs;

-- Read BEFORE the drop; applied after the rename. DROP TABLE deletes the
-- table's sqlite_sequence row, and the INSERT above only carries the sequence
-- up to MAX(id) — on the live database today sqlite_sequence.seq is 34 while
-- MAX(id) is 33, so without this the next leg would be inserted as id 34, an
-- id AUTOINCREMENT has already handed out once. Measured both ways on a copy.
--   const keep = SELECT seq FROM sqlite_sequence WHERE name = 'planned_legs';

DROP TABLE planned_legs;

ALTER TABLE planned_legs_new RENAME TO planned_legs;

-- The drop took both indexes with it. applySchema's CREATE INDEX IF NOT
-- EXISTS statements have already run by the time the migration block
-- executes, so the rebuild recreates them itself.
CREATE INDEX IF NOT EXISTS idx_planned_legs_trip   ON planned_legs(trip_id, seq);
CREATE INDEX IF NOT EXISTS idx_planned_legs_source ON planned_legs(trip_id, source_sha256);

-- Guarded so a fresh table (seq already >= keep) is never walked backwards.
--   UPDATE sqlite_sequence SET seq = :keep WHERE name = 'planned_legs' AND seq < :keep;

-- PRAGMA foreign_key_check must come back empty; a non-empty result aborts
-- the transaction rather than committing a rebuilt table with dangling rows.

-- COMMIT;
-- outside the transaction: PRAGMA foreign_keys = ON;  (restore the prior value)
