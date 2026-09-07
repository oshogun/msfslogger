# T-005 — Phase 1 review (T-002, T-003, T-004)

**Overall verdict: `approve`.**

Per-task: **T-002 `approve`**, **T-003 `approve`**, **T-004 `approve`**.

Zero blocking findings. Nine non-blocking follow-ups (§7), none of which sends a
task back. Everything the three tasks claimed was re-executed here on my own
scratch copies and my own ports; the three arms T-004 listed as **UNVERIFIED**
are now verified (§4.4) by a technique T-004's `allowed_paths` did not permit it
to use.

**Independently verified: 20 of the 20 acceptance criteria** across the three
tasks (T-002: 6/6, T-003: 8/8, T-004: 6/6). None was taken on report. Two
criteria are marked *verified with a caveat* rather than plain pass — T-002's
criterion 1 (§7 N-2, the design's own grep wording is unsatisfiable) and T-003's
criterion 6 (the db-layer refusal set is narrower than the endpoint's, which is
what design.md §4.3 froze). Neither is a defect in the code.

Everything below marked **[executed]** was run by me and the output is quoted
verbatim. Claims marked **[read]** come from reading code or a diff and are
labelled as such.

**Live database — read this carefully, the md5 moved and it was not this
review.**

```
md5sum flights.db   (start of review, 18:24)  717061074332a3a9cd4f190345dd5a58
md5sum flights.db   (end of review,   18:40)  e6959a7a85e0f2fc97fea90a20586954
```

**The user started flying at 18:29, in the middle of this review, and their own
server wrote to the file.** `GET localhost:3000/api/status` returns
`{"connected":true,"flightState":"FLYING","currentFlightId":57,…"plannedLeg":{"plannedLegId":13,…}}`
and the live database now holds a flight 57 that did not exist when I took my
copies. The file grew 4,304,896 → 4,579,328 bytes when SQLite auto-checkpointed
the WAL (4.1 MB) back into it. Every byte of the delta is the user's sim
session **[executed]**:

```
flight 57: { id: 57, start_time: '2026-09-07T18:29:21.787Z', end_time: null,
             planned_leg_id: 13, planned_leg_link_source: 'auto' }
flight_points for 57: { c: 127, last: '2026-09-07T18:40:54.775Z' }
flights added since the review started: [ { id: 57, start_time: '2026-09-07T18:29:21.787Z' } ]
```

**Proof that no write of mine reached it** — the three things that would be true
if any had, and are not **[executed]**:

```
review fixture flights present in the LIVE db: 0      # ids 900+ / aircraft='REVIEW-FIXTURE'
review fixture legs present in the LIVE db:   0       # ids 100+
legs by status: [ { status: 'flown', c: 7 }, { status: 'planned', c: 2 } ]
leg 12: { status: 'planned', arrival_deviation_nm: null }
leg 13: { status: 'planned', arrival_deviation_nm: null }
```

Leg 12 — the leg I marked `flown` a dozen times on my scratch copies — is still
`planned` with a NULL deviation in the live file, and none of my 8 fixture
flights or 8 fixture legs exists there. Every server I started ran with its cwd
inside
`/tmp/claude-1000/-home-guilherme-msfslogger/50558345-1929-4e55-a7a6-8c3bec61895a/scratchpad/rev/`,
so `src/db.ts:9`'s `path.join(process.cwd(),'flights.db')` and
`src/server.ts:107`'s static root both resolved inside the scratch tree and
could not name the live file; my only live-database access was
`new Database('flights.db', { readonly: true })`, which cannot write and cannot
checkpoint. The scratch copies were taken at 18:28, before flight 57's row was
committed, so nothing in this review is contaminated by the new data either.

**This matters for shipping, more than for the review.** design.md R-6's restart
window is live *right now*: restarting the user's server to pick up this
feature while flight 57 is in the air would lose the in-memory flight. The
Orchestrator should wait for the flight to end. Flight 57 is also, incidentally,
a live instance of §1.3 row 13 (`auto` + in air + `planned`) — the gate refuses
it in both directions, verified with a fixture in §4.2.

---

## 1. Processes and ports

| Step | Port | cwd | PID | Stopped |
|---|---|---|---|---|
| working-tree server | 3210 | `…/scratchpad/rev/work` | 487341 | yes, SIGTERM then SIGKILL |
| `git archive HEAD` server | 3211 | `…/scratchpad/rev/base` | 487343 | yes, SIGTERM then SIGKILL |
| duplicate-link probe | 3212 | `…/scratchpad/rev/race` | — | never listened (crashed at `initDb()`, §4.4) |
| arm harness ×3 | 3213 | `…/scratchpad/rev/arms` | 488803 / 488815 / 488826 | yes, each killed after its request |
| post-write-throw harness | 3214 | `…/scratchpad/rev/arms` | 489195 | yes |

Final state **[executed]**:

```
$ ss -ltn | grep -E '3210|3211|3212|3213|3214' || echo "ALL SCRATCH PORTS CLEAR"
ALL SCRATCH PORTS CLEAR

$ pgrep -af "dist/index.js"
458301 node dist/index.js          # the user's server; cwd=/home/guilherme/msfslogger — untouched

$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/status
200
```

The user's server was never stopped, restarted or rebuilt over. `dist/*.js` in
the repo still carries its Sep 6 13:48 mtimes — I built with
`npx tsc -p tsconfig.json --outDir <scratch>/dist`, never `npm run build`.

---

## 2. Scope — every changed file inside an allowed path

**[executed]**

```
$ git status --porcelain
 M .claude/runs/2026-09-04-lnmpln-trip-planner/design.md
 M src/db.ts
 M src/server.ts
?? .claude/ENVIRONMENT.md
?? .claude/agents/
?? .claude/runs/2026-09-07-manual-mark-flown/
?? .claude/runs/README.md
?? CLAUDE.md
?? src/inspect-manual-mark.ts
?? src/plannedLegClose.ts
```

- `src/plannedLegClose.ts`, `src/inspect-manual-mark.ts` — T-002's two paths.
- `src/db.ts` — T-003's path.
- `src/server.ts` — T-004's path.
- `.claude/runs/2026-09-04-lnmpln-trip-planner/design.md` — Amendment D, written
  by **T-001** (the design task), not by any task under review; the workflow
  explicitly calls for amending a prior design in place. Out of scope here,
  noted so the next reviewer does not read it as a phase-1 leak.
- Everything else is workflow scaffolding that pre-dates the run.

Not one file under `client/`, `README.md`, `src/types.ts`, `src/flightManager.ts`,
`src/legMatcher.ts` or `src/geo.ts` is modified — M-9 and M-10 hold **[executed]**
(`git status --porcelain src/ client/ README.md` lists only the four files above).

---

## 3. Must-not-change list, one by one

| Item | Verdict | Evidence |
|---|---|---|
| **M-1** `planned_legs` DDL + `ALTER TABLE` block unchanged | **holds [executed]** | `awk '/CREATE TABLE IF NOT EXISTS planned_legs/,/^    \)/'` over `git show HEAD:src/db.ts` and over the working tree both md5 `3671ba24865482e17c1e8069071277a6`; `grep -c "ALTER TABLE"` = 12 on both |
| **M-2** `setPlannedLegStatus()`, `PlannedLegHasLinkedFlightError` unchanged | **holds [executed]** | function-body diff HEAD↔tree: `setPlannedLegStatus` IDENTICAL (19 lines, md5 `1e72b11f73cb`), `PlannedLegHasLinkedFlightError` IDENTICAL (6 lines, md5 `9db4c6b7332c`) |
| **M-3** `recordPlannedLegArrival()`, `unlinkFlightFromPlannedLeg()`, `clearPlannedLegLink()`, `linkFlightToPlannedLeg()` unchanged; reverse must not unlink | **holds [executed]** | all four IDENTICAL (5 / 23 / 20 / 44 lines). Reverse-does-not-unlink proved twice: HTTP (§4.2 case b) and a whole-table comparison (§4.6) |
| **M-4** `app.patch('/api/planned-legs/:legId')` unchanged + its four behaviours | **holds [executed]** | handler text md5 `733fb364c750fe07b611a3c13fe8954d` on HEAD and on the tree; twelve differential requests byte-identical against a `git archive HEAD` server (§4.5) |
| **M-5** pure module imports only `./geo`; no `ARRIVAL_RADIUS_NM`; `db.ts` does not import it | **holds in substance [executed]**, see §7 N-2 | `grep -nE "^import\|require\("` → one line, `import { haversineNm } from './geo';`. `ARRIVAL_RADIUS_NM` appears twice and `'diverted'` four times, **all in comments or in the status union type §6.2 itself mandates** — no code reference. `grep -n plannedLegClose src/db.ts` → two comment mentions, no import |
| **M-6** rounding character-identical to `flightManager.ts:463` | **holds [executed]** | `src/plannedLegClose.ts:174-178` is `Math.round(haversineNm(…) * 10) / 10`; `src/flightManager.ts:463` is `Math.round(deviationNm * 10) / 10`. Behaviourally pinned by the inspector's x.x5 boundary row and by mutation M3 (§4.1) |
| **M-7** `updateFlight()` allowlist still `['aircraft','notes']` | **holds [executed]** | `src/db.ts:351` — `const allowed = ['aircraft', 'notes'] as const;`, inside a function whose diff is empty |
| **M-8** nothing writes `planned_legs.destination_lat/lon` after import | **holds [read]** | the run's diff adds exactly one UPDATE, `SET status = ?, arrival_deviation_nm = ?` (`src/db.ts:1382-1384`); no other write appears in the diff |
| **M-9** `flightManager.ts`, `legMatcher.ts`, `geo.ts` unmodified | **holds [executed]** | `git status --porcelain src/` |
| **M-10** `types.ts`, `client/src/types.ts`, `PlannedLegRows.tsx`, `TripDetail.tsx` unmodified | **holds [executed]** | same command; `client/` is entirely clean |
| **M-11** no reachable undefined leg state | **holds [executed]**, reasoning in §6 | statuses actually written by the new endpoint across my whole matrix: `flown` and `planned`, nothing else (§4.6) |
| **M-12** existing planned-leg behaviour untouched | **holds [executed]** | eighteen differential requests, including `GET /api/flights`, `GET /api/trips/1` (11.4 MB body), `GET /api/status`, `PUT /api/flights/56/planned-leg` — all byte-identical HEAD↔tree (§4.5) |
| **M-13** live DB never written by this review; port-3000 server never touched | **holds [executed]** | the md5 moved, and the header section proves the delta is the user's own flight 57 and nothing of mine: 0 fixture rows, leg 12 still `planned`/NULL. `pgrep` shows PID 458301 still up and answering 200; repo `dist/` mtimes unchanged |

`src/db.ts` is a **strict append** — the strongest form of M-1/M-2/M-3
**[executed]**:

```
$ git show HEAD:src/db.ts > /tmp/…/db.HEAD.ts
$ head -n 1322 src/db.ts > /tmp/…/db.work.head1322.ts
$ diff /tmp/…/db.HEAD.ts /tmp/…/db.work.head1322.ts && echo IDENTICAL
IDENTICAL          # HEAD is exactly 1322 lines; everything new is after it
```

`src/server.ts` is `54` added lines and `1` changed line (`git diff --numstat`);
the changed line is the `./db` import list. **[executed]**

---

## 4. Acceptance criteria, re-executed

### 4.1 T-002 — the pure module and its inspector

**Criterion 1 — signatures and imports.** **holds [executed]**. The seven
exports of `src/plannedLegClose.ts` are name-for-name and order-for-order the
seven of `contracts/plannedLegClose.d.ts`; both function signatures are textually
identical to the contract, parameter types included. `grep -nE "from '\./(db|server|flightManager)'" src/plannedLegClose.ts`
prints nothing; the only import line is `import { haversineNm } from './geo';`.

**Criterion 2 — `npx tsc --noEmit`.** **holds [executed]**:

```
$ export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20; node -v; npx tsc --noEmit; echo "TSC EXIT=$?"
v20.20.2
TSC EXIT=0
```

**Criterion 3 — the inspector.** **holds [executed]**. `npx ts-node
src/inspect-manual-mark.ts` exits 0 and prints 24 gate rows (48 verdicts) + the
two §1.5 cases + the six named rows + the rounding-boundary row, last line:

```
24 gate rows (48 verdicts) + 2 outside-the-grid cases + 6 named rows + 1 rounding-boundary row, 0 failures
INSPECTOR EXIT=0
```

**Row-by-row coverage of design.md §1.3 — the criterion this review exists for.**
I did not eyeball it. I parsed the 24-row markdown table out of `design.md` and
the `GATE_TABLE` literal out of `src/inspect-manual-mark.ts` and compared the
tuples `(link_source, flight, leg.status, →flown verdict, →planned verdict)`
**[executed]**:

```
design rows parsed: 24 inspector rows parsed: 24
mismatches: 0
```

Every §1.3 row has an inspector row, in both directions, with the design's own
refusal code. No gate-table row is missing.

**Is the expected column transcribed or derived?** Derived-from-implementation
was the named risk. Two checks:

1. **[read]** `GATE_TABLE` is a literal array of `ALLOW` / `refuse('CODE')`
   values; `decideHandClose` is called only to produce the *actual* column.
2. **[executed] mutation test.** I copied `plannedLegClose.ts`, `geo.ts` and the
   inspector into a scratch tree (`…/scratchpad/rev/mut/src/`) — **the real
   `src/` file was never edited; `diff` at the end confirmed it byte-identical**
   — and mutated the copy five times, running the inspector against each:

   | # | Mutation | Inspector |
   |---|---|---|
   | M0 | none (control) | **EXIT=0**, 0 failures |
   | M1 | swap refusal order: `end_time` checked before `link_source` | **EXIT=1, 8 failures** |
   | M2 | allow `diverted → flown` | **EXIT=1, 1 failure** |
   | M3 | `Math.round(x*10)/10` → `Number(x.toFixed(1))` | **EXIT=1, 1 failure** |
   | M4 | NULL arrival returns `0` instead of `null` | **EXIT=1, 1 failure** |
   | M5 | allow `skipped → planned` | **EXIT=1, 1 failure** |

   Five out of five killed. The inspector is a genuine oracle, not a mirror.

**Criterion 4 — the six named rows.** **holds [executed]**, all six present,
labelled (a)–(f) and passing: (a) `ALLOW, deviationNm 0.3, status 'flown'` on
flight 56/leg 12's real coordinates; (b) `409 LINK_NOT_MANUAL`; (c)
`409 FLIGHT_NOT_ENDED`; (d) `ALLOW, deviationNm null, status 'flown'`; (e)
antimeridian `ALLOW, deviationNm 120.1` (2° of longitude, not 358°); (f) far
diversion `ALLOW, deviationNm 124.8, status 'flown'` — never `'diverted'`.

**Criterion 5 — the rounding boundary.** **holds [executed]**:

```
   raw distance (double)        : 0.15
   Math.round(raw*10)/10        : 0.2  <- design.md §3.2, src/flightManager.ts:463
   Number(raw.toFixed(1))       : 0.1  <- NOT used; shown to prove the two disagree here
   handCloseDeviationNm() actual : 0.2
```

The two roundings genuinely disagree at this input, and the module takes the
frozen branch. Mutation M3 confirms the row is load-bearing.

**Criterion 6 — no leak into other files.** **holds [executed]**, §2.

### 4.2 T-004 — the curl matrix, cases (a)–(f), re-run on my own server

Port **3210**, cwd `…/scratchpad/rev/work`, working-tree build, against my own
seeded copy of the database. Every line below is my output **[executed]**.

| Case | Request | Observed |
|---|---|---|
| (a) | `PUT /api/flights/56/planned-leg-status {"status":"flown"}` | `200` — `leg id=12 status=flown arrival_deviation_nm=0.3` |
| (a2) | same again | `409 {"error":"Planned leg 12 is 'flown', not 'planned': only a planned leg can be marked flown by hand"}` |
| (b) | `{"status":"planned"}` | `200` — `leg id=12 status=planned arrival_deviation_nm=null` |
| (b2) | `{"status":"flown"}` again | `200` — `arrival_deviation_nm=0.3` — **round trip 0.3 → null → 0.3** |
| (b3) | `GET /api/flights/56` after the reverse | `planned_leg_id: 12, planned_leg_link_source: 'manual', trip_id: 1, end_time: '2026-09-07T17:06:00.726Z'` — **the reverse does not unlink** (frozen decision 3) |
| (c) | flight 48 (`auto`), both directions | `409 {"error":"Flight 48 was not linked to its planned leg by hand: only a hand-linked flight's leg can be closed by hand"}` |
| (d) | flight 913 (`manual`, `end_time` NULL), both directions | `409 {"error":"Flight 913 has not ended: its planned leg is closed at touchdown"}` |
| (e) | flight 902 (no `planned_leg_id`), both directions | `409 {"error":"Flight 902 is not linked to a planned leg"}` |
| (f) | flight 9999 | `404 {"error":"Flight not found"}` |
| (f) | `PUT /api/flights/abc/planned-leg-status` | `400 {"error":"Invalid id"}` |
| (f) | `{"status":"diverted"}` / `{"status":"skipped"}` / `{"status":null}` / `{"status":1}` / `{"status":["flown"]}` / `{}` / no body / `[]` / `text/plain` / form-encoded | `400 {"error":"status must be 'flown' or 'planned'"}` — all ten |

Every status code and every message string matches design.md §5.3 character for
character.

**§1.3 rows the live data cannot reach, driven over HTTP against my own
fixtures** (seeded identically into both scratch databases — my own seed script,
`…/scratchpad/rev/seed.js`, not T-004's) **[executed]**:

| §1.3 row | Fixture | `→flown` | `→planned` |
|---|---|---|---|
| 3 manual/ended/**diverted** | flight 911 → leg 101 | `409 Planned leg 101 is 'diverted', not 'planned': …` | `409 … not 'flown': …` |
| 4 manual/ended/**skipped** | flight 912 → leg 102 | `409 Planned leg 102 is 'skipped', not 'planned': …` | `409 … not 'flown': …` |
| 5 manual/**in air**/planned | flight 913 → leg 103 | `409 FLIGHT_NOT_ENDED` text | same |
| 9 **auto**/ended/planned | flight 914 → leg 104 | `409 LINK_NOT_MANUAL` text | — |
| 13 auto/in air/planned | flight 918 → leg 108 | `409 LINK_NOT_MANUAL` text | — |
| 17 **link_source NULL**/ended/planned | flight 915 → leg 105 | `409 LINK_NOT_MANUAL` text | same |
| 2 manual/ended/flown (reverse ALLOW) | flight 917 → leg 107 | `409 LEG_NOT_PLANNED` | `200 leg 107 status=planned dev=null` |
| §3.3 NULL arrival position | flight 916 → leg 106 | `200 leg 106 status=flown dev=null` | `200 … status=planned dev=null` |
| §1.5 case 2, `planned_leg_id=999`, leg row gone | flight 901 | `404 {"error":"Planned leg not found"}` | `404 {"error":"Planned leg not found"}` |

**The `diverted` leg and the `skipped` leg are refused in both directions over
HTTP, and the `auto` link and the in-air flight are refused in both
directions.** There is no request in this matrix that reaches `flown` or
`planned` on a leg §1.3 refuses.

### 4.3 Route shadowing and registration order

**[executed]**, and **[read]** for the ordering:

```
src/server.ts:629   app.put('/api/flights/:id/planned-leg', …)
src/server.ts:675   app.put('/api/flights/:id/planned-leg-status', …)   ← new
src/server.ts:719   app.get('/api/flights/:id/export.pdf', …)
src/server.ts:761   app.get('*', …)                                     ← SPA catch-all
```

Registered exactly where §5.5 says, inside the link block, 86 lines before the
catch-all. To make shadowing visible I put a marked `index.html` in the scratch
`client/dist`:

| Request | Result |
|---|---|
| `PUT …/56/planned-leg-status` | JSON from the new handler |
| `GET …/56/planned-leg-status` | `200 <!doctype html><title>SPA-CATCHALL-MARKER</title>` — the catch-all, GET-only, as §5.5 predicts |
| `POST` / `PATCH` the same path | `404 Cannot POST/PATCH …` — Express default, no route claimed |
| `PUT /api/flights/56/planned-leg` (the neighbour) | `200` + the flight row, byte-identical to the HEAD server |
| same PUT against the HEAD server on 3211 | `404 Cannot PUT /api/flights/56/planned-leg-status` — proof the route is genuinely new |

The new literal segment shadows nothing and is shadowed by nothing.

### 4.4 The three arms T-004 listed as UNVERIFIED — now verified

T-004 is right that no `curl` can reach them: the handler is **fully
synchronous** (`src/server.ts:675-717`, no `await` anywhere between the gate's
read and the writer's UPDATE), so in a single Node process no concurrent request
can interleave into the §4.3 window. I first tried to force it with persistent
state — dropping `idx_flights_planned_leg` and pointing a second, `auto`-linked
flight at leg 12 — and the server **refused to start**, which is itself evidence
worth keeping **[executed]**:

```
SqliteError: UNIQUE constraint failed: flights.planned_leg_id
    at initDb (…/dist/db.js:310:8)
```

So instead I ran the **real compiled handler** and replaced only the writer on
the `db` module object (the compiled handler resolves
`db_1.setPlannedLegHandOutcome` at call time), harness at
`…/scratchpad/rev/arms/harness.js`. Nothing in `src/` was edited **[executed]**:

| Arm | Substituted writer | Observed |
|---|---|---|
| §5.3 row 10 | throws `PlannedLegHandCloseConflictError(12,'it has no linked flight')` | `409 {"error":"Planned leg 12 cannot be closed by hand: it has no linked flight"}` |
| §5.3 row 11 | returns `false` | `404 {"error":"Planned leg not found"}` |
| §5.3 row 12 | throws `new Error('boom from the writer')` | `500 {"error":"Error: boom from the writer"}` |

All three match §5.3 exactly. **Ruling on the Orchestrator's question:** those
arms are now exercised, so the question is moot — but even unexercised they
would not have been blocking, because each is three lines copied verbatim from
the two neighbouring handlers and the failure mode is a wrong status code on a
path that cannot be reached in-process.

**And the writer's own three throw arms, driven directly** against a private copy
(`…/scratchpad/rev/unit/`) **[executed]**:

```
leg 999 (row absent)          -> returned false
leg 13  (no linked flight)    -> threw PlannedLegHandCloseConflictError | Planned leg 13 cannot be closed by hand: it has no linked flight
leg 5   (auto-linked)         -> threw PlannedLegHandCloseConflictError | Planned leg 5 cannot be closed by hand: its flight was not linked by hand
leg 103 (flight still in air) -> threw PlannedLegHandCloseConflictError | Planned leg 103 cannot be closed by hand: its flight has not ended
leg 12  (qualifies)           -> returned true  {"id":12,"status":"flown","arrival_deviation_nm":0.3}
leg 12  (idempotent repeat)   -> returned true  {"id":12,"status":"flown","arrival_deviation_nm":0.3}
leg 12  (reverse)             -> returned true  {"id":12,"status":"planned","arrival_deviation_nm":null}
flight 56 link after the reverse: {"id":56,"planned_leg_id":12,"planned_leg_link_source":"manual","trip_id":1,"end_time":"2026-09-07T17:06:00.726Z"}
```

This is T-003's criterion 5 and criterion 6, reproduced independently: mark →
`flown`/0.3, reverse → `planned`/NULL, link and trip untouched in both steps,
and the db-layer refusals are exactly the three invariants §4.3 froze — not the
transition rule, which §4.3 explicitly places in `plannedLegClose.ts`.

**Ruling on the Orchestrator's third judgement call (T-003's deliberate
non-check of leg status).** That split is what design.md §4.3 froze, verbatim:
*"What the writer deliberately does not re-check is the leg's own current
status."* Confirmed correct **[read]**, and no forbidden transition can be
written through the composed path, because the endpoint is the only caller
(`grep -rn setPlannedLegHandOutcome src/ client/` → the import line and the one
call site at `src/server.ts:705`) and it calls the writer only after
`decision.allowed === true`. The residual is N-4 in §7.

### 4.5 The F-1 non-regression, differentially and from scratch

Base materialised with `git archive HEAD | tar -x -C …/basesrc` — **no branch
switch, no worktree, no stash** — built with `npx tsc -p tsconfig.json --outDir
…/base/dist`, run on **3211** against a copy of the *same seeded database*. The
two scratch databases were byte-identical before the first request
(`md5 1feae9a1fa5b2a1b9a9602b4c8ba22c7` both). Full-body `cmp`, not a prefix
**[executed]**:

```
IDENT  200  PATCH /api/planned-legs/13 {"status":"skipped"}     | body(2361 B)
IDENT  200  PATCH /api/planned-legs/13 {"status":"planned"}     | body(2361 B)
IDENT  400  PATCH /api/planned-legs/13 {"status":"flown"}       | {"error":"status must be 'planned' or 'skipped'"}
IDENT  400  PATCH /api/planned-legs/13 {"status":"diverted"}    | {"error":"status must be 'planned' or 'skipped'"}
IDENT  400  PATCH /api/planned-legs/13 {}                       | {"error":"status must be 'planned' or 'skipped'"}
IDENT  409  PATCH /api/planned-legs/12 {"status":"planned"}     | {"error":"Planned leg 12 cannot have its status changed: linked to flight 56"}
IDENT  409  PATCH /api/planned-legs/12 {"status":"skipped"}     | {"error":"Planned leg 12 cannot have its status changed: linked to flight 56"}
IDENT  409  PATCH /api/planned-legs/4  {"status":"planned"}     | {"error":"Planned leg 4 cannot have its status changed: linked to flight 47"}
IDENT  409  PATCH /api/planned-legs/10 {"status":"planned"}     | {"error":"Planned leg 10 cannot have its status changed: linked to flight 52"}
IDENT  409  PATCH /api/planned-legs/107 {"status":"planned"}    | {"error":"Planned leg 107 cannot have its status changed: linked to flight 917"}
IDENT  404  PATCH /api/planned-legs/9999 {"status":"planned"}   | {"error":"Not found"}
IDENT  400  PATCH /api/planned-legs/abc {"status":"planned"}    | {"error":"Invalid id"}
IDENT  200  GET   /api/flights/56                               | body(673055 B)
IDENT  200  GET   /api/trips/1                                  | body(11468547 B)
IDENT  200  GET   /api/flights                                  | body(33186 B)
IDENT  200  GET   /api/status                                   | body(153 B)
IDENT  200  PUT   /api/flights/56/planned-leg {"plannedLegId":12} | body(673055 B)
IDENT  200  GET   /api/planned-legs/12                          | body(2136 B)
```

Eighteen requests, eighteen byte-identical pairs. **Rows 8, 9 and 10 are the
ones that decide the question:** legs 4, 10 and 107 are precisely the
manual/ended/`flown` shape the new gate *admits*, and at the `PATCH` path they
still get F-1's 409, unchanged. The new capability exists only at the new path.
The 11.4 MB `GET /api/trips/1` pair is included because it is the widest payload
in the app and would surface any accidental change to leg serialisation.

### 4.6 Failure paths, malformed input, and what the endpoint actually writes

**[executed]** beyond the criteria:

- Malformed JSON (`{"status":`) → `400` with Express's HTML body-parser page,
  **identical on HEAD** for every other endpoint. Pre-existing, §7 N-8.
- `{"status":"flown","__proto__":{"x":1}}` → `200`, no prototype pollution
  (`JSON.parse` defines `__proto__` as an own property); leg state correct.
- `{"status":"flown'; DROP TABLE planned_legs;--"}` → `400`, and `planned_legs`
  still holds all 17 rows afterwards. Every statement in the new code is
  parameterised (`.run(status, deviationNm, legId)`), so the string never
  reaches SQL as text.
- `PUT /api/flights/..%2f..%2fetc/planned-leg-status` → `400 Invalid id`. No
  filesystem path is built from any request value on this route.
- `-1` → `404 Flight not found`; `56.9` and `56;DROP TABLE planned_legs` →
  treated as `56` by `parseInt`, exactly as HEAD does on every other `:id`
  route (§7 N-9).
- **Nothing on `flights` moves.** After the entire matrix above, I compared the
  whole `flights` table between the working-tree scratch DB and the HEAD scratch
  DB **[executed]**:

  ```
  flights rows: 52 52
  flights table differences after all the new endpoint traffic: 0
  ```

  Zero columns differ on any of 52 rows. The endpoint writes to `planned_legs`
  and nowhere else, which is design.md §7 and M-3, demonstrated rather than
  argued. The only `planned_legs` divergence between the two databases is leg
  107, my fabricated fixture — see §7 N-6.
- Statuses actually written by the endpoint across the whole session: **`flown`
  and `planned`, nothing else.** (Legs 101/102 read `diverted`/`skipped` in both
  databases because I seeded them that way; neither was written by the endpoint,
  and both were refused in both directions.)

### 4.7 The deviation, re-measured against the live database, read-only

The round-trip theorem of §2.2 is the whole justification for the no-migration
decision, so I re-ran the measurement myself rather than reading E1
**[executed]**, `new Database('flights.db', { readonly: true })` plus the
compiled `geo.js`:

```
flight  leg  src       status     stored  recomputed  verdict
47      4    manual    flown      0.4     0.4         EXACT MATCH
48      5    auto      flown      0.1     0.1         EXACT MATCH
49      6    auto      flown      0.1     0.1         EXACT MATCH
50      8    auto      flown      0.2     0.2         EXACT MATCH
51      9    auto      flown      0.4     0.4         EXACT MATCH
52      10   manual    flown      0.8     0.8         EXACT MATCH
53      11   auto      flown      0.2     0.2         EXACT MATCH
56      12   manual    planned    null    0.3         no stored value (would be 0.3)
57      13   auto      planned    null    null        no stored value (would be null)
mismatches: 0
```

`Object.is()` on the raw double *and* on the rounded value, 0 mismatches over
every linked pair in the live logbook — including the two `manual` ones the gate
admits. Row 9 is the user's in-progress flight 57, which did not exist when
T-001 measured; it recomputes to `null` (no arrival position yet), which is
consistent with §3.3 and does not disturb anything. **The theorem's premise
holds on today's live data**, and the endpoint's observed round trip
(0.3 → null → 0.3, §4.2 b2) is the theorem in action.

---

## 5. Design conformance

Read against the frozen contract line by line **[read]**, spot-checked by
execution where noted:

- **§1.1/§1.2 refusal order** — `src/plannedLegClose.ts:99-143` evaluates
  NOT_LINKED → LINK_NOT_MANUAL → FLIGHT_NOT_ENDED → LEG_NOT_PLANNED /
  LEG_NOT_FLOWN, in that order. Confirmed behaviourally: an `auto` link on an
  in-air flight (fixture 918) reports `LINK_NOT_MANUAL`, not `FLIGHT_NOT_ENDED`;
  and mutation M1 (reordering) fails 8 inspector rows.
- **§3.2 deviation expression, §3.3 NULL policy, §3.4 always-the-requested-status**
  — all three verified in code and over HTTP; `'diverted'` never appears as an
  output of any function this run adds.
- **§4.2 writer body** — the SELECT, the three invariant checks, the single
  `UPDATE planned_legs SET status = ?, arrival_deviation_nm = ? WHERE id = ?`,
  all inside one `db.transaction()`, `return result.changes > 0`. Matches the
  normative body shape statement for statement, including the error messages.
- **§5.1/§5.3 API surface** — method, path, body, `PlannedLegWithChildren`
  payload, and all twelve error rows verified (§4.2, §4.4).
- **§5.4 handler shape** — steps 1–6 in the frozen order, including status
  validation *before* the flight 404. One deliberate departure at step 7, ruled
  on in §7 N-1.
- **§5.5 registration** — verified (§4.3).
- **§5.6 the PATCH is untouched** — verified by md5 of the handler text and by
  twelve differential requests (§4.5).
- **§5.7 no `refreshPlannedLegForFlight()`** — correctly absent
  (`grep -n refreshPlannedLegForFlight src/server.ts` → only line 653, the old
  route). The argument holds: the gate demands `end_time IS NOT NULL`, and
  `currentFlightId` is cleared in the same synchronous block that writes
  `end_time`. Live check: flight 57 is `currentFlightId` **and** has
  `end_time NULL`, consistent with R-3 not having fired.
- **§6.1/§6.2/§6.3 module boundaries** — `plannedLegClose.ts` imports only
  `./geo`; `db.ts` does not import `plannedLegClose`; composition lives in the
  endpoint; no type file changed; exports match `contracts/` exactly.

**Style.** Both additions read like their neighbours: the same comment idiom
(section rule, design-section citations), the same `if (…) { res.status(n).json({ error }); return; }`
one-liner shape as the two adjacent handlers, the same `db.prepare(...).run(...)`
form and the same error-class pattern as `PlannedLegAlreadyLinkedError` /
`PlannedLegHasLinkedFlightError`. The new writer sits next to
`recordPlannedLegArrival()` as §6.3 requires. Nothing here reads as foreign.

---

## 6. The question T-005 must answer in its own words

**Can any sequence of calls to the new endpoint put a leg into a state prior
design §15's amended table does not define?** No.

Here is the enumeration, not the assertion. A leg's user-visible state in §15 is
the pair *(its `status`, whether a flight points at it)*, and after Amendment D
the named states are: **planned** (`planned`, unlinked), **skipped**
(`skipped`, unlinked), **linked** (`planned`, linked, flight still flying),
**unclosed** (`planned`, linked, flight ended), **flown** (`flown`, linked) and
**diverted** (`diverted`, linked).

1. *The endpoint never changes the second component.* It writes only
   `planned_legs`, never `flights` — demonstrated, not argued: after my entire
   matrix the `flights` table is identical in all 52 rows to the HEAD server's
   (§4.6). So a leg's linked-ness, its link source and its flight's `end_time`
   are the same after every call as before.
2. *The endpoint writes only two values into the first component.* `status` is
   `decision.status`, which `decideHandClose` sets to `requested`, which the
   handler has already narrowed to `'flown' | 'planned'` (`src/server.ts:691-694`)
   — the ten malformed-body probes in §4.2 all stop at that 400. Across every
   request I made, the only statuses written were `flown` and `planned`.
3. *It only ever writes on a leg whose flight is hand-linked and ended.* Both
   the gate and, independently, the writer's transaction demand it; the writer's
   demand is inside the same transaction as the UPDATE, so even a state change
   between the two would throw rather than write (§4.4, arm 1).

So the pre-state of any write is `manual + ended + status ∈ {planned, flown}` =
**unclosed** or **flown**, and the post-state is `manual + ended + status ∈
{planned, flown}` = **unclosed** or **flown**. Both are defined. `diverted` and
`skipped` legs are refused in both directions (verified over HTTP with fixtures
911 and 912), in-air flights are refused (913, 918), `auto` and NULL link
sources are refused (48, 914, 915, 918), and an unlinked flight is refused
(902). The reachable set is closed at two states. **M-11 holds.**

The one caveat is not about the endpoint: `setPlannedLegHandOutcome()` itself
would write any string a caller handed it if a caller bypassed TypeScript — I
proved that, N-4 — but its caller set is exactly one, and that caller cannot.

---

## 7. Non-blocking findings and follow-ups

None of these sends a task back. They are recorded for the Orchestrator to track.

**N-1 — `res.json()` moved inside the `try`, departing from §5.4 step 7.**
*Severity: non-blocking. `src/server.ts:709` (inside the `try` opened at `:703`).
Ruling: accept as implemented; the design should carry an amendment row.*
§5.4 is marked normative and puts step 7 outside the `try`. T-004's argument is
correct and I verified the consequence rather than accepting it: §5.4's
`catch → 500` arm does not return, so the literal transcription would send a 500
and then fall into `res.json(...)`, a double-send. I tested the implemented
shape's own worst case — the post-write `getPlannedLegById()` throwing — with a
harness that makes the *second* call throw **[executed]**:

```
HTTP 500 body: {"error":"Error: payload read blew up"}
--- server log:
listening                       # no ERR_HTTP_HEADERS_SENT, no crash
```

One clean response, server healthy, and the write (already committed) is
readable on the next request. Both neighbouring handlers are written this way.
The wire behaviour is identical to §5.4's intent for every reachable input.
Follow-up for the Designer: add a row to design.md's Amendments table recording
that §5.4 step 7 sits inside the `try`, so the next reviewer does not re-derive
this.

**N-2 — design.md §3.2's grep criterion is unsatisfiable as written.**
*Severity: non-blocking, and it is a documentation defect, not a code defect.*
§3.2 says *"A grep for [`ARRIVAL_RADIUS_NM`] in that file returning nothing is
part of the review (M-5)"*, and M-5 adds *"contains neither `ARRIVAL_RADIUS_NM`
nor the string `'diverted'`"*. Actual **[executed]**: `ARRIVAL_RADIUS_NM` appears
twice (`src/plannedLegClose.ts:15,20`) and `'diverted'` four times (`:15,20,24,63`).
Every one is a comment explaining that the constant must not be used — except
`:63`, which is `status: 'planned' | 'flown' | 'diverted' | 'skipped'`, the union
**§6.2 itself mandates verbatim**. So no file can satisfy §3.2's literal grep and
§6.2's signature at once. The substantive requirement — no import, no code
reference, `'diverted'` never an output — **holds**. Follow-up: reword M-5 to
"no code reference outside comments and the status union".

**N-3 — the pure module's `NOT_LINKED` fallback for §1.5 case 2 is a latent trap
for a future second caller.** *Severity: non-blocking. `src/plannedLegClose.ts:99`.*
`decideHandClose` collapses "no link" and "link points at a missing leg" into
`NOT_LINKED`, while §1.5 assigns the second a 404. **Ruled on:** the endpoint
does intercept it first, verified rather than assumed — fixture flight 901
(`planned_leg_id = 999`, leg row absent, inserted with `foreign_keys = OFF`
because the FK's `ON DELETE SET NULL` makes it otherwise unreachable) returns
`404 {"error":"Planned leg not found"}` in **both** directions **[executed]**.
So the design's contract is honoured on the wire today. It is a trap only for a
second caller that forgets the pre-check, which is the same exposure as N-4 and
is already documented in the module's own doc comment. If a second caller ever
appears, the cheap fix is a sixth refusal reason `LEG_MISSING`.

**N-4 — `setPlannedLegHandOutcome()` enforces the invariants but not the
transition rule, so a caller that bypasses TypeScript can write any status.**
*Severity: non-blocking; this is design.md R-5, accepted with eyes open.*
Demonstrated **[executed]** by calling the compiled JS directly:
`db.setPlannedLegHandOutcome(12, 'diverted', 9)` → the row becomes
`{"id":12,"status":"diverted","arrival_deviation_nm":9}`. Unreachable from the
app: the caller set is one (`src/server.ts:705`), the parameter type is
`'planned' | 'flown'`, and `npx tsc --noEmit` exits 0. Worth keeping in R-5 and
re-grepping whenever a caller is added.

**N-5 — the race the writer's re-check closes cannot occur inside one process.**
*Severity: non-blocking observation.* The handler is fully synchronous, so on a
single-threaded Node process no request can interleave into the window between
the gate's read and the UPDATE. The guard therefore protects against a *second
process* on the same database file (a scratch server, a `ts-node` inspector, a
future worker) rather than against concurrent HTTP. That still justifies it —
and it is exactly why no `curl` can exercise the 409 arm, which is why I used
module substitution (§4.4).

**N-6 — the round-trip theorem's precondition, stated so a future reader does
not over-read it.** *Severity: non-blocking.* The reverse restores the deviation
bit-for-bit **only when the stored value was itself computed from
`flights.arrival_lat/lon` and `planned_legs.destination_lat/lon`**. My fixture
leg 107 carried a hand-invented `0.7` against PAJN coordinates; reopening and
re-marking produced `0.3`, the true recomputed value — the endpoint corrected a
value that never matched the coordinates. That is not a defect (it cannot arise
from any writer in this codebase), and it is *not* a case of destroying a
non-recomputable number: it is the theorem's premise being false for a row I
fabricated. On the live database the premise holds for all 8 stored values,
verified in §4.7. This is design.md §2.3's falsifier list; nothing on it has
fired.

**N-7 — `getFlightById()` loads every `flight_points` row to read six columns.**
*Severity: non-blocking, performance only. `src/server.ts:697`.* The response for
flight 56 is 673 KB, and the gate needs six scalar fields. This is exactly what
§5.4 step 3 froze and what the neighbouring `PUT /api/flights/:id/planned-leg`
already does, so it is conformant and consistent — but a `getFlightRowById()`
without points would make this endpoint O(1) instead of O(points). Worth a note
only if the button ever feels slow.

**N-8 — malformed JSON returns Express's HTML error page, not `{"error": …}`.**
*Severity: non-blocking, pre-existing.* `-d '{"status":'` → `400` with an HTML
`SyntaxError` body. Identical on the HEAD server for every endpoint; the body
parser answers before any handler. Recorded so it is not read as new.

**N-9 — `parseInt` leniency on `:id`.** *Severity: non-blocking, pre-existing.*
`/api/flights/56.9/planned-leg-status` and
`/api/flights/56;DROP%20TABLE%20planned_legs/planned-leg-status` both resolve to
flight 56 (`parseInt('56.9')`, `parseInt('56;…')`). Every `:id` route in the
codebase behaves this way, on HEAD too, and it is not injectable — the value is
a JS number by the time it reaches a parameterised statement, and the table was
intact afterwards. Consistency, not security.

**Housekeeping.** `plan.json` T-005's acceptance criteria name
`reviews/phase1.md`; the request envelope names `reviews/phase-1.md`. This file
is at **`reviews/phase-1.md`**, per the envelope. Both are inside the review's
`allowed_paths`.

---

## 8. Scratch tree

Everything I created lives under
`/tmp/claude-1000/-home-guilherme-msfslogger/50558345-1929-4e55-a7a6-8c3bec61895a/scratchpad/rev/`
— two built server trees, two seeded database copies, a mutation sandbox, the
arm harnesses and my seed script. Nothing was written into the repository except
this file. No commit, no push, no branch change, no stash, no worktree.
