# T-010 — Ship gate review

**Verdict: `approve`.**

**Blocking findings: 0.** Seven non-blocking follow-ups (§9), none of which sends
a task back. Three of them are *durable-record* fixes the Orchestrator should
make in the same commit as the code (§9 F-1, F-2, F-3) — they are documentation,
not behaviour.

**Independently verified: 5 of the 5 T-010 acceptance criteria** (as adjusted by
the Orchestrator's envelope — see §2), plus the three post-phase-2 changes A, B
and C, plus 12 of the 13 must-not-change items. Nothing below was taken from a
report: every command was run in this review and its real output is pasted.
Claims marked **[read]** come from reading code or a diff and are labelled.

**The headline result.** The three changes the Orchestrator made after
`reviews/phase-2.md` closed are correct, minimal, and behaviour-preserving where
they claim to be:

- **A** (`src/types.ts`, `client/src/types.ts`) is genuinely comment-only. Every
  non-comment byte of both files is identical to `HEAD`, the two comment blocks
  are byte-identical to each other, and the project's own mirror checker passes.
  The new wording is *substantially* true of the shipped gate; it omits one
  precondition (§4.1).
- **B** (`src/server.ts`) cannot throw on any branch I could construct, fires on
  both directions and on neither refusal nor error, leaks nothing, and matches
  the codebase's `[Tag] …` convention. Both log lines the Orchestrator reported
  were reproduced verbatim on my own scratch server (§4.2).
- **C** holds: `PATCH /api/planned-legs/:legId` is byte-identical to `HEAD`, and
  the rest of the new handler is byte-identical to the text phase-1 approved —
  exactly one line was replaced (§4.3).

---

## 1. Safety envelope — the user is still flying, and nothing of mine reached them

The user was airborne throughout (flight 57, live server PID 458301 on port
3000). **[executed]**

### 1.1 The live database was never written

```
$ md5sum flights.db          # start of review, 19:24
d6757e488c6596117c0eebca66c4b6fb  flights.db
$ md5sum flights.db          # end of review, 19:33
d6757e488c6596117c0eebca66c4b6fb  flights.db
```

Identical. The main file is quiet because the database is in WAL mode and the
user's flight appends to `flights.db-wal`; that file is theirs and I did not
touch it either. My only access to the live file was
`new Database('flights.db', { readonly: true })` and one `cp` of the three
`flights.db*` files into scratch.

Positive proof — the rows this review mutated **on its copy**, read back from the
live file at the end **[executed]**:

```
leg 12 : { id: 12, status: 'planned', arrival_deviation_nm: null }
leg 13 : { id: 13, status: 'planned', arrival_deviation_nm: null }
fixtures in live db: { c: 0 } { c: 0 }     # planned_legs id>=100, flights aircraft='REVIEW-FIXTURE'
```

**Live leg 12 reads `planned` with a NULL `arrival_deviation_nm`, as required.**
On my copy it went `planned → flown/0.3 → planned/null` four times. None of it
reached the live file, and none of my five synthetic fixture rows exists there.

### 1.2 The user's server was not touched

```
$ ps -p 458301 -o pid,etime,cmd     # start        $ ... end
 458301  1-05:33:49 node dist/index.js              458301  1-05:42:11 node dist/index.js
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/status   → 200
$ curl -s http://localhost:3000/api/status | head -c 160
{"connected":true,"flightState":"FLYING","currentFlightId":57,"paused":false,…}
```

Same PID, still flying, never signalled, never restarted, never rebuilt over.

### 1.3 No build ran in the project tree

`npm run build`, `npm run build:client` and `npm run build:server` were **not**
run in `/home/guilherme/msfslogger`. The tree's build outputs are byte-for-byte
and mtime-for-mtime identical before and after **[executed]**:

```
$ find dist client/dist -type f -printf '%T@ %s %p\n' | sort -k3 | md5sum
2495e6ac7d319fb45e4bec71e56a7484  -        # before, 19:24
2495e6ac7d319fb45e4bec71e56a7484  -        # after,  19:33
$ diff <(find dist client/dist -type f -printf '%T@ %s %p\n' | sort -k3) dist-before.txt
dist + client/dist IDENTICAL               # 21 files, every mtime unchanged
```

`git status --porcelain` is character-for-character what it was at the start of
this review (§8.1). I wrote exactly one file in the project tree: this review.

### 1.4 Ports and processes

My scratch server bound **3210** only, for nine minutes. At the end
**[executed]**:

```
$ ss -ltn | grep -E ':(3100|3210)'   →  3100/3210 clear
$ ss -ltn | grep ':3000'             →  LISTEN 0 511 *:3000 *:*   (the user's)
$ kill 513669; ps -p 513669          →  scratch server stopped
$ rm -rf …/scratchpad/rev-ship; ls -d …/rev-ship
ls: cannot access '…/rev-ship': No such file or directory
```

Scratch rig removed. One scratch tree that is **not mine** remains:
`…/scratchpad/ship`, left by DevOps. It holds a build of the **pre-change-B**
`src/server.ts` (md5 `47a8d22c…`; the tree now has `85295c9d…`), so it is stale
and superseded by §3. I left it where DevOps put it rather than delete another
agent's artifact.

---

## 2. The adjusted criteria, and the one that can no longer pass as written

`plan.json#T-010` criterion 1 has two clauses that this run's reality overtook,
and the Orchestrator's envelope adjusted both. Recording the adjustment
explicitly, because a later reader will otherwise find a criterion marked
"verified" that reads false:

| Clause as written in `plan.json` | Status | What I did instead |
|---|---|---|
| "the new route string appears in **`dist/server.js`** and the new button label appears in **the client bundle**" | **satisfied in intent** | Those artifacts do not exist in the project tree and must not be created while the user is flying (a build publishes the button to their browser with no endpoint behind it — `reports/ship.md` §8). I built the *current* source into a scratch clone and grepped the emitted output there. §3. |
| "**no source file changed after T-008's approval**" | **false as written, and known** | Three files changed after `reviews/phase-2.md` closed. That is the work I was convened to review, not a criterion to fail on. §4, with the full timeline in §8.1. |

Everything else in T-010 is verified as written. Per-criterion:

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Verdict at top; built artifacts correspond to the reviewed source; scope of change stated | **PASS (adjusted)** | §3, §8.1 |
| 2 | Prior design §12.3, §14, §15, Amendment D true of shipped code | **PASS**, one nit | §7 |
| 3 | Run directory complete per `.claude/runs/README.md` | **PASS** | §8.2 |
| 4 | Forward + reverse re-run on my own scratch server; leg ends as it started | **PASS** | §5.1 |
| 5 | Live md5 identical; no scratch process/port left; user's PID unchanged | **PASS** | §1 |

---

## 3. The current source compiles and the emitted output carries the feature

Scratch clone of the **working tree as it stands now** (including A and B),
`node_modules` symlinked, `.git`/`dist`/`client/dist`/`backups`/`flights.db*`/
`flight_plans`/`.claude` excluded. Fidelity check before building **[executed]**:

```
OK  src/server.ts                     85295c9d79fa65e1b9bf5ee35bda0aca
OK  src/types.ts                      acde58c2c3c8ae921557425049c722fb
OK  client/src/types.ts               489cad34da576677ef3104f9933e0666
OK  src/db.ts                         613ef1f84fbd7694fb0dcbb728b2a41f
OK  src/plannedLegClose.ts            6ba23782f6d42faa7cf4877065398ef9
OK  src/inspect-manual-mark.ts        bb005db98ff0d86b07e7957454d960e4
OK  client/src/pages/FlightDetail.tsx ac5ae63bbdbdc21a5dc4934edd06718e
OK  README.md                         ee7a65e61ff1b639d23bee2680b62681
src: 20 = 20    client/src: 29 = 29
```

`src/server.ts` here is `85295c9d…`, **not** the `47a8d22c…` DevOps built from —
this build is the first one that contains change B.

```
$ nvm use 20 && cd "$R" && node -v && npx tsc --version && npm run build
v20.20.2
Version 5.9.3
> tsc && vite build
vite v5.4.21 building for production...
✓ 102 modules transformed.
dist/index.html                   0.40 kB │ gzip:   0.27 kB
dist/assets/index-DURsPzUe.css   34.44 kB │ gzip:  10.87 kB
dist/assets/index-DIA3gNQd.js   389.18 kB │ gzip: 117.13 kB
✓ built in 1.99s
> msfslogger@1.0.0 build:server
> tsc
BUILD_EXIT=0
```

Both halves silent, exit 0. The client bundle hash `index-DIA3gNQd.js` is
**identical to DevOps's**, which is the expected consequence of A being a comment
and B being server-side only.

Route string and log line in the emitted server JS **[executed]**:

```
$ grep -rn "planned-leg-status" "$R/dist/server.js"
791:    app.put('/api/flights/:id/planned-leg-status', (req, res) => {
$ grep -n "PlannedLeg\] Flight" "$R/dist/server.js"
838:                ? `[PlannedLeg] Flight #${id} hand-marked flown ` +
841:                : `[PlannedLeg] Flight #${id} hand-reopened — leg #${decision.legId} back to planned`);
$ ls -la "$R/dist/plannedLegClose.js"
-rw-rw-r-- 1 guilherme guilherme 4861 … plannedLegClose.js
```

Labels in the emitted client bundle **[executed]**:

```
Mark flown           1
Back to planned      1
Marking…             1
Reopening…           1
planned-leg-status   1
Mark failed:         1
```

All four labels are design.md §8.2 exactly, including the single-character `…`
(U+2026).

---

## 4. The three unreviewed changes

### 4.1 Change A — the type comment (`src/types.ts`, `client/src/types.ts`)

**Comment-only: proven, not asserted.** `git diff --word-diff` shows the whole
change is inside one `/** */` block, and stripping comment lines from both files
makes them byte-identical to `HEAD` **[executed]**:

```
$ for f in src/types.ts client/src/types.ts; do
    git show HEAD:$f | grep -v '^\s*\*' | grep -v '^\s*/\*' | md5sum
    grep -v '^\s*\*' $f | grep -v '^\s*/\*' | md5sum
  done
src/types.ts         HEAD 46c2a7f17220bd23d945aa1bba97ff09   NOW 46c2a7f17220bd23d945aa1bba97ff09
client/src/types.ts  HEAD 61d72b4c804929eee1baabfede3adc1a   NOW 61d72b4c804929eee1baabfede3adc1a
```

The union line is byte-identical in both files, before and after **[executed]**:

```
$ grep 'export type PlannedLegStatus' <each of the four> | md5sum
e76476e06c91c1c12ae69a0146d9767a     # all four identical
export type PlannedLegStatus = 'planned' | 'flown' | 'diverted' | 'skipped';
```

**The two files are still exact mirrors.** The five-line comment block is
byte-identical between them, including the UTF-8 `§` **[executed]**:

```
$ diff <(sed -n '116,121p' src/types.ts) <(sed -n '60,65p' client/src/types.ts)
(no output — IDENTICAL BLOCKS)
```

And the project's own drift checker — the one `client/src/types.ts:57` names —
passes **[executed]**:

```
$ node .claude/runs/2026-09-04-lnmpln-trip-planner/tools/check-type-mirror.js
- PlannedLeg: OK (50 fields match)
- PlannedWaypoint: OK (13 fields match)
- PlannedAlternate: OK (9 fields match)
No drift.     EXIT=0
```

**Is the new wording true of the shipped gate?** Substantially yes, with one
omission.

> `'diverted'` is set by the system only; `'flown'` is set at touchdown, or by
> hand on a leg whose flight was linked manually and has already ended
> (2026-09-07 design.md §1).

- "`'diverted'` is set by the system only" — **true**. `'diverted'` is never an
  output of any function this run adds; `grep -n diverted src/plannedLegClose.ts`
  returns four hits, three in comments and one as an *input* type
  (`:63 status: 'planned' | 'flown' | 'diverted' | 'skipped'`). **[executed]**
- "set at touchdown" — **true**: `recordArrivalOnPlannedLeg()` runs inside
  `endFlight()` (`src/flightManager.ts:463`). **[read]**
- "or by hand on a leg whose flight was linked manually and has already ended" —
  the two conditions are **necessary but not sufficient**. The gate also demands
  the leg currently be `planned`. Demonstrated: flight 902 (manual, ended) whose
  leg is `diverted` is refused **[executed]**:
  ```
  PUT /api/flights/902/planned-leg-status {"status":"flown"} -> HTTP 409
  {"error":"Planned leg 102 is 'diverted', not 'planned': only a planned leg can be marked flown by hand"}
  ```
  This is the same shape as phase-2's N-5 for the README, it is far truer than
  the sentence it replaces, and it points the reader at `design.md §1` where the
  full 24-row gate is written. **Non-blocking nit, §9 F-4.**

**The one real finding on A is a record-keeping one, not a code one.** These two
files are named in design.md **M-10** ("`src/types.ts`, `client/src/types.ts` …
are **not** modified") and in **§0** ("No change to `src/types.ts` or
`client/src/types.ts`"). Both are now contradicted *in letter*. In substance
neither is violated: M-10's stated purpose is "No payload gains a field; the trip
page gains no control", and no payload, type, union or emitted byte changed.
Phase-2's own N-2 called for this fix and said it "needs its own one-line task",
so the change is the review's recommendation carried out — but design.md's own
convention (`.claude/runs/README.md`: "when reality contradicts a frozen section,
amend it in place … and record the change in an amendment table") was not
followed, and design.md's amendment table still reads `None yet`. **§9 F-1.**

### 4.2 Change B — the log line (`src/server.ts:707-720`)

**It cannot throw.** Every value it interpolates is either a primitive already in
hand or guarded:

- `decision.deviationNm === null` is branched on explicitly, so the §3.3
  NULL-arrival path prints `(arrival position unknown)` rather than `null nm`.
- `saved?.destination_ident ?? '—'` uses optional chaining, so an impossible
  `undefined` re-read degrades to an em dash instead of a `TypeError`. `saved` is
  the same `getPlannedLegById()` call the response already made, so no extra
  query and no new failure mode.
- The whole thing is inside the existing `try`, so even a thrown value would map
  to the frozen `500 String(err)` rather than crash the process.

**Both directions reproduced, verbatim, on my own scratch server** (port 3210,
against a copy) **[executed]**:

```
$ curl -X PUT localhost:3210/api/flights/56/planned-leg-status -d '{"status":"flown"}'    → HTTP 200
[PlannedLeg] Flight #56 hand-marked flown 0.3 nm from planned PAJN — leg #12
$ curl -X PUT localhost:3210/api/flights/56/planned-leg-status -d '{"status":"planned"}'  → HTTP 200
[PlannedLeg] Flight #56 hand-reopened — leg #12 back to planned
```

Character-for-character the two lines the Orchestrator reported.

**The NULL-deviation branch, which no live row exercises**, driven with a
synthetic fixture on the copy (flight 901: manual, ended, `arrival_lat` NULL,
leg 101 `planned`) **[executed]**:

```
PUT /api/flights/901/planned-leg-status {"status":"flown"}   → HTTP 200, status 'flown'
[PlannedLeg] Flight #901 hand-marked flown (arrival position unknown) from planned KBBB — leg #101
PUT /api/flights/901/planned-leg-status {"status":"planned"} → HTTP 200
[PlannedLeg] Flight #901 hand-reopened — leg #101 back to planned
```

No throw, no `null nm`, status still set — design.md §3.3's policy, logged
honestly.

**It does not fire on a refusal.** Five refusals of every shape, log line count
before and after **[executed]**:

```
flight 48   {"status":"flown"}    -> HTTP 409 Flight 48 was not linked to its planned leg by hand: …
flight 57   {"status":"flown"}    -> HTTP 409 Flight 57 was not linked to its planned leg by hand: …
flight 56   {"status":"planned"}  -> HTTP 409 Planned leg 12 is 'planned', not 'flown': …
flight 56   {"status":"skipped"}  -> HTTP 400 status must be 'flown' or 'planned'
flight 9999 {"status":"flown"}    -> HTTP 404 Flight not found
--- log lines added by those 5 refusals: 0
```

**It leaks nothing.** Four values: a flight id, a leg id, a deviation in nm and
an airport ident — all four already public in the JSON this same handler returns,
and the automatic path already logs three of them. No coordinates, no file paths,
no request body.

**Format matches the house convention.** `src/*.ts` uses `[Tag] …` throughout
(`[FlightManager]` ×3, `[Airports]` ×2, `[PDF]`, `[HTTP]`, `[LNMPLN]`,
`[DB]`, `[Ingest]`). The message deliberately parallels its automatic twin
**[read]**:

```
src/flightManager.ts:465  [FlightManager] Flight #56 landed 0.3 nm from planned PAJN — leg #12 marked flown
src/server.ts:716         [PlannedLeg]    Flight #56 hand-marked flown 0.3 nm from planned PAJN — leg #12
```

A new tag (`[PlannedLeg]`) rather than reusing `[FlightManager]` is the right
call: `FlightManager` is not in this call path at all (design §5.7).

Two cosmetic differences from the twin, neither worth changing: the automatic
line prints `deviationNm.toFixed(1)` (always one decimal) where this prints the
stored rounded number, so a deviation of exactly 120 logs `120 nm` not
`120.0 nm`; and `hand-marked flown (arrival position unknown) from planned KBBB`
reads a little oddly in the NULL branch. **§9 F-5.**

**One correction to the rationale in my task envelope, for the record.** The
envelope says `leg!` "would have been the only non-null assertion in all of
`src/*.ts`". That is not so — `src/server.ts:525` already has
`imported.push(getPlannedLegById(legId)!)`, and `src/inspect-manual-mark.ts` has
four **[executed]**. The *conclusion* is still the better one: optional chaining
with a fallback is safer than an assertion here, and the code is right. Only the
justification was overstated.

### 4.3 Change C — nothing else in `src/server.ts` moved

`git diff` produces exactly three hunks **[executed]**:

```
$ git diff -U0 src/server.ts | grep '^@@'
@@ -5 +5 @@          # the import list: + setPlannedLegHandOutcome, + PlannedLegHandCloseConflictError
@@ -8,0 +9 @@        # + import { decideHandClose } from './plannedLegClose';
@@ -657,0 +659,67 @@ # the new handler
```

Removing the new block and diffing the remainder against `HEAD` leaves only the
two import lines — i.e. **every other line of the file, including
`app.patch('/api/planned-legs/:legId')`, is byte-identical to `HEAD`**
**[executed]**:

```
$ diff <(git show HEAD:src/server.ts) <(sed -n '1,663p;731,$p' src/server.ts)
5c5   … import list …
8a9   > import { decideHandClose } from './plannedLegClose';
(nothing else)
```

(The PATCH handler now starts at line 598 rather than 597; the one-line shift is
the added `import`, not an edit.)

**And the rest of the new handler is exactly what phase-1 approved.** Diffing the
handler text quoted in `reports/T-004.md` (the text `reviews/phase-1.md`
approved) against the file today **[executed]**:

```
$ diff handler-phase1.txt handler-now.txt
44c44,59
<       res.json(getPlannedLegById(decision.legId));
---
>       const saved = getPlannedLegById(decision.legId);
>       … 4 comment lines …
>       console.log( … )
>       res.json(saved);
```

**Exactly one line replaced, in exactly the place change B claims.** The other 51
lines — the gate, the refusal order, the 400/404/409/500 arms, the `try` shape,
the comments — are unchanged from the approved text. The wire behaviour of the
success path is identical: the same `getPlannedLegById(decision.legId)` value is
serialised, just via a named const.

---

## 5. The behaviour, re-executed

Scratch server: built from the current source, `PORT=3210`, cwd in scratch so
`path.join(process.cwd(),'flights.db')` (`src/db.ts:9`) opened a **copy** of the
live database taken with its `-wal` and `-shm`. Boot log **[executed]**:

```
[DB] Database ready
[Airports] Loaded 29549 airports from cache
[Ingest] Waiting for agent data on /api/ingest
[HTTP] Server running at http://localhost:3210
```

### 5.1 Criterion 4 — the round trip leaves the leg as it found it

**[executed]**

```
BEFORE: leg 12 {"status":"planned","arrival_deviation_nm":null}
        flight 56 {"planned_leg_id":12,"planned_leg_link_source":"manual","trip_id":1}
PUT {"status":"flown"}   -> HTTP 200  status flown   dev 0.3   linked_flight_id 56
MID:    leg 12 {"status":"flown","arrival_deviation_nm":0.3}
        flight 56 {"planned_leg_id":12,"planned_leg_link_source":"manual","trip_id":1}
PUT {"status":"planned"} -> HTTP 200  status planned dev None  linked_flight_id 56
AFTER:  leg 12 {"status":"planned","arrival_deviation_nm":null}
        flight 56 {"planned_leg_id":12,"planned_leg_link_source":"manual","trip_id":1}
```

`BEFORE` and `AFTER` are identical: §2.2's lossless-reversal theorem holds on the
built artifact, the deviation is the frozen `0.3`, and **the reverse did not
unlink** (M-3) — `planned_leg_id`, `planned_leg_link_source` and `trip_id` are
all unmoved. The copy was then destroyed, so this review leaves no data changed
anywhere.

### 5.2 F-1 non-regression, all four documented rows (M-2, M-4, §5.6)

**[executed]**, against the same server:

| Request | Design says | Got |
|---|---|---|
| `PATCH /api/planned-legs/12 {"status":"planned"}` (linked) | 409 | **409** `Planned leg 12 cannot have its status changed: linked to flight 56` |
| `PATCH /api/planned-legs/12 {"status":"skipped"}` (linked) | 409 | **409** same message |
| `PATCH /api/planned-legs/12 {"status":"flown"}` | 400 | **400** `status must be 'planned' or 'skipped'` |
| `PATCH /api/planned-legs/100 {"status":"planned"}` (unlinked fixture) | 200 | **200**, the leg |
| `PATCH /api/planned-legs/100 {"status":"skipped"}` (unlinked fixture) | 200 | **200**, the leg |
| `PATCH /api/planned-legs/100 {"status":"flown"}` (unlinked fixture) | 400 | **400** `status must be 'planned' or 'skipped'` |

The unlinked rows needed a synthetic leg: the live plan has **no** unlinked legs
left (`select … where not exists (select 1 from flights …)` returns `[]`), which
is why phase-1/phase-2 could only test them on fixtures too.

### 5.3 The writer's transactional re-assertion (§4.3) actually fires

Called directly against the built `dist/db.js` on the copy — the arm the HTTP
gate normally refuses before reaching **[executed]**:

```
setPlannedLegHandOutcome(100 unlinked,      'flown', 1.2) -> THREW PlannedLegHandCloseConflictError:
    Planned leg 100 cannot be closed by hand: it has no linked flight
setPlannedLegHandOutcome(9999 missing,      'flown', null)-> false
setPlannedLegHandOutcome(5 auto-linked,     'flown', 1.2) -> THREW PlannedLegHandCloseConflictError:
    Planned leg 5 cannot be closed by hand: its flight was not linked by hand
setPlannedLegHandOutcome(13 in-air-linked,  'flown', 1)   -> THREW PlannedLegHandCloseConflictError:
    Planned leg 13 cannot be closed by hand: its flight was not linked by hand
after: leg 100 status 'skipped' dev null    # unchanged by the throw
after: leg 5   status 'flown'   dev 0.1     # unchanged
after: leg 13  status 'planned' dev null    # unchanged
```

All three refusals throw, the missing leg returns `false` (→ the frozen 404), and
**nothing was written in any refused case**. The message texts are §5.3's, so the
409 body the endpoint would produce is right too.

---

## 6. Failure paths and security

Every one of these was executed against the scratch server; none of them logged
anything and none of them wrote **[executed]**:

| Input | Result | Note |
|---|---|---|
| no body, no `Content-Type` | 400 `status must be 'flown' or 'planned'` | `express.json()` leaves `req.body = {}`; the destructure does not throw |
| `Content-Type: application/json`, empty body | 400 same | |
| body `{` (malformed JSON) | 400, body-parser's HTML `SyntaxError` page | **pre-existing global behaviour**: `PATCH /api/planned-legs/12` with the same input returns the identical page |
| body `null` | 400, same HTML page | same, global |
| body `[1,2]` | 400 `status must be 'flown' or 'planned'` | |
| `{"status":["flown"]}` | 400 same | strict `!==` comparison, no coercion |
| `:id = abc` | 400 `Invalid id` | |
| `:id = 56abc` | treated as 56 | `parseInt` quirk — **house-wide and pre-existing**: `PATCH /api/planned-legs/12abc` and `PUT /api/flights/56abc/planned-leg` behave identically on `HEAD`. Not a finding against this run |
| `:id = -1` | 404 `Flight not found` | |
| `:id = 1 or 1=1` (URL-encoded) | 409 `Flight 1 is not linked to a planned leg` | `parseInt` truncates; no SQL reaches the driver |
| `{"status":"flown'; drop table planned_legs;--"}` | 400 `status must be 'flown' or 'planned'` | status is compared against two literals before it can reach SQL, and every statement in `src/db.ts` is parameterised |
| `GET` on the new path | 200 `index.html` | the SPA catch-all is GET-only, exactly as design §5.5 predicts; the `PUT` is never shadowed |

Nothing user-supplied reaches SQL as text, the filesystem, or the log except a
parsed integer and a status validated against a two-element allowlist.

---

## 7. The durable record (criterion 2) — is the prior design true of the code?

`.claude/runs/2026-09-04-lnmpln-trip-planner/design.md`, all amended sentences,
checked against behaviour rather than against the report that wrote them.

| Amended text | True? | Evidence |
|---|---|---|
| **§12.3** new row: `PUT /api/flights/:id/planned-leg-status`, `{status}`, 200 `PlannedLegWithChildren`, 400/404/409/500 | **true** | §5.1, §5.2, §6 — every code observed |
| §12.3 row wording "`404` flight not found" | **true but incomplete** | there is a second 404 (`Planned leg not found`, §1.5 / writer returns false). The run design §5.3 has both; the prior design's one-line summary omits the second. Nit, §9 F-6 |
| §12.3 amended `PATCH` row: "`flown`/`diverted` are **not settable at this path**" | **true** | 400 observed on `{"status":"flown"}` |
| §12.3 "Keeping it separate also leaves the `PATCH` handler literally unchanged" | **true** | §4.3 — byte-identical to `HEAD` |
| **§14** "always stores the status the user asked for … never `diverted`" | **true** | `'diverted'` never an output; §4.1 |
| §14 "`ARRIVAL_RADIUS_NM` is not read by that path at all" | **true** | its only two occurrences in `src/plannedLegClose.ts` are the comment forbidding it; the one in `src/server.ts:603` is inside the **pre-existing** PATCH comment, not the new handler |
| §14 "unlink remains the **only** way to reopen a `diverted` leg" | **true** | flight 902 / leg 102 refused in both directions (§4.1) |
| §14 "README says so where it describes the control" | **true** | `README.md:212-215`: "the leg is always marked *flown*, never *diverted*, however far off the arrival was — only the automatic check on landing can mark a leg diverted" |
| **§15** six states, `unclosed` = `planned` + linked + ended | **true** | live query returns exactly one such row: flight 56 → leg 12 |
| §15 `unclosed → flown` and `flown → unclosed` transitions | **true** | §5.1 |
| §15 "`flown` … clears `arrival_deviation_nm`, **keeps the link**" | **true** | §5.1 AFTER row |
| §15 "that function and that endpoint are **unchanged**: every linked leg … still gets the 409 there" | **true** | §4.3, §5.2 |
| §15 "a `skipped` leg … Amendment D's gate refuses it too" | **true** | same refusal class as the `diverted` fixture (`LEG_NOT_PLANNED` / `LEG_NOT_FLOWN`) |
| **Amendment D** "flight 47 → leg 4 (0.4 nm, KSFO) and flight 52 → leg 10 (0.8 nm, CYVR)" | **true** | live read-only: `47│manual│4│flown│0.4│KSFO`, `52│manual│10│flown│0.8│CYVR`, `56│manual│12│planned│null│PAJN` |
| Amendment D "No schema migration … no payload gains a field" | **true** | `git diff src/db.ts` contains no `CREATE TABLE`, no `ALTER TABLE`, no `CHECK (status`; M-10 payload types byte-identical (§4.1) |

**No sentence in the amended sections describes an intention rather than the
implementation.** The only gap is the §12.3 omission of the second 404, which is
an incomplete summary, not a false statement.

**README.md** (`:210-215`, unchanged since phase 2 and unaffected by A and B) is
true of the shipped code, with the two caveats phase-2 already recorded as N-4
(no NULL-deviation caveat) and N-5 (omits the leg-status precondition). I
re-confirmed both against behaviour and agree with phase-2's ruling that neither
is worth a README edit: zero live rows are in either state.

---

## 8. Scope and completeness

### 8.1 What changed, and when

**[executed]**

```
17:57:52  .claude/runs/2026-09-04-lnmpln-trip-planner/design.md   T-001/T-005 — approved phase 1
18:03:35  src/db.ts                                               T-003 — approved phase 1
18:08:28  src/inspect-manual-mark.ts                              T-002 — approved phase 1
18:08:55  src/plannedLegClose.ts                                  T-002 — approved phase 1
18:44:24  README.md                                               T-007 — approved phase 2
18:45:35  client/src/pages/FlightDetail.tsx                       T-006 — approved phase 2
19:07:53  reviews/phase-2.md written  ────────────────────────────  phase 2 closes
19:09:08  src/types.ts             ┐
19:09:08  client/src/types.ts      ├─ change A — reviewed here (§4.1)
19:20:03  src/server.ts            ┘  change B — reviewed here (§4.2, §4.3)
```

`git status --porcelain` and `git diff --stat` at the end of this review:

```
 M .claude/runs/2026-09-04-lnmpln-trip-planner/design.md | 151 ++++++++++++---
 M README.md                                             |  10 ++
 M client/src/pages/FlightDetail.tsx                      |  48 +++++
 M client/src/types.ts                                    |   5 +-
 M src/db.ts                                              |  71 ++++++
 M src/server.ts                                          |  70 +++++-
 M src/types.ts                                           |   5 +-
?? src/inspect-manual-mark.ts   ?? src/plannedLegClose.ts   ?? .claude/…
 7 files changed, 335 insertions(+), 25 deletions(-)
```

Identical to the listing in `reports/ship.md` §6. Every changed file is inside
some task's `allowed_paths` **except** `src/types.ts` and `client/src/types.ts`,
which were in *no* task's allowed paths and were named in M-10 — the point
discussed in §4.1 and recorded as F-1.

### 8.2 Must-not-change list

| Item | Verdict | Evidence |
|---|---|---|
| M-1 DDL / `ALTER TABLE` block untouched | **PASS** | `git diff src/db.ts` has one hunk, `@@ -1322,0 +1323,71 @@`, appended after `recordPlannedLegArrival`; no `create table`/`alter table`/`CHECK (status` line in the diff |
| M-2 `setPlannedLegStatus`, `PlannedLegHasLinkedFlightError` | **PASS** | function-body md5 vs `HEAD`: `1e72b11f73cb`, `9db4c6b7332c` — identical |
| M-3 `recordPlannedLegArrival`, `unlinkFlightFromPlannedLeg`, `clearPlannedLegLink`, `linkFlightToPlannedLeg`; reverse must not unlink | **PASS** | md5s `af8a2e22bf40`, `d7803efd95b1`, `d882295e9bd8`, `eb57de2a4fc2` identical; link intact after reverse (§5.1) |
| M-4 `app.patch('/api/planned-legs/:legId')` unchanged, four behaviours | **PASS** | §4.3, §5.2 |
| M-5 `plannedLegClose.ts` imports only `./geo`; no `ARRIVAL_RADIUS_NM`; `'diverted'` not an output; `db.ts` does not import it | **PASS** | single `import { haversineNm } from './geo'`; the `ARRIVAL_RADIUS_NM` and `'diverted'` hits are comments plus one input-type union; `db.ts`'s two mentions are comments |
| M-6 deviation expression character-identical | **PASS** | `Math.round(haversineNm(flight.arrival_lat, flight.arrival_lon, leg.destination_lat, leg.destination_lon) * 10) / 10` vs `flightManager.ts:463` `Math.round(deviationNm * 10) / 10` — same rounding, same argument order |
| M-7 `updateFlight()` allowlist | **PASS** | `src/db.ts:351  const allowed = ['aircraft', 'notes'] as const;` |
| M-8 nothing writes `destination_lat/lon` after import | **PASS [read]** | the only new UPDATE is `SET status = ?, arrival_deviation_nm = ?` |
| M-9 `flightManager.ts`, `legMatcher.ts`, `geo.ts` unmodified | **PASS** | `git diff --stat` empty |
| M-10 `src/types.ts`, `client/src/types.ts`, `PlannedLegRows.tsx`, `TripDetail.tsx` unmodified | **VIOLATED IN LETTER, INTACT IN SUBSTANCE** | the two `.tsx` files are byte-identical; the two `types.ts` files changed by a comment only (§4.1). **F-1** |
| M-11 no reachable undefined state | **PASS** | §5.1, §5.3 — every refusal leaves the row untouched; the only writes are the two defined transitions |
| M-12 existing planned-leg behaviour untouched | **PASS (partial)** | skip/unskip, PATCH, unlink verified here and in phases 1–2; delete-trip / re-import / combine rely on phase-1's coverage, not re-run — §10 |
| M-13 live db never written; server never restarted | **PASS** | §1.1, §1.2 |

`§5.7`'s own falsifier, checked **[read]**: `endFlight()` calls `closeFlight()`
(writes `end_time`) at `flightManager.ts:284`, `recordArrivalOnPlannedLeg()` at
`:304` and `this.currentFlightId = null` at `:306` in one synchronous block. A
flight therefore *does* momentarily have `end_time` set while it is still
`currentFlightId` — but no HTTP handler can run inside that block, so the window
is unreachable by a request and §5.7 stands. Worth knowing if anyone ever makes
`endFlight()` async: that would falsify it. Recorded as F-7.

### 8.3 Run directory completeness (criterion 3)

Per `.claude/runs/README.md` **[executed]**:

```
intake.md      ✓          contracts/    ✓  api.http, db-additions.d.ts, plannedLegClose.d.ts
plan.json      ✓          prototypes/   ✓  deviation-recompute.js, haversine-parity.js
design.md      ✓          reports/      ✓  T-002, T-003, T-004, T-006, T-007, ship
                          reviews/      ✓  phase-1.md, phase-2.md, ship.md (this file)
```

**Complete.** `tools/` is absent and correctly so — it is optional in the layout,
and this run's reusable checker shipped as `src/inspect-manual-mark.ts` per design
§6.5 instead. No design-bearing task is missing a report: T-001 produced
`design.md`, T-005 and T-008 are the two review files.

---

## 9. Findings

**Blocking: none.** Nothing here sends a task back.

**F-1 · non-blocking, but fix it in the ship commit · `design.md` §0, M-10 and
the amendment table · the freeze was narrowed without being amended.**

M-10 and §0 say `src/types.ts` and `client/src/types.ts` are not modified; both
are modified (comment-only, §4.1). The run's own convention requires the section
to be edited in place with a row in the amendment table, and that table still
reads `None yet`. The code is right; the record is not. Suggested one-line
amendment: *"M-10 narrowed 2026-09-07: the two `types.ts` files may carry a
comment-only correction of the `PlannedLegStatus` doc block (phase-2 finding
N-2); no type, union or payload changes. Evidence: non-comment bytes identical to
HEAD, `check-type-mirror.js` clean."*

**F-2 · non-blocking, fix in the ship commit · `design.md` §5.4 · the normative
handler shape no longer matches the handler.**

§5.4 lists steps 1–7 and ends `res.json(getPlannedLegById(decision.legId))`. The
shipped handler has two more actions between 6 and 7 (re-read into `saved`, log).
No wire behaviour differs, and `reports/T-004.md` already documented one earlier
deliberate departure (`res.json` inside the `try`). Same treatment: record both in
the amendment table so the next reader is not misled by a "normative" block that
is one line short.

**F-3 · non-blocking · `reports/ship.md` §2, §7 N-2 and §9 · the ship report now
describes a state that no longer holds.**

Three sentences went stale 75 seconds to 9 minutes after it was written:
§2's fidelity md5 `src/server.ts 47a8d22cd990b0adb9c536399c60631b` (the tree has
`85295c9d79fa65e1b9bf5ee35bda0aca`); §7 N-2 "the hand-close path is silent in the
logs … I did not add it. Follow-up task."; and §9's row *"Observability of the new
path | **Silent**"*. All three are now false — the log exists and I reproduced
it. The build proof in §3-§5 of that report also covers the **pre-change-B**
source, and is superseded by §3 of this review. Append a dated note; do not
rewrite the report.

**F-4 · non-blocking · `src/types.ts:118-120`, `client/src/types.ts:62-64` · the
new comment omits one precondition.**

"by hand on a leg whose flight was linked manually and has already ended" is
necessary but not sufficient — the leg must also be `planned` (forward) or
`flown` (reverse); a `diverted` or `skipped` leg on such a flight is refused
(§4.1, observed). Same class as phase-2's N-5. The comment cites `design.md §1`,
which states the full gate, so a reader is one hop from the truth. Fix on the next
touch of the file, if ever.

**F-5 · non-blocking · `src/server.ts:714-720` · two cosmetic wrinkles in the log
line.** `(arrival position unknown) from planned KBBB` reads awkwardly, and a
whole-number deviation logs `120 nm` where the automatic twin's `toFixed(1)`
would log `120.0 nm`. Neither affects diagnosis. Note only.

**F-6 · non-blocking · prior `design.md` §12.3 · the new endpoint's error column
lists only one of its two 404s.** The `Planned leg not found` 404 (§1.5, and the
writer-returned-false case) is missing from the one-line summary. The run
design's §5.3 table is complete. Fix if the prior design is ever touched again.

**F-7 · non-blocking · `src/flightManager.ts:284-306` · design §5.7's falsifier
is guarded by synchrony alone.** `end_time` is set while `currentFlightId` is
still non-null, inside one synchronous block. Unreachable by any request today.
If `endFlight()` ever becomes `async`, §5.7's argument for omitting
`refreshPlannedLegForFlight()` fails and the call must be added. Worth a comment
in `endFlight()` on its next edit.

Phase-1's nine and phase-2's six follow-ups still stand as written; none of them
was invalidated by A, B or C, and none of them is blocking.

**Process note, not a finding against the code.** Changes A and B were made by
the Orchestrator directly rather than routed to a Dispatcher, which is why they
arrived unreviewed and why `reports/ship.md` §7 N-1 had to escalate. The
workflow's own answer — send it to the Reviewer before merging — was followed,
and that is this document. Both changes are now reviewed and approved.

---

## 10. What I could not verify

- **M-12's long tail.** Delete-trip, delete-flight, re-import, `combineFlights()`
  and leg ordering were **not** re-exercised here. They are untouched by this
  run's diff (`git diff src/db.ts` is a single appended function) and phase-1
  covered them; I am relying on that rather than claiming it myself.
- **The browser.** I did not render the UI. The client bundle is byte-identical
  to the one phase-2 drove through headless Chromium over all 24 gate rows
  (`index-DIA3gNQd.js`, §3), and neither A nor B can change client behaviour, so
  re-running that would have re-proved a bundle that did not move. If you want
  the UI re-verified after A and B, say so — it is a 10-minute job.
- **The Docker image** — not built, not the deployment in use (`ship.md` §7 N-3).
- **A real concurrent unlink race.** I proved the writer's re-assertion throws by
  calling it directly on rows in each refused shape (§5.3). Interleaving two HTTP
  requests inside one synchronous `better-sqlite3` transaction is not possible in
  this single-threaded server, so the race the guard closes cannot be staged
  through the wire — the direct call is the strongest available evidence.

---

## 11. Ship

Approved to commit. `reports/ship.md` §8's go-live instruction is unchanged by
anything in this review and remains correct: **`./start.sh -r`, after the current
flight has ended** — it stops before it builds, so the "button with no endpoint
behind it" window never opens. Do not run a bare `npm run build` while flight 57
is in the air.

Recommended commit contents: the seven modified files, the two new `src/` files,
the run directory — plus the three record fixes F-1, F-2 and F-3, which are text
edits to `design.md` and `reports/ship.md` and need no code round.
