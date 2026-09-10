-- Run 2026-09-10-security-hardening — frozen DDL (design.md §4, §5).
--
-- REFERENCE ARTIFACT. Not loaded by the build. The Dispatcher transcribes this
-- verbatim into the db.exec(`...`) block in src/db.ts initDb(), after the
-- existing CREATE TABLE statements and before the PRAGMA table_info migration
-- block.
--
-- Every statement is IF NOT EXISTS and additive: no existing table, column,
-- index or row is altered, dropped or repurposed. Running it against a
-- database that already holds the user's logbook adds three empty tables and
-- one index, and nothing else. Running it twice is a no-op.
-- Timestamps are TEXT ISO-8601 UTC written by the application, matching the
-- existing trips.created_at convention (src/db.ts).

-- The single operator account. id is pinned to 1 by a CHECK so a second
-- account cannot be inserted by accident; §6.1 explains why one account.
CREATE TABLE IF NOT EXISTS auth_user (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  -- scrypt$N$r$p$<salt-b64>$<key-b64> — encoding frozen in §6.2
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- express-session store backing table (§10.2). `data` is the JSON-serialised
-- session; `expires_at` is epoch milliseconds, so the sweep is an integer
-- comparison and needs no date parsing.
CREATE TABLE IF NOT EXISTS auth_session (
  sid        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_session_expires ON auth_session(expires_at);

-- Server-side secrets that the operator does not have to manage. Currently one
-- row: name='session_secret' (§10.3). Values are base64 of 32 random bytes.
CREATE TABLE IF NOT EXISTS app_secret (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
