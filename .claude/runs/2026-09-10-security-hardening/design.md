# design.md — run 2026-09-10-security-hardening

Frozen contracts for putting msfslogger behind authentication, serving it over
TLS, and making the ingest token mandatory.

Section numbers are an interface: `.claude/tools/ctx.sh design
2026-09-10-security-hardening 9 13` slices this file by them. They never get
renumbered. An amendment edits a section in place and adds a row to the table
below.

## Amendments

| # | Date | Section(s) | What changed | Evidence that forced it |
|---|------|-----------|--------------|-------------------------|
| 1 | 2026-09-10 | §12.4, §22 | `src/inspect-traffic.ts` (a standalone CLI inspector, not part of the Express app) is in scope after all — narrowly, for one call site. §12.4 makes `createIngestRouter`'s third `IngestConfig` parameter mandatory; `tsconfig.json`'s `"include": ["src/**/*"]` pulls every `src/inspect-*.ts` into the same build, so `npm run build` / `npx tsc` fail at `src/inspect-traffic.ts:561` (`Expected 3 arguments, but got 2`) without a matching update there. Not anticipated at design time because §22's file-and-ownership map only covered files this run's *behaviour* touches, not every caller a signature change would break. The Orchestrator dispatched a narrow, out-of-band fixup task (outside any plan.json task's `allowed_paths`) after T-007 landed: `withRouterServer()` now builds an `IngestConfig` from `process.env.INGEST_TOKEN` (read after its existing `envOverrides` loop, preserving every scenario's token-set/unset semantics unchanged) and passes it as the third argument. No inspector scenario's expected output changed. | T-007's own report surfaced the `tsc` failure; the T-007-fixup dispatcher confirmed `npx tsc`/`npm run build` exit 0 afterward and the inspector's full scenario table (36 rows, including S29–S33 which specifically exercise `INGEST_TOKEN` set/unset) still passes; the phase-3 reviewer (T-012) independently confirmed the diff is narrow and mechanical and flagged the missing amendment record, which this row closes. |

---

## 1. Overview and scope

### 1.1 What this run changes

Today every route in `src/server.ts` is open to anyone who can reach port 3000,
the server binds `0.0.0.0`, there is no TLS, and `INGEST_TOKEN` is optional
(`src/ingest.ts:120` — `if (!token) return true`). This design freezes:

- a single-operator session login (§6, §9, §10);
- HTTPS inside the Node process (§11);
- a mandatory ingest token with a named, documented opt-out (§12);
- an auth gate over every `/api/*` route except three login endpoints and
  `/api/ingest/*` (§8);
- the PDF-export loopback fix that auth would otherwise break (§13);
- the client-side login page and 401 handling (§14);
- the agent-side consequences (§15).

### 1.2 What this run does not change

The logbook's data model, every existing endpoint's request/response shape and
status codes, the upload validation already in place, flight recording, leg
matching, export output. §19 is the enumerated must-not-change list the
Reviewer checks one by one.

### 1.3 Shape of the change

Seven new server files, four new client files, additive DDL for three tables,
one new dependency (`express-session`) plus its `@types` package, and edits to
`src/server.ts`, `src/index.ts`, `src/ingest.ts`, `src/pdfExport.ts`,
`src/db.ts`, `package.json`, `README.md`, `agent/README.md`,
`docker-compose.yml`. §22 is the file-by-file ownership map.

### 1.4 Reference artifacts

`.claude/runs/2026-09-10-security-hardening/contracts/`:

| File | Contents |
|------|----------|
| `schema.sql` | The DDL of §5, ready to transcribe into `initDb()` |
| `config.ts` | `AppConfig`, `loadConfig`, `getConfig`, `ConfigError`, env name list (§7) |
| `auth-types.ts` | Wire types, row types, db accessors, password/session/middleware signatures (§4, §6, §9, §10) |
| `express-session.d.ts` | The `SessionData` augmentation, to be copied to `src/auth/` (§4.4) |
| `client-auth.ts` | Client-side types, hook and component contract (§14) |
| `samples/*.json` | Every request and response body in §9, verbatim |
| `../prototypes/*.js` | The two prototypes of §17 |

---

## 2. Frozen decisions restated

These came from the user in intake and are not open for redesign. A Dispatcher
that thinks one is wrong returns `blocked` rather than designing around it.

1. **Web UI auth is a session login.** A username/password form posts to the
   server, which sets a server-side session cookie. Not HTTP Basic, not
   "put a reverse proxy in front of it".
2. **HTTPS is built into the Node server**, configured with cert/key paths in
   env vars. Not guidance-only, not reverse-proxy-only.
3. **`INGEST_TOKEN` is required by default.** The server refuses to start
   without it unless an explicit, documented opt-out env var is set, which the
   README labels insecure and LAN-only.
4. **Destructive operations get no second confirmation.** A valid session is
   the whole gate for `DELETE`s and `POST /api/flights/combine`, exactly as it
   is for every other authenticated route.

---

## 3. Threat model and non-goals

### 3.1 What is being defended against

One operator, one homelab LAN, one server that until now answered
`DELETE /api/flights/7` from anybody. The threats that matter:

- **T1** — any device on the LAN (guest phone, IoT junk, a browser on a
  compromised machine) reaching the API and deleting or reading the logbook.
- **T2** — a request from a web page the operator happens to have open,
  riding their browser's ambient authority (CSRF) once a cookie exists.
- **T3** — passive capture of the session cookie or the ingest token on an
  untrusted network segment (plaintext HTTP).
- **T4** — an attacker who can reach the ingest endpoints injecting fake
  flights, or scraping live position data.
- **T5** — brute-forcing the operator's password over the network.

### 3.2 Non-goals, stated so nobody designs for them later by accident

- **Multi-user.** One account. No roles, no per-flight ownership (§6.1).
- **Public-internet exposure.** The design is safe on a LAN and behind a VPN;
  nothing here (no HSTS preload, no WAF, no account recovery flow, no 2FA)
  makes port-forwarding it to the internet a good idea, and the README must
  not imply it does.
- **Encryption at rest.** `flights.db` and `flight_plans/` stay plaintext on
  disk. Anyone with filesystem access already wins, including against the
  session store (§10.3).
- **Certificate management.** No ACME, no auto-renewal. The operator supplies
  cert and key files (§11.5).
- **Audit logging.** Login successes/failures are logged to stdout (§9.4) and
  that is all.

---

## 4. Data model

### 4.1 `auth_user` — the operator account

One row, `id` pinned to 1 by a `CHECK` constraint.

| Column | Type | Null? | Owned by | Notes |
|--------|------|-------|----------|-------|
| `id` | INTEGER PK | no | DDL | `CHECK (id = 1)`. A second account cannot be inserted. |
| `username` | TEXT | no | set-password CLI (§6.4) | 1–64 chars after trim. Compared case-sensitively (§16.1). |
| `password_hash` | TEXT | no | set-password CLI | `scrypt$N$r$p$<salt-b64>$<key-b64>` (§6.2). Never leaves the server, never appears in an API response, never logged. |
| `created_at` | TEXT | no | set-password CLI | ISO-8601 UTC. Set on first insert, preserved on later password changes. |
| `updated_at` | TEXT | no | set-password CLI | ISO-8601 UTC. Rewritten on every change. |

### 4.2 `auth_session` — the session store

| Column | Type | Null? | Owned by | Notes |
|--------|------|-------|----------|-------|
| `sid` | TEXT PK | no | `express-session` | The unsigned session id. The cookie carries a signed form of it; only the bare id is stored. |
| `data` | TEXT | no | `SqliteSessionStore` (§10.2) | `JSON.stringify(session)` — `{ cookie: {...}, user?: { username } }`. |
| `expires_at` | INTEGER | no | `SqliteSessionStore` | Epoch **milliseconds**. Derived from `session.cookie.expires`; when that is absent, `now + sessionMaxAgeMs`. |

Index `idx_auth_session_expires ON auth_session(expires_at)` supports the sweep
in §10.5.

### 4.3 `app_secret` — server-managed secrets

| Column | Type | Null? | Owned by | Notes |
|--------|------|-------|----------|-------|
| `name` | TEXT PK | no | server | Currently exactly one value: `'session_secret'`. |
| `value` | TEXT | no | server | base64 of 32 `crypto.randomBytes`. |
| `created_at` | TEXT | no | server | ISO-8601 UTC. |

### 4.4 Type ownership

Two parallel tasks must never edit the same file, so every shared type has one
home:

| Type | Lives in | Mirrored in |
|------|----------|-------------|
| `SessionUser`, `LoginRequest`, `LoginResponse`, `SessionResponse` | `src/types.ts` | `client/src/types.ts` (hand-copied, byte-identical — there is no shared package and this run does not introduce one) |
| `AuthUserRow` and the `auth_*`/`app_secret` accessors | `src/db.ts` | — |
| `AppConfig`, `TlsConfig`, `IngestConfig`, `ConfigError` | `src/config.ts` | — |
| `SCRYPT_PARAMS`, `hashPassword`, `verifyPassword`, `DUMMY_PASSWORD_HASH` | `src/auth/password.ts` | — |
| `SqliteSessionStore` | `src/auth/sessionStore.ts` | — |
| `requireAuth`, `requireSameOrigin`, `LoginThrottle`, `sessionCookieFrom` | `src/auth/middleware.ts` | — |
| `createAuthRouter` | `src/auth/routes.ts` | — |
| `declare module 'express-session' { interface SessionData }` | `src/auth/express-session.d.ts` — **the only** augmentation of it anywhere | — |
| `UnauthorizedError`, `setUnauthorizedHandler` | `client/src/utils/api.ts` | — |
| `SessionState`, `useSession` | `client/src/hooks/useSession.ts` | — |

The error body stays the project's existing `{ error: string }` shape (§9.5);
no new error envelope is introduced.

---

## 5. Persistence and migration

### 5.1 DDL

Verbatim in `contracts/schema.sql`. Three `CREATE TABLE IF NOT EXISTS` and one
`CREATE INDEX IF NOT EXISTS`, transcribed into the existing `db.exec(\`...\`)`
template literal in `initDb()` (`src/db.ts:42`), **after** the existing
`CREATE TABLE` statements and **before** the `PRAGMA table_info(flights)`
migration block at `src/db.ts:237`.

### 5.2 Migration safety rules this satisfies

- **Additive only.** No `ALTER TABLE`, no `DROP`, no column repurposed, no
  existing row read or written by the migration.
- **Idempotent.** Every statement is `IF NOT EXISTS`; running it on an
  already-migrated database is a no-op, and `initDb()` runs it on every start.
- **Safe under live rows.** The three new tables are unrelated to `flights`,
  `flight_points`, `trips`, `planned_legs`, `planned_waypoints`,
  `planned_alternates`. `PRAGMA foreign_keys = ON` is unaffected: none of the
  new tables has a foreign key, and nothing references them.
- **No downgrade hazard.** An older build against a migrated database simply
  ignores the three tables.

### 5.3 Rollback

Reverting the code is sufficient; the tables stay behind, inert. Nothing in
this design requires dropping them, and no task may write a `DROP TABLE`.

### 5.4 Write patterns and concurrency

`auth_session` is written on login, on logout, and on every request that
touches a live session (`rolling: true`, §10.4) — a single `INSERT … ON
CONFLICT DO UPDATE` per request, synchronous, in WAL mode. That is the same
order of write traffic the ingest path already produces.

The set-password CLI (§6.4) opens its own `better-sqlite3` connection while the
server holds one. **Verified** (prototype P7, §17): a second process writes to
the WAL database while the first holds it open, and the holding connection sees
the new value on its next read — so the CLI works with the server running, and
the change takes effect on the next login attempt without a restart.

---

## 6. Credentials

### 6.1 One account, stored in SQLite

A single operator row (§4.1), not a `username:password` pair in the
environment.

Rationale, since this is the app's first credential of any kind:

- The password can be changed without editing a systemd unit or a compose file
  and restarting the server (§5.4).
- A hash in an env var leaks through `/proc/<pid>/environ`, `docker inspect`,
  and any crash reporter that dumps the environment. The DB is already the
  app's trust boundary — the logbook it protects lives there.
- One account matches the deployment: one operator, whose logbook this is.
  Multi-user would need per-row ownership everywhere and is an explicit
  non-goal (§3.2).

### 6.2 Hashing — `node:crypto` scrypt, no new dependency

Frozen parameters: **N = 16384, r = 8, p = 1, keylen = 32, salt = 16 random
bytes**. `crypto.scryptSync` with defaults (`maxmem` 32 MB) accepts these;
128·N·r = 16 MB of memory per hash.

Storage encoding, one line, self-describing so the parameters can be raised
later without a migration:

```
scrypt$16384$8$1$<salt base64>$<key base64>
```

`verifyPassword(password, stored)`:

1. Split on `$`. Anything other than 6 parts, or a first part that is not
   `scrypt`, returns `false` — never throws (a corrupt row must be a failed
   login, not a 500).
2. Re-derive with the row's own N/r/p and the stored key's length.
3. Compare with `crypto.timingSafeEqual`.

**Why not bcrypt/argon2:** both are native addons. `.claude/ENVIRONMENT.md`
documents that this machine's default Node is 26 and `better-sqlite3` already
fails to load under it; adding a second native addon doubles that failure mode
for zero security gain at this threat level. `node:crypto`'s scrypt is in the
standard library, has no ABI to rebuild, and is a memory-hard KDF.
**Measured** (prototype P2, §17): hash 46 ms, verify 45 ms on this machine —
slow enough to matter under brute force, fast enough that a login is not
noticeably delayed.

### 6.3 Password and username rules

Enforced by the set-password CLI at set time; **not** re-enforced at login
(a login only ever compares against whatever is stored).

| Rule | Value | On violation |
|------|-------|--------------|
| Password length | ≥ 12 and ≤ 200 UTF-16 code units | CLI exits 1: `Password must be at least 12 characters.` / `Password must be at most 200 characters.` |
| Password content | must contain a non-whitespace character | CLI exits 1: `Password must not be blank.` |
| Password confirmation | second entry must match | CLI exits 1: `Passwords do not match.` |
| Username | 1–64 chars after trim | CLI exits 1: `Username must be 1-64 characters.` |

No composition rules (no "must contain a digit"): length is the only
requirement that survives contact with a human.

### 6.4 First run — `npm run set-password`

The chicken-and-egg is resolved by never letting the server be usable without
a credential, and by making the credential settable without the server.

- New script: `"set-password": "node dist/setPassword.js"`, source
  `src/setPassword.ts`. It compiles into `dist/` with everything else, so it
  works in the production Docker image, which has no dev dependencies and no
  `ts-node`.
- Behaviour:
  - `--username <name>` optional; default `operator`.
  - If `process.stdin.isTTY`: prompt `Password: ` then `Confirm password: `,
    both with echo disabled (`readline` with `terminal: true` and a muted
    output stream).
  - If stdin is **not** a TTY: read the first line as the password and skip
    confirmation. This is the Docker/automation path:
    `printf '%s\n' "$PW" | docker compose run --rm -T msfslogger node dist/setPassword.js`.
  - Never accept the password as a command-line argument — it would show up in
    `ps` and in shell history.
  - `initDb()` first (so the tables exist), then `setAuthUser()`, then
    `closeDb()`. Prints `Password set for user "<name>".` and exits 0.
- **Startup refusal.** After `initDb()`, `src/index.ts` calls `getAuthUser()`.
  If it returns `null`, print to stderr and exit 1:

  ```
  [Auth] Refusing to start: no operator account exists.
  [Auth] Run `npm run set-password` to create one (README § First run).
  ```

  There is deliberately no HTTP setup flow: a "first request wins" setup page
  is a land-grab race on a LAN, and a console-printed setup token is one more
  mechanism that still cannot help an operator who forgets their password.
  The CLI handles both first-run and reset with the same three lines of
  typing.

### 6.5 Changing or resetting the password

Re-run the CLI. It upserts row 1 (`ON CONFLICT(id) DO UPDATE`), preserving
`created_at`. Existing sessions are **not** invalidated by a password change —
they live in `auth_session` and remain valid until they expire. Operators who
want to kick everyone out delete the rows:
`DELETE FROM auth_session` (documented in the README's troubleshooting
section). This is a deliberate simplification; §21 R6 records the exposure.

---

## 7. Configuration and environment variables

### 7.1 The table

New and changed variables. `PORT`, `EXPORT_BASE_URL`, `TRAFFIC_ENABLED`,
`SIMCONNECT_*` keep their current meanings and their current readers.

| Variable | Required | Default | Meaning / validation |
|----------|----------|---------|----------------------|
| `INGEST_TOKEN` | **yes**, unless `ALLOW_UNAUTHENTICATED_INGEST` is truthy | none | Shared secret for `/api/ingest/*`. Compared with the `x-ingest-token` header, timing-safely (§12.3). Shorter than 16 chars → warning, not fatal (§7.3 step 5). |
| `ALLOW_UNAUTHENTICATED_INGEST` | no | off | Truthy (§7.2) means "run `/api/ingest/*` with no authentication". Insecure, LAN-only, README says so in those words (§20.4). |
| `TLS_CERT_FILE` | no (but see §11) | none | PEM certificate (chain allowed). Must be set together with `TLS_KEY_FILE`. |
| `TLS_KEY_FILE` | no | none | PEM private key. |
| `TLS_KEY_PASSPHRASE` | no | none | Passphrase for an encrypted key. Only read when the pair above is set. |
| `ALLOW_PLAINTEXT_HTTP` | no | off | Truthy allows plaintext HTTP on a non-loopback bind (§11.3). |
| `BIND_HOST` | no | `0.0.0.0` | Interface to bind. `0.0.0.0` reproduces today's behaviour exactly. `127.0.0.1` is the loopback-only dev mode of §11.3. |
| `SESSION_SECRET` | no | auto-generated and stored in `app_secret` | If set, must be ≥ 16 chars. Overriding it invalidates every existing session (§10.3). |

There is no `.env` loading and this design does not add `dotenv`: the server
takes its environment from systemd, the shell, or `docker-compose.yml`, as it
does today.

### 7.2 Boolean parsing

`parseBooleanEnv(v)` is true iff `String(v ?? '').trim().toLowerCase()` is
exactly one of `'1'`, `'true'`, `'yes'`, `'on'`. Everything else — unset,
empty, `'0'`, `'no'`, `'maybe'` — is false.

This is deliberately **not** the inverted-list shape of `parseTrafficEnabled()`
in `src/ingest.ts` (which defaults to enabled and lists the off-values). These
flags default to off and weaken security when on, so an unrecognised value must
fail closed. `parseTrafficEnabled` is untouched (§19 item 8).

### 7.3 Startup validation — order and exact messages

`loadConfig()` runs first, before `initDb()`, before any listener. It throws
`ConfigError` on the first problem; `src/index.ts` catches it, prints
`[Config] ${err.message}` to **stderr**, and calls `process.exit(1)`. Warnings
go to stdout via `console.warn` and do not stop startup. Secrets are never
included in any message.

1. **TLS pair.** Exactly one of `TLS_CERT_FILE` / `TLS_KEY_FILE` set → fatal:
   `TLS_CERT_FILE and TLS_KEY_FILE must be set together. Set both to enable HTTPS, or neither to run plaintext HTTP (README § HTTPS).`
2. **TLS material.** Both set → read both files. Unreadable → fatal:
   `Cannot read TLS_CERT_FILE at <path>: <errno message>` (same wording with
   `TLS_KEY_FILE`). Then call `tls.createSecureContext({ cert, key, passphrase })`
   eagerly; if it throws → fatal:
   `TLS certificate or key is not valid PEM (<message>). Refusing to start — the server never falls back to plaintext HTTP.`
3. **Plaintext.** Neither set:
   - `BIND_HOST` is loopback (`127.0.0.1`, `::1`, `localhost`) → allowed,
     warn: `No TLS configured — serving plaintext HTTP on loopback only.`
   - else `ALLOW_PLAINTEXT_HTTP` truthy → allowed, warn:
     `WARNING: serving plaintext HTTP on <bindHost>:<port> because ALLOW_PLAINTEXT_HTTP is set. The session cookie and the ingest token cross the network unencrypted. Configure TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS).`
   - else → fatal:
     `Refusing to start: no TLS configured and BIND_HOST is <bindHost>, which is not loopback. Set TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS), or set ALLOW_PLAINTEXT_HTTP=1 to accept an unencrypted LAN deployment.`
4. **Ingest token.** `INGEST_TOKEN` unset/empty and `ALLOW_UNAUTHENTICATED_INGEST`
   not truthy → fatal (§12.2 quotes it in full).
5. **Ingest token strength.** Set and shorter than 16 characters → warn:
   `INGEST_TOKEN is shorter than 16 characters — consider a longer random value.`
   Not fatal: an existing deployment's working token must not be rejected by an
   upgrade.
6. **Both ingest settings.** `INGEST_TOKEN` set *and* `ALLOW_UNAUTHENTICATED_INGEST`
   truthy → warn, token wins:
   `ALLOW_UNAUTHENTICATED_INGEST is set but INGEST_TOKEN is also set — the token is enforced and the opt-out ignored.`
7. **Session secret.** `SESSION_SECRET` set and shorter than 16 characters →
   fatal: `SESSION_SECRET is set but shorter than 16 characters. Unset it to have the server generate and store a strong one, or set a longer value.`

After `loadConfig()` succeeds: `initDb()`, then the credential check of §6.4,
then the listener of §11.

### 7.4 Who reads the environment

`src/config.ts` is the only module that reads `process.env` for anything in
§7.1. `src/ingest.ts` stops reading `process.env.INGEST_TOKEN` and takes the
resolved `IngestConfig` from its caller (§12.4). `src/pdfExport.ts` calls
`getConfig()` for the export scheme (§13.2) and keeps its existing
`EXPORT_BASE_URL` override. `src/index.ts` reads `PORT` through `loadConfig()`.
`parseTrafficEnabled(process.env.TRAFFIC_ENABLED)` in `src/ingest.ts` stays
exactly where it is.

---

## 8. HTTP surface and the auth gate

### 8.1 Enumeration — what moves behind the gate

**Gated** (401 without a session). Every one of these keeps its existing path,
method, request shape, response shape and status codes; the only new outcome
is 401:

| Method | Path |
|--------|------|
| GET | `/api/status` |
| GET | `/api/flights` |
| POST | `/api/flights/combine` |
| GET | `/api/flights/:id` |
| PATCH | `/api/flights/:id` |
| DELETE | `/api/flights/:id` |
| POST | `/api/flights/:id/flight-plan` |
| GET | `/api/flights/:id/flight-plan` |
| DELETE | `/api/flights/:id/flight-plan` |
| PUT | `/api/flights/:id/planned-leg` |
| PUT | `/api/flights/:id/planned-leg-status` |
| GET | `/api/flights/:id/export.pdf` |
| GET | `/api/flights/:id/export.kml` |
| POST | `/api/flights/export.kml` |
| POST | `/api/trips` |
| GET | `/api/trips` |
| GET | `/api/trips/:id` |
| PATCH | `/api/trips/:id` |
| DELETE | `/api/trips/:id` |
| POST | `/api/trips/:id/flights` |
| DELETE | `/api/trips/:id/flights/:flightId` |
| GET | `/api/trips/:id/journey` |
| POST | `/api/trips/:id/planned-legs` |
| GET | `/api/trips/:id/planned-legs` |
| PATCH | `/api/trips/:id/planned-legs/order` |
| GET | `/api/trips/:id/export.pdf` |
| GET | `/api/trips/:id/export.kml` |
| GET | `/api/planned-legs/:legId` |
| PATCH | `/api/planned-legs/:legId` |
| DELETE | `/api/planned-legs/:legId` |
| GET | `/api/active-trip` |
| PUT | `/api/active-trip` |
| — | any unmatched `/api/*` path |

That is every `app.*` route in `src/server.ts` that starts with `/api/`,
without exception. It is enforced by one `app.use('/api', requireAuth)`
mounted at the right point (§8.3), not by decorating handlers, so a route
added later is gated by default.

**Public, by name:**

| Method | Path | Why |
|--------|------|-----|
| POST | `/api/auth/login` | Cannot require a session to create one. |
| POST | `/api/auth/logout` | Idempotent; must work with an expired session. |
| GET | `/api/auth/session` | The SPA's bootstrap "am I logged in?" probe. Reveals only a boolean and, when logged in, the operator's own username. |
| POST | `/api/ingest/frame`, `/api/ingest/event`, `/api/ingest/traffic` | The agent has no browser and no session; authenticated by `INGEST_TOKEN` instead (§12). |
| GET | Static assets from `client/dist` (`express.static`) | The login page has to load. |
| GET | The SPA catch-all `app.get('*')` | Same reason; it serves `index.html` for every client route, including `/print/*` (§13.4). |

Serving the built SPA bundle to an anonymous client leaks no logbook data:
every byte of data comes from `/api/*`, which is gated. `flight_plans/` is not
statically served — it is only reachable through the gated
`GET /api/flights/:id/flight-plan`.

### 8.2 The 401

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json
{ "error": "Authentication required" }
```

No `WWW-Authenticate` header: it would make browsers pop a Basic-auth dialog,
and the login is a form (§2 decision 1). Body verbatim in
`contracts/samples/gated-401.json`.

### 8.3 Middleware order in `createServer()`

Frozen, because Express order is behaviour. Positions relative to today's
`src/server.ts`:

1. `app.use(express.json({ limit: '100kb' }))` — line 122, now with an
   explicit limit (§8.5).
2. `app.use(express.static(path.join(process.cwd(), 'client', 'dist')))` —
   line 123, **unmoved**. Public (§8.1).
3. `app.use('/api/ingest', createIngestRouter(...))` — line 130, unmoved, and
   deliberately **above** the session middleware: the agent never sends a
   cookie, and ingest traffic must never touch the session store.
4. `app.use(session({...}))` — new (§10.1).
5. `app.use(requireSameOrigin)` — new (§16.3). Applies to `/api/*` except
   `/api/ingest/*`, which is already handled above.
6. `app.use('/api/auth', createAuthRouter())` — new (§9).
7. `app.use('/api', requireAuth)` — new. Everything registered after this line
   is gated.
8. All existing API routes, in their existing order (`/api/status` first,
   `/api/flights/combine` still before `/api/flights/:id`, planned-legs still
   before the PDF/KML exports, all of them still before the catch-all).
9. `app.get('*')` catch-all — unmoved, public.
10. The `MulterError` error handler — unmoved, last.

### 8.4 Session middleware placement rationale

Mounting `express-session` after the ingest router means an ingest request
never allocates or touches a session. With `saveUninitialized: false` an
anonymous request that never writes to `req.session` also performs no store
write, so the static assets and the catch-all cost nothing either.

### 8.5 Body-size limits

| Surface | Limit | Change |
|---------|-------|--------|
| `express.json()` | `'100kb'`, explicit | **No behavioural change** — 100 kb is already Express's default. Making it explicit stops a future body-parser default from silently moving it, and gives the number a home in `AppConfig.jsonBodyLimit`. |
| PDF upload (`upload`) | `fileSize: 20 MB`, plus new `files: 1, fields: 5, fieldSize: 8 KB, parts: 6` | The size limit and the `application/pdf` + magic-byte sniff (`isPdfBuffer`) are adequate and stay untouched (§19 item 4). The added limits close the one real gap: multer's defaults are `fields: Infinity` and `fieldSize: 1 MB`, so a multipart request could carry unbounded non-file fields. A legitimate PDF upload sends one file and zero fields. |
| `.lnmpln` upload (`uploadLnmpln`) | `fileSize: 512 KB`, `files: 25`, plus new `fields: 5, fieldSize: 8 KB, parts: 31` | Same reasoning. A legitimate import sends ≤ 25 files and one field (`allow_duplicates`). |

`LIMIT_FIELD_COUNT`, `LIMIT_FIELD_VALUE` and `LIMIT_PART_COUNT` already fall
into the existing error handler's generic branch
(`res.status(400).json({ error: err.message })`, `src/server.ts:906`) — no new
error-handling code and no new error shape.

Headroom check for the 100 kb JSON limit, **measured** (§17, command in
§17.3): the largest legitimate JSON body in the app is a full traffic batch —
200 objects, the cap in `src/ingest.ts:13` — at **22,013 bytes**. `POST
/api/flights/export.kml` with the maximum 100 ids is **709 bytes**; a
`/api/ingest/frame` with a 200-character aircraft name is **396 bytes**. The
limit has ~4.5× headroom over the worst case and nothing needs a per-route
override.

---

## 9. Login API contract

New router at `/api/auth`, `src/auth/routes.ts`. Every body in
`contracts/samples/`.

### 9.1 `POST /api/auth/login`

Request (`Content-Type: application/json`):

```json
{ "username": "operator", "password": "correct horse battery staple" }
```

| Status | Body | When |
|--------|------|------|
| 200 | `{ "user": { "username": "operator" } }` | Credentials match. `Set-Cookie: msfslogger.sid=…` accompanies it (§10.1). |
| 400 | `{ "error": "username and password are required" }` | Either field missing or not a string. |
| 401 | `{ "error": "Invalid username or password" }` | Unknown username **or** wrong password — one message, one status, one timing profile (§16.1). |
| 429 | `{ "error": "Too many login attempts. Try again in <n> seconds.", "retryAfterSec": <n> }` | Throttle tripped (§16.2). Also sends `Retry-After: <n>`. |
| 500 | `{ "error": "<string>" }` | Store or DB failure, matching the existing convention elsewhere in `src/server.ts`. |

On success the session id is **regenerated** before `req.session.user` is set
(§16.1 step 5), so a pre-login session id cannot be fixated by an attacker.

### 9.2 No username enumeration

Enforced on three axes, all specified in §16.1:

- **Body and status identical** for unknown-user and wrong-password.
- **Timing identical**: an unknown username still runs one full scrypt
  derivation against `DUMMY_PASSWORD_HASH` (~45 ms, §6.2) before answering.
- **Throttling identical**: the rate limiter is keyed on the client IP only,
  never on the submitted username, so probing usernames cannot be used to map
  which ones are "real" by watching who gets locked out.

### 9.3 `POST /api/auth/logout` and `GET /api/auth/session`

`POST /api/auth/logout` — always `204 No Content`, with no body, whether or not
a session existed. It calls `req.session.destroy()` (removing the
`auth_session` row) and then `res.clearCookie('msfslogger.sid', { path: '/' })`.
Idempotent by construction: a logout with an expired cookie is still a 204.

`GET /api/auth/session` — always `200`, never 401, so the SPA can ask the
question without triggering its own 401 handling:

```json
{ "authenticated": true,  "user": { "username": "operator" } }
{ "authenticated": false, "user": null }
```

`Cache-Control: no-store` on this response, so a stale cached answer cannot
leave the SPA believing it is logged in.

### 9.4 Logging

- Success: `[Auth] Login OK for "<username>" from <ip>`.
- Failure: `[Auth] Login FAILED for "<username>" from <ip>` — the submitted
  username is logged (it is attacker-supplied, and knowing what was tried is
  the point); the password never is, in any form.
- Throttle: `[Auth] Login throttled for <ip> (<n>s remaining)`.

### 9.5 Error-body shape

`{ "error": string }`, the shape every other route in `src/server.ts` already
returns, plus the optional `retryAfterSec` on the 429. No new envelope, so
`apiFetch`'s existing error extraction keeps working unchanged (§19 item 6).

---

## 10. Session mechanism

### 10.1 Library and cookie

`express-session@^1.19.0` (dependency) + `@types/express-session@^1.19.0`
(devDependency). Both **verified** to install and run on Node 20 with Express 4
(§17, prototypes P1/P3). It is the standard Express session middleware; nothing
smaller is worth hand-rolling when signed-cookie handling and store plumbing
are the parts that are easy to get subtly wrong.

Frozen options:

```
name:              'msfslogger.sid'
secret:            <§10.3>
store:             SqliteSessionStore
resave:            false
saveUninitialized: false
rolling:           true
cookie: {
  httpOnly: true,
  sameSite: 'lax',
  secure:   config.tls.enabled,      // §10.6
  path:     '/',
  maxAge:   30 * 24 * 60 * 60 * 1000 // 30 days, §10.4
}
```

`app.set('trust proxy', …)` is **not** set. `X-Forwarded-For` is therefore
ignored, so a spoofed header cannot poison the login throttle's key (§16.2),
and `req.protocol` reflects the actual connection.

**Verified** (prototype P3): the emitted header is
`msfslogger.sid=s%3A…; Path=/; Expires=…; HttpOnly; Secure; SameSite=Lax`, the
cookie round-trips over HTTPS, and a request without it gets 401.

### 10.2 Store — SQLite, not memory

`SqliteSessionStore extends session.Store`, in `src/auth/sessionStore.ts`,
implementing `get` / `set` / `destroy` / `touch` on the four `src/db.ts`
accessors of §4.2. `length` and `clear` are not implemented;
`express-session` does not call them.

- `get(sid)` — row missing → `cb(null, null)`. Row present but
  `expires_at <= Date.now()` → delete it and `cb(null, null)`. Otherwise
  `cb(null, JSON.parse(row.data))`. A `JSON.parse` failure is reported as
  "no session" (`cb(null, null)`), not as an error, so one corrupt row cannot
  wedge every request.
- `set(sid, sess)` — `INSERT … ON CONFLICT(sid) DO UPDATE SET data =
  excluded.data, expires_at = excluded.expires_at`.
- `touch` — delegates to `set`; that is what makes `rolling: true` extend the
  stored expiry, not just the cookie's.

**Why not the default `MemoryStore`:** it is documented by the package itself
as leaking memory and unsuitable for production, and every restart — after
every `npm run build` and deploy, which this project does often — would log the
operator out. **Why not `connect-sqlite3`:** it depends on the `sqlite3`
package, a *second* native SQLite driver alongside `better-sqlite3`, with the
Node-ABI rebuild problem of `.claude/ENVIRONMENT.md` attached to it. **Why not
`better-sqlite3-session-store`:** a third-party dependency for ~40 lines that
would still need our `getDb()`. The store is small, and the prototype is
literally the implementation (§17.1).

**Verified** (prototype P1): a login writes exactly one row; a fresh connection
to the same file reads that row back with `user.username` intact — i.e. a
session survives a restart.

### 10.3 Secret

`SESSION_SECRET` if set (≥ 16 chars, §7.3 step 7). Otherwise the server calls
`getOrCreateAppSecret('session_secret', () => randomBytes(32).toString('base64'))`
during startup, which inserts the row on first run and reads it thereafter.

This removes a required operator step and rules out a weak or empty default,
at the cost of storing the secret next to the sessions it signs. That cost is
zero in practice: an attacker who can read `app_secret` can already read
`auth_session` and use a session directly. There is **no** hard-coded fallback
secret anywhere in the code — the server either finds one or makes one.

Rotation: change `SESSION_SECRET`, or `DELETE FROM app_secret WHERE name =
'session_secret'`. Either invalidates every existing cookie; the next request
is simply anonymous.

### 10.4 Expiry

30 days, sliding (`rolling: true`, `resave: false`): every request that carries
a valid session re-stamps both the cookie and `auth_session.expires_at`. A
session unused for 30 days is dead. There is no absolute cap on top of the
sliding window — that would need a second timestamp and a second rule for one
operator on a LAN, and §3.1 has no threat it would address. The value is a
frozen constant in `src/config.ts`, not an env var: one more knob nobody will
turn.

### 10.5 Sweeping expired rows

`sessionSweep(Date.now())` — `DELETE FROM auth_session WHERE expires_at <= ?` —
runs once at startup (after `initDb()`) and then every 6 hours on a
`setInterval(...).unref()`, so it never holds the process open at shutdown. It
logs only when it deletes something: `[Auth] Swept <n> expired sessions`.
Expired rows are already unusable before the sweep (`get` checks `expires_at`);
this only stops the table growing without bound.

### 10.6 The `secure` flag is tied to TLS

`cookie.secure` is `true` exactly when `config.tls.enabled` is true. It cannot
be hard-coded `true`: a browser will not send a `Secure` cookie over plaintext
HTTP, so a plaintext deployment (§11.3) would log in and then immediately look
logged out. It cannot be hard-coded `false` either: that would let the cookie
cross the network in the clear on a TLS deployment. Deriving it is the only
correct rule, and it is why the plaintext modes are explicitly opted into
rather than being the quiet default.

---

## 11. TLS contract

### 11.1 Configuration

`TLS_CERT_FILE`, `TLS_KEY_FILE`, optional `TLS_KEY_PASSPHRASE` (§7.1). Both
files are read once at startup — the process holds the parsed material, so
rotating a certificate needs a restart (documented, §20.3).

### 11.2 Failure modes — the server never silently downgrades

This is the rule the user asked for in the envelope, in full:

| Situation | Behaviour |
|-----------|-----------|
| Both vars set, both files valid | HTTPS on `PORT` via `https.createServer({ key, cert, passphrase }, app)`. |
| Exactly one var set | **Fatal**, exit 1, §7.3 step 1. |
| Both set, a file is missing or unreadable | **Fatal**, exit 1, §7.3 step 2. |
| Both set, the PEM does not parse | **Fatal**, exit 1, §7.3 step 2 — caught eagerly with `tls.createSecureContext()` *before* the listener opens, so a bad cert fails at startup rather than on the first connection. |

In no branch does a TLS misconfiguration result in a plaintext listener. An
operator who believes they configured TLS either gets TLS or gets a dead server
with a specific message.

### 11.3 Plaintext HTTP

Permitted in exactly two cases (§7.3 step 3):

1. **Loopback dev.** `BIND_HOST` is `127.0.0.1`, `::1` or `localhost`. No
   opt-out variable needed — nothing leaves the machine. This is the
   `npm run dev` path.
2. **Explicit LAN opt-out.** `ALLOW_PLAINTEXT_HTTP` truthy, with the loud
   startup warning of §7.3.

Anything else — no TLS, non-loopback bind, no opt-out — is fatal. Combined with
§10.6 (`cookie.secure` follows TLS), the login works in all three modes, and
only the two deliberate ones ship a cookie over the wire in the clear.

### 11.4 Ports and binding

**One port, one protocol.** `PORT` (default 3000) serves either HTTPS or HTTP,
never both, and there is no second listener redirecting HTTP to HTTPS. An
operator whose bookmark still says `http://host:3000` gets a browser-level
connection error, which the README's upgrade section calls out (§20.3). A
redirect listener would mean a second socket, a second failure mode, and a
plaintext port on a design whose whole point is not having one; §18 records the
option and the reasoning.

`BIND_HOST` is new, defaults to `0.0.0.0`, and is passed as
`server.listen(port, bindHost, cb)`. The default reproduces today's
`app.listen(PORT)` exactly (§19 item 7); it exists so §11.3's loopback case has
something to test.

The startup line becomes
`[HTTP] Server running at https://<bindHost>:<port>` / `http://…`, matching the
actual scheme instead of today's hard-coded `http://localhost:${PORT}`.

### 11.5 Getting a certificate

Not the app's job, but the README must give a working one-liner, verified on
this machine (OpenSSL 3.0.13, §17.3):

```
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout msfslogger-key.pem -out msfslogger-cert.pem \
  -subj "/CN=msfslogger" \
  -addext "subjectAltName=IP:<server-lan-ip>,DNS:<server-hostname>"
```

A self-signed certificate makes browsers warn once (the operator accepts it)
and makes the agent fail hard until it is told to trust the file (§15.2). The
README documents both.

### 11.6 What TLS does not do here

It encrypts the transport. It does not authenticate the client, does not
replace the session gate, and — with a self-signed certificate — does not
protect against an active MITM on first use. That is an accepted limit at this
threat level (§3.1 T3), recorded in §21 R4.

---

## 12. Ingest contract

### 12.1 The token becomes mandatory

`src/ingest.ts:120-127` today reads `process.env.INGEST_TOKEN` and, when it is
absent, `checkAuth` returns `true` for every request. The token check itself is
unchanged in shape — header `x-ingest-token`, 401
`{ "error": "Invalid or missing ingest token" }` on mismatch — but the "no
token configured" branch is now reachable only through the explicit opt-out of
§12.2, because `loadConfig()` refuses to start without one (§7.3 step 4).

### 12.2 The opt-out

Variable name, frozen: **`ALLOW_UNAUTHENTICATED_INGEST`**. Truthy per §7.2.

With `INGEST_TOKEN` unset and the opt-out not set, startup fails with exit code
1 and this message on stderr (`[Config] ` prefix, one line per sentence):

```
[Config] Refusing to start: INGEST_TOKEN is not set.
[Config] The agent ingest endpoints (/api/ingest/frame, /event, /traffic) would accept flight data from anyone who can reach this server.
[Config] Set INGEST_TOKEN to a shared secret and set the same value on the agent (agent/README.md), or set ALLOW_UNAUTHENTICATED_INGEST=1 to run ingest unauthenticated (insecure - LAN only).
```

With the opt-out set and no token, the server starts and warns on every start:

```
[Config] WARNING: ALLOW_UNAUTHENTICATED_INGEST is set - /api/ingest/* accepts data from anyone who can reach this server.
```

With both set, the token wins and §7.3 step 6's warning is printed. The web API
is unaffected by this variable in every case: it only ever governs
`/api/ingest/*` (§19 item 3).

### 12.3 Timing-safe comparison

`checkAuth` currently uses `===` on the header. Replace with: `sha256(header)`
vs `sha256(token)` compared with `crypto.timingSafeEqual`. Hashing first makes
the two buffers equal-length, so `timingSafeEqual` cannot throw on a
length mismatch and the comparison leaks nothing about the token's length. A
missing header is still a 401 with the same body.

### 12.4 Wiring

`createIngestRouter(flightManager, trafficStore, ingestConfig)` gains a third
parameter of type `IngestConfig` (§7.4); `createServer()` passes
`getConfig().ingest`. The router keeps reading `TRAFFIC_ENABLED` itself through
`parseTrafficEnabled` — untouched (§19 item 8).

### 12.5 Rate limiting on ingest

None. The agent posts at ~1 Hz and a limiter would risk dropping real frames;
the token is the gate. Recorded in §21 R7.

---

## 13. PDF export loopback

### 13.1 The problem auth creates

`renderPdf()` (`src/pdfExport.ts:124`) drives headless Chromium to
`http://127.0.0.1:$PORT/print/flight/:id`. That page is the SPA, and it fetches
its data from `/api/flights/:id` — which §8.1 gates. Chromium carries no
session cookie, so **without a fix, every PDF export breaks** the moment auth
lands: the print page would set `window.__EXPORT_ERROR__ = "Failed to load
flight 7: Authentication required"` and `renderPdf` would throw. **Verified as
a real failure** (prototype P4 control case, §17): a render with no cookie sees
401.

### 13.2 The fix — forward the caller's own session cookie

The two export routes are themselves authenticated, so the request already
carries a valid cookie. `sessionCookieFrom(req)` (in `src/auth/middleware.ts`)
parses `req.headers.cookie` for `msfslogger.sid` and returns
`{ name, value } | undefined`, with the value **exactly as it appears in the
header** (still percent-encoded — `express-session` decodes it itself).

`renderPdf(path, opts?: { sessionCookie?: { name: string; value: string } })`.
In `renderOnce`, before `page.goto`:

```
const u = new URL(baseUrl());
await page.setCookie({
  name, value,
  domain: u.hostname, path: '/',
  httpOnly: true, secure: u.protocol === 'https:', sameSite: 'Lax',
});
```

`page.setCookie` scopes the cookie to that host, so it is **not** sent to the
OSM tile servers the print maps load. Using
`page.setExtraHTTPHeaders({ Cookie: … })` instead would have leaked the session
cookie to every third-party origin the page touches — that is why this design
names `setCookie` specifically.

**Verified** (prototype P4/P5, §17): the render with `setCookie` reaches the
gated API and produces a 17,674-byte PDF; a request interceptor confirms the
cookie value appeared on **no** non-loopback request.

`baseUrl()` becomes scheme-aware:
`process.env.EXPORT_BASE_URL ?? \`${getConfig().tls.enabled ? 'https' : 'http'}://127.0.0.1:${port}\``.
The `EXPORT_BASE_URL` override keeps its current meaning and precedence
(§19 item 9).

### 13.3 Self-signed certificates and the loopback render

`puppeteer.launch()` gains `acceptInsecureCerts: true` alongside the existing
args. **Verified present in the installed puppeteer 24.43.1** type definitions
and accepted at launch (§17). It covers both the self-signed chain and the
hostname mismatch that `https://127.0.0.1` produces against a certificate
issued for the LAN name. If a future Chromium ever tightens this, the fallback
requires no code change: set `EXPORT_BASE_URL` to the certificate's own
hostname. The existing rationale for `--no-sandbox` applies unchanged here —
the browser only ever loads this server's own pages.

### 13.4 Print routes stay public HTML

`/print/flight/:id` and `/print/trip/:id` are client-side routes served by the
SPA catch-all, so the HTML shell is public; all their data is gated. They are
**not** wrapped in `<RequireAuth>` (§14.3), and the client's global 401 handler
is not registered on them — a 401 during an export must surface through the
existing `window.__EXPORT_ERROR__` path (`client/src/pages/PrintFlight.tsx:34`)
and become a 500 to the operator, never a redirect that would render the login
page into a PDF.

### 13.5 A note for whoever implements it

The `browserPromise` singleton caches one browser across renders;
`acceptInsecureCerts` is a launch option, so it is fixed for the process
lifetime. That is fine — it is unconditionally on. The per-render cookie is set
on the `page`, not the browser, so two concurrent exports (serialised by the
existing queue anyway) cannot cross-contaminate.

---

## 14. Client contract

### 14.1 New page — `client/src/pages/Login.tsx`

Route `/login`, registered in `App.tsx` **outside** `AppShell` (alongside the
print routes), so it never mounts `Header` and never starts the `/api/status`
poll (`useStatus`) that would 401 in a loop on the login screen.

Form: username, password (`type="password"`, `autoComplete="current-password"`),
submit. On submit it calls `session.login()`. On 401 it renders the server's
message verbatim; on 429 it renders the server's message (which includes the
wait); it never invents a distinction between "no such user" and "wrong
password" (§9.2). On success it navigates to the location the redirect
carried, defaulting to `/`.

### 14.2 `client/src/utils/api.ts` — owned additions

- `class UnauthorizedError extends Error` with `status: 401`.
- `setUnauthorizedHandler(fn | null)`, a module-level slot.
- In both `apiFetch` and the private `download`: on `res.status === 401`, call
  the handler if one is registered, then throw `UnauthorizedError`.
- **Everything else in this file is unchanged**, including the existing
  `throw new Error(body.error ?? statusText)` for every other non-2xx
  (§19 item 6). `UnauthorizedError` extends `Error`, so existing `catch (err)
  { (err as Error).message }` call sites keep working untouched.

Every request in the client is same-origin and already sends cookies by
default (`credentials: 'same-origin'` is the fetch default); no call site needs
a `credentials` option added.

### 14.3 `useSession` + `RequireAuth`

`client/src/hooks/useSession.ts` — calls `GET /api/auth/session` once on mount,
exposes `SessionState` (`contracts/client-auth.ts`), and provides `login()` and
`logout()`. The state is shared through a React context provider mounted at the
top of `App`, so the header and the guard see the same value.

`client/src/components/RequireAuth.tsx` — wraps `<AppShell/>` only. Renders
nothing while `status === 'loading'`, `<Navigate to="/login" state={{ from }}
replace/>` when `'anonymous'`, children when `'authenticated'`. It registers
`setUnauthorizedHandler` on mount (so a mid-session expiry bounces the operator
to `/login`) and clears it on unmount.

### 14.4 Route table after the change

| Path | Wrapped in `RequireAuth`? |
|------|---------------------------|
| `/login` | no |
| `/print/flight/:id`, `/print/trip/:id` | no (§13.4) |
| `/device`, `/override` | yes — they are operator tools; they move inside the guard |
| everything else (`AppShell`: `/`, `/flights`, `/flight/:id`, `/trip/:id`) | yes |

### 14.5 Logout affordance

A "Log out" control in `client/src/components/Sidebar.tsx` (the navigation
added in 209d36e), showing the logged-in username. It calls `session.logout()`
and then navigates to `/login`. One component owns it; `Header.tsx` is not
touched, to keep this run off the file that `useStatus` lives next to.

### 14.6 Dev-mode note

`client/vite.config.ts` is **unchanged**. Its proxy (`'/api' →
http://localhost:3000`) leaves the `Host` header alone (`changeOrigin` defaults
to false), so the browser's `Origin: http://localhost:5173` matches the `Host`
the server sees and the §16.3 check passes. Dev runs plaintext on loopback, so
`cookie.secure` is false (§10.6) and the cookie is set normally. If a developer
ever sets `changeOrigin: true`, state-changing requests will start returning
403 — that is the first thing to check, and the README's dev section says so.

---

## 15. Agent contract

The agent runs on a separate Windows box (`agent/agent.js`, `SERVER_URL` +
optional `INGEST_TOKEN`, `agent.js:17-18`). Nothing about this design changes
the ingest wire format.

### 15.1 The token stops being optional in practice

`agent.js:119` already sends `x-ingest-token` when `INGEST_TOKEN` is set. No
code change is required — but the agent's environment must now define it,
because the server will reject its posts with 401 otherwise (and, before that,
will not have started at all). `agent/README.md` must state that `INGEST_TOKEN`
is now required and must match the server's exactly.

### 15.2 TLS: `SERVER_URL` becomes `https://` and the cert must be trusted

The agent uses global `fetch` (undici). **Verified** (prototype P6, §17): an
unmodified Node 20 client posting to a self-signed HTTPS endpoint fails with
`DEPTH_ZERO_SELF_SIGNED_CERT`, and the **same unmodified client succeeds
(204)** when started with `NODE_EXTRA_CA_CERTS=<path to the server's
cert.pem>`.

Frozen: **no agent code change and no `rejectUnauthorized: false` option.** The
operator copies the server's certificate file to the Windows box and starts the
agent with `NODE_EXTRA_CA_CERTS` pointing at it:

```powershell
$env:SERVER_URL = "https://<server-ip-or-name>:3000"
$env:INGEST_TOKEN = "<same value as the server>"
$env:NODE_EXTRA_CA_CERTS = "C:\msfslogger\msfslogger-cert.pem"
node agent.js
```

The certificate's SAN must contain whatever `SERVER_URL` uses — hence the
`-addext subjectAltName=...` in §11.5. A disabled-verification switch was
rejected: it would make the agent's TLS decorative, and the working
alternative costs one environment variable.

### 15.3 Deploy ordering

Both boxes change at once. The server refuses to start without a token; the
agent cannot reach a TLS server it does not trust. The documented order is:
set the token and cert on the server, start it, then update the agent's
environment and restart it. Per the standing note in the project memory, an
agent that "stopped working" after this run is a redeploy question before it is
a debugging question.

---

## 16. Algorithms

Precise enough to implement twice and get the same answer.

### 16.1 Login evaluation

Input: `req.body`, `req.socket.remoteAddress`.

1. If `typeof body.username !== 'string' || typeof body.password !== 'string'`
   → 400 `{ error: 'username and password are required' }`. Stop.
2. `username = body.username.trim()`. The **password is not trimmed** — leading
   and trailing whitespace are part of it.
3. `wait = throttle.check(ip, Date.now())`. If `wait !== null` → set
   `Retry-After: wait`, respond 429 with
   `{ error: \`Too many login attempts. Try again in ${wait} seconds.\`, retryAfterSec: wait }`.
   Stop. (Checked before any DB read, so a throttled client costs nothing.)
4. `row = getAuthUser()`.
   - `row === null` → `verifyPassword(body.password, DUMMY_PASSWORD_HASH)`,
     discard the result, `throttle.recordFailure`, 401. Stop.
   - `row.username !== username` (exact, case-sensitive, after the trim in
     step 2) → `verifyPassword(body.password, DUMMY_PASSWORD_HASH)`, discard,
     `throttle.recordFailure`, 401. Stop.
   - `verifyPassword(body.password, row.password_hash) === false` →
     `throttle.recordFailure`, 401. Stop.
5. Success: `req.session.regenerate(err => …)` → on the new session set
   `req.session.user = { username: row.username }` → `req.session.save(err =>
   …)` → `throttle.recordSuccess(ip)` → 200 `{ user: { username } }`.
   Regenerating **before** setting the user is what defeats session fixation;
   the order is not optional. Either callback erroring → 500
   `{ error: String(err) }`.

Every 401 path in step 4 runs exactly one scrypt derivation, so all three cost
the same ~45 ms.

### 16.2 Login throttle

Fixed window per client IP. Constants: `WINDOW_MS = 15 * 60 * 1000`,
`MAX_FAILURES = 10`. State: `Map<ip, { count: number; windowStart: number }>`,
in memory, lost on restart (acceptable: a restart is an operator action, and
the attacker gains at most one more window).

- `check(ip, now)` — no entry → `null`. `now - e.windowStart >= WINDOW_MS` →
  delete the entry, `null`. `e.count >= MAX_FAILURES` →
  `Math.ceil((WINDOW_MS - (now - e.windowStart)) / 1000)`. Otherwise `null`.
- `recordFailure(ip, now)` — no entry, or window elapsed →
  `{ count: 1, windowStart: now }`. Otherwise `e.count += 1` (the window start
  does **not** move; a locked-out attacker's clock still runs down).
- `recordSuccess(ip)` — delete the entry.
- Bounding: on each `check`, if `map.size > 1000`, delete every entry whose
  window has elapsed. Deterministic and cheap; the map cannot grow without
  bound from spoofed sources on a LAN.

`ip = req.socket.remoteAddress ?? 'unknown'`. `X-Forwarded-For` is deliberately
ignored (§10.1): with `trust proxy` off, an attacker cannot rotate the key by
setting a header.

### 16.3 Same-origin check (CSRF defence in depth)

`requireSameOrigin(req, res, next)`:

1. If `req.method` is `GET`, `HEAD` or `OPTIONS` → `next()`. (Those routes do
   not mutate; the gated exports are GETs and must stay linkable.)
2. If `req.path` does not start with `/api/` → `next()`.
3. If `req.path` starts with `/api/ingest/` → `next()` (the agent is not a
   browser, has no cookie, and is authenticated by token).
4. `const origin = req.get('origin')`. Absent → `next()`. A browser always
   sends `Origin` on a cross-origin request and on any non-GET; a curl or the
   agent does not send one at all, and rejecting header-less clients would
   break every scripted use without adding protection.
5. `expected = \`${req.protocol}://${req.get('host')}\``. `origin === expected`
   → `next()`; otherwise 403 `{ error: 'Cross-origin request rejected' }`.

The primary CSRF defence is `SameSite=Lax` (§10.1), which already stops a
cross-site POST — including a cross-site `multipart/form-data` form post —
from carrying the cookie. This check is the second layer, for a browser or a
future cookie policy where `Lax` is not what we assumed. No CSRF token is
introduced; §18 records why.

### 16.4 `getOrCreateAppSecret`

Inside one `better-sqlite3` transaction: `SELECT value FROM app_secret WHERE
name = ?`; if a row exists, return it; otherwise `INSERT INTO app_secret
(name, value, created_at) VALUES (?, ?, ?)` with `generate()` and return the
generated value. Single-process and transactional, so two callers cannot
produce two secrets.

### 16.5 Session expiry derivation (store `set`/`touch`)

`expiresAt = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() :
Date.now() + sessionMaxAgeMs`. An `Invalid Date` (`NaN`) falls back to the same
`Date.now() + sessionMaxAgeMs`, so a malformed cookie object can never write a
`NaN` into an `INTEGER NOT NULL` column.

---

## 17. Prototypes and evidence

Everything asserted about a library's behaviour in this document was run before
it was frozen. Both prototypes live in
`.claude/runs/2026-09-10-security-hardening/prototypes/` and touch neither
`src/`, the live server, nor `flights.db`.

### 17.1 `proto-auth-tls-pdf.js` — 16/16 passed (Node v20.20.2)

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
cd <scratch>/proto && npm i express@4 express-session
PROTO_DIR=<scratch>/proto \
NODE_PATH=<scratch>/proto/node_modules:/home/guilherme/msfslogger/node_modules \
  node .claude/runs/2026-09-10-security-hardening/prototypes/proto-auth-tls-pdf.js
```

```
PASS P2 scrypt verify accepts the right password — hash 46ms / verify 45ms
PASS P2 scrypt verify rejects the wrong password
PASS P3 https.createServer listening on 127.0.0.1:3199
PASS P3 undici fetch rejects the self-signed cert by default — DEPTH_ZERO_SELF_SIGNED_CERT
PASS P3 wrong password → 401 — body {"error":"Invalid username or password"}
PASS P3 login → 200 and a Set-Cookie — msfslogger.sid=s%3A0X9k…; Path=/; Expires=…; HttpOnly; Secure; SameSite=Lax
PASS P3 cookie carries HttpOnly, Secure, SameSite=Lax
PASS P3 gated GET with cookie → 200 — {"flights":42}
PASS P3 gated GET without cookie → 401
PASS P1 session row persisted in sqlite
PASS P1 session survives a fresh connection (restart-safe)
PASS P4 puppeteer accepts { acceptInsecureCerts: true } — puppeteer 24.43.1
PASS P4 control: render WITHOUT the cookie sees 401 — ERR=401
PASS P4 render WITH page.setCookie() reaches the gated API — FLIGHTS=42
PASS P4 page.pdf() produced a PDF — 17674 bytes
PASS P5 session cookie was not sent to any third-party origin
```

The store in that prototype is the §10.2 store; the scrypt functions are the
§6.2 functions. They are reference implementations, not just probes.

### 17.2 `proto-agent-tls-and-cli-write.js` — 4/4 passed

```
PASS P6 control: plain fetch to self-signed HTTPS fails — DEPTH_ZERO_SELF_SIGNED_CERT
PASS P6 NODE_EXTRA_CA_CERTS makes the same unmodified client succeed — STATUS=204
PASS P7 second process writes while the first holds the DB open (WAL) — CLI_OK
PASS P7 the holding connection sees the new hash on its next read
```

### 17.3 Other measurements

- Body sizes (§8.5), `node -e` with `JSON.stringify`: traffic batch at the
  200-object cap **22,013 bytes**; `export.kml` with 100 ids **709 bytes**; a
  frame with a 200-char aircraft name **396 bytes**.
- `express-session@1.19.0` and `@types/express-session@1.19.0` install cleanly
  under Node 20 (`npm install` in a scratch directory, not the repo).
- `openssl version` → `OpenSSL 3.0.13`; the §11.5 command produced the
  certificate both prototypes used.
- Route enumeration in §8.1 was read off `src/server.ts` (913 lines) directly,
  not from memory.

### 17.4 What was **not** prototyped

- The full server under the real `src/server.ts` middleware stack — the
  prototype used an equivalent minimal app. Ordering (§8.3) is asserted from
  Express semantics, and the Dispatcher must verify it with `curl` against a
  scratch server on another port.
- The Windows agent against a TLS server. P6 verifies the Node client
  behaviour on Linux; Windows certificate-store differences are §21 R5.

---

## 18. Alternatives considered

| Decision | Options | Chosen | Why |
|----------|---------|--------|-----|
| Password hashing (§6.2) | bcrypt, argon2, `node:crypto` scrypt | **scrypt** | Both alternatives are native addons; `.claude/ENVIRONMENT.md` documents that a native addon already breaks under this machine's default Node. Standard-library, memory-hard, 45 ms measured. |
| Credential location (§6.1) | env var hash, DB row | **DB row** | Changeable without a restart or a unit-file edit; not exposed via `/proc/<pid>/environ` or `docker inspect`; the DB is already the trust boundary. |
| First run (§6.4) | HTTP setup page, console setup token, CLI | **CLI** | A setup page is a land-grab race on a LAN; a console token still cannot help a forgotten password. The CLI does first-run and reset with one mechanism, and works with the server up (P7). |
| Session store (§10.2) | MemoryStore, `connect-sqlite3`, `better-sqlite3-session-store`, own store | **own store on `better-sqlite3`** | MemoryStore logs the operator out on every deploy and leaks; `connect-sqlite3` drags in a second native SQLite driver with the ABI problem; the third-party better-sqlite3 store is a dependency for ~40 lines that would still need our `getDb()`. |
| Session secret (§10.3) | required env var, auto-generate + persist | **auto-generate, env override** | Removes a required operator step and any chance of a weak default; the secret sits beside the sessions it signs, which costs nothing because holding one implies holding the other. |
| CSRF (§16.3) | synchroniser token, double-submit cookie, `SameSite` + Origin check | **`SameSite=Lax` + Origin check** | `Lax` already blocks cross-site cookie-bearing POSTs, including multipart form posts. A token would touch every mutating call site in the client for a threat model with one operator on a LAN. |
| TLS ports (§11.4) | one port, HTTP+HTTPS on two ports, HTTPS + redirect listener | **one port** | A redirect listener means a second socket and a plaintext port on a design whose point is not having one. The cost is a confusing browser error on a stale `http://` bookmark, which the README pre-empts. |
| Plaintext default (§11.3) | always require TLS, allow plaintext freely, loopback-free + explicit opt-out | **loopback free, LAN needs opt-out** | Always-require breaks `npm run dev` and every local test; allow-freely is the status quo this run exists to end. The chosen rule makes the insecure case a deliberate, named, logged act. |
| PDF loopback auth (§13.2) | bypass auth for loopback IPs, mint a one-shot render token, forward the caller's cookie | **forward the caller's cookie** | A loopback bypass reopens the whole API to anything on the box. A one-shot token is a second credential type with its own lifetime bugs. Forwarding is the same principal that made the authenticated request, verified end to end (P4/P5). |
| Agent TLS trust (§15.2) | `rejectUnauthorized: false` flag, `NODE_EXTRA_CA_CERTS` | **`NODE_EXTRA_CA_CERTS`** | Verified to work with zero agent code change (P6); an opt-out flag makes the agent's TLS decorative. |
| Ingest opt-out name (§12.2) | `INSECURE_INGEST`, `ALLOW_UNAUTHENTICATED_INGEST` | **`ALLOW_UNAUTHENTICATED_INGEST`** | The envelope proposed it, and it says what it does in words an operator will not misread six months later. |

---

## 19. Must-not-change list

The Reviewer checks these one at a time. Each is behaviour this design
guarantees is untouched, once the caller is authenticated.

1. **Every existing endpoint's request shape, response body and status codes**
   are unchanged. The only new outcome anywhere is 401 (and 403 in the narrow
   §16.3 case). No response gains, loses or renames a field. `GET /api/status`
   in particular keeps its conditional-spread `plannedLeg` / `traffic` keys and
   must still serialise byte-identically for an unchanged `AppState`.
2. **Route registration order inside `src/server.ts` is preserved.**
   `/api/flights/combine` stays before `/api/flights/:id`; planned-leg routes
   stay before the PDF/KML exports; every literal route stays before
   `app.get('*')`; the `MulterError` handler stays last.
3. **`/api/ingest/*` behaviour is unchanged** apart from the token being
   mandatory: same paths, same payload validation (`isValidFrame`,
   `buildTrafficObjects`, `MAX_BATCH_OBJECTS = 200`), same 204/400/401 codes,
   same stale-timeout disconnect logic, same de-duplication and retention cap.
4. **The two upload validators are untouched.** PDF: 20 MB `fileSize`,
   `mimetype === 'application/pdf'`, `isPdfBuffer` magic-byte sniff.
   `.lnmpln`: 512 KB, 25 files, BOM-stripped `'<'` sniff, the duplicate-hash
   rules, `chainOrderForBatch`, and the per-file `results[]` shape. Only the
   `fields`/`fieldSize`/`parts` limits of §8.5 are added, and no legitimate
   upload reaches them.
5. **The Vitest suite passes unchanged.** `npm test` today covers
   `flightManager`, `legMatcher`, `plannedLegClose`, `airports`, `lnmpln`,
   `kmlExport`, `flightPlans` — none of which this design touches. New pure
   modules (`src/auth/password.ts`, `parseBooleanEnv`, `LoginThrottle`) are
   good test targets; existing tests must not be edited to accommodate them.
6. **`apiFetch`'s error contract is unchanged** for every status other than
   401: still `throw new Error(body.error ?? statusText)`. `UnauthorizedError`
   extends `Error`, so existing `catch` sites keep compiling and keep showing
   the same messages.
7. **Default bind and port are unchanged.** With no new env vars set, the
   server still binds `0.0.0.0:3000` — `BIND_HOST` defaults to the value that
   reproduces today's `app.listen(PORT)`.
8. **`TRAFFIC_ENABLED` and `parseTrafficEnabled` are untouched**, including
   their inverted default-on semantics, which §7.2's new parser deliberately
   does not share.
9. **`EXPORT_BASE_URL` keeps its meaning and its precedence** over the derived
   default, and PDF/KML output bytes are unchanged for an authenticated
   caller — same `renderPdf` flow, same `appendPdfs` behaviour, same
   `Content-Disposition` filename rules in `sendPdf`/`sendKml`.
10. **The database's existing tables, columns, indexes and rows are untouched.**
    The migration adds three tables and one index and nothing else; no
    `ALTER TABLE`, no `DROP`, no `UPDATE` of existing rows anywhere in this
    design.
11. **The shutdown path is unchanged**: SIGINT/SIGTERM still close the server,
    then `closeDb()`, with the 3 s unref'd fallback. The new sweep interval is
    `unref()`ed so it cannot hold the process open.
12. **No agent code changes.** `agent/agent.js` and `agent/traffic.js` are not
    edited by this run; only `agent/README.md` and the operator's environment.

---

## 20. Migration and breaking changes

This is a deliberate breaking change (§2). What follows is exactly what happens
to an existing deployment that pulls the new build and does nothing.

### 20.1 The server will not start

`node dist/index.js` exits 1 at once with the `INGEST_TOKEN` message of §12.2 —
before the database is opened. Nothing is written; nothing is lost. Then, once
a token is set, it exits 1 again with the no-operator-account message of §6.4.

Minimum sequence to a working deployment:

```
npm run build
node dist/setPassword.js                 # or: npm run set-password
export INGEST_TOKEN=$(openssl rand -hex 24)
# EITHER supply a certificate:
export TLS_CERT_FILE=/etc/msfslogger/cert.pem TLS_KEY_FILE=/etc/msfslogger/key.pem
# OR accept plaintext on the LAN, knowingly:
export ALLOW_PLAINTEXT_HTTP=1
npm start
```

### 20.2 What the operator sees afterwards

- Browsing to the app redirects to `/login`; nothing is readable until they log
  in. The logbook itself is unchanged.
- With TLS on, the URL becomes `https://…` and a self-signed certificate
  produces a one-time browser warning.
- The agent stops delivering data until it gets the same `INGEST_TOKEN`, and —
  if TLS is on — an `https://` `SERVER_URL` plus `NODE_EXTRA_CA_CERTS`
  (§15.2). Flights in progress are not corrupted; the server simply marks the
  agent disconnected after the existing 10 s stale timeout.
- PDF and KML exports work exactly as before, from inside a logged-in session
  (§13).

### 20.3 What the README must say

`README.md` is user-facing and kept accurate, so this run must add or rewrite:

1. **A "First run" section** — `npm run set-password` before the first start,
   the non-interactive stdin form for Docker, and how to reset a forgotten
   password (re-run it; and `DELETE FROM auth_session` to end existing
   sessions, §6.5).
2. **The environment-variable table** (line 21 today) — every row of §7.1.
   `INGEST_TOKEN`'s current wording ("Optional shared secret … If unset, the
   endpoints are unauthenticated — fine on a trusted home LAN") is now wrong
   and must be replaced.
3. **An "HTTPS" section** — the two variables, the `openssl` command of §11.5,
   the one-port rule and the fact that a stale `http://` bookmark will fail to
   connect, and that certificate rotation needs a restart (§11.1).
4. **An "Insecure modes" subsection** naming `ALLOW_UNAUTHENTICATED_INGEST` and
   `ALLOW_PLAINTEXT_HTTP` in the same words the startup warnings use: insecure,
   trusted LAN only, never on an internet-reachable host.
5. **The upgrade note** — §20.1 verbatim, so an existing user who hits the exit
   code finds the fix in the README rather than in a stack trace.
6. **The dev note** — loopback plaintext needs no opt-out; `npm run dev` is
   unaffected; `changeOrigin` in the Vite proxy must stay false (§14.6).

`agent/README.md` gets §15.1 and §15.2. `docker-compose.yml` gets the new
variables as commented pass-throughs (`INGEST_TOKEN`, `TLS_CERT_FILE`,
`TLS_KEY_FILE`, `ALLOW_PLAINTEXT_HTTP`, `SESSION_SECRET`) and a volume mount
hint for the certificate directory; no default values are baked into the image.

### 20.4 The user's own running server

Per `.claude/ENVIRONMENT.md`, the live process on port 3000 is not restarted by
any agent in this run. `npm run build` overwrites `dist/`, so the tree must be
left shippable — and note that after this run, the user's *next* restart of
their live server will hit §20.1. That has to be in the final report to the
user, not just in the README.

---

## 21. Risks

| # | Risk | What would falsify / what it costs | Mitigation |
|---|------|-----------------------------------|------------|
| R1 | **The operator locks themselves out** — wrong password, or the DB row is lost with the sessions. | A support incident with the user's own data behind it. | The CLI resets the password without the server (§6.4, verified P7); no account lockout exists (§16.2 throttles by IP and expires in 15 min, it never disables the account). |
| R2 | **PDF export regresses in a way the prototype did not cover** — the real print pages make several gated calls and load Leaflet tiles, not one `fetch`. | Export returns 500 with `Failed to load flight N: Authentication required`. | §13 is verified end to end in miniature; the implementing task must run a real export against a scratch server on another port and diff the byte count against a pre-change export. |
| R3 | **Middleware ordering mistake** silently leaves a route ungated — e.g. registering `app.use('/api', requireAuth)` after a route block. | A `curl` with no cookie returns 200 on a `/api/*` route. | §8.3 freezes the order; the Reviewer's evidence must be an unauthenticated `curl` against **every** row of §8.1's gated table, not a sample. |
| R4 | **Self-signed TLS is trust-on-first-use.** An active MITM on the LAN can still impersonate the server the first time. | Accepted at this threat level (§3.1 T3, §11.6). | Documented; an operator who wants more can supply a real certificate — nothing in the design assumes self-signed. |
| R5 | **The Windows agent behaves differently from the Linux prototype** with `NODE_EXTRA_CA_CERTS` (path quoting, CRLF in the PEM, a different Node major). | The agent logs `DEPTH_ZERO_SELF_SIGNED_CERT` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE` after the upgrade. | P6 verified the mechanism on Linux/Node 20; the agent box needs its own smoke test, and the memory note about redeploying the agent applies. |
| R6 | **A password change does not end existing sessions** (§6.5). | An operator who changes their password because they think a session was stolen is not actually protected. | Documented, with the `DELETE FROM auth_session` escape hatch. A follow-up run could bump a `session_epoch` in `app_secret` and check it in `requireAuth`. |
| R7 | **No rate limit on `/api/ingest/*`** (§12.5). | A leaked token lets someone flood frames. | The token is the gate; frames are cheap and the flight-state machine already ignores nonsense. Revocation is changing the token on both sides. |
| R8 | **Session rows grow if the sweep interval is dropped in review** (it is `unref()`ed and easy to "simplify" away). | `auth_session` accumulates dead rows in the user's logbook DB. | §10.5 is explicit; expired rows are already unusable, so this is hygiene, not correctness. |
| R9 | **`express-session` is a new supply-chain dependency** in an app that has kept its dependency list short. | One more package to keep patched. | It is the canonical Express session middleware; the alternative was hand-rolling signed-cookie session handling, which is worse. `npm audit` output belongs in the DevOps report. |
| R10 | **The 100 kb JSON limit becomes wrong** if a future traffic cap or export payload grows past it (§8.5 has 4.5× headroom today). | A 413 on a legitimate ingest batch. | The measurement and the cap it derives from (`MAX_BATCH_OBJECTS`) are recorded here; anyone raising that cap must revisit §8.5. |

---

## 22. File and ownership map

For the Planner's batching. Two tasks must never own the same file.

| File | New? | Owns | Depends on |
|------|------|------|------------|
| `src/config.ts` | new | §7 in full: `AppConfig`, `loadConfig`, `getConfig`, `ConfigError`, `parseBooleanEnv`, all messages | — |
| `src/db.ts` | edit | §5 DDL block; `AuthUserRow`; `getAuthUser`, `setAuthUser`, `getAppSecret`, `getOrCreateAppSecret`, `sessionGet/Set/Destroy/Sweep` | — |
| `src/auth/password.ts` | new | §6.2, §6.3 constants, `DUMMY_PASSWORD_HASH` | — |
| `src/auth/sessionStore.ts` | new | §10.2 | `src/db.ts` |
| `src/auth/middleware.ts` | new | `requireAuth`, `requireSameOrigin` (§16.3), `LoginThrottle` (§16.2), `sessionCookieFrom` (§13.2) | `src/config.ts` |
| `src/auth/routes.ts` | new | §9, §16.1 | `password.ts`, `middleware.ts`, `db.ts` |
| `src/auth/express-session.d.ts` | new | §4.4 augmentation — nothing else declares it | `src/types.ts` |
| `src/types.ts` | edit | `SessionUser`, `LoginRequest`, `LoginResponse`, `SessionResponse` | — |
| `src/server.ts` | edit | §8.3 ordering, §8.5 limits, session middleware, §13.2 cookie forwarding at the two export routes, ingest wiring (§12.4) | everything above |
| `src/ingest.ts` | edit | §12.1, §12.3, §12.4 — third parameter, timing-safe compare. Nothing else in the file moves | `src/config.ts` |
| `src/pdfExport.ts` | edit | §13.2 `renderPdf` signature + `page.setCookie`, §13.3 `acceptInsecureCerts`, scheme-aware `baseUrl()` | `src/config.ts` |
| `src/index.ts` | edit | §7.3 startup order, §6.4 credential check, §11 listener selection, §10.5 sweep interval, startup log line | `src/config.ts`, `src/db.ts` |
| `src/setPassword.ts` | new | §6.3, §6.4 CLI | `password.ts`, `db.ts` |
| `package.json` | edit | `express-session` dep, `@types/express-session` devDep, `set-password` script | — |
| `client/src/types.ts` | edit | mirrored wire types (§4.4) | — |
| `client/src/utils/api.ts` | edit | §14.2 | — |
| `client/src/hooks/useSession.ts` | new | §14.3 | `api.ts`, `types.ts` |
| `client/src/components/RequireAuth.tsx` | new | §14.3 | `useSession.ts` |
| `client/src/pages/Login.tsx` | new | §14.1 | `useSession.ts` |
| `client/src/App.tsx` | edit | §14.4 route table + the session provider | the four client files above |
| `client/src/components/Sidebar.tsx` | edit | §14.5 logout control | `useSession.ts` |
| `README.md` | edit | §20.3 items 1-6 | — |
| `agent/README.md` | edit | §15.1, §15.2 | — |
| `docker-compose.yml` | edit | §20.3 env pass-throughs + cert volume hint | — |
| `src/inspect-traffic.ts` | edit | Amendment 1: `withRouterServer()`'s `createIngestRouter(...)` call site only — one `IngestConfig` argument built from `process.env.INGEST_TOKEN`, no scenario behaviour changed | `src/ingest.ts` |

Not touched by this run, deliberately: `agent/agent.js`, `agent/traffic.js`
(§19 item 12), `client/vite.config.ts` (§14.6), `client/src/components/Header.tsx`,
every other `src/inspect-*.ts`, and every file under `tests/` (§19 item 5).
