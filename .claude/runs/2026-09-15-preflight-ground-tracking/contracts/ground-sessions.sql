-- ── ground_sessions ──────────────────────────────────────────────────────────
--
-- Reference artifact for design.md §3. Paste verbatim into the db.exec(`...`)
-- template literal in applySchema() (src/db/schema.ts), after the
-- acars_messages block and before the auth_user block. Not wired into the
-- build from here.
--
-- Verified against a copy of the user's real flights.db (55 flights, 22
-- planned legs) by prototypes/ground-sessions-ddl.js under Node 20: applies,
-- re-applies as a no-op, enforces one-open-session, honours its CHECKs and its
-- ON DELETE SET NULL foreign key with PRAGMA foreign_keys = ON.

    -- One pre-flight / on-ground session: the aircraft parked somewhere with an
    -- airport and (sometimes) a stand, from before pushback. Exists so ACARS
    -- dispatch and load-sheet actions have real context before a flights row
    -- does — flights is written at rotation and cannot answer "where am I
    -- parked right now".
    --
    -- Rows are never deleted by the app and never repurposed: a closed session
    -- is the historical record of a pre-flight, and `ended_reason` says how it
    -- ended.
    CREATE TABLE IF NOT EXISTS ground_sessions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Who created the row: 'auto' (the ground-state machine, from telemetry)
      -- or 'manual' (the operator typed it). Never rewritten after insert —
      -- an automatic session adopting operator-entered detail stays 'manual'
      -- and vice versa; the per-field *_source columns below carry the finer
      -- grain.
      source                  TEXT    NOT NULL CHECK (source IN ('auto', 'manual')),
      -- findNearestAirport()'s answer at entry, or the operator's ICAO.
      -- Nullable: a cold-and-dark spawn more than 10 nm from any known field
      -- is still a real ground session, and leaving the row to exist is what
      -- gives the manual fallback something to correct.
      airport_icao            TEXT,
      -- Only the automatic path can fill this: the manual endpoint has no
      -- ICAO -> name lookup (src/airports.ts exposes none) and must not invent
      -- one.
      airport_name            TEXT,
      -- The AIRCRAFT's position at entry, not the airport reference point —
      -- it is the more precise fact, it is what the re-anchor rule measures
      -- against, and findNearestAirport() does not return airport coordinates.
      lat                     REAL,
      lon                     REAL,
      -- Free text as the pilot would say it: 'Stand 231', 'GATE A12', 'Ramp 4'.
      -- No SimVar publishes the parking spot's name, so the automatic path can
      -- only fill this from a matched planned leg's departure_start.
      parking_position        TEXT,
      parking_position_source TEXT    CHECK (parking_position_source IN ('auto', 'manual')),
      -- The planned leg this session is about, matched by matchPlannedLeg()
      -- or named by the operator. SET NULL, not CASCADE: deleting a leg must
      -- not delete the record that the aircraft sat at a gate.
      planned_leg_id          INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL,
      planned_leg_link_source TEXT    CHECK (planned_leg_link_source IN ('auto', 'manual')),
      -- SimFrame.aircraft at entry. NULL on a manual session created with no
      -- agent connected.
      aircraft                TEXT,
      -- ISO 8601 UTC instants, new Date().toISOString() — the same clock and
      -- format as flights.start_time and acars_messages.sent_at.
      started_at              TEXT    NOT NULL,
      -- NULL means open. At most one row may hold NULL; see the partial UNIQUE
      -- index below.
      ended_at                TEXT,
      -- 'flight-started' | 'sim-exit' | 'crash' | 'slew' | 'superseded' |
      -- 'corrected' | 'manual'. Deliberately NOT a CHECK constraint, for the
      -- reason acars_messages.category is not one: a later reason must not
      -- need a table rewrite.
      ended_reason            TEXT,
      -- Set when the session ended because this flight started. SET NULL so
      -- deleting a flight leaves the pre-flight record standing.
      flight_id               INTEGER REFERENCES flights(id) ON DELETE SET NULL,
      created_at              TEXT    NOT NULL,
      updated_at              TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ground_sessions_started ON ground_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_ground_sessions_leg     ON ground_sessions(planned_leg_id);
    -- "At most one open ground session" as a database guarantee, in the same
    -- spirit as idx_trips_active. The expression is not decoration: SQLite
    -- treats NULLs in a UNIQUE index as distinct, so UNIQUE(ended_at) would
    -- constrain nothing at all. `ended_at IS NULL` evaluates to the non-null
    -- integer 1 for every row the partial index covers, and uniqueness over
    -- that single value is exactly the invariant. A SQLITE_CONSTRAINT here
    -- means a caller opened a session without closing the previous one — fix
    -- the caller, never the index.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ground_sessions_open
      ON ground_sessions(ended_at IS NULL) WHERE ended_at IS NULL;
