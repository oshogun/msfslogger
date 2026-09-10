# Review — phase 2 (T-006, T-007, T-008) · T-009

**Verdict: approve.** 0 blocking findings. Every acceptance criterion was
re-run by the reviewer against a scratch HTTPS server on port 3111 built from
the tree as it stands; no Dispatcher report was read.

| Task | Verdict |
|------|---------|
| T-006 session store / middleware / auth router | approve |
| T-007 server wiring, ingest token, PDF loopback | approve |
| T-008 client login flow | approve |

## Evidence base

Scratch HTTPS server `PORT=3111 BIND_HOST=127.0.0.1 TLS_CERT_FILE/TLS_KEY_FILE`
(self-signed, `CN=localhost`), `INGEST_TOKEN=reviewer-scratch-token-0123456789`,
cwd = scratchpad copy of `flights.db`, operator created with
`node dist/setPassword.js --username operator`. Pre-phase comparison from a
`git worktree` at `209d36e`, built and served on 3112 (removed at the end).
Plaintext loopback server on 3113 for §10.6 and the throttle. All stopped.

## Acceptance criteria

**1. All 32 gated rows of §8.1 (criterion 1).** Every row issued
unauthenticated. **32/32 → `401 {"error":"Authentication required"}`. Zero
200s.** Plus `GET /api/no-such-route` and `POST /api/no/such/route` → 401 (the
"any unmatched `/api/*`" row). Full transcript reproduced by the loop in this
review's command log; the pattern is uniform — status and body identical on
every row, including the two PDF and three KML export paths and all five
planned-leg routes.

**2. Public surface (criterion 2).** `GET /` 200 (SPA), `/login` 200,
`/print/flight/68` 200, `/print/trip/1` 200, `/assets/index-BNT5hX0p.js` 200,
`GET /api/auth/session` 200 `{"authenticated":false,"user":null}` with
`Cache-Control: no-store`. Ingest with a valid token: `/frame` 204, `/event`
204/400-by-payload, `/traffic` 204. Without the token or with a wrong one, all
three → `401 {"error":"Invalid or missing ingest token"}`. A session cookie
does **not** substitute for the token (still 401) — §8.3 position 3 holds.

**3. Exports (criterion 3), pre-phase vs authenticated post-phase.**

| Export | pre (3112) | post (3111, authed) | Content-Disposition |
|--------|-----------|---------------------|---------------------|
| flight 68 PDF | 1 page | **1 page** | identical: `attachment; filename="flight-68-paou-pacd-2026-09-09.pdf"` |
| trip 1 PDF | 678 pages | **678 pages** | identical: `…"trip-circumnavegacao-2026-08-17.pdf"` |
| flight 57 PDF `?plans=1` (appendPdfs) | 28 pages | **28 pages** | identical |
| flight 68 KML | md5 `aef8485e…` | **`aef8485e…`** | identical |
| trip 1 KML | md5 `7ebde275…` | **`7ebde275…`** | identical |

Byte sizes differ run-to-run on both trees (pre 178832 / 178132, post 140150 /
177984 across two passes) — map-tile load variance, not auth: page counts match
and `strings post_*.pdf | grep -i "Authentication required"` is empty on both.
Server log confirms the scheme-aware base:
`[PDF] Rendering https://127.0.0.1:3111/print/flight/68` (pre-phase: `http://…:3112/…`).

**4. Puppeteer end-to-end, reviewer's own (criterion 4).** Real HTTPS server,
`acceptInsecureCerts`, no stubs:

```
1. anonymous /flights  -> url: https://127.0.0.1:3111/login   login form: true
2. after submit        -> url: https://127.0.0.1:3111/flights
   cookie: name=msfslogger.sid httpOnly=true secure=true sameSite=Lax path=/
3. gated /flights      -> "…FLIGHT LOG AIRCRAFT DATE DURATION… Circumnavegação ACTIVE 47"
   in-page /api/flights status: 200
4. DELETE FROM auth_session (4 rows) -> reload -> url: /login, login form: true   (mid-session 401 bounce)
5. re-login -> /flights; <div class="sidebar-section sidebar-account">
     <span class="sidebar-username">operator</span><button class="sidebar-logout">Log out</button></div>
   click Log out -> url: /login; login form: true; /api/status: 401; cookies: []
```

Set-Cookie attributes, both transports (§10.6):
- over TLS (3111): `msfslogger.sid=s%3A…; Path=/; Expires=…; HttpOnly; **Secure**; SameSite=Lax`
- over loopback plaintext (3113): `msfslogger.sid=s%3A…; Path=/; Expires=…; HttpOnly; SameSite=Lax` — **Secure absent**.

Note: step 5 needed a 1600px viewport. At puppeteer's default 800×600 the
sidebar auto-collapses and the logout control is inside the `!collapsed`
branch, so it is not reachable — pre-existing collapse behaviour from 209d36e,
not a phase-2 defect. Recorded as a follow-up.

**5. Design §19 items 1–12 (criterion 5).**

1. **Verified.** `GET /api/status` from a fresh pre-phase server (3112) and a
   fresh post-phase server (3114), same empty AppState: `diff` reports no
   difference — byte-identical, conditional keys included.
2. **Verified.** `POST /api/flights/combine` (authed) → `400 {"error":"id1 and
   id2 must be integers"}` — its own handler, not `/:id`. `/api/trips/1/planned-legs`
   200 and `/api/planned-legs/28` 200 (still ahead of the export routes);
   `GET /zzz` → 200 SPA (catch-all still last). Diff moves no route.
3. **Verified, explicit diff.** `git diff src/ingest.ts` touches only
   `createIngestRouter`'s 3rd parameter, `sha256`/`timingSafeEqual` in
   `checkAuth`, and the token source. `isValidFrame`, `buildTrafficObjects`,
   `MAX_BATCH_OBJECTS`, the stale-timeout and retention logic are unchanged
   lines. Runtime: valid frame + token 204; no token 401; 201-object batch →
   `400 {"error":"Traffic batch exceeds 200 objects"}`.
4. **Verified, explicit diff.** `src/flightPlans.ts` unmodified
   (`git status --porcelain src/flightPlans.ts` empty); `src/server.ts` diff adds
   only `files/fields/fieldSize/parts` to the two multer instances. Runtime
   pre vs post, identical on every row: real PDF → 200, `text/plain` → `400
   {"error":"File must be a PDF"}`, PDF mimetype + junk bytes → same 400, no
   file → `400 {"error":"No file uploaded"}`. Only new outcome: 10 extra
   fields → `400 {"error":"Too many parts"}` (pre-phase accepted it) — exactly
   §8.5, through the existing generic MulterError branch.
5. **Verified, explicit diff.** `git diff --stat -- tests/` is empty; the only
   test changes are three new files (`config`, `loginThrottle`, `password`).
   `npm test`: **14 files, 266 tests, 0 failures**.
6. **Verified.** `client/src/utils/api.ts` diff adds `UnauthorizedError`,
   `setUnauthorizedHandler` and a 401 branch; the non-401 line
   `throw new Error(body.error || res.statusText)` is untouched in both
   `apiFetch` and `download`.
7. **Verified.** With `ALLOW_PLAINTEXT_HTTP=1` and no `PORT`/`BIND_HOST`:
   `[HTTP] Server running at http://0.0.0.0:3000`, `ss` shows
   `LISTEN 0.0.0.0:3000`. Defaults unchanged. (With no opt-out the server now
   *refuses* to start on a non-loopback bind — that refusal is §11.3/§7.3 step 3
   by design, and §19 item 7 speaks to the default *value*, which holds.)
8. **Verified.** `git diff src/ingest.ts | grep -c parseTrafficEnabled` → 0;
   `TRAFFIC_ENABLED` still read at `src/ingest.ts:142` through the untouched parser.
9. **Verified.** `src/pdfExport.ts:29` keeps
   `process.env.EXPORT_BASE_URL ?? …` — same precedence, only the derived
   default gained the scheme. Output equivalence in the table above.
10. **Verified.** Schema diff of live `flights.db` vs the exercised scratch DB:
    added/removed/altered objects **(none)**; row counts identical for every
    pre-existing table. Only `auth_session` and `app_secret` differ (0 → 1),
    both new tables.
11. **Verified.** `kill -INT` on the scratch server → exits in 1 s with
    `[Shutdown] SIGINT — closing database... / [Shutdown] Clean.` The sweep
    interval does not hold the process open.
12. **Verified.** `git status --porcelain agent/` is empty.

**6. Session survives restart (criterion 6).** Logged in, `GET /api/status` 200,
`kill` the 3111 server, restart against the same scratch DB, replay the same
cookie: **200**, and `/api/auth/session` → `{"authenticated":true,"user":{"username":"operator"}}`.
`app_secret.session_secret` (44 chars, base64 of 32 bytes) is what makes this work.

**7. Toolchain (criterion 7).** `npm test` 266/266 pass; `npm run test:types`
exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0 (client + server).

**8. Scope and commits (criterion 8).** `git status --porcelain` lists only
files inside phase-1 or phase-2 `allowed_paths`, plus `.claude/runs` artifacts
and `src/inspect-traffic.ts`. That file's diff is exactly the narrow fixup the
Orchestrator described: one `import type { IngestConfig }`, an `IngestConfig`
built from `process.env.INGEST_TOKEN`, passed as the 3rd argument; no scenario
or expected output changed. `git log --oneline -1` → `209d36e`, unchanged. No
sub-agent committed. Reviewer's `git worktree` removed; `git worktree list`
shows only the main checkout.

**9. Live database and server (criterion 9).** `md5sum flights.db` at review
start and at review end: **`bf2bb4ebc4cbd0055ac812738f4dada0`** both times —
unchanged by this review. **Port 3000 had no listener at review start** (`curl`
→ 000, no `dist/index.js` process); there is no PID to state. See question Q1.

## Extra probes (not required, all clean)

- Login contract §9.1: missing/non-string fields → `400 {"error":"username and
  password are required"}`; wrong password and unknown username → identical
  `401 {"error":"Invalid username or password"}`; success → `200 {"user":{"username":"operator"}}`.
- §16.1 fixation: re-login from the same jar produces a different `sid`
  (`s%3A3xVEB7…` → `s%3AqMPIGz…`) — regenerate-before-set.
- §16.2 throttle: attempts 1–10 → 401, attempt 11 → `429 {"error":"Too many
  login attempts. Try again in 900 seconds.","retryAfterSec":900}` with
  `Retry-After: 900`; the correct password while throttled is still 429; log
  line `[Auth] Login throttled for 127.0.0.1 (900s remaining)`.
- §9.3 logout: 204 with a session, 204 without one, `/api/status` 401 after.
- §16.3: cross-origin `POST` → `403 {"error":"Cross-origin request rejected"}`;
  same-origin POST passes; cross-origin `GET` still 200 (exports stay linkable).
- §7.3 refusals, each exit 1 with the frozen message: no `INGEST_TOKEN`; cert
  without key; unreadable cert; short `SESSION_SECRET`; non-loopback bind with
  no TLS; no operator account. `ALLOW_UNAUTHENTICATED_INGEST=1` prints the
  §12.2 warning.
- Body limit: a 102,904-byte traffic batch → 413; the 22 KB legitimate worst
  case passes.
- Secrets: `grep -c` for the password, the ingest token, `session_secret` and
  `password_hash` across both server logs → 0.
- Static exposure: `/flights.db` and `/flight_plans/` return the SPA shell, not
  files.

## Non-blocking follow-ups

1. `client/src/components/Sidebar.tsx:209-214` — `.sidebar-account`,
   `.sidebar-username`, `.sidebar-logout` have no rules in
   `client/src/index.css`; the logout control renders unstyled.
2. Same block is inside the `!collapsed` branch, so on a narrow viewport (or
   after the operator collapses the sidebar) there is no way to log out
   without expanding it first. Consider a collapsed-state affordance.
3. `client/src/App.tsx` — `/device` and `/override` moved *into* `AppShell`'s
   `Routes` rather than being wrapped individually. They are now gated, as
   §14.4 requires, but they also gain `Header`/`Sidebar` and the `useStatus`
   poll they previously ran without. Cosmetic, and arguably an improvement;
   §14.4 does not specify either way.
4. §21 R8 holds: the `unref()`ed sweep interval survived review — do not
   "simplify" it away later.

## Question (cannot attribute or reproduce — for the Orchestrator, not a finding)

**Q1.** The live `flights.db` changed *after* phase 1's review: that review
recorded md5 `ac497b30ada7946b4c13f5f1d3b6e53a`; the file was already
`bf2bb4ebc4cbd0055ac812738f4dada0` when this review began and still is. It now
carries the three new tables and an `auth_user` row (`username='operator'`,
`created_at=2026-09-10T14:05:28.283Z`, scrypt hash). Its mtime is 14:05, hours
before this review. Consistent with the user themselves restarting the server
on the new build and running `npm run set-password`; also consistent with an
agent having run against the repo cwd. Related: the port-3000 server that was
alive during phase 1 (`pid=743686`) is **not running now**, which is what an
upgrade without `INGEST_TOKEN` would produce (`[Config] Refusing to start`).
Worth confirming with the user before shipping — the row counts of every
pre-existing table are intact, so no data was lost either way.

*(Housekeeping: read-only `better-sqlite3` opens left a 0-byte
`flights.db-wal` and a `flights.db-shm` beside the live DB. Removing them was
blocked by the permission classifier; they are harmless and SQLite recreates
them on next open.)*
