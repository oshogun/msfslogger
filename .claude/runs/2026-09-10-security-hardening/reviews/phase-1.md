# Review — phase 1 (T-001…T-004), run 2026-09-10-security-hardening

**VERDICT: approve.** 6 of 6 acceptance criteria verified independently, 0 claimed-only.
No blocking findings. 4 non-blocking follow-ups, one of which (F1) must be resolved
before T-010 writes README §20.1.

Method: reports for T-001…T-004 were not read. Evidence below is from the reviewer's own
runs against a WAL-consistent copy of `flights.db` in the session scratchpad, on ports
3100–3103. Only the `risks` list was taken from the implementers.

| Task | Verdict |
|------|---------|
| T-001 deps | approve |
| T-002 `src/config.ts` | approve |
| T-003 schema / password / CLI | approve |
| T-004 `src/index.ts` | approve |

## Live state — unchanged

| | Start of review | End of review |
|---|---|---|
| `md5sum flights.db` | `ac497b30ada7946b4c13f5f1d3b6e53a` | `ac497b30ada7946b4c13f5f1d3b6e53a` |
| port 3000 listener | `pid=743686` | `pid=743686` |
| `git log --oneline -1` | `209d36e` | `209d36e` |

No agent committed. Scratch dirs and all scratch servers removed; `ss -ltnp | grep :310[0-3]`
→ none. `npm run build` was re-run (criterion 4), which overwrites `dist/` — see risk R1.

## Acceptance criteria

**1. §7.3 / §12.2 / §6.4 messages diffed character-for-character against the design.**
All 13 reproduced messages are **exact matches**. No character-level differences found.

| Design | Trigger | Result |
|---|---|---|
| §7.3 step 1 | only `TLS_CERT_FILE`; only `TLS_KEY_FILE` | exact (both) |
| §7.3 step 2 read | missing file; cert path is a directory | exact (`ENOENT…`, `EISDIR…`) |
| §7.3 step 2 PEM | `not a pem`; cert/key swapped; encrypted key w/ wrong and w/ no passphrase | exact (4 cases) |
| §7.3 step 3 fatal | empty env, `BIND_HOST=0.0.0.0` | exact |
| §7.3 step 3 warn ×2 | loopback; `ALLOW_PLAINTEXT_HTTP=1` | exact |
| §7.3 steps 5, 6 warn | short token; token + opt-out | exact |
| §7.3 step 7 fatal | `SESSION_SECRET=short` | exact |
| §12.2 three-line | `BIND_HOST=127.0.0.1`, no token | exact, incl. `insecure - LAN only` hyphen |
| §12.2 opt-out warn | `ALLOW_UNAUTHENTICATED_INGEST=1` | exact |
| §6.4 two-line | valid config, empty `auth_user` | exact |
| §6.3 CLI ×5 | see criterion below | exact (all five) |

All fatal paths `exit=1`.

**2. Migration applied by the reviewer to a fresh copy.** `initDb()` run from a scratch cwd
against a copy of the live DB (+ `-wal`, `-shm`).

```
sqlite_master BEFORE: 6 tables, 8 indexes
sqlite_master AFTER : 6 tables + app_secret, auth_session, auth_user
                      8 indexes + idx_auth_session_expires
row counts BEFORE == AFTER:
  flights 47 | flight_points 43698 | trips 1
  planned_legs 16 | planned_waypoints 138 | planned_alternates 3
new tables: auth_user 0, auth_session 0, app_secret 0
```

A JSON dump of `type,name,sql` for every object was diffed pristine-vs-migrated:
**4 added lines, 0 removed or changed lines** — no existing table's or index's DDL text moved
a byte. `PRAGMA foreign_key_check` → `[]`; `integrity_check` → `ok`. `initDb()` run twice in
one process and again in a second process: no error (idempotent).

**3. Unauthenticated `curl` still reaches `/api/status`.** Confirmed:
`curl -sk https://127.0.0.1:3100/api/status` → `http_code=200` with the full
`{"connected":…,"flightState":"IDLE",…}` body; `/api/flights` → `200`.
**Expected and temporary — the gate lands in phase 2 (T-006/T-007). Phase 1 is not the
finished feature.** What *is* closed already: `POST /api/ingest/frame` with no header →
`401 {"error":"Invalid or missing ingest token"}`; with the header → `400 {"error":"Invalid
frame payload"}` (§12.1 shape preserved).

**4. `npm test` / `npm run test:types` / `npx tsc` / `npm run build`** — all re-run, all exit 0.
`Test Files 13 passed (13) | Tests 260 passed (260)`.

**5. Scope.** `git status --porcelain` lists exactly the union of T-001…T-004 `allowed_paths`
(`package.json`, `package-lock.json`, `src/config.ts`, `src/db.ts`, `src/types.ts`,
`src/index.ts`, `src/auth/password.ts`, `src/setPassword.ts`, `tests/config.test.ts`,
`tests/password.test.ts`) plus `.claude/runs/` artifacts. `src/auth/` contains only
`password.ts`. **No file outside allowed_paths changed.**
`git diff --stat HEAD -- tests/` → **empty**; `git status --porcelain tests/` shows only the
two new untracked files. §19 item 5 holds.

**6. md5 / PID** — stated in the table above; both unchanged.

## The two points referred for independent resolution

**Point 1 — validation order. Confirmed correct, not a defect.** `src/config.ts` executes
step 1 (L107) → step 2 (L115-143) → step 3 (L146-161) → step 4 (L168) → 5 (L177) → 6 (L182)
→ 7 (L205), which is §7.3's numbered order exactly. With an empty environment the step-3
plaintext refusal therefore fires first, and the §12.2 message is reachable only once
`BIND_HOST` is loopback or `ALLOW_PLAINTEXT_HTTP` is set. T-004's account is accurate and
config.ts is the module that owns the order. See F1 for the documentation consequence.

**Point 2 — the `[Config]` prefix. Confirmed correct; no double- or zero-prefixed line.**
`src/config.ts:170-172` bakes a literal `[Config] ` into each of the three step-4 lines;
`src/index.ts:22-24` prefixes per-line only when the line does not already start with
`[Config]`. Captured stderr, verbatim:

```
[Config] Refusing to start: INGEST_TOKEN is not set.
[Config] The agent ingest endpoints (/api/ingest/frame, /event, /traffic) would accept flight data from anyone who can reach this server.
[Config] Set INGEST_TOKEN to a shared secret and set the same value on the agent (agent/README.md), or set ALLOW_UNAUTHENTICATED_INGEST=1 to run ingest unauthenticated (insecure - LAN only).
```

Single-line ConfigErrors (steps 1, 2, 3, 7) each came out with exactly one `[Config] `.

## Design conformance (§19 must-not-change, checked one at a time)

- **item 5 (Vitest unchanged)** — pass. 260/260, zero edits to existing test files.
- **item 7 (default bind/port)** — pass. `PORT=3102`, no `BIND_HOST` →
  `ss -ltnp` shows `LISTEN 0.0.0.0:3102`, log `[HTTP] Server running at http://0.0.0.0:3102`.
- **item 10 (existing tables/rows untouched)** — pass, see criterion 2. `git diff src/db.ts`
  adds no `ALTER`/`DROP`/`UPDATE`; the pre-existing `PRAGMA table_info` block is unmoved.
- **item 11 (shutdown path)** — pass. SIGTERM → `[Shutdown] SIGTERM — closing database...`,
  `[Shutdown] Clean.`, **exit 0 in 0.116 s**. The 6 h sweep interval is `unref()`ed and does
  not hold the process open. SIGINT path likewise clean.
- items 1–4, 6, 8, 9, 12 — untouched by construction: `src/server.ts`, `src/ingest.ts`,
  `src/pdfExport.ts`, `client/`, `agent/` are absent from the diff.

Schema DDL matches `contracts/schema.sql` verbatim (only `§6.1` rendered as `design.md §6.1`
in a comment). TLS contract §11.2 verified in all four rows of the table, **including the
negative control**: valid pair → `[HTTP] Server running at https://127.0.0.1:3100`, HTTPS
`200`; plaintext `curl http://…:3100` → `curl exit=52` (no plaintext listener). An encrypted
key with the correct `TLS_KEY_PASSPHRASE` also serves (`status=200`). **In no
misconfiguration did a plaintext listener appear.**

Credentials: hash is `scrypt$16384$8$1$…$…`, 6 parts, matching §6.2. `verifyPassword` returns
`true` for the right password and `false` — never throws — for a wrong password, a superseded
password, `'garbage'`, a bcrypt-shaped string and `''`. `INSERT … id=2` → `CHECK constraint
failed: id = 1`. Upsert preserves `created_at` and moves `updated_at`.

CLI, both paths: TTY-less (piped) sets the password and skips confirmation; a real pty prompts
`Password: ` / `Confirm password: ` with **no echo of the typed characters**, sets on match
(exit 0) and prints `Passwords do not match.` on mismatch (exit 1). All five §6.3 validation
messages exact. `--password hunter2hunter2` is refused, not read.

## Findings

None blocking.

**F1 (non-blocking, documentation).** `T-004` acceptance criterion 1 asserts that an empty
scratch dir with no env produces "exactly the three `[Config]` lines of design §12.2". It does
not, and cannot, given §7.3's frozen step order:

```
$ cd /tmp/.../empty && env -i PATH=$PATH HOME=$HOME node /home/guilherme/msfslogger/dist/index.js
[Config] Refusing to start: no TLS configured and BIND_HOST is 0.0.0.0, which is not loopback. …
[exit=1]   # ls -a afterwards: only . and ..  — DB genuinely not opened
```

The code is right and the plan's criterion is wrong; §12.2's "with `INGEST_TOKEN` unset and the
opt-out not set, startup fails with **this** message" is misleading for the default
`BIND_HOST`. **This matters for T-010:** README §20.1 must show the plaintext/TLS message as
the *first* thing an upgrading operator sees, then the ingest message, then the credential
message — three refusals in sequence, not one. Recommend a design amendment note in §12.2.
(The "fails before the database is opened" half of the criterion does hold.)

**F2 (non-blocking, `src/setPassword.ts:61-78`).** EOF (Ctrl-D) at the `Password: ` prompt on a
TTY makes the process **exit 0 having done nothing**, with no message — `rl.question`'s
callback never fires, the promise never settles, and Node exits cleanly when the loop drains.
Reproduction: drive the CLI on a pty and send `\x04` → output is `Password: `, `EXIT=0`,
`auth_user.username` unchanged. A wrapper script that trusts the exit code would believe a
password was set. Suggest an `rl.on('close')` that rejects when no answer was given.

**F3 (non-blocking, `tests/config.test.ts:12,183`).** The suite now shells out to `openssl`
via `execFileSync`. It was sanctioned by T-002's own criterion and it passes here (OpenSSL
3.0.13), but it makes `npm test` depend on an external binary, which `.claude/ENVIRONMENT.md`
and CLAUDE.md both describe as hermetic. Consider a checked-in fixture pair, or `it.skipIf`
when `openssl` is absent.

**F4 (non-blocking, `src/index.ts:73-76` vs design §11.1).** §11.1 says the TLS files are
"read once at startup"; they are in fact read twice — `loadConfig()` reads and validates them,
then `index.ts` re-reads with `fs.readFileSync` for `https.createServer`. Harmless today, but a
file deleted between the two reads throws an unhandled `ENOENT` past the `ConfigError`
handler, i.e. a stack trace instead of the §7.3 message. Cheapest fix is to carry the buffers
on `TlsConfig`.

## Risks to track

- **R1.** `dist/` now contains phase-1 code while the feature is half-landed. The user's
  running server (pid 743686) still holds the old build, but **their next restart will hit the
  §7.3 step-3 refusal** — no `INGEST_TOKEN`, no operator account, `BIND_HOST` unset. This is
  the run's intended breaking change arriving early. Worth telling the user before phase 3.
- **R2.** `npm audit --omit=dev`: 8 vulnerabilities (2 moderate, 6 high) across
  `puppeteer`/`multer`/`qs`/`body-parser`/`js-yaml`/`extract-zip`. **All pre-existing** —
  `express-session@1.19.0`'s tree (`cookie@0.7.2`, `on-headers@1.1.0`, `cookie-signature`,
  `uid-safe`, `depd`, `parseurl`, `safe-buffer`, `debug`) contributes none of them.
  `better-sqlite3@9.6.0` loads and its version is unchanged; no existing `"version"` line was
  removed from `package-lock.json`.
- **R3.** Password changes do not invalidate live sessions (§6.5, §21 R6) — by design, but the
  README troubleshooting section owes it a mention (T-010).
