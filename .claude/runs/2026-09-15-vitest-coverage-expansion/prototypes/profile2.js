const Database = require('better-sqlite3');
const fs = require('fs'), os = require('os'), path = require('path');
require('ts-node').register({ compilerOptions: { module: 'commonjs' } });
const { applySchema } = require('/home/guilherme/msfslogger/src/db/schema.ts');
const avg = (f, n=10) => { const a=process.hrtime.bigint(); for(let i=0;i<n;i++) f(i); return Number(process.hrtime.bigint()-a)/1e6/n; };

for (const root of ['/tmp', '/dev/shm']) {
  const dir = fs.mkdtempSync(path.join(root, 'prof-'));
  // V0: production sequence verbatim
  console.log(root, 'V0 prod initDb+closeDb   ', avg(i => {
    const db = new Database(path.join(dir, `v0-${i}.db`));
    db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); applySchema(db);
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {} db.close();
  }).toFixed(1), 'ms');
  // V2: pre-create the file as WAL with synchronous=OFF, then run the prod sequence
  console.log(root, 'V2 pre-created WAL file  ', avg(i => {
    const f = path.join(dir, `v2-${i}.db`);
    const pre = new Database(f); pre.pragma('synchronous = OFF'); pre.pragma('journal_mode = WAL'); pre.close();
    const db = new Database(f);
    db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); applySchema(db);
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {} db.close();
  }).toFixed(1), 'ms');
  fs.rmSync(dir, {recursive:true, force:true});
}

// V3: one db per file, reset between tests
const dir = fs.mkdtempSync(path.join('/tmp', 'prof3-'));
const f = path.join(dir, 'flights.db');
const db = new Database(f); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); applySchema(db);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
const reset = db.transaction(() => {
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("DELETE FROM sqlite_sequence").run();
  db.pragma('foreign_keys = ON');
});
console.log('tables reset:', tables.join(','));
console.log('V3 reset-between-tests   ', avg(() => {
  db.prepare("INSERT INTO flights (aircraft, start_time) VALUES ('C172','t')").run();
  reset();
}, 50).toFixed(2), 'ms');
db.close(); fs.rmSync(dir, {recursive:true, force:true});
