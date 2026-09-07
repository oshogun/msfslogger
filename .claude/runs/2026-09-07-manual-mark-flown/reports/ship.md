# T-009 — Ship report

**Run:** `2026-09-07-manual-mark-flown`
**Role:** DevOps
**Date:** 2026-09-07, 19:11–19:20 UTC
**Verdict: SHIPPABLE** — with one required sequencing instruction (§8) and one
disclosure the Orchestrator must decide on (§7, N-1: two files changed after the
phase-2 review closed).

Scope was overridden by the Orchestrator: **no build was run in the project
tree.** `dist/` and `client/dist/` were not written. Everything was proved in a
scratch clone. §6 is the proof the user's tree is byte-for-byte untouched.

---

## 1. Safety envelope

The user was flying throughout (flight 57, airborne, live server on port 3000).

### 1.1 The user's server was never touched

```
$ pgrep -af 'dist/index.js'          # before, 19:11
458301 node dist/index.js
$ pgrep -af 'node dist/index.js'     # after, 19:19
458301
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/status   # after
200
```

Same PID, 458301, start to finish. Not stopped, not signalled, not
reconfigured. Mid-work it answered:

```
$ curl -s http://localhost:3000/api/status
{"connected":true,"flightState":"FLYING","currentFlightId":57,"paused":false,
 "aircraft":"Cessna 408 Skycourier N685SW",
 "frame":{"lat":59.089…,"lon":-138.736…,"altitudeFt":13744.79,…},
 "plannedLeg":{"plannedLegId":13,"tripId":1,"destinationIdent":"PANC",
               "nextWaypointIdent":"YESKA","remainingDistanceNm":359.3,…}}
```

### 1.2 The live database

```
$ md5sum flights.db      # before, 19:11
d6757e488c6596117c0eebca66c4b6fb  flights.db
$ md5sum flights.db      # after, 19:19
d6757e488c6596117c0eebca66c4b6fb  flights.db
```

**Identical.** The main file is unchanged because the database is in WAL mode —
the user's flight is appending to `flights.db-wal`, not to `flights.db`. The
user's writes are visible through it: `npm run backup` counted 38 507
`flight_points` at 19:11 and a read-only query at 19:19 counted 38 551. That
delta of 44 points is **the user's flight 57 recording. None of the change is
mine.**

The positive proof that nothing of mine reached the live file — these are exactly
the rows my endpoint test mutated on the copy:

```
$ node -e "…new Database('flights.db',{readonly:true})…"    # live, after all work
planned_legs:  id 5  status 'flown'    arrival_deviation_nm 0.1
               id 12 status 'planned'  arrival_deviation_nm null      ← untouched
flights:       id 48 leg 5  'auto'    ended 2026-09-05T17:58:20.680Z
               id 56 leg 12 'manual'  ended 2026-09-07T17:06:00.726Z
```

Leg 12 is still `planned` with a null deviation in the live database. On my copy
it went `planned → flown (0.3) → planned`. The live file never saw it.

### 1.3 Backup snapshot (step 1)

```
$ export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20; npm run backup
> msfslogger@1.0.0 backup
> ts-node src/backup.ts
database    4.4 MB  43 flights, 38507 points, 1 trips
flight plans 10.0 MB  23 file(s)
Backed up to /home/guilherme/msfslogger/backups/20260907-191127
```

**Snapshot name: `backups/20260907-191127`** — `flights.db` (4 579 328 B),
`flights.db-wal` (0 B), `flights.db-shm` (32 768 B), `flight_plans/`.
`backups/` is gitignored (`.gitignore:11`), so it does not enter `git status`.
This snapshot is what the scratch server ran against; the live file was never
opened for writing.

### 1.4 Ports

Only 3100 was bound by me, and only for four minutes.

```
$ ss -ltn | grep 3100         # after
(no output — port 3100 clear)
$ ss -ltn | grep ':3000'
LISTEN 0  511  *:3000  *:*     ← the user's, still there
```

---

## 2. The scratch clone (step 2)

`git stash`, `git worktree` and branch switches were **not** used; the user's
tree never moved. The clone is an `rsync` of the working tree with build
outputs, `node_modules`, the database and `flight_plans/` excluded, and
`node_modules` symlinked back so nothing was re-installed:

```
S=…/scratchpad/ship
rsync -a --exclude '.git/' --exclude 'node_modules/' --exclude 'client/node_modules/' \
         --exclude 'dist/'  --exclude 'client/dist/' --exclude 'backups/' \
         --exclude 'flights.db*' --exclude 'flight_plans/' --exclude '.claude/' \
         ./ "$S/"
ln -s /home/guilherme/msfslogger/node_modules        "$S/node_modules"
ln -s /home/guilherme/msfslogger/client/node_modules "$S/client/node_modules"
```

Fidelity check — every file this run changed, plus the build config, md5-matched
before the build **and again after it** (i.e. no late edits landed mid-task):

```
OK   src/db.ts                         613ef1f84fbd7694fb0dcbb728b2a41f
OK   src/server.ts                     47a8d22cd990b0adb9c536399c60631b
OK   src/types.ts                      acde58c2c3c8ae921557425049c722fb
OK   src/plannedLegClose.ts            6ba23782f6d42faa7cf4877065398ef9   (new, untracked)
OK   src/inspect-manual-mark.ts        bb005db98ff0d86b07e7957454d960e4   (new, untracked)
OK   client/src/types.ts               489cad34da576677ef3104f9933e0666
OK   client/src/pages/FlightDetail.tsx ac5ae63bbdbdc21a5dc4934edd06718e
OK   README.md                         ee7a65e61ff1b639d23bee2680b62681
OK   tsconfig.json / package.json / client/package.json / client/vite.config.ts
file counts: src 20 = 20,  client/src 29 = 29
```

Both new untracked files are present in the clone, so the build compiled the real
feature and not a truncated tree.

---

## 3. Clean build (step 3) — PASS, exit 0

```
$ export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
$ cd "$S" && node -v && npx tsc --version && npm run build
v20.20.2
Version 5.9.3

> msfslogger@1.0.0 build
> npm run build:client && npm run build:server

> msfslogger@1.0.0 build:client
> cd client && npm run build
> msfslogger-client@0.0.0 build
> tsc && vite build
vite v5.4.21 building for production...
transforming...
✓ 102 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.40 kB │ gzip:   0.27 kB
dist/assets/index-DURsPzUe.css   34.44 kB │ gzip:  10.87 kB
dist/assets/index-DIA3gNQd.js   389.18 kB │ gzip: 117.13 kB
✓ built in 1.97s

> msfslogger@1.0.0 build:server
> tsc

EXIT=0
```

**Both halves are silent.** The client half is `tsc && vite build` — the client
`tsc` emitted no diagnostic, so the React/TS side type-checks; the server `tsc`
emitted nothing, so the Express/better-sqlite3 side type-checks. Exit 0.

Server artifacts include the new module:

```
$ ls -la "$S/dist"
plannedLegClose.js        4 861      ← new
inspect-manual-mark.js   26 611      ← new
server.js                40 052      (repo's built copy is 36 764 — the delta is this run)
db.js                    56 608
index.js                  1 753
… 20 files total
```

**Re-run at the end of the task** (standing scope: re-build after any late
edits — there were none, this proves reproducibility): second `npm run build`,
`EXIT=0`, identical content-hashed bundle name `index-DIA3gNQd.js`. The build is
deterministic across runs.

---

## 4. The built artifact boots and answers (step 4) — PASS

Run with the scratch clone as cwd, holding the `20260907-191127` database copy
(so `path.join(process.cwd(),'flights.db')`, `src/db.ts:9`, opened the copy) and
the scratch `client/dist` (so `express.static(path.join(process.cwd(),'client','dist'))`,
`src/server.ts:107`, served the new bundle).

```
$ cd "$S" && PORT=3100 nohup node "$S/dist/index.js" > scratch-server.log 2>&1 &
SCRATCH_PID=509309
$ cat scratch-server.log
[DB] Database ready
[Airports] Loaded 29549 airports from cache
[Ingest] Waiting for agent data on /api/ingest
[HTTP] Server running at http://localhost:3100
```

`[DB] Database ready` — required log line present. `better-sqlite3` loaded under
Node 20 as expected.

### 4.1 Fixture state on the copy, before any request

```
flights:     48 → leg 5,  'auto',   ended, arrival 39.797/-121.858
             56 → leg 12, 'manual', ended, arrival 58.357/-134.586
             57 → leg 13, 'auto',   NOT ended, arrival null   (the live flight)
planned_legs: 5 → 'flown'   dev 0.1   dest KCIC 39.795383/-121.858414
             12 → 'planned' dev null  dest PAJN 58.354721/-134.578491
```

### 4.2 The request matrix, verbatim

| # | Request | Expected | Got |
|---|---|---|---|
| 1 | `GET /api/flights` | 200 | **HTTP 200, 28 401 bytes**, first row `{"id":57,…"end_time":null…}` |
| 2 | `GET /` | 200, scratch bundle | **HTTP 200**, references `index-DIA3gNQd.js` |
| 3 | `PUT /api/flights/56/planned-leg-status {"status":"flown"}` | 200, leg 12 flown, dev 0.3 | **HTTP 200 · id 12 · status 'flown' · arrival_deviation_nm 0.3** |
| 4 | `PUT /api/flights/48/planned-leg-status {"status":"flown"}` | 409 `LINK_NOT_MANUAL` | **HTTP 409** `{"error":"Flight 48 was not linked to its planned leg by hand: only a hand-linked flight's leg can be closed by hand"}` |

Rows 3 and 4 are the two cases the task named, and both match design.md §5.3 and
§8.5 exactly — including the deviation value `0.3`.

Four further checks I ran on the same server, all matching §5.3:

| # | Request | Got |
|---|---|---|
| 5 | `PUT /flights/56/planned-leg-status {"flown"}` again | **409** `Planned leg 12 is 'flown', not 'planned': only a planned leg can be marked flown by hand` |
| 6 | `PUT /flights/56/planned-leg-status {"planned"}` | **200** — full `PlannedLegWithChildren`, `"status":"planned"`, `"arrival_deviation_nm":null`, `"linked_flight_id":56`, 3 waypoints + 1 alternate |
| 7 | `PUT /flights/56/planned-leg-status {"skipped"}` | **400** `status must be 'flown' or 'planned'` |
| 8 | `PUT /flights/9999/planned-leg-status {"flown"}` | **404** `Flight not found` |
| 9 | `PUT /flights/57/planned-leg-status {"flown"}` (the live in-progress flight) | **409** `Flight 57 was not linked to its planned leg by hand: …` — correct: flight 57 is `auto`-linked, and §1.2 puts `LINK_NOT_MANUAL` ahead of `FLIGHT_NOT_ENDED` in the refusal order |
| 10 | `PATCH /api/planned-legs/12 {"status":"planned"}` | **409** `Planned leg 12 cannot have its status changed: linked to flight 56` — **F-1 unchanged**, the old leg endpoint still refuses every linked leg |

Row 6 is the round-trip: `planned → flown/0.3 → planned/null`. §2.2's lossless
reversal holds on the built artifact.
Row 10 is the regression guard: the new capability exists **only** at the new
path.

### 4.3 Shutdown

```
$ kill 509309
$ ss -ltn | grep 3100
(no output — port 3100 clear)
```

---

## 5. The client bundle contains the reviewed source (step 5) — PASS

Grepping the emitted, minified JS (`$S/client/dist/assets/index-DIA3gNQd.js`):

```
Mark flown             1 occurrence(s)
Back to planned        1 occurrence(s)
Marking…               1 occurrence(s)
Reopening…             1 occurrence(s)
planned-leg-status     1 occurrence(s)
Mark failed:           1 occurrence(s)
```

All four labels are exactly design.md §8.2, including the single-character `…`
(U+2026). The emitted call site:

```js
async function mt(ee){de(!0),J("");try{const ye=await oe(
  `/api/flights/${e}/planned-leg-status`,
  {method:"PUT",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({status:ee})});_e(ye)}catch(ye){J("Mark …
```

`PUT`, JSON body `{status}`, success calls the leg setter (`_e`, i.e.
`setPlannedLeg`) — not a reload — and the catch sets the `Mark failed: ` error.
That is §8.4 verbatim, minified.

**And the same grep against the bundle the user's browser is being served right
now** (`client/dist/assets/index-B-KIRG3H.js`):

```
Mark flown             0 occurrence(s)
Back to planned        0 occurrence(s)
planned-leg-status     0 occurrence(s)
```

Zero. The user cannot currently see the button. That is the state §8 must be
read against.

---

## 6. The project tree is untouched (step 6) — PASS

```
                                 BEFORE (19:11)                AFTER (19:19)
stat dist/index.js               2026-09-06 13:48:17.752891407  identical
stat dist/server.js              2026-09-06 13:48:17.750891405  identical
stat client/dist/index.html      2026-09-06 13:48:15.370888380  identical
find dist       … | md5sum       25bfc6dddd8a5e88c7f056d1c7d6e6db  identical
find client/dist… | md5sum       ab53c9a29c2b97ab8af37d24db0bc37d  identical
```

Not one byte, not one mtime. `npm run build`, `npm run build:client` and
`npm run build:server` were never run in `/home/guilherme/msfslogger`.

`git status --porcelain`, before and after, **character for character identical**:

```
 M .claude/runs/2026-09-04-lnmpln-trip-planner/design.md
 M README.md
 M client/src/pages/FlightDetail.tsx
 M client/src/types.ts
 M src/db.ts
 M src/server.ts
 M src/types.ts
?? .claude/ENVIRONMENT.md
?? .claude/agents/
?? .claude/runs/2026-09-07-manual-mark-flown/
?? .claude/runs/README.md
?? CLAUDE.md
?? src/inspect-manual-mark.ts
?? src/plannedLegClose.ts
```

I wrote exactly two things in the project tree: `backups/20260907-191127/`
(gitignored, via the supported `npm run backup`) and this report. No commit, no
push, no branch switch — `git rev-parse --abbrev-ref HEAD` is still `main` and
`git stash list` was never used.

---

## 7. Findings

### N-1 · **needs an Orchestrator decision** · two files changed 75 seconds after the phase-2 review closed

`git status` now lists `src/types.ts` and `client/src/types.ts` as modified.
The phase-2 review explicitly recorded them as **unchanged** (`reviews/phase-2.md`
§2: `git diff --stat client/src/types.ts src/types.ts … → (no output)`, cited as
proof of must-not-change **M-10**). Timestamps:

```
2026-09-07 19:07:53  reviews/phase-2.md        ← review written
2026-09-07 19:09:08  src/types.ts              ← changed AFTER
2026-09-07 19:09:08  client/src/types.ts       ← changed AFTER
```

The change is the fix for the review's own non-blocking finding **N-2** ("a doc
comment is now false"), and it is **comment-only** — the full diff of both files
is four lines inside a `/** */` block, with `export type PlannedLegStatus =
'planned' | 'flown' | 'diverted' | 'skipped';` byte-identical:

```diff
- * it, so the two facts cannot drift apart. 'flown' and 'diverted' are set by
- * the system only.
+ * it, so the two facts cannot drift apart. 'diverted' is set by the system
+ * only; 'flown' is set at touchdown, or by hand on a leg whose flight was
+ * linked manually and has already ended (2026-09-07 design.md §1).
```

It cannot change behaviour, it is included in the build I proved above, and it
makes the comment true. But it is formally **unreviewed work**, and M-10 named
these two files. I am not the one to approve it. **Recommendation: the
Orchestrator sends this two-file comment diff to the Reviewer as a trivial
round, or records it as a deliberate post-review N-2 fix in the run report.**
It does not affect the SHIPPABLE verdict.

### N-2 · non-blocking · the hand-close path is silent in the logs

My standing scope asks whether the app says enough to diagnose the new feature
in the field. It does not, quite:

```
$ git diff -U0 src/db.ts src/server.ts client/src/pages/FlightDetail.tsx | grep '^+.*console\.'
(none added)
$ cat scratch-server.log      # after all 10 requests above, including 2 successful writes
[DB] Database ready
[Airports] Loaded 29549 airports from cache
[Ingest] Waiting for agent data on /api/ingest
[HTTP] Server running at http://localhost:3100
```

Two legs were closed and reopened by hand and the log says nothing.

**This matches house style and is not a defect of this run.** `src/db.ts` has
zero `console.*` calls; `src/server.ts` has three, all for LNMPLN parse warnings
and PDF failures; and the sibling mutation `PUT /api/flights/:id/planned-leg`
(`src/server.ts:629-660`) logs nothing either. The new handler is consistent
with the endpoint it sits next to.

The asymmetry worth naming: the **automatic** version of this exact state
transition *is* logged —

```
src/flightManager.ts:465
  console.log(`[FlightManager] Flight #${flightId} landed ${deviationNm.toFixed(1)} nm from ` +
              `planned ${leg.destination_ident} — leg #${legId} marked ${status}`);
```

so a leg that reads `flown` with a deviation but has no `[FlightManager] … marked
flown` line in the log is, from the log's point of view, unexplained. A one-line
`console.log('[PlannedLeg] Flight #… leg #… marked … by hand (… nm)')` in the new
handler would close that. **It is outside my allowed_paths and outside the frozen
design, so I did not add it. Follow-up task.**

### N-3 · informational · Docker is not this deployment, and needs no change

```
$ docker ps
CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES
(empty)
$ cat /proc/458301/cgroup
0::/user.slice/user-1000.slice/session-3769.scope
```

The live server is a plain user process, not a container and not a systemd unit.
`docker-compose.yml` exists but nothing is running from it. **I did not build the
image**: it is not the shipping path here, the task did not ask for it, and
building would have added nothing to the verdict. Reading the `Dockerfile`: it
does `COPY src/ ./src/` and `COPY client/ ./client/` wholesale, so
`src/plannedLegClose.ts` is picked up with no Dockerfile edit needed. **Untested
this run** — recorded as a risk. The known Alpine limitation (PDF export needs
puppeteer's Chromium, which the image does not carry) is unchanged by this run.

### N-4 · informational · migration rehearsal was not applicable

design.md §4.1 is titled "No migration": this feature adds no column, no table
and no index. The rehearsal I would normally run has no subject. The equivalent
evidence is §4.2 above — the built server read the existing schema unmodified
and old rows (flights 48/56, legs 5/12, imported 2026-09-05 and 2026-09-07) read
back correctly, and the `planned_legs.status` CHECK constraint already permits
`'flown'`, so `setPlannedLegHandOutcome` writes a value the existing schema
accepts. Backup/restore round-trip: `backups/20260907-191127/flights.db` was
copied into the scratch cwd and opened successfully by the built server
(`[DB] Database ready`, `GET /api/flights` 200 with 43 flights) — that *is* the
restore path, exercised.

---

## 8. Going live — the exact instructions for the user

> **Do not run the build on its own, and do not do either step while you are
> flying.**
>
> The server serves the browser files straight off disk
> (`express.static(path.join(process.cwd(), 'client', 'dist'))`,
> `src/server.ts:107`), so **the moment `npm run build` finishes, the new
> "Mark flown" button appears in your browser — served by the server process you
> already have running, which does not have the endpoint behind that button.**
> The endpoint only exists in `dist/server.js`, and the running process loaded
> that file at startup on 6 September; it will not pick up the new one until it
> restarts. So between a bare build and a restart there is a window in which the
> button is visible and every click fails with a 404. Build and restart must
> therefore happen together, and **after your current flight has ended** — the
> Windows agent posts your position to `/api/ingest` continuously, and the
> ~30 seconds the server is down during a restart is ~30 seconds of track
> dropped from whatever flight is in the air.
>
> **Your setup:** the server is PID 458301, `node dist/index.js`, `PORT=3000`,
> cwd `/home/guilherme/msfslogger`, running under your own login session — not
> Docker (`docker ps` is empty) and not systemd. It was started by `./start.sh`
> in the foreground, in a VS Code integrated terminal, on 6 September at
> 13:48:08. `docker-compose.yml` exists but is not what is running, so ignore
> it.
>
> **What to run, once the aircraft is parked and the flight has been recorded —
> one command, from `/home/guilherme/msfslogger`:**
>
> ```bash
> ./start.sh -r
> ```
>
> That is the whole thing. `start.sh` stops the running instance **first**
> (line 47), *then* selects Node 20 via nvm, *then* rebuilds — its `needs_build`
> check finds `src/` and `client/src/` newer than `dist/index.js` and runs
> `npm run build` for you — *then* starts the server again. Because the stop
> happens before the build, the "button with no endpoint" window never opens:
> the app is simply unreachable for the half-minute the build takes, and comes
> back with the button and the endpoint together.
>
> If you would rather do it by hand, the equivalent is: go to the VS Code
> terminal where the server is running, press **Ctrl-C**, then run
> `./start.sh` there (it will rebuild automatically and run in the foreground
> again), or `./start.sh -d` to detach and log to `server.log`.
>
> **What not to do:** do not run `npm run build` first and restart later — that
> is the broken window. And do not run `./start.sh` (without `-r`) from a
> *second* terminal while the first is still serving: it builds first and only
> then notices port 3000 is taken, so it will exit with "port 3000 is already in
> use" having already published the button to your browser — the exact state
> you are trying to avoid.
>
> **After the restart**, open `/flight/56`. The leg badge reads `Planned`, the
> text reads `Linked by hand.`, and there is now a `Mark flown` button beside
> `Unlink`. Clicking it turns the badge to `Flown` and adds
> `flown, 0.3 nm from plan`; the button becomes `Back to planned` and clicking
> that puts it back exactly as it was. `/flight/48` is unchanged and shows no
> such button, because that flight was linked automatically.
>
> **Rollback**, if anything is wrong: `./start.sh -s` to stop, then
> `git checkout -- src/ client/src/ README.md && rm -f src/plannedLegClose.ts
> src/inspect-manual-mark.ts && ./start.sh -b`. Your data is untouched by this
> feature either way, and there is a snapshot at
> `backups/20260907-191127/` taken at 19:11 today.

---

## 9. Verdict

**SHIPPABLE.**

| Item | State |
|---|---|
| Clean build, Node 20, exit 0, both halves silent | **PASS** (§3, run twice) |
| `client/dist` + `dist/*.js` produced, include the new module | **PASS** (§3) |
| Built server boots, `[DB] Database ready` | **PASS** (§4) |
| `GET /api/flights` 200 | **PASS** (§4.2 row 1) |
| New endpoint 200 on flight 56 → leg 12 flown, deviation 0.3 | **PASS** (§4.2 row 3) |
| New endpoint 409 on flight 48 (auto-linked) | **PASS** (§4.2 row 4) |
| Round-trip lossless; F-1 (`PATCH /api/planned-legs`) unchanged | **PASS** (§4.2 rows 6, 10) |
| Client bundle contains the reviewed UI | **PASS** (§5) |
| Migration rehearsal | **N/A — no schema change** (§7 N-4); backup/restore exercised |
| Docs (`README.md`) | Approved in phase 2 (T-007); built into this artifact unchanged |
| Docker image | **NOT TESTED** — not the deployment in use (§7 N-3) |
| Observability of the new path | **Silent**, consistent with its sibling; follow-up (§7 N-2) |
| Live server untouched, PID 458301 | **PASS** (§1.1) |
| Live database untouched | **PASS** (§1.2) — md5 identical, leg 12 still `planned` |
| Project tree build outputs untouched | **PASS** (§6) — identical mtimes and hashes |
| Scratch ports released | **PASS** (§4.3) |

Outstanding for the Orchestrator: **N-1** — decide how to handle the two
comment-only `types.ts` edits that landed after the phase-2 review closed.

Scratch tree kept for the Reviewer at
`/tmp/claude-1000/-home-guilherme-msfslogger/50558345-1929-4e55-a7a6-8c3bec61895a/scratchpad/ship`
(built `dist/` and `client/dist/` intact; the database copies were deleted after
the run for data hygiene — re-stage from `backups/20260907-191127/`).

---

## Orchestrator amendment — 2026-09-07, after this report was written

This report is **superseded in three places** by a change made after DevOps
finished. It is kept as written (reports are append-mostly); the corrections
are here.

DevOps's finding N-2 said the hand-close path was silent in the logs and that
closing the gap was outside its allowed paths. The Orchestrator implemented it:
one `console.log` in the success arm of the new handler, recorded as
**Amendment C** in `design.md`, and reviewed at the ship gate
(`reviews/ship.md` §3) — the Orchestrator does not review its own work.

| Section here | Now reads | Corrected to |
|---|---|---|
| §2 | `src/server.ts` md5 `47a8d22c…` | `85295c9d79fa65e1b9bf5ee35bda0aca` |
| §7, N-2 | "the hand-close path is silent in the logs … I did not add it" | Added. Both directions reproduced verbatim at `reviews/ship.md` §3. |
| §9 | Observability \| Silent | Observability \| One line per hand-close and per reopen, matching `flightManager.ts:465`'s automatic twin. |

The build proof in §3–§5 covers the source **before** that change and is
superseded by `reviews/ship.md` §3, which rebuilt the current source in its own
scratch clone (`npm run build` EXIT=0, route string at `dist/server.js:791`,
all four button labels present in the emitted bundle).

**§8's go-live paragraph is unaffected and still stands**, including the
`./start.sh -r` remedy and the instruction to wait for flight 57 to land.
