/**
 * Prototype 2 for run 2026-09-10-security-hardening.
 *
 *   P6  A Node 20 client (the Windows agent, agent/agent.js, which uses global
 *       fetch) can be made to trust the server's self-signed certificate with
 *       NODE_EXTRA_CA_CERTS alone — no code change, no rejectUnauthorized:false.
 *       Control: the same request without it fails with DEPTH_ZERO_SELF_SIGNED_CERT.
 *   P7  A second process can write to a better-sqlite3 database that a running
 *       process holds open in WAL mode — this is `npm run set-password` while
 *       the server is up (§6.4 of design.md).
 *
 * Run: same NODE_PATH recipe as proto-auth-tls-pdf.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const Database = require('better-sqlite3');

const SCRATCH = process.env.PROTO_DIR || process.cwd();
const PORT = 3198;
const out = [];
const check = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);

async function main() {
  const server = https.createServer(
    { key: fs.readFileSync(path.join(SCRATCH, 'key.pem')), cert: fs.readFileSync(path.join(SCRATCH, 'cert.pem')) },
    (_req, res) => { res.writeHead(204); res.end(); }
  );
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const script = `fetch('https://127.0.0.1:${PORT}/api/ingest/frame', { method: 'POST' })
    .then(r => console.log('STATUS=' + r.status))
    .catch(e => console.log('ERR=' + ((e.cause && e.cause.code) || e.message)));`;

  // execFileAsync, not execFileSync: a sync child blocks this process's event
  // loop, so the https server above never accepts the connection and every
  // request "fails" with a connect timeout regardless of TLS.
  const plain = (await execFileAsync(process.execPath, ['-e', script])).stdout.trim();
  check('P6 control: plain fetch to self-signed HTTPS fails', plain.startsWith('ERR='), plain);

  const withCa = (await execFileAsync(process.execPath, ['-e', script], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(SCRATCH, 'cert.pem') },
  })).stdout.trim();
  check('P6 NODE_EXTRA_CA_CERTS makes the same unmodified client succeed', withCa === 'STATUS=204', withCa);

  server.close();

  // ── P7 ──
  const dbFile = path.join(SCRATCH, 'proto-concurrent.db');
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true });
  const held = new Database(dbFile);
  held.pragma('journal_mode = WAL');
  held.exec('CREATE TABLE IF NOT EXISTS auth_user (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password_hash TEXT NOT NULL)');
  held.prepare('INSERT INTO auth_user (id, username, password_hash) VALUES (1, ?, ?)').run('operator', 'hash-v1');
  held.prepare('SELECT * FROM auth_user').get(); // keep the connection warm/open

  const cliScript = `const D = require('better-sqlite3'); const db = new D(${JSON.stringify(dbFile)});
    db.prepare('INSERT INTO auth_user (id, username, password_hash) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash').run('operator', 'hash-v2');
    db.close(); console.log('CLI_OK');`;
  let cliOut;
  try {
    cliOut = execFileSync(process.execPath, ['-e', cliScript], { encoding: 'utf8', env: process.env }).trim();
  } catch (e) { cliOut = 'CLI_FAIL ' + e.message; }
  check('P7 second process writes while the first holds the DB open (WAL)', cliOut === 'CLI_OK', cliOut);

  const seen = held.prepare('SELECT password_hash FROM auth_user WHERE id = 1').get();
  check('P7 the holding connection sees the new hash on its next read', seen.password_hash === 'hash-v2', JSON.stringify(seen));
  held.close();

  console.log(out.join('\n'));
  process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
}
main().catch((e) => { console.error('PROTOTYPE ERROR', e); process.exit(2); });
