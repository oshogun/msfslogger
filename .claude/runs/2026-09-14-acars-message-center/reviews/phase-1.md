# Phase 1 gate — VERDICT: approve

Phase 2 (T-004, T-005 — the ACARS page) is gated on this verdict and is now
unblocked. All 10 of T-002's acceptance criteria verified independently; 0
unverifiable. 4 non-blocking follow-ups. The implementer's report was not read;
only its `risks` list, ruled on at the end.

Everything below was re-run by the Reviewer on its own copy of the database
(`cp flights.db flights.db-wal flights.db-shm` into the session scratchpad),
Node 20.20.2, scratch server on PORT=3100 in a scratch cwd.

## Live database

| | md5 `flights.db` |
|---|---|
| before review 15:35 | `f318d6642e3e0b206ccda51fa71b05a1` |
| after review 15:52 | `610d849b3d3e42a6fff58cca1804cc7b` |

**It changed, and not because of this run's code.** Evidence, not assertion:
`ls -l /proc/732594/fd` shows the user's live server holding fds 17/18/19 open
read-write on `flights.db`, `-wal` and `-shm`. With the Reviewer doing literally
nothing for 40 s, `flights.db-wal` changed md5 twice
(`068afbd…` → `4ad98c5…`) and its mtime advanced 15:48:44 → 15:49:25. The main
file's mtime moved at 15:42:26, when the only commands running were `tsc` and
`npm test`. No process of this review ever opened the live path read-write —
every `node`/`ts-node`/server invocation ran with cwd in the scratchpad, and
`src/db/connection.ts` freezes its path from `process.cwd()`. T-002's claim (b)
is substantiated. The must-not-change item 15 wording ("identical before and
after") is unachievable while the user's server runs; what is verifiable — that
no reviewed code and no agent wrote to it — holds.

Port 3000 untouched (pid 732594 still up, 3h22m). Scratch servers stopped by
recorded PID only (`kill 749407`, `749851`, `751581`); `ss -lnt` → port 3100
CLOSED. No `pkill` was used.

## T-002 acceptance criteria

| # | Criterion | Verdict | Deciding evidence |
|---|---|---|---|
| 1 | DDL in `applySchema`, no migration machinery, tail unchanged | **verified** | `git diff -U0 src/db/schema.ts` → a single hunk, `@@ -201,0 +202,62 @@`; placed after `idx_planned_alternates_leg` and before `-- The single operator account.` Built `dist/db/schema.js` block is **byte-identical to design § 2.1**; comments stripped, also identical to `contracts/acars_messages.sql`. |
| 2 | Idempotency on a copy, counts, live md5 | **verified** (md5 see above) | Two `initDb()` opens of my copy: `open #2 no error, table_info identical: true`; counts `{"flights":54,"trips":1,"planned_legs":20}` unchanged; indexes `idx_acars_messages_dedup(partial=1) | ..._leg(partial=0) | ..._flight(partial=0)`. |
| 3 | Tests, typecheck, build | **verified** | `npm test` → `Test Files 18 passed (18) / Tests 350 passed (350)`, incl. `tests/acars.test.ts (23 tests)`; `npx tsc --noEmit` → `tsc exit=0`; `npm run test:types` exit 0; `npm run build` → `build exit=0`. All nine groups design § 6.5 lists are present as `describe` blocks. |
| 4 | `src/acars.ts` pure | **verified** | `grep -n "^import\|require(" src/acars.ts` → one line: `9:import type { AcarsDirection, CannedAcarsMessage } from './types';` |
| 5 | Scratch-server thread + three canned sends | **verified** | Empty thread `{"flight_id":81,"planned_leg_id":29,"messages":[]}`; three POSTs → 201 with ids 1,2,3; list returns all three in frozen order. `GET /api/acars/canned-messages` compares **equal to `contracts/api/GET-canned-messages.200.json`**. |
| 6 | Every frozen rejection | **verified** | All 10 cases compared programmatically against `contracts/api/errors.json`: body and status match verbatim, including `401 {"error":"Authentication required"}`. Thread after the rejection sweep still held only the successfully-posted rows. |
| 7 | Auth gate and mount order | **verified** | No cookie → 401 on GET thread, POST send and GET canned-messages. `src/server.ts` mounts: flights 126, trips 132, settings 138, planned-legs 145, exports 150, **acars 157**, catch-all `app.get('*')` 160. `git status` shows nothing under `src/auth/`. |
| 8 | Restart persistence, stop by PID | **verified** | `kill 749407` → `[Shutdown] SIGTERM … [Shutdown] Clean.`, `-wal`/`-shm` gone (graceful checkpoint). Restart on 3100 → thread JSON **byte-identical** via `diff` (14 messages, ids 1–14, same timestamps, same order). |
| 9 | AC4 genericity, samples through the db module | **verified** — see ruling below | `npx ts-node src/inspect-acars.ts --db <scratch> --flight 81 --samples contracts/samples` → all 11 stored (ids 15–25), `table_info unchanged by every insert: true`. Leg-scoped rows 15–19 surface in flight 81's thread, proving § 1.5. |
| 10 | Nothing outside `allowed_paths` | **verified** | `git diff --stat -- . ':!.claude'` → only `src/db.ts`, `src/db/schema.ts`, `src/server.ts`, `src/types.ts`. New: `src/acars.ts`, `src/db/acarsMessages.ts`, `src/routes/acars.ts`, `src/inspect-acars.ts`, `tests/acars.test.ts`. No `client/` file, no existing test modified. `user_stories/*.md` are untracked inputs written 14:18–14:19, before `intake.md` (14:21). |

## Must-not-change list

1 single hunk ✓ · 2 `PRAGMA table_info` for all ten pre-existing tables compared
pristine-copy vs new-code-copy → `identical for all 10 existing tables: true` ✓ ·
3 counts `{"flights":54,"trips":1,"planned_legs":20,"flight_points":52746}` on
both ✓ · 4 mount order (above) ✓ · 5 auth gate untouched ✓ · 6 `PUT
/api/settings/simbrief` with `{"user_id":` still returns
`{"error":"Invalid request body","code":"INVALID_BODY"}` **and** a malformed body
to `/api/flights/combine` still gets express's default `text/html` page — the
widening is additive, T-002's claim (c) confirmed ✓ · 7 `GET /api/status` keys
unchanged, no ACARS key ✓ · 8 `src/db.ts` +1 line ✓ · 9 `flights.ts`,
`trips.ts`, `plannedLegs.ts`, `flightManager.ts`, `ingest.ts` unmodified ✓ ·
10–13 phase 2, N/A · 14 suite green, no test file edited ✓ · 15 above.

## Ruling on the design deviation (§ 4.2 `getFlightPlannedLegId`)

**Acceptable as resolved. No rework.** All three parts of T-002's account check
out: `src/db/plannedLegs.ts:452` already defines the function with identical
semantics, including the documented "NULL means no link, and it also means no
such flight" collapse (`:448-450`); `src/db.ts` still exports that one and no
second copy exists; the comment at `src/db/acarsMessages.ts:141-144` points at
it without citing a run artifact. The forcing constraint is real, not asserted —
a minimal two-module barrel reproduces it:
`error TS2308: Module './a' has already exported a member named
'getFlightPlannedLegId'.` A second copy would also make
`src/flightManager.ts:3`'s import from `./db` ambiguous. The frozen contract's
*intent* — that function callable from the barrel — is satisfied; verified live,
`inspect-acars.ts:141` calls `db.getFlightPlannedLegId(81)` and gets `29`.
Follow-up F3 records it in the design's Amendments table, which still says
"None yet".

## Genericity ruling (the part four later stories inherit)

**Yes — all four sibling stories can be built on this schema with no
`ALTER TABLE`, and I name no missing column.** Checked against the story files
themselves, not the design's summary of them: PDC AC2 "requesting twice returns
an identical clearance" and position-reports AC1 "exactly one message per OOOI
transition" are both database guarantees via `dedup_key` + the partial UNIQUE
index (namespaced `pdc:leg:29`, `oooi:81:OUT`, so the global index cannot
collide across features); both request/reply stories pair via `correlation_id`
(verified: sample 16→15, 19→18, 21→20); `oooi` stores in a `CHECK`-free `TEXT`
column; both pre-pushback stories write leg-scoped and surface in the flight's
thread; the message centre's own unread affordance has `read_at`. Structured
fields (squawk, fuel, lat/lon/ETA) all landed in `payload_json` with
`table_info` unchanged. One soft spot, not a missing column: the weather story's
cache window (its AC3) must find "the last `wx` reply for ICAO X" through
`json_extract(payload_json,'$.icao')`, unindexed — fine at this volume, and a
per-ICAO column would be the per-story commitment § 2.6 refuses.

## Failure paths and security (Reviewer-originated, all passing)

- Forgery: `{"canned_id":"wx-request","flight_id":999,"sent_at":"1999-…","read_at":"x","dedup_key":"evil","payload_json":"{}","label":"SPOOF"}` → 201 storing `flight_id:81`, server clock, `label:"WX REQUEST"`, all extras `null`. Nothing client-supplied reaches a column.
- Injection: `{"body":"WX REQUEST'); DROP TABLE acars_messages;--"}` → 400 `NOT_A_CANNED_MESSAGE`; table intact. All SQL is parameterised.
- 8 concurrent POSTs → 8 distinct ids, no `SQLITE_BUSY`, thread still totally ordered by `(sent_at, id)`.
- `-1`, array, string, `null`, empty and malformed bodies all handled per contract.
- `id=81.9` and `id=1%20OR%201=1` resolve via `parseInt` to 81 and 1 — the house idiom frozen in § 5.4 and shared with `src/routes/flights.ts:69-70`. Consistent, not a finding.
- No new or edited comment in the diff cites `.claude/runs/`, a run id, `design.md`, a `§`, `plan.json` or a task id (grepped across all nine files). The DDL comments were rewritten to drop the `§6`/`§4` and line-number citations the contract file carries — the right call.

## Non-blocking follow-ups

- **F1 — `canned_id: null` alongside `body` bypasses a frozen rejection.**
  `src/routes/acars.ts:71`. § 5.4 freezes "`canned_id` is not a string → 400
  `UNKNOWN_CANNED_MESSAGE`", but the guard is `!== undefined && !== null`, so an
  explicit null falls through to the `body` branch. Repro:
  `curl -b cookies -H 'Content-Type: application/json' -d '{"canned_id":null,"body":"WX REQUEST"}' :3100/api/flights/81/acars-messages`
  → `201` (stored id 4) where the contract says 400. Harmless — the stored row is
  still a canned downlink — so not blocking, but it is a divergence from a frozen
  table. `{"canned_id":42,"body":"WX REQUEST"}` correctly returns 400.
- **F2 — the 404 check is ~60× the cost of the work it guards.** `src/routes/acars.ts:36,58`
  uses `getFlightById()`, which materialises `FlightWithPoints`. Measured on the
  largest flight in the live copy (56, 2242 points): `getFlightById` 12.6 ms vs
  `listAcarsMessagesForFlight` 0.2 ms. Absolute cost is small today; when the
  position-report story starts writing on a cadence this is the line to change,
  to an existence probe or to `getFlightPlannedLegId()` (which already returns
  `null` for a missing flight and would serve both the 404 and the envelope).
  T-002's risk (a) confirmed with a number.
- **F3 — the Amendments table still reads "None yet"** while the shipped code
  deviates from § 4.2. One row recording the duplicate-export constraint would
  stop the next reader treating `src/db/acarsMessages.ts` as incomplete.
- **F4 — `contracts/acars_messages.sql` is now stale** against § 2.1 (comment
  text only; SQL is identical, verified). It still carries `§6`/`§4` and
  line-number citations that would be findings if pasted into `src/` verbatim.
  Either refresh it from § 2.1 or note that § 2.1 is the authority.
