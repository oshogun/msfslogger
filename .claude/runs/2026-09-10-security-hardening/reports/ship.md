# Ship report — T-011 upgrade rehearsal + packaging

All work done in `/tmp/ship-2026-09-10/` (scratch, outside repo). No source
files written. `flights.db` md5 unchanged: `bf2bb4ebc4cbd0055ac812738f4dada0`
before and after. `ss -ltnp | grep :3000`: nothing before, nothing after — no
process was live on port 3000 during this task (confirmed correction 1: the
user had stopped it earlier for unrelated reasons; this task neither started
nor touched anything on that port).

## Scratch DB provenance

`npm run backup /tmp/ship-2026-09-10/backup` (safe, read-only against live) —
47 flights, 43698 points, 1 trip, 26 flight plans. Per correction 2, this
snapshot already carries the schema migration **and** an `operator` account
(confirmed: `select * from auth_user` → `{id:1, username:'operator', ...}`),
so it could not by itself reproduce the missing-operator-account refusal. For
that one check only, I made a second scratch copy and deleted its
`auth_user` row (scratch-only DB mutation, never touching live or the
snapshot used for the rest of the rehearsal) to represent the genuinely-stale
pre-`set-password` state.

## Two refusals, in order

1. **INGEST_TOKEN missing** (`BIND_HOST=127.0.0.1`, no other env — isolates
   the credential refusals from the TLS/plaintext check, which the README's
   "Upgrading" section documents separately as a third refusal when
   `BIND_HOST` is left at its non-loopback default `0.0.0.0`; the task asked
   for two, so loopback was used here):
   ```
   [Config] Refusing to start: INGEST_TOKEN is not set.
   [Config] The agent ingest endpoints (/api/ingest/frame, /event, /traffic) would accept flight data from anyone who can reach this server.
   [Config] Set INGEST_TOKEN to a shared secret and set the same value on the agent (agent/README.md), or set ALLOW_UNAUTHENTICATED_INGEST=1 to run ingest unauthenticated (insecure - LAN only).
   ```
   exit 1.
2. **Operator account missing** (`INGEST_TOKEN` set, synthetic pre-account DB):
   ```
   [Auth] Refusing to start: no operator account exists.
   [Auth] Run `npm run set-password` to create one (README § First run).
   ```
   exit 1.

## README "Upgrading from an earlier version" — verbatim, command by command

All on the main scratch tree (`/tmp/ship-2026-09-10/tree`, `npm ci` in root
and `client/`, both exit 0):

| Command | Exit |
|---|---|
| `npm run build` | 0 |
| `node dist/setPassword.js` (piped `ScratchOperatorPass123!` via stdin, no TTY — the README's documented non-interactive path) → `Password set for user "operator".` | 0 |
| `export INGEST_TOKEN=$(openssl rand -hex 24)` | 0 (48-char token) |
| `openssl req -x509 ...` (README §HTTPS one-liner) | 0 |
| `export TLS_CERT_FILE=... TLS_KEY_FILE=...; npm start` (as `PORT=3107 BIND_HOST=127.0.0.1 node dist/index.js`) → `[HTTP] Server running at https://127.0.0.1:3107` | started clean, no deviation from the README text needed |

No documentation bug found in this block.

## End-to-end checks on port 3107 (HTTPS, scratch DB)

1. `POST /api/auth/login` → `HTTP/1.1 200 OK`,
   `Set-Cookie: msfslogger.sid=...; HttpOnly; Secure; SameSite=Lax`
2. `GET /api/flights` with cookie → `200`, 47 flights (matches scratch DB)
3. `GET /api/flights/68/export.pdf` → `200`, `Content-Type: application/pdf`,
   140232 bytes
4. `POST /api/ingest/frame` with `x-ingest-token` and a valid `SimFrame` body
   → `204 No Content`
5. Same POST without the header → `401 Unauthorized`,
   `{"error":"Invalid or missing ingest token"}`

Server killed afterward; port 3107 confirmed clear.

## Packaging

- **Docker server stage**, exact copied set (`package.json`,
  `package-lock.json`, `tsconfig.json`, `src/`) in a fresh scratch dir:
  `npm ci` exit 0, `npm run build:server` exit 0. `ls dist/setPassword.js
  dist/auth/` → `dist/setPassword.js`, `dist/auth/{middleware,password,routes,sessionStore}.js`.
- **`docker build .`**: daemon available (`docker info` exit 0); full build
  exit 0, image tagged, then removed (`docker rmi`, exit 0) — no image left
  behind.
- **`npm audit --omit=dev`**: exit 1 (npm's normal exit for any finding), 8
  vulnerabilities (2 moderate: `body-parser`/`qs`; 6 high: `extract-zip` via
  the `puppeteer` toolchain, `js-yaml`, `multer`). All pre-existing
  transitive deps, unrelated to this run — `src/auth/` uses `node:crypto`
  only, no new dependency was added (confirmed against `package.json` diff).
  No critical advisories. Full text: `/tmp/ship-2026-09-10/npm-audit.log`.

## Shippability (real repo, `/home/guilherme/msfslogger`)

- `npm run build` → exit 0 (`dist/*.js`, `client/dist/` produced)
- `npx tsc --noEmit` → exit 0
- `npm test` → 266 passed, 14 files, exit 0
- `git status --porcelain` → only this run's own source edits (`README.md`,
  `agent/README.md`, `client/src/*`, `docker-compose.yml`, `package.json`,
  `package-lock.json`, `src/*`, new `src/auth/`, `src/config.ts`,
  `src/setPassword.ts`, tests, run artifacts) — nothing else, no `dist/` or
  `client/dist/` tracked (both `.gitignore`d).

**The user's next restart of `node dist/index.js` on the live host will hit
the §20.1 refusal until they set `INGEST_TOKEN` (not set anywhere yet) — it
will *not* hit the missing-operator-account refusal, since the user has
already run `npm run set-password` against the real, live `flights.db` and
created the operator account.**

## Cleanup

Scratch server killed, port 3107 confirmed clear, no `node dist/index.js`
process left running anywhere, docker test image removed, all scratch dirs
under `/tmp/ship-2026-09-10/` (61 MB after trimming `node_modules`), nothing
written to the repo.
