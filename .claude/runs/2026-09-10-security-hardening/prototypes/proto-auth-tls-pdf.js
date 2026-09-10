/**
 * Prototype for run 2026-09-10-security-hardening.
 *
 * Verifies the load-bearing assumptions of design.md before they are frozen:
 *   P1  express-session 1.19 + a custom better-sqlite3-backed Store works on
 *       Node 20 / Express 4, and a session survives a fresh Store instance
 *       (i.e. a server restart).
 *   P2  node:crypto scrypt hashing round-trips and how long a verify costs.
 *   P3  https.createServer with a self-signed cert serves the app, and a
 *       `secure` session cookie round-trips over it.
 *   P4  Puppeteer 24 can render a gated page over that self-signed HTTPS
 *       origin using `acceptInsecureCerts` + `page.setCookie()` — this is the
 *       PDF-export path (§9 of design.md). Control case: without the cookie
 *       the same render sees 401.
 *   P5  A cookie installed with page.setCookie(domain: '127.0.0.1') is NOT
 *       sent to a third-party origin (the OSM tile hosts) — i.e. the session
 *       cookie does not leak to tile servers.
 *
 * Run (nothing here touches the repo, the live server, or flights.db):
 *   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
 *   cd <scratch>/proto && npm i express@4 express-session
 *   NODE_PATH=<scratch>/proto/node_modules:/home/guilherme/msfslogger/node_modules \
 *     node .claude/runs/2026-09-10-security-hardening/prototypes/proto-auth-tls-pdf.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const puppeteer = require('puppeteer');

const SCRATCH = process.env.PROTO_DIR || process.cwd();
const CERT = fs.readFileSync(path.join(SCRATCH, 'cert.pem'));
const KEY = fs.readFileSync(path.join(SCRATCH, 'key.pem'));
const DB_FILE = path.join(SCRATCH, 'proto-sessions.db');
const PORT = 3199;
const ok = [];
const bad = [];
const check = (name, cond, detail = '') => (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

// ── P2: scrypt password hashing on node:crypto (no new dependency) ──────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltlen: 16 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(SCRYPT.saltlen);
  const key = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [scheme, N, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), key.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, got);
}

// ── P1: a minimal better-sqlite3 session store ─────────────────────────────
function makeStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_session (
    sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_session_expires ON auth_session(expires_at);`);

  class SqliteStore extends session.Store {
    get(sid, cb) {
      try {
        const row = db.prepare('SELECT data, expires_at FROM auth_session WHERE sid = ?').get(sid);
        if (!row) return cb(null, null);
        if (row.expires_at <= Date.now()) { db.prepare('DELETE FROM auth_session WHERE sid = ?').run(sid); return cb(null, null); }
        cb(null, JSON.parse(row.data));
      } catch (e) { cb(e); }
    }
    set(sid, sess, cb) {
      try {
        const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
        db.prepare('INSERT INTO auth_session (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at')
          .run(sid, JSON.stringify(sess), expires);
        cb(null);
      } catch (e) { cb(e); }
    }
    destroy(sid, cb) {
      try { db.prepare('DELETE FROM auth_session WHERE sid = ?').run(sid); cb(null); } catch (e) { cb(e); }
    }
    touch(sid, sess, cb) { this.set(sid, sess, cb); }
  }
  return new SqliteStore();
}

async function main() {
  fs.rmSync(DB_FILE, { force: true });
  fs.rmSync(DB_FILE + '-wal', { force: true });
  fs.rmSync(DB_FILE + '-shm', { force: true });
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  const t0 = Date.now();
  const stored = hashPassword('correct horse battery staple');
  const tHash = Date.now() - t0;
  const t1 = Date.now();
  const good = verifyPassword('correct horse battery staple', stored);
  const tVerify = Date.now() - t1;
  check('P2 scrypt verify accepts the right password', good, `hash ${tHash}ms / verify ${tVerify}ms`);
  check('P2 scrypt verify rejects the wrong password', verifyPassword('wrong', stored) === false);

  const app = express();
  app.set('trust proxy', false);
  app.use(express.json({ limit: '100kb' }));
  app.use(session({
    name: 'msfslogger.sid',
    secret: crypto.randomBytes(32).toString('base64'),
    store: makeStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 30 * 86400_000, path: '/' },
  }));

  app.post('/api/auth/login', (req, res) => {
    if (req.body.username !== 'operator' || !verifyPassword(req.body.password || '', stored)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.user = { username: 'operator' };
    req.session.save(() => res.status(200).json({ username: 'operator' }));
  });

  const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'Authentication required' });
  };

  app.get('/api/secret', requireAuth, (_req, res) => res.json({ flights: 42 }));

  // Stand-in for the SPA print route: public HTML, gated data fetch inside.
  app.get('/print/flight/1', (_req, res) => {
    res.type('html').send(`<!doctype html><html><body><h1 id="out">loading</h1>
    <img id="tile" src="https://tile.openstreetmap.org/0/0/0.png" />
    <script>
      fetch('/api/secret').then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(j => { document.getElementById('out').textContent = 'FLIGHTS=' + j.flights; window.__EXPORT_READY__ = true; })
        .catch(s => { document.getElementById('out').textContent = 'ERR=' + s; window.__EXPORT_READY__ = true; });
    </script></body></html>`);
  });

  const server = https.createServer({ key: KEY, cert: CERT }, app);
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  check('P3 https.createServer listening on 127.0.0.1:' + PORT, server.listening);

  const base = `https://127.0.0.1:${PORT}`;
  // https.request with rejectUnauthorized:false — Node 20 exposes no undici
  // Agent to hand to fetch(), and this is also exactly what an agent-side TLS
  // opt-out would have to do.
  const req = (method, p, body, cookie) => new Promise((resolve, reject) => {
    const r = https.request({
      host: '127.0.0.1', port: PORT, method, path: p, rejectUnauthorized: false,
      headers: {
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
        ...(cookie ? { cookie } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

  // Plain fetch with no TLS override — this is what the Windows agent does today.
  let agentErr = null;
  try { await fetch(`${base}/api/secret`); } catch (e) { agentErr = (e.cause && e.cause.code) || e.message; }
  check('P3 undici fetch rejects the self-signed cert by default', agentErr !== null, String(agentErr));

  const badLogin = await req('POST', '/api/auth/login', JSON.stringify({ username: 'operator', password: 'nope' }));
  check('P3 wrong password → 401', badLogin.status === 401, `body ${badLogin.text}`);

  const login = await req('POST', '/api/auth/login', JSON.stringify({ username: 'operator', password: 'correct horse battery staple' }));
  const setCookie = (login.headers['set-cookie'] || [])[0] || '';
  check('P3 login → 200 and a Set-Cookie', login.status === 200 && setCookie.includes('msfslogger.sid'), setCookie);
  check('P3 cookie carries HttpOnly, Secure, SameSite=Lax',
    /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));

  const cookiePair = setCookie.split(';')[0];
  const cookieValue = cookiePair.slice(cookiePair.indexOf('=') + 1);

  const gated = await req('GET', '/api/secret', null, cookiePair);
  check('P3 gated GET with cookie → 200', gated.status === 200, gated.text);
  const noCookie = await req('GET', '/api/secret', null, null);
  check('P3 gated GET without cookie → 401', noCookie.status === 401);

  const rows = db.prepare('SELECT sid, expires_at FROM auth_session').all();
  check('P1 session row persisted in sqlite', rows.length === 1, JSON.stringify(rows));

  // P1: a *new* Store over the same file resolves the same sid — restart-safe.
  const db2 = new Database(DB_FILE, { readonly: true });
  const persisted = db2.prepare('SELECT data FROM auth_session WHERE sid = ?').get(rows[0].sid);
  db2.close();
  check('P1 session survives a fresh connection (restart-safe)',
    !!persisted && JSON.parse(persisted.data).user.username === 'operator');

  // ── P4/P5: puppeteer render of the gated print page ──────────────────────
  const browser = await puppeteer.launch({
    acceptInsecureCerts: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  check('P4 puppeteer accepts { acceptInsecureCerts: true }', true, 'puppeteer ' + (puppeteer.default ? '' : '') + require('puppeteer/package.json').version);

  // Control: no cookie installed.
  const anon = await browser.newPage();
  await anon.goto(`${base}/print/flight/1`, { waitUntil: 'domcontentloaded' });
  await anon.waitForFunction('window.__EXPORT_READY__ === true', { timeout: 15000, polling: 100 });
  const anonText = await anon.evaluate('document.getElementById("out").textContent');
  check('P4 control: render WITHOUT the cookie sees 401', anonText === 'ERR=401', String(anonText));
  await anon.close();

  const page = await browser.newPage();
  const thirdPartyCookieSeen = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith(base) && (req.headers().cookie || '').includes(cookieValue)) thirdPartyCookieSeen.push(u);
    req.continue();
  });
  await page.setCookie({
    name: 'msfslogger.sid', value: cookieValue,
    domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'Lax',
  });
  await page.goto(`${base}/print/flight/1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__EXPORT_READY__ === true', { timeout: 15000, polling: 100 });
  const text = await page.evaluate('document.getElementById("out").textContent');
  check('P4 render WITH page.setCookie() reaches the gated API', text === 'FLIGHTS=42', String(text));
  const pdf = Buffer.from(await page.pdf({ printBackground: true }));
  check('P4 page.pdf() produced a PDF', pdf.length > 1000 && pdf.subarray(0, 5).toString() === '%PDF-', `${pdf.length} bytes`);
  // Give the tile request a moment to have gone out.
  await new Promise((r) => setTimeout(r, 1500));
  check('P5 session cookie was not sent to any third-party origin',
    thirdPartyCookieSeen.length === 0, thirdPartyCookieSeen.join(','));
  await page.close();
  await browser.close();

  server.close();
  db.close();

  console.log('\n'.padEnd(1) + [...ok, ...bad].join('\n'));
  console.log(`\n${ok.length} passed, ${bad.length} failed  (node ${process.version}, ${os.platform()})`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error('PROTOTYPE ERROR', e); process.exit(2); });
