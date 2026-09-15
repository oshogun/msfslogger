const Database = require('better-sqlite3');
const fs = require('fs'), os = require('os'), path = require('path');
require('ts-node').register({ compilerOptions: { module: 'commonjs' } });
const { applySchema } = require('/home/guilherme/msfslogger/src/db/schema.ts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
function t(label, fn) { const a = process.hrtime.bigint(); const r = fn(); const b = process.hrtime.bigint(); console.log(label, Number(b-a)/1e6, 'ms'); return r; }
for (const mode of ['wal-default', 'wal-syncoff', 'delete-default', 'memory-journal']) {
  let open=0, prag=0, sch=0, close=0;
  for (let i=0;i<10;i++) {
    const f = path.join(dir, `${mode}-${i}.db`);
    let a = process.hrtime.bigint();
    const db = new Database(f);
    let b = process.hrtime.bigint(); open += Number(b-a)/1e6;
    a=b;
    if (mode.startsWith('wal')) db.pragma('journal_mode = WAL');
    if (mode === 'wal-syncoff') db.pragma('synchronous = OFF');
    if (mode === 'memory-journal') { db.pragma('journal_mode = MEMORY'); db.pragma('synchronous = OFF'); }
    db.pragma('foreign_keys = ON');
    b = process.hrtime.bigint(); prag += Number(b-a)/1e6; a=b;
    applySchema(db);
    b = process.hrtime.bigint(); sch += Number(b-a)/1e6; a=b;
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    db.close();
    b = process.hrtime.bigint(); close += Number(b-a)/1e6;
  }
  console.log(`${mode}: open ${(open/10).toFixed(1)}  pragma ${(prag/10).toFixed(1)}  applySchema ${(sch/10).toFixed(1)}  close ${(close/10).toFixed(1)}  total ${((open+prag+sch+close)/10).toFixed(1)} ms`);
}
// in-memory for comparison
let tot=0;
for (let i=0;i<10;i++){ const a=process.hrtime.bigint(); const db=new Database(':memory:'); db.pragma('foreign_keys = ON'); applySchema(db); db.close(); tot += Number(process.hrtime.bigint()-a)/1e6; }
console.log(':memory: total', (tot/10).toFixed(1), 'ms');
fs.rmSync(dir, {recursive:true, force:true});
