#!/usr/bin/env node
// ── ground_sessions DDL prototype ────────────────────────────────────────────
//
// Proves, against a COPY of the user's real flights.db (never the live file),
// that the DDL frozen in design.md §3 is:
//
//   1. applicable to a database that already holds real rows,
//   2. idempotent — running it twice changes nothing and throws nothing,
//   3. able to enforce "at most one open ground session" as a database
//      guarantee via a partial UNIQUE index on the expression `ended_at IS NULL`
//      (a plain UNIQUE(ended_at) cannot: SQLite treats NULLs as distinct),
//   4. honouring its CHECK constraints and its ON DELETE SET NULL foreign key
//      under `PRAGMA foreign_keys = ON`, which src/db/connection.ts sets.
//
// Usage (Node 20 — see .claude/ENVIRONMENT.md):
//   node .../ground-sessions-ddl.js /path/to/scratch-copy.db
//
// Exits non-zero on the first disagreement.

const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: ground-sessions-ddl.js <scratch-copy.db>');
  process.exit(2);
}

// The DDL exactly as design.md §3 freezes it.
const DDL = `
    CREATE TABLE IF NOT EXISTS ground_sessions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      source                  TEXT    NOT NULL CHECK (source IN ('auto', 'manual')),
      airport_icao            TEXT,
      airport_name            TEXT,
      lat                     REAL,
      lon                     REAL,
      parking_position        TEXT,
      parking_position_source TEXT    CHECK (parking_position_source IN ('auto', 'manual')),
      planned_leg_id          INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL,
      planned_leg_link_source TEXT    CHECK (planned_leg_link_source IN ('auto', 'manual')),
      aircraft                TEXT,
      started_at              TEXT    NOT NULL,
      ended_at                TEXT,
      ended_reason            TEXT,
      flight_id               INTEGER REFERENCES flights(id) ON DELETE SET NULL,
      created_at              TEXT    NOT NULL,
      updated_at              TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ground_sessions_started ON ground_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_ground_sessions_leg     ON ground_sessions(planned_leg_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ground_sessions_open
      ON ground_sessions(ended_at IS NULL) WHERE ended_at IS NULL;
`;

const checks = [];
function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail: detail ?? '' });
  } catch (err) {
    checks.push({ name, ok: false, detail: String(err) });
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const rowsBefore = db.prepare('SELECT COUNT(*) AS n FROM flights').get().n;
const legsBefore = db.prepare('SELECT COUNT(*) AS n FROM planned_legs').get().n;

check('1. applies to a database holding real rows', () => {
  db.exec(DDL);
  return `flights=${rowsBefore}, planned_legs=${legsBefore} before; table created`;
});

check('2. second application is a no-op (idempotent)', () => {
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ground_sessions'").get().sql;
  db.exec(DDL);
  const after = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ground_sessions'").get().sql;
  assert(before === after, 'DDL text changed on second run');
  const cols = db.prepare('PRAGMA table_info(ground_sessions)').all().map(c => c.name);
  assert(new Set(cols).size === cols.length, 'duplicate columns after second run');
  return `${cols.length} columns: ${cols.join(', ')}`;
});

check('3a. one open session inserts', () => {
  db.prepare(`
    INSERT INTO ground_sessions
      (source, airport_icao, airport_name, lat, lon, parking_position, parking_position_source,
       planned_leg_id, planned_leg_link_source, aircraft, started_at, ended_at, ended_reason,
       flight_id, created_at, updated_at)
    VALUES ('auto', 'KSFO', 'San Francisco Intl', 37.618, -122.3755, NULL, NULL,
            NULL, NULL, 'Cessna 172', '2026-09-15T10:00:00.000Z', NULL, NULL,
            NULL, '2026-09-15T10:00:00.000Z', '2026-09-15T10:00:00.000Z')
  `).run();
  return 'ok';
});

check('3b. a SECOND open session is refused by the database', () => {
  let threw = null;
  try {
    db.prepare(`
      INSERT INTO ground_sessions (source, started_at, created_at, updated_at)
      VALUES ('manual', '2026-09-15T10:05:00.000Z', '2026-09-15T10:05:00.000Z', '2026-09-15T10:05:00.000Z')
    `).run();
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, 'a second open session was accepted — the index does not constrain');
  assert(String(threw).includes('UNIQUE'), `expected a UNIQUE violation, got: ${threw}`);
  return String(threw.message);
});

check('3c. closing the first lets a second open session in', () => {
  db.prepare(`UPDATE ground_sessions SET ended_at = '2026-09-15T10:06:00.000Z', ended_reason = 'superseded' WHERE ended_at IS NULL`).run();
  db.prepare(`
    INSERT INTO ground_sessions (source, airport_icao, parking_position, parking_position_source,
                                 started_at, created_at, updated_at)
    VALUES ('manual', 'EGLL', 'Stand 231', 'manual',
            '2026-09-15T10:06:01.000Z', '2026-09-15T10:06:01.000Z', '2026-09-15T10:06:01.000Z')
  `).run();
  const open = db.prepare('SELECT COUNT(*) AS n FROM ground_sessions WHERE ended_at IS NULL').get().n;
  assert(open === 1, `expected exactly 1 open session, found ${open}`);
  return '1 open, 1 closed';
});

check('3d. many closed sessions coexist (the index is partial)', () => {
  const insert = db.prepare(`
    INSERT INTO ground_sessions (source, started_at, ended_at, ended_reason, created_at, updated_at)
    VALUES ('auto', ?, ?, 'sim-exit', ?, ?)
  `);
  for (let i = 0; i < 5; i++) {
    const ts = `2026-09-14T0${i}:00:00.000Z`;
    insert.run(ts, ts, ts, ts);
  }
  const closed = db.prepare('SELECT COUNT(*) AS n FROM ground_sessions WHERE ended_at IS NOT NULL').get().n;
  assert(closed === 6, `expected 6 closed sessions, found ${closed}`);
  return `${closed} closed rows, no conflict`;
});

check('4a. CHECK rejects an unknown source', () => {
  let threw = null;
  try {
    db.prepare(`INSERT INTO ground_sessions (source, started_at, ended_at, created_at, updated_at)
                VALUES ('guessed', 'x', 'x', 'x', 'x')`).run();
  } catch (err) { threw = err; }
  assert(threw !== null, "source 'guessed' was accepted");
  return String(threw.message);
});

check('4b. ON DELETE SET NULL blanks planned_leg_id, never the session row', () => {
  const leg = db.prepare('SELECT id FROM planned_legs ORDER BY id LIMIT 1').get();
  if (!leg) return 'skipped — no planned_legs rows in this database';
  // A throwaway trip+leg would be cleaner, but a real leg id proves the FK
  // against the real table. Delete is rolled back so the copy stays comparable.
  const tx = db.transaction(() => {
    db.prepare(`UPDATE ground_sessions SET planned_leg_id = ?, planned_leg_link_source = 'auto'
                 WHERE ended_at IS NULL`).run(leg.id);
    db.prepare('DELETE FROM planned_legs WHERE id = ?').run(leg.id);
    const row = db.prepare('SELECT id, planned_leg_id FROM ground_sessions WHERE ended_at IS NULL').get();
    assert(row !== undefined, 'the ground session was deleted with the leg — FK is CASCADE, not SET NULL');
    assert(row.planned_leg_id === null, `planned_leg_id is ${row.planned_leg_id}, expected null`);
    throw new Error('ROLLBACK_SENTINEL');
  });
  try { tx(); } catch (err) {
    if (String(err.message) !== 'ROLLBACK_SENTINEL') throw err;
  }
  return `leg ${leg.id} deleted -> session survived with planned_leg_id NULL (rolled back)`;
});

check('5. existing tables and row counts are untouched', () => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM flights').get().n;
  const l = db.prepare('SELECT COUNT(*) AS n FROM planned_legs').get().n;
  assert(n === rowsBefore, `flights row count changed: ${rowsBefore} -> ${n}`);
  assert(l === legsBefore, `planned_legs row count changed: ${legsBefore} -> ${l}`);
  return `flights=${n}, planned_legs=${l}`;
});

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? `\n        ${c.detail}` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
