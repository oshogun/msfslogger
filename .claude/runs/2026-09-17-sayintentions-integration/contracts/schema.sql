-- Reference stub — NOT wired into the build. Owner: T-003.
--
-- The one schema change this design makes. Additive, idempotent, and safe to
-- apply to the live flights.db while the user's server is running: it creates a
-- table that did not exist, touches no existing table, adds no column to one,
-- and drops nothing. Running it twice is a no-op.
--
-- Placement: inside applySchema()'s single db.exec(`…`) template in
-- src/db/schema.ts, immediately AFTER the app_setting CREATE TABLE and before
-- the closing backtick. Not after migratePlannedLegsTripIdNullable() and not in
-- the PRAGMA table_info migration block below it — there is no column to add.
--
-- The planned_legs table-rebuild migration at the top of src/db/schema.ts runs
-- with foreign_keys OFF and fires every ON DELETE action that references
-- planned_legs. This table references flights only, so that rebuild cannot
-- touch it.
--
-- See design.md §5 (link storage), §6 (migration).

CREATE TABLE IF NOT EXISTS sayintentions_links (
  -- PRIMARY KEY, not just a FK: one msfslogger flight has at most one
  -- SayIntentions link, and that is a database guarantee rather than a
  -- convention, the same way idx_flights_planned_leg makes the leg link one.
  -- CASCADE matches acars_messages: deleting a flight deletes its link and its
  -- imported thread together, leaving no orphan cursor behind.
  flight_id          INTEGER PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE,
  -- SayIntentions' own flight/session id as seen at link time, stored as TEXT
  -- because their JSON is not documented to be a number and a string compares
  -- the same either way. NULL when the response carried none.
  upstream_flight_id TEXT,
  -- The polling cursor: the highest comm_history[].id already imported. NULL
  -- before the first import, meaning "send no since_id at all".
  since_id           INTEGER,
  -- The highest comm_history[].id that existed when the link was made, so
  -- ?from=now can start the cursor there and an operator can see how much
  -- history predates the link. 0 when the session had no comms yet.
  baseline_comm_id   INTEGER NOT NULL DEFAULT 0,
  -- ISO 8601 UTC, same clock and format as flights.start_time and
  -- acars_messages.sent_at.
  linked_at          TEXT    NOT NULL,
  last_import_at     TEXT,
  -- Cumulative acars_messages rows this link has written. Display only;
  -- nothing branches on it.
  imported_count     INTEGER NOT NULL DEFAULT 0
);

-- No index beyond the primary key: every read is getSayIntentionsLink(flightId),
-- an exact PK lookup, and the table holds one row per linked flight (tens, at
-- msfslogger's volumes).
