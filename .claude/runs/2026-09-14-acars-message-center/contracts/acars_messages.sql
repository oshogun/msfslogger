-- Frozen DDL for design.md §2. Reference artifact: this file is NOT executed by
-- the build. T-002 pastes this block into applySchema()'s single db.exec(...)
-- template literal in src/db/schema.ts, immediately after the four
-- idx_planned_* CREATE INDEX lines (src/db/schema.ts:197-200) and before the
-- `-- The single operator account.` comment at :202, indented to match.
--
-- Verified against a copy of the user's real flights.db (54 flights, 20 planned
-- legs, 52746 flight points) under Node 20 / better-sqlite3 / SQLite 3.45.3:
-- applies twice with no error, PRAGMA table_info identical after the second
-- apply, row counts in flights/trips/planned_legs/flight_points unchanged.
-- See ../prototypes/acars-ddl-proto.js.

    -- Datalink-style messages for one flight, or for the planned leg a flight
    -- has not been created for yet (a PDC or a dispatch release arrives before
    -- pushback, when no flights row exists). Exactly one of flight_id and
    -- planned_leg_id is normally set; both may be set by a writer that knows
    -- both. A row with neither is unreachable and is refused above the
    -- database, in src/db/acarsMessages.ts.
    CREATE TABLE IF NOT EXISTS acars_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Nullable on purpose: startFlight() (src/flightManager.ts:236) does not
      -- insert a flights row until the flight begins, and pre-pushback messages
      -- have to land somewhere. CASCADE matches flight_points: deleting a
      -- flight deletes its thread.
      flight_id      INTEGER REFERENCES flights(id) ON DELETE CASCADE,
      -- The pre-flight scope. A thread read for a flight also returns the rows
      -- carrying that flight's planned_leg_id, so a clearance issued before
      -- departure shows up in the flight's thread once the link exists.
      planned_leg_id INTEGER REFERENCES planned_legs(id) ON DELETE CASCADE,
      -- 'uplink' (from dispatch to the aircraft) | 'downlink' (from the
      -- cockpit). No CHECK: validated in src/acars.ts, so a future direction
      -- needs no migration. The two values are frozen in §6 regardless.
      direction      TEXT    NOT NULL,
      -- 'pdc' | 'wx' | 'freetext' | 'position-report' | 'dispatch' | 'oooi' |
      -- whatever a later story needs. Deliberately NOT a CHECK constraint: the
      -- position-report story already needs 'oooi', which this story's own five
      -- do not include, and a CHECK cannot be widened without rewriting the
      -- table.
      category       TEXT    NOT NULL,
      -- Short display heading, e.g. 'PDC', 'METAR EGLL', 'OUT'. NULL renders as
      -- the category.
      label          TEXT,
      -- The message as the crew reads it. Newlines are significant and are
      -- never collapsed on the way in.
      body           TEXT    NOT NULL,
      -- Optional machine-readable twin of body: the loadsheet's fixed fields,
      -- a position report's lat/lon/alt. Opaque JSON text, owned entirely by
      -- the writing feature; no column of this table is derived from it.
      payload_json   TEXT,
      -- The request this row replies to (weather and loadsheet are both
      -- request/reply). SET NULL, not CASCADE: deleting a request must not
      -- silently delete the answer the user already read.
      correlation_id INTEGER REFERENCES acars_messages(id) ON DELETE SET NULL,
      -- Idempotency for writers that must not issue twice: 'pdc:leg:29',
      -- 'oooi:81:OUT', 'dispatch:ofp:<request_id>'. Free-form and owned by the
      -- writer; NULL for everything that may legitimately repeat.
      dedup_key      TEXT,
      -- ISO 8601 UTC instant, real wall-clock, as new Date().toISOString() —
      -- the same clock and format as flights.start_time and flight_points.ts.
      -- There is no sim clock to record: SimFrame (src/types.ts:1-12) carries
      -- no sim time.
      sent_at        TEXT    NOT NULL,
      -- NULL means unread. Nothing writes it this run; the column exists so the
      -- message-center's unread affordance and the MCDU client in the other
      -- repo do not need a migration.
      read_at        TEXT
    );

    -- Covers both halves of the thread read in §4, including its ORDER BY.
    CREATE INDEX IF NOT EXISTS idx_acars_messages_flight ON acars_messages(flight_id, sent_at, id);
    CREATE INDEX IF NOT EXISTS idx_acars_messages_leg    ON acars_messages(planned_leg_id, sent_at, id);
    -- Partial, in the same spirit as idx_flights_planned_leg: it turns "a PDC is
    -- issued once per leg" into a database guarantee while leaving every
    -- ordinary message (dedup_key IS NULL) free to repeat.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_acars_messages_dedup
      ON acars_messages(dedup_key) WHERE dedup_key IS NOT NULL;
