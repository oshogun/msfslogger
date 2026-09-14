// Prototype for design.md §2/§3/§4. Run under Node 20 against a COPY of
// flights.db (never the live file):
//
//   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
//   node .claude/runs/2026-09-14-acars-message-center/prototypes/acars-ddl-proto.js <scratch-dir>
//
// Proves, against the user's real row set: the DDL applies twice with no error
// and no table_info drift; every sibling story's sample row inserts with no
// extra column; the self-referencing correlation FK works; the partial UNIQUE
// index on dedup_key rejects a second PDC for the same leg; the flight+leg
// union list query returns a leg-scoped pre-flight row in the flight's thread;
// and ON DELETE CASCADE from both parents leaves no orphan.

const path = require('path');
const Database = require('/home/guilherme/msfslogger/node_modules/better-sqlite3');

const dir = process.argv[2];
if (!dir) throw new Error('usage: acars-ddl-proto.js <scratch-dir>');
const db = new Database(path.join(dir, 'flights.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DDL = `
    CREATE TABLE IF NOT EXISTS acars_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_id      INTEGER REFERENCES flights(id) ON DELETE CASCADE,
      planned_leg_id INTEGER REFERENCES planned_legs(id) ON DELETE CASCADE,
      direction      TEXT    NOT NULL,
      category       TEXT    NOT NULL,
      label          TEXT,
      body           TEXT    NOT NULL,
      payload_json   TEXT,
      correlation_id INTEGER REFERENCES acars_messages(id) ON DELETE SET NULL,
      dedup_key      TEXT,
      sent_at        TEXT    NOT NULL,
      read_at        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_acars_messages_flight ON acars_messages(flight_id, sent_at, id);
    CREATE INDEX IF NOT EXISTS idx_acars_messages_leg    ON acars_messages(planned_leg_id, sent_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_acars_messages_dedup
      ON acars_messages(dedup_key) WHERE dedup_key IS NOT NULL;
`;

function counts() {
  const q = t => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
  return { flights: q('flights'), trips: q('trips'), planned_legs: q('planned_legs'), flight_points: q('flight_points') };
}

function tableInfo() {
  return JSON.stringify(db.prepare('PRAGMA table_info(acars_messages)').all());
}

console.log('counts before        :', JSON.stringify(counts()));
db.exec(DDL);
const info1 = tableInfo();
db.exec(DDL); // idempotency: the whole block again
const info2 = tableInfo();
console.log('counts after         :', JSON.stringify(counts()));
console.log('table_info stable    :', info1 === info2);
console.log('columns              :', JSON.parse(info1).map(c => `${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}`).join(' | '));
console.log('indexes              :', db.prepare("SELECT name, partial FROM pragma_index_list('acars_messages')").all().map(i => `${i.name}(partial=${i.partial})`).join(' | '));

// A flight and a planned leg from the user's real data, so the FKs are exercised
// against real parents. A leg that has no flight is preferred for the
// pre-flight case.
const flight = db.prepare('SELECT id, planned_leg_id FROM flights WHERE planned_leg_id IS NOT NULL ORDER BY id DESC LIMIT 1').get();
console.log('sample flight        :', JSON.stringify(flight));
const legId = flight.planned_leg_id;

const insert = db.prepare(`
  INSERT INTO acars_messages
    (flight_id, planned_leg_id, direction, category, label, body, payload_json, correlation_id, dedup_key, sent_at)
  VALUES
    (@flight_id, @planned_leg_id, @direction, @category, @label, @body, @payload_json, @correlation_id, @dedup_key, @sent_at)
`);

const base = { flight_id: null, planned_leg_id: null, label: null, payload_json: null, correlation_id: null, dedup_key: null };
const ids = {};

// 1. PDC: leg-scoped, pre-pushback, no flights row yet. dedup_key pins one per leg.
ids.pdc = insert.run({
  ...base, planned_leg_id: legId, direction: 'uplink', category: 'pdc', label: 'PDC',
  body: 'CLEARED TO EGLL VIA SID WESLA5 ROUTE DCT SUSEY UN57 LL\nINITIAL FL100 SQUAWK 4271',
  payload_json: JSON.stringify({ departure: 'EHAM', destination: 'EGLL', squawk: '4271', initial_alt_ft: 10000 }),
  dedup_key: `pdc:leg:${legId}`, sent_at: '2026-09-14T09:00:00.000Z',
}).lastInsertRowid;

// 2. Dispatch release on SimBrief import: leg-scoped, pre-flight.
ids.dispatch = insert.run({
  ...base, planned_leg_id: legId, direction: 'uplink', category: 'dispatch', label: 'DISPATCH RELEASE',
  body: 'RELEASE EHAM-EGLL FL360 BLOCK 5.4T ALTN EGKK ETE 0055',
  payload_json: JSON.stringify({ block_fuel_kg: 5400, alternates: ['EGKK'], ete_min: 55 }),
  dedup_key: `dispatch:leg:${legId}`, sent_at: '2026-09-14T09:05:00.000Z',
}).lastInsertRowid;

// 3. WX request/reply pair, flight-scoped, correlated.
ids.wxReq = insert.run({
  ...base, flight_id: flight.id, direction: 'downlink', category: 'wx', label: 'WX REQUEST',
  body: 'WX REQUEST EGLL', sent_at: '2026-09-14T10:00:00.000Z',
}).lastInsertRowid;
ids.wxRep = insert.run({
  ...base, flight_id: flight.id, direction: 'uplink', category: 'wx', label: 'METAR EGLL',
  body: 'EGLL 141020Z 25012KT 9999 FEW035 14/07 Q1014',
  correlation_id: ids.wxReq, sent_at: '2026-09-14T10:00:04.000Z',
}).lastInsertRowid;

// 4. OOOI — a category the message-center story's own five do not include.
ids.oooi = insert.run({
  ...base, flight_id: flight.id, direction: 'downlink', category: 'oooi', label: 'OUT',
  body: 'OUT 1005Z EHAM FUEL 5.4', payload_json: JSON.stringify({ event: 'OUT', fuel_kg: 5400 }),
  dedup_key: `oooi:${flight.id}:OUT`, sent_at: '2026-09-14T10:05:00.000Z',
}).lastInsertRowid;

// 5. Position report.
ids.pos = insert.run({
  ...base, flight_id: flight.id, direction: 'downlink', category: 'position-report', label: 'POS',
  body: 'POS N5209.1 E00434.7 FL360 1042Z NEXT REDFA 1051Z',
  payload_json: JSON.stringify({ lat: 52.152, lon: 4.578, alt_ft: 36000, next_fix: 'REDFA' }),
  sent_at: '2026-09-14T10:42:00.000Z',
}).lastInsertRowid;

// 6. The canned client send this run actually ships.
ids.canned = insert.run({
  ...base, flight_id: flight.id, direction: 'downlink', category: 'freetext', label: 'REQUEST PUSHBACK',
  body: 'REQUEST PUSHBACK', sent_at: '2026-09-14T10:42:00.000Z', // same second as #5 on purpose: tiebreak
}).lastInsertRowid;

console.log('inserted ids         :', JSON.stringify(ids));

// Dedup: a second PDC for the same leg must be refused by the partial index.
try {
  insert.run({ ...base, planned_leg_id: legId, direction: 'uplink', category: 'pdc', label: 'PDC',
    body: 'SECOND CLEARANCE', dedup_key: `pdc:leg:${legId}`, sent_at: '2026-09-14T09:10:00.000Z' });
  console.log('dedup                : FAIL — duplicate accepted');
} catch (err) {
  console.log('dedup                :', err.code, '—', err.message);
}

// The §5/§4 list query: flight-scoped rows UNION the linked leg's pre-flight rows.
const list = db.prepare(`
  SELECT id, flight_id, planned_leg_id, direction, category, label, sent_at
    FROM acars_messages
   WHERE flight_id = @flightId
      OR planned_leg_id = (SELECT planned_leg_id FROM flights WHERE id = @flightId)
   ORDER BY sent_at ASC, id ASC
`).all({ flightId: flight.id });
console.log('thread (asc, id tiebreak):');
for (const r of list) console.log('   ', r.sent_at, String(r.id).padStart(3), r.direction.padEnd(8), r.category.padEnd(15), 'flight=' + r.flight_id, 'leg=' + r.planned_leg_id);

// A flight with no leg link must not pick up anybody else's leg rows.
const otherFlight = db.prepare('SELECT id FROM flights WHERE planned_leg_id IS NULL ORDER BY id DESC LIMIT 1').get();
const otherCount = db.prepare(`
  SELECT count(*) AS n FROM acars_messages
   WHERE flight_id = @flightId
      OR planned_leg_id = (SELECT planned_leg_id FROM flights WHERE id = @flightId)
`).get({ flightId: otherFlight.id }).n;
console.log('unlinked flight', otherFlight.id, 'sees  :', otherCount, '(must be 0)');

// Cascade, in a rolled-back transaction so the scratch rows survive for inspection.
db.exec('BEGIN');
db.prepare('DELETE FROM acars_messages WHERE id = ?').run(ids.wxReq);
console.log('correlation SET NULL :', db.prepare('SELECT correlation_id FROM acars_messages WHERE id = ?').get(ids.wxRep).correlation_id);
db.prepare('DELETE FROM planned_legs WHERE id = ?').run(legId);
console.log('leg-scoped after leg delete :', db.prepare('SELECT count(*) AS n FROM acars_messages WHERE planned_leg_id IS NOT NULL').get().n);
db.prepare('DELETE FROM flights WHERE id = ?').run(flight.id);
console.log('flight-scoped after flight delete :', db.prepare('SELECT count(*) AS n FROM acars_messages WHERE flight_id IS NOT NULL').get().n);
console.log('orphans (both null)  :', db.prepare('SELECT count(*) AS n FROM acars_messages WHERE flight_id IS NULL AND planned_leg_id IS NULL').get().n);
db.exec('ROLLBACK');
console.log('rows after rollback  :', db.prepare('SELECT count(*) AS n FROM acars_messages').get().n);
console.log('counts at end        :', JSON.stringify(counts()));

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
