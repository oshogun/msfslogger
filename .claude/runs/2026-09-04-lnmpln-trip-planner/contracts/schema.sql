-- ============================================================================
-- LNMPLN trip planner — schema reference
--
-- REFERENCE ONLY. This file is not read by the application and is not wired
-- into the build. src/db.ts remains the single place that issues SQL; these
-- statements are the exact text to place there, in the order given below.
--
-- Style follows the statements already in initDb(): CREATE TABLE IF NOT EXISTS,
-- INTEGER PRIMARY KEY AUTOINCREMENT, snake_case columns, aligned types,
-- CREATE INDEX IF NOT EXISTS, and additive idempotent migrations.
--
-- PRAGMA foreign_keys = ON is already set by initDb(), so every REFERENCES
-- clause below is enforced.
--
-- Amended 2026-09-04 (Amendment A in design.md): comments on seq and on
-- planned_waypoints.ident, after three real Little Navmap 3.0.18 files.
-- Amended 2026-09-04 (Amendment B): procedure columns 9 -> 18, after the first
-- real IFR plan, whose custom approach had four fields with nowhere to go.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — append to the existing db.exec(`...`) block in initDb(),
--          after CREATE TABLE trips. Must run BEFORE step 2, because step 2
--          adds a column on flights that REFERENCES planned_legs(id).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS planned_legs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id                INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  -- 1-based within a trip, dense on import, gappy after a delete. Every read
  -- orders by (seq, id) so the order stays total even if two rows shared a seq.
  -- Assigned in the order the import handler calls createPlannedLeg(), which is
  -- the CHAIN order of the batch (destination ident -> next departure ident),
  -- not the multipart upload order: Little Navmap's default filenames sort a
  -- trip into reverse route order. Falls back to upload order when the chain
  -- does not resolve uniquely. design.md §9.2.
  seq                    INTEGER NOT NULL,
  -- 'linked' is deliberately absent: a leg is linked when a flight row points
  -- at it, so the two facts cannot drift apart.
  status                 TEXT    NOT NULL DEFAULT 'planned'
                           CHECK (status IN ('planned', 'flown', 'diverted', 'skipped')),

  -- First waypoint of the plan. Not necessarily an airport: Little Navmap
  -- allows plan snippets, so departure_is_airport gates any ICAO claim.
  departure_ident        TEXT    NOT NULL,
  departure_name         TEXT,
  departure_lat          REAL    NOT NULL,
  departure_lon          REAL    NOT NULL,
  departure_is_airport   INTEGER NOT NULL DEFAULT 0,
  -- <Departure> in the file: the parking spot / runway the plan starts at.
  -- More precise than departure_lat/lon but optional, so the matcher uses the
  -- waypoint position above and these are display-only.
  departure_start        TEXT,
  departure_start_type   TEXT,
  departure_pos_lat      REAL,
  departure_pos_lon      REAL,

  -- Last waypoint of the plan, same caveat as the departure.
  destination_ident      TEXT    NOT NULL,
  destination_name       TEXT,
  destination_lat        REAL    NOT NULL,
  destination_lon        REAL    NOT NULL,
  destination_is_airport INTEGER NOT NULL DEFAULT 0,

  is_snippet             INTEGER NOT NULL DEFAULT 0,
  -- CruisingAltF preferred over CruisingAlt; null when the file carries neither.
  cruise_alt_ft          REAL,
  flightplan_type        TEXT,
  aircraft_type          TEXT,

  -- Procedures are stored flat because the file never contains their waypoints,
  -- so there would be nothing for a procedure-leg table to hold. Eighteen
  -- columns, not the nine originally frozen: a real custom approach is
  -- characterised entirely by Type + the Custom* values, all of which the
  -- nine-column form discarded. design.md §2.2.1.
  --
  -- sid_runway is the ONLY place a departure runway appears: no real file has
  -- ever carried a <Departure> element. design.md §5.4b, §5.4f.
  sid_name               TEXT,
  sid_runway             TEXT,
  sid_transition         TEXT,
  -- 'CUSTOMDEPART' for the manual's custom-departure form, which the XSD does
  -- not declare. NULL for an ordinary published SID.
  sid_type               TEXT,
  sid_custom_distance_nm REAL,

  -- Three columns only: no observed file and no documentation gives a STAR a
  -- type or a custom form. An unrecognised child of <STAR> surfaces as an
  -- UNKNOWN_ELEMENT warning rather than vanishing. design.md §5.4e.
  star_name              TEXT,
  star_runway            TEXT,
  star_transition        TEXT,

  -- approach_name is an opaque label, never a fix reference: with Type=CUSTOM
  -- Little Navmap synthesizes it as ICAO+runway ("KLAX24R"). design.md §5.4g.
  approach_name          TEXT,
  approach_runway        TEXT,
  approach_transition    TEXT,
  approach_type          TEXT,     -- e.g. 'CUSTOM'; says whether the name means anything
  approach_arinc         TEXT,
  approach_suffix        TEXT,
  approach_transition_type TEXT,
  -- The three Custom* values. CustomOffsetAngle is written by real Little
  -- Navmap and appears NOWHERE in the official XSD — the schema is not an
  -- exhaustive description of the format. design.md §5.4e.
  approach_custom_distance_nm REAL,
  approach_custom_altitude_ft REAL,
  approach_custom_offset_deg  REAL,

  waypoint_count         INTEGER NOT NULL DEFAULT 0,
  alternate_count        INTEGER NOT NULL DEFAULT 0,
  -- Great-circle sum over the en-route waypoint chain only. Named "approx"
  -- because SID/STAR/approach legs are absent from the file, so this is always
  -- short of the real routing. Never render it without an "approx." qualifier.
  -- The error is not small and not bounded: the real KSFO->KLAX IFR plan stores
  -- 293.5 nm against a 293.2 nm direct great circle, i.e. a straight line, while
  -- every turn the flight makes lives in the SID and STAR. design.md §6.
  approx_distance_nm     REAL    NOT NULL DEFAULT 0,
  -- Written at landing on both the 'flown' and the 'diverted' path.
  arrival_deviation_nm   REAL,

  remarks                TEXT,
  -- CreationDate normalised to a full ISO instant (the file writes a two-digit
  -- UTC offset, e.g. +02, which Date parses inconsistently).
  plan_created_at        TEXT,

  -- Provenance. The uploaded bytes are not kept; these three columns plus the
  -- import log are what makes a mis-parse reproducible from the user's own file.
  source_filename        TEXT    NOT NULL,
  source_sha256          TEXT    NOT NULL,
  source_program         TEXT,
  imported_at            TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS planned_waypoints (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  planned_leg_id    INTEGER NOT NULL REFERENCES planned_legs(id) ON DELETE CASCADE,
  -- 1-based document order across every <Waypoints> block in the file
  seq               INTEGER NOT NULL,
  ident             TEXT    NOT NULL,
  name              TEXT,
  region            TEXT,
  airway            TEXT,
  track             TEXT,
  -- AIRPORT | UNKNOWN | WAYPOINT | VOR | NDB | USER, or an unrecognised value
  -- passed through verbatim. Only AIRPORT is behaviourally significant.
  type              TEXT    NOT NULL,
  comment           TEXT,
  lat               REAL    NOT NULL,
  lon               REAL    NOT NULL,
  -- Pos/@Alt is optional in the format, and where present it is Little Navmap's
  -- COMPUTED profile altitude, not a planned constraint: a waypoint mid-climb
  -- carries a lower value than cruise. Store it, never present it as planned.
  -- design.md §6.1.
  alt_ft            REAL
);

CREATE TABLE IF NOT EXISTS planned_alternates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  planned_leg_id    INTEGER NOT NULL REFERENCES planned_legs(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  ident             TEXT    NOT NULL,
  name              TEXT,
  type              TEXT,
  -- Nullable, unlike planned_waypoints: <Alternate><Pos> is optional in the XSD
  lat               REAL,
  lon               REAL,
  alt_ft            REAL
);

CREATE INDEX IF NOT EXISTS idx_planned_legs_trip       ON planned_legs(trip_id, seq);
CREATE INDEX IF NOT EXISTS idx_planned_legs_source     ON planned_legs(trip_id, source_sha256);
CREATE INDEX IF NOT EXISTS idx_planned_waypoints_leg   ON planned_waypoints(planned_leg_id, seq);
CREATE INDEX IF NOT EXISTS idx_planned_alternates_leg  ON planned_alternates(planned_leg_id, seq);


-- ---------------------------------------------------------------------------
-- STEP 2 — append to the existing PRAGMA table_info migration block.
--          Additive and idempotent; nothing is renamed, retyped or dropped.
--
--   const cols = (db.prepare('PRAGMA table_info(flights)').all() as { name: string }[]).map(c => c.name);
--   ... existing checks unchanged ...
--   if (!cols.includes('planned_leg_id'))            db.exec('ALTER TABLE flights ADD COLUMN planned_leg_id INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL');
--   if (!cols.includes('planned_leg_link_source'))   db.exec('ALTER TABLE flights ADD COLUMN planned_leg_link_source TEXT');
--   if (!cols.includes('planned_leg_prev_trip_id'))  db.exec('ALTER TABLE flights ADD COLUMN planned_leg_prev_trip_id INTEGER');
--
--   const tripCols = (db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]).map(c => c.name);
--   if (!tripCols.includes('is_active'))             db.exec('ALTER TABLE trips ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
--
-- SQLite rules that make these legal exactly as written:
--   * ADD COLUMN with a REFERENCES clause requires a NULL default, which is why
--     planned_leg_id has none.
--   * is_active has no REFERENCES, so NOT NULL DEFAULT 0 is allowed.
--   * planned_legs must already exist (step 1) or the FK target is missing.
-- ---------------------------------------------------------------------------

ALTER TABLE flights ADD COLUMN planned_leg_id           INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL;
ALTER TABLE flights ADD COLUMN planned_leg_link_source  TEXT;     -- 'auto' | 'manual' | NULL
ALTER TABLE flights ADD COLUMN planned_leg_prev_trip_id INTEGER;  -- trip_id held immediately before the link
ALTER TABLE trips   ADD COLUMN is_active                INTEGER NOT NULL DEFAULT 0;


-- ---------------------------------------------------------------------------
-- STEP 3 — run unconditionally after the migration block, NOT inside the
--          if (!cols.includes(...)) branches. Both statements are IF NOT EXISTS,
--          so this is idempotent, and it also repairs a database that gained a
--          column without its index. (The existing idx_flights_trip is created
--          inside its branch; do not copy that, and do not change it either.)
--
-- Both indexes are partial and UNIQUE, and both are load-bearing: they turn a
-- convention into a database guarantee. A SQLITE_CONSTRAINT from either means
-- the caller's statement order is wrong. Fix the order, never the index.
-- ---------------------------------------------------------------------------

-- "A planned leg has at most one flight." The flight side is a single column,
-- which gives "a flight has at most one planned leg" for free.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flights_planned_leg
  ON flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL;

-- "At most one active trip." Every active row shares the key value 1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_active
  ON trips(is_active) WHERE is_active = 1;


-- ============================================================================
-- Reference queries — the exact shapes the CRUD layer needs
-- ============================================================================

-- Legs of a trip, in order, with the derived link. Children are fetched with
-- the two queries below and attached in JS, as getTripById() already does for
-- flight_points.
--
--   SELECT l.*,
--          (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
--     FROM planned_legs l
--    WHERE l.trip_id = ?
--    ORDER BY l.seq ASC, l.id ASC;
--
--   SELECT * FROM planned_waypoints  WHERE planned_leg_id = ? ORDER BY seq ASC;
--   SELECT * FROM planned_alternates WHERE planned_leg_id = ? ORDER BY seq ASC;

-- Auto-match candidates at takeoff. One indexed read over a table with tens of
-- rows; runs once per flight start, never per frame, and touches no airport data.
--
--   SELECT l.*,
--          (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
--     FROM planned_legs l
--     JOIN trips t ON t.id = l.trip_id
--    WHERE t.is_active = 1
--      AND l.status = 'planned'
--    ORDER BY l.seq ASC, l.id ASC;

-- Duplicate detection on import, per uploaded file, within the target trip.
--
--   SELECT id, seq FROM planned_legs WHERE trip_id = ? AND source_sha256 = ? LIMIT 1;

-- Next seq on import, inside the insert transaction. New legs are always
-- appended after the trip's existing legs; chain-sorting only decides the order
-- of the batch among itself and never renumbers what is already there.
--
--   SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM planned_legs WHERE trip_id = ?;

-- Set the active trip. Clear first, then set — the reverse order raises
-- SQLITE_CONSTRAINT against idx_trips_active whenever another trip is active.
--
--   UPDATE trips SET is_active = 0 WHERE is_active = 1;
--   UPDATE trips SET is_active = 1 WHERE id = ?;          -- skipped when clearing

-- Link a flight to a planned leg (auto or manual), one transaction.
-- prev_trip_id is captured BEFORE trip_id is overwritten.
--
--   UPDATE flights
--      SET planned_leg_prev_trip_id = trip_id,
--          trip_id                  = (SELECT trip_id FROM planned_legs WHERE id = :legId),
--          planned_leg_id           = :legId,
--          planned_leg_link_source  = :source        -- 'auto' | 'manual'
--    WHERE id = :flightId;

-- Unlink, restoring the trip the flight was in before the link. One transaction.
--
--   UPDATE planned_legs
--      SET status = 'planned', arrival_deviation_nm = NULL
--    WHERE id = (SELECT planned_leg_id FROM flights WHERE id = :flightId);
--   UPDATE flights
--      SET trip_id                  = planned_leg_prev_trip_id,
--          planned_leg_id           = NULL,
--          planned_leg_link_source  = NULL,
--          planned_leg_prev_trip_id = NULL
--    WHERE id = :flightId;

-- clearPlannedLegLink(flightId): used by deleteFlight() and combineFlights(),
-- where the flight row is about to be destroyed. Identical to unlink EXCEPT
-- that trip_id is NOT restored, because the flight is going away.
--
--   UPDATE planned_legs
--      SET status = 'planned', arrival_deviation_nm = NULL
--    WHERE id = (SELECT planned_leg_id FROM flights WHERE id = :flightId);
--   UPDATE flights
--      SET planned_leg_id = NULL, planned_leg_link_source = NULL,
--          planned_leg_prev_trip_id = NULL
--    WHERE id = :flightId;

-- Landing outcome, written by endFlight() for a linked flight.
--
--   UPDATE planned_legs SET status = ?, arrival_deviation_nm = ? WHERE id = ?;
--       status = 'flown'    when the arrival is within ARRIVAL_RADIUS_NM (10)
--       status = 'diverted' otherwise; the link is kept either way

-- Reorder: full permutation, renumbered 1..N in one transaction after the
-- server has checked that legIds is exactly the set of this trip's leg ids.
--
--   UPDATE planned_legs SET seq = ? WHERE id = ? AND trip_id = ?;

-- Trip list aggregate (additive to the existing getTrips() query).
--
--   LEFT JOIN ... , (SELECT COUNT(*) FROM planned_legs pl WHERE pl.trip_id = t.id) AS planned_leg_count


-- ============================================================================
-- Verification transcript — what a DevOps/Reviewer run should produce
-- Run against a CHECKPOINTED COPY of flights.db, never the live file.
-- ============================================================================
--
--   sqlite3 copy.db ".schema planned_legs"         -- exactly one definition
--   sqlite3 copy.db "select count(*) from planned_legs"                      -- 0
--   sqlite3 copy.db "select count(*) from flights"  -- unchanged from before
--   sqlite3 copy.db "select count(*) from trips"    -- unchanged from before
--   sqlite3 copy.db "select count(*) from trips where is_active = 1"         -- 0 or 1, always
--   sqlite3 copy.db "select count(*) from planned_legs
--                     where trip_id not in (select id from trips)"           -- 0 after any trip delete
--   sqlite3 copy.db "select count(*) from planned_waypoints
--                     where planned_leg_id not in (select id from planned_legs)" -- 0
--   sqlite3 copy.db "pragma foreign_key_check"      -- empty
--   sqlite3 copy.db "pragma integrity_check"        -- ok
