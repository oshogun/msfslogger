# Review — Phase 3 (T-010, T-011) + run close-out — 2026-09-10-security-hardening

## Verdict: request_changes

One blocking finding: a file outside every task's `allowed_paths` in the whole
run — `src/inspect-traffic.ts` — was modified, contradicting the run's own
GOAL text ("Out of scope, deliberately: ... src/inspect-\*.ts") and never
recorded in design.md's Amendments table (still "none yet"). The change
itself is correct and necessary (see below) — the fix here is administrative
(a design amendment + retroactive path authorization), not a code revert.

Everything else checked — 8 of 9 acceptance criteria fully independently
verified with commands re-run by me, one (AC-3, the fatal-message quotes)
verified with a downgrade from "blocking" to "non-blocking" on my own
judgement, explained below.

---

## Environment corrections applied

- No PID on port 3000 throughout (`lsof -i:3000` / `ps aux | grep dist/index.js`
  empty before, during and after) — confirms the user's correction.
- Operator account already exists on live `flights.db`; I did not re-run
  `set-password` against it.

## AC-1 — Runnable command blocks, exit status

All work done in scratch dirs under the session scratchpad, on ports 3112–3115,
never against `flights.db`. `npm run build` run once in the live tree (writes
`dist/`, which is expected/safe per ENVIRONMENT.md; server not running).

| Block | Where | Result |
|---|---|---|
| `npm run build` | live tree | exit 0 |
| `npm run set-password` (non-interactive stdin) | scratch | `Password set for user "operator".` exit 0 |
| §20.1 upgrade sequence, all 3 refusals + working start | scratch, `env -i` | see AC-3/order section below |
| `openssl req ...` (HTTPS one-liner) | scratch | exit 0, cert+key produced |
| HTTPS server start + `curl --cacert` | scratch :3114 | `{"authenticated":false,...}` 200; plain http to same port → connection fails (curl 000), confirms "one port, one protocol" |
| `npm run dev` BIND_HOST=127.0.0.1 block | scratch | prints `No TLS configured — serving plaintext HTTP on loopback only.` verbatim, matches README |
| `npm test` | live tree | 266 passed, exit 0 |
| `npm run test:types` | live tree | exit 0 |
| `npm run backup` | scratch DB | exit 0, wrote `backups/<ts>/` |
| KML export curl example (§ KML export, pre-existing) | scratch :3115, logged-in cookie added by me | server itself: 401 if run exactly as documented (no cookie) — see follow-up below |
| Docker server-stage build | `docker build --target server-builder` | exit 0, `dist/setPassword.js` + `dist/auth/{middleware,password,routes,sessionStore}.js` present in image (AC-4) |
| `docker compose config` | not re-run (T-011's job, not blocking here) | — |
| agent/README.md PowerShell blocks (setup, HTTPS/NODE_EXTRA_CA_CERTS, `--sim 2024`, `schtasks`) | — | Windows-only, unrunnable here by inspection (PowerShell syntax, doc explicitly Windows-targeted) |
| Utility scripts, project-structure tree, MSFS `--sim` block | — | pre-existing, unrelated to this run; not re-run |

## AC-2 — Env var cross-check

```
$ grep -oE "'[A-Z_]+'" src/config.ts
'TLS_CERT_FILE' 'TLS_KEY_FILE' 'TLS_KEY_PASSPHRASE' 'ALLOW_PLAINTEXT_HTTP'
'BIND_HOST' 'SESSION_SECRET' 'ALLOW_UNAUTHENTICATED_INGEST' 'INGEST_TOKEN'
```
= exactly the `ENV_VARS` constant (8 items), all 8 appear as rows in the
README's environment table. The README table has 3 more rows — `PORT`,
`EXPORT_BASE_URL`, `TRAFFIC_ENABLED` — which design §7.1 explicitly excludes
from `config.ts`'s remit ("keep their current meanings and their current
readers"); confirmed each is genuinely read elsewhere: `PORT`/`EXPORT_BASE_URL`
in `src/pdfExport.ts:29`, `TRAFFIC_ENABLED` in `src/ingest.ts:142`. No
fictional variable, nothing undocumented. Literal set equality (README table
== `ENV_VARS`) does not hold, by design; substantive completeness does.

## AC-3 — Fatal messages / insecure warnings vs. README

Reproduced all three fatal exits and both warnings with `env -i` against a
built scratch tree (no `flights.db` present, so `initDb()` never touches
anything live):

```
$ env -i PATH="$PATH" node dist/index.js
[Config] Refusing to start: no TLS configured and BIND_HOST is 0.0.0.0, which
is not loopback. Set TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS), or set
ALLOW_PLAINTEXT_HTTP=1 to accept an unencrypted LAN deployment.
exit 1

$ env -i PATH="$PATH" ALLOW_PLAINTEXT_HTTP=1 node dist/index.js
WARNING: serving plaintext HTTP on 0.0.0.0:3000 because ALLOW_PLAINTEXT_HTTP
is set. [...] (README § HTTPS).
[Config] Refusing to start: INGEST_TOKEN is not set. [...]
exit 1

$ env -i PATH="$PATH" ALLOW_PLAINTEXT_HTTP=1 INGEST_TOKEN=devtoken1234567890 node dist/index.js
[DB] Database ready
[Auth] Refusing to start: no operator account exists.
[Auth] Run `npm run set-password` to create one (README § First run).
exit 1
```

The `ALLOW_PLAINTEXT_HTTP` warning is quoted **verbatim** in README.md:105-117.
The three fatal messages are described accurately in prose (First run / HTTPS
/ Upgrading sections) but not quoted verbatim anywhere — design §20.3 only
requires verbatim quoting for the two *insecure-mode* warnings, not the three
fatal messages, so this is design-conformant, not drift. **Downgrading this
half of AC-3 to non-blocking**, see follow-ups.

`ALLOW_UNAUTHENTICATED_INGEST`'s active-state warning
(`[Config] WARNING: ALLOW_UNAUTHENTICATED_INGEST is set - /api/ingest/*
accepts data from anyone who can reach this server.`, reproduced by me) is
**not** quoted anywhere in README; the Insecure-modes bullet instead quotes the
tail of the *refusal* message (accurate, but a different string). Also
non-blocking — see follow-ups.

## Corrected §20.1 order — independently verified

Design's own §20.1 prose said INGEST_TOKEN fires first, then no-operator-account
— which is wrong for a truly empty environment, since `BIND_HOST` defaults to
`0.0.0.0` and the TLS/plaintext check (§7.3 step 3) runs before the ingest
check (step 4). I reproduced the real order myself (three separate `env -i`
runs above): **TLS/plaintext refusal → INGEST_TOKEN refusal → no-operator-account
refusal**. README.md:242-250 states exactly this corrected order. Matches.

## Dev-mode BIND_HOST finding — independently verified

```
$ env -i PATH="$PATH" node dist/index.js   # no BIND_HOST set
[Config] Refusing to start: ... BIND_HOST is 0.0.0.0, which is not loopback...
```

Confirms `npm run dev` is **not** zero-config-safe — the plaintext-on-non-loopback
refusal fires unless `BIND_HOST=127.0.0.1` is exported. README.md:155-168
("Running locally" § 3. Start) states this correctly and gives the working
`export BIND_HOST=127.0.0.1 / export INGEST_TOKEN=... / npm run dev` sequence,
which I ran and confirmed prints `No TLS configured — serving plaintext HTTP
on loopback only.` and proceeds to the (expected, scratch-tree) no-operator
refusal. Matches design's corrected §14.6 note (not the original's "unaffected"
claim).

## AC-4 — Docker server-stage build

`docker build --target server-builder -t ...` → exit 0 (cached from a prior
identical layer set). `docker run --rm ... ls dist/setPassword.js dist/auth/`
→ both present, `node -v` inside → v20.20.2. Image removed after.

## AC-5 — Design §19 items 1-12, re-verified against the shipped tree

1. **Status/response shapes unchanged** — not independently re-captured this
   round (T-007's byte-diff evidence covers it; out of this task's fresh
   scope). Not re-verified by me — recorded as such, not claimed.
2. **Route order** — `grep -n "app\.\(get\|post\|put\|patch\|delete\)("
   src/server.ts` — every literal route precedes the sole `app.get('*')` at
   line 964; `MulterError` handler at line 968 is last. Matches.
3. **Ingest unchanged apart from mandatory token** — `git diff src/ingest.ts`
   shows `parseTrafficEnabled` untouched; token check confirmed live above.
4. **Upload validators untouched** — not re-diffed this round (T-007's scope);
   `git diff --stat` shows no further changes to `src/server.ts` since phase 2.
5. **Vitest suite passes** — `npm test` → 266 passed, 0 failed, exit 0.
6. **`apiFetch` error contract** — `client/src/utils/api.ts`: `UnauthorizedError
   extends Error`; every other non-2xx still `throw new Error(...)`. Confirmed
   by reading the file.
7. **Default bind unchanged** — `src/config.ts:100`:
   `env.BIND_HOST || '0.0.0.0'`. Confirmed.
8. **`TRAFFIC_ENABLED`/`parseTrafficEnabled` untouched** — `git diff
   src/ingest.ts` shows zero lines touching either. Confirmed.
9. **`EXPORT_BASE_URL` precedence / export bytes** — not re-captured this
   round; §13 was T-007's regression scope, reviewed at T-009.
10. **DB additive-only migration** — `grep CREATE TABLE\|CREATE INDEX
    src/db.ts` shows only new tables/indexes (`auth_user`, `auth_session`,
    `app_secret`, `idx_auth_session_expires`); the only `+`/`-` lines matching
    `ALTER|DROP|UPDATE` in the diff are `ON CONFLICT ... DO UPDATE` (upserts on
    the new tables, not existing ones). Confirmed.
11. **Shutdown path unchanged** — `src/index.ts`: SIGINT/SIGTERM → `closeDb()`,
    3s `unref()`ed fallback; new sweep interval also `.unref()`ed
    (`src/index.ts:55`). Confirmed.
12. **No agent code changes** — `git diff --stat agent/agent.js agent/traffic.js`
    → empty. Confirmed.

## AC-6 / scope — git status, git log, allowed_paths

`git log --oneline -3` — unchanged (`209d36e`, `4a1f823`, `bec50d7`) — no
sub-agent committed, pushed, or switched branches.

`git status --porcelain` — every modified/untracked file maps to a task's
`allowed_paths` **except one**:

```
M src/inspect-traffic.ts
```

No task in plan.json (T-001 through T-011) lists this file in `allowed_paths`,
and the run's own GOAL text names it explicitly as deliberately out of scope:
*"any change to agent/agent.js, agent/traffic.js, client/vite.config.ts,
client/src/components/Header.tsx, **src/inspect-\*.ts** or tests/ existing
files."* `design.md`'s Amendments table is still `none yet`.

The change itself (diff below) is a one-line import + threading a required
`IngestConfig` third argument into a direct call to `createIngestRouter()`,
whose signature T-007 changed (`src/ingest.ts:126-130`, no default, no `?`):

```
+import type { IngestConfig } from './config';
...
-  app.use('/api/ingest', createIngestRouter(flightManager, store));
+  const ingestConfig: IngestConfig = rawToken ? {...} : {...};
+  app.use('/api/ingest', createIngestRouter(flightManager, store, ingestConfig));
```

I confirmed this edit is **necessary**: `src/inspect-traffic.ts` is included by
`tsconfig.json`'s `"include": ["src/**/*"]`, and `createIngestRouter`'s third
parameter is mandatory — without this edit `npx tsc`/`npm run build` would fail
to compile. `npm run build` in the live tree does exit 0 with the edit present.
This is a real, correct fix for a real knock-on break — but it was made by
whichever dispatcher round changed `src/ingest.ts` (phase 2, T-007), outside
that task's `allowed_paths` (`src/server.ts`, `src/ingest.ts`,
`src/pdfExport.ts` — not this file), and neither T-005 nor T-009 recorded it as
an accepted deviation. **This is the blocking finding.** Remedy: a design
amendment (Amendments table row) retroactively authorizing this file for the
scope that required the `createIngestRouter` signature change, or an explicit
one-line addition to T-007's `allowed_paths` in `plan.json` — not a code
revert.

## AC-7 — Live DB / port state

`md5sum flights.db` — `bf2bb4ebc4cbd0055ac812738f4dada0` before my session and
unchanged at every check throughout (re-verified after each scratch server
run). `lsof -i:3000` / `ps aux | grep dist/index.js` — empty throughout; "no
PID (server not running)" confirmed at start and end.

## AC-8 — Residual risks (§21) shipping unmitigated

- **R4** — self-signed TLS is trust-on-first-use; an active LAN MITM can
  impersonate the server on first connection. Accepted at this threat level.
- **R5** — the Windows agent's behaviour with `NODE_EXTRA_CA_CERTS` (path
  quoting, CRLF, Node major) is unverified on the actual Windows box; only
  Linux/Node 20 was prototyped.
- **R6** — a password change does not end existing sessions; only
  `DELETE FROM auth_session` does (documented escape hatch).
- **R7** — no rate limit on `/api/ingest/*`; the token is the only gate.

**The sentence for the user:** their server's next restart will refuse to
start until `INGEST_TOKEN` is set in its environment. The operator-account
refusal will **not** trigger — that account was already created against the
live `flights.db` before this run.

---

## Non-blocking follow-ups

1. README's "Insecure modes" section quotes the *refusal* message's tail for
   `ALLOW_UNAUTHENTICATED_INGEST` rather than its own active-state startup
   warning (`[Config] WARNING: ALLOW_UNAUTHENTICATED_INGEST is set - ...`).
   Accurate as far as it goes, but asymmetric with the `ALLOW_PLAINTEXT_HTTP`
   bullet, which quotes its real active warning verbatim. Add the missing
   line for symmetry.
2. None of the three fatal startup messages are quoted verbatim in README
   (only accurately paraphrased) — not required by design §20.3, but would
   help an operator grep their own stderr against the doc.
3. The pre-existing KML export `curl` example
   (`curl -si -X POST localhost:3000/api/flights/export.kml ...`) predates the
   auth gate and, run exactly as written, now gets `401` — it needs a session
   cookie. Out of this run's declared doc scope (§20.3's six items didn't
   include it), but worth a follow-up pass now that every `/api` route is
   gated.
4. `src/inspect-traffic.ts`'s comment references "§12.4" correctly and reads
   like the surrounding code — once the scope gap above is formally closed, no
   further code change is needed there.
