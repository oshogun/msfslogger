# T-008 — Phase 2 review (T-006, T-007)

**Overall verdict: `approve`.**

Per-task: **T-006 `approve`**, **T-007 `approve`**.

**Blocking findings: 0.** Six non-blocking follow-ups (§8), none of which sends a
task back.

**Independently verified: 13 of 13 acceptance criteria** (T-006: 8/8, T-007:
5/5). None was taken on the Dispatcher's report. Every command below was run by
me in this review and its output is pasted verbatim; claims are marked
**[executed]** or **[read]**.

**The headline check — the 24-row predicate equivalence — passes with zero
disagreements**, and it was established by *driving the real predicate*: the
built bundle was rendered in headless Chromium over 24 synthetic flights, one
per row of design.md §1.3, and the same 24 rows were then put to the real
endpoint in both directions (48 requests). §3 has the full table.

I also **closed the gap T-006 declared unverified**: rows 3 and 4 (`manual +
ended + diverted` / `+ skipped`) had never been exercised in a browser because no
such fixture exists in the live data. I seeded them into my scratch copy; both
render with no control, matching the API's 409 (§3, rows 3–4).

---

## 1. Safety envelope

The user was flying throughout this review (flight 57, airborne, live server on
port 3000). **[executed]**

```
$ md5sum flights.db                     # start of review, 18:55
e6959a7a85e0f2fc97fea90a20586954  flights.db
$ md5sum /home/guilherme/msfslogger/flights.db    # end of review
e6959a7a85e0f2fc97fea90a20586954  /home/guilherme/msfslogger/flights.db
```

Identical. The live database was opened read-only or copied; every write in this
review went to `$S/flights.db`, a copy taken with its `-wal` and `-shm`.

The repo's build outputs are byte-for-byte untouched, before and after
**[executed]**:

```
                                        before review        after review
find dist -type f -printf '%T@ %s %p\n' | sort | md5sum
                                        25bfc6dd…6e6db       25bfc6dd…6e6db
find client/dist -type f -printf '%T@ %s %p\n' | sort | md5sum
                                        ab53c9a2…bc37d       ab53c9a2…bc37d

$ stat -c '%y %n' client/dist/index.html
2026-09-06 13:48:15.370888380 +0000 client/dist/index.html     (before and after)
$ stat -c '%y %n' dist/index.js
2026-09-06 13:48:17.752891407 +0000 dist/index.js              (after)
```

`npm run build`, `npm run build:client` and `npm run build:server` were **not
run**. The only builds were to a scratch outDir:

```
$ npx tsc --outDir "$S/dist"                                   # server, scratch
$ cd client && npx vite build --outDir "$S/client/dist" --emptyOutDir
```

Ports: my server bound **3210** only. At the end **[executed]**:

```
$ ss -ltn | grep -E ':(3100|3101|3210)'   →  (no output)   "scratch ports clear"
$ ss -ltn | grep ':3000'                  →  LISTEN … *:3000    (the user's)
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/status  → 200
```

The user's server was never stopped, restarted or rebuilt over. `GET
localhost:3000/api/status` mid-review returned
`{"connected":true,"flightState":"FLYING","currentFlightId":57,…}` — undisturbed.

**Scratch rig.** `$S =
/tmp/claude-1000/-home-guilherme-msfslogger/50558345-…/scratchpad/rev8`, holding
the copied database, the scratch server build, the scratch client build, a
symlink to `airports.json`, and `flight_plans/`. The server ran with `$S` as its
cwd, so `path.join(process.cwd(), 'flights.db')` (`src/db.ts:9`) opened the copy
and `express.static(path.join(process.cwd(), 'client', 'dist'))`
(`src/server.ts:107`) served the scratch bundle. Removed at the end.

---

## 2. Scope — what actually changed in phase 2

**[executed]**

```
$ git diff --name-only
.claude/runs/2026-09-04-lnmpln-trip-planner/design.md      ← T-001/T-005, approved in phase-1
README.md                                                   ← T-007
client/src/pages/FlightDetail.tsx                           ← T-006
src/db.ts                                                   ← T-003, approved in phase-1
src/server.ts                                               ← T-004, approved in phase-1
```

Phase 2's two tasks touched exactly `README.md` and
`client/src/pages/FlightDetail.tsx`, plus their two reports under
`.claude/runs/2026-09-07-manual-mark-flown/reports/`. Every one is inside the
respective task's `allowed_paths`. Nothing outside them.

Must-not-change M-10, checked by hand **[executed]**:

```
$ git diff --stat client/src/types.ts src/types.ts \
      client/src/components/PlannedLegRows.tsx client/src/pages/TripDetail.tsx \
      src/flightManager.ts src/legMatcher.ts src/geo.ts
(no output — all unchanged)
```

`client/src/types.ts` and `client/src/components/PlannedLegRows.tsx` are
untouched, as T-006's criterion 8 requires. `src/flightManager.ts`,
`src/legMatcher.ts`, `src/geo.ts` unchanged (M-9). `src/db.ts` does not import
`src/plannedLegClose.ts`, and that module still imports only `./geo` (M-5)
**[executed]**:

```
$ grep -n "^import" src/plannedLegClose.ts
22:import { haversineNm } from './geo';
$ grep -n "ARRIVAL_RADIUS_NM" src/plannedLegClose.ts
15:// This module must not import or reference ARRIVAL_RADIUS_NM, and 'diverted'
19:// rule in src/flightManager.ts, which does use ARRIVAL_RADIUS_NM to choose
        (both comments; no code reference)
```

---

## 3. THE HEADLINE CHECK — 24-row predicate equivalence

### 3.1 Method

Not by reading the code. By running both sides over the same 24 input shapes.

**Fixtures.** 24 flights (ids 101–124) each linked to its own planned leg (ids
101–124) in a scratch trip, generated in design.md §1.3's exact row order —
`{manual, auto, null}` × `{ended, in air}` × `{planned, flown, diverted,
skipped}`. Arrival position 0.3 nm from the leg destination, mirroring live leg
12. Seeder: `$S/seed24.js`, run against `$S/flights.db` only. **[executed]**

**UI side.** Headless Chromium (`puppeteer`, already a dependency) loaded
`http://localhost:3210/flight/1NN` for each of the 24, against the scratch
client build, and recorded which buttons the *real bundle* rendered in the
Planned Leg section. Script `$S/ui24.js`. **[executed]**

**API side.** For each row and each direction, the row was reset from a separate
`better-sqlite3` connection immediately before the request (so all 48 requests
saw exactly the row they name), then `PUT
/api/flights/1NN/planned-leg-status` was issued and the status code, error text
and resulting leg row recorded. Script `$S/api48.js`. **[executed]**

### 3.2 The table

`ui_offers` = the label the browser actually rendered, mapped to its target
(`Mark flown` → `flown`, `Back to planned` → `planned`, no button → `none`).
`api_allows` = the direction that returned **200** (every other request returned
**409**).

| # | link_source | flight | leg.status | design §1.3 | api_allows | ui_offers | agree |
|---|---|---|---|---|---|---|---|
| 1 | manual | ended | planned | ALLOW → flown | **flown (200, dev 0.3)** | **flown** (`Mark flown`) | YES |
| 2 | manual | ended | flown | ALLOW → planned | **planned (200, dev null)** | **planned** (`Back to planned`) | YES |
| 3 | manual | ended | diverted | both 409 | none | none | YES |
| 4 | manual | ended | skipped | both 409 | none | none | YES |
| 5 | manual | in air | planned | both 409 | none | none | YES |
| 6 | manual | in air | flown | both 409 | none | none | YES |
| 7 | manual | in air | diverted | both 409 | none | none | YES |
| 8 | manual | in air | skipped | both 409 | none | none | YES |
| 9 | auto | ended | planned | both 409 | none | none | YES |
| 10 | auto | ended | flown | both 409 | none | none | YES |
| 11 | auto | ended | diverted | both 409 | none | none | YES |
| 12 | auto | ended | skipped | both 409 | none | none | YES |
| 13 | auto | in air | planned | both 409 | none | none | YES |
| 14 | auto | in air | flown | both 409 | none | none | YES |
| 15 | auto | in air | diverted | both 409 | none | none | YES |
| 16 | auto | in air | skipped | both 409 | none | none | YES |
| 17 | null | ended | planned | both 409 | none | none | YES |
| 18 | null | ended | flown | both 409 | none | none | YES |
| 19 | null | ended | diverted | both 409 | none | none | YES |
| 20 | null | ended | skipped | both 409 | none | none | YES |
| 21 | null | in air | planned | both 409 | none | none | YES |
| 22 | null | in air | flown | both 409 | none | none | YES |
| 23 | null | in air | diverted | both 409 | none | none | YES |
| 24 | null | in air | skipped | both 409 | none | none | YES |

```
disagreements: 0
```

**Two ALLOW cells out of forty-eight, in the UI and in the API, and they are the
same two.** No row where the UI offers what the API refuses (would be blocking);
no row where the UI hides what the API allows (would be a note).

Rows 17–24 are the `link_source IS NULL` shapes the design keeps in the table
because `FlightDetail.tsx:290` already renders a `'Linked.'` fallback for them.
The browser confirms both halves: `'Linked.'` renders, and no control does.

### 3.3 The refusal texts, for free

All 26 distinct 409 bodies produced across the 48 requests match design.md §5.3
character for character **[executed]** — e.g.

```
Flight 109 was not linked to its planned leg by hand: only a hand-linked flight's leg can be closed by hand
Flight 105 has not ended: its planned leg is closed at touchdown
Planned leg 102 is 'flown', not 'planned': only a planned leg can be marked flown by hand
Planned leg 103 is 'diverted', not 'flown': only a flown leg can be returned to planned
```

Refusal *order* (§1.2) is visible in the data: row 13 (`auto` + in air) reports
`LINK_NOT_MANUAL`, not `FLIGHT_NOT_ENDED`.

### 3.4 The gap T-006 declared open is now closed

T-006's residual risk 4: "*Not verified: behaviour on a leg whose status is
`'diverted'` or `'skipped'` — no such hand-linked, ended fixture exists in the
live data … the UI path for those two statuses is unobserved.*"

Rows 3 and 4 above are exactly those fixtures, seeded and rendered
**[executed]**:

```
id 103  manual/ended/diverted  buttons: ['Unlink']  badge: 'Diverted'  'Linked by hand.'
id 104  manual/ended/skipped   buttons: ['Unlink']  badge: 'Skipped'   'Linked by hand.'
```

The third conjunct's exclusions are now observed in a browser, not inferred.
**Ruling on the judgement call: not waved through — closed.**

---

## 4. T-006 — acceptance criteria, one at a time

### AC-1 — the predicate is design.md §8.1's, over existing fields — **PASS [executed]**

`client/src/pages/FlightDetail.tsx:320-341`. Extracted and compared to §8.1
(design.md:869-877):

```ts
const handCloseEligible =
  flight.planned_leg_link_source === 'manual' &&
  flight.end_time !== null &&
  (plannedLeg.status === 'planned' || plannedLeg.status === 'flown');

const handCloseTarget: 'flown' | 'planned' =
  plannedLeg.status === 'flown' ? 'planned' : 'flown';
```

Identical to the frozen text. Every field used already exists on the client's
`Flight` (`client/src/types.ts:12` `end_time: string | null`, `:32`
`planned_leg_link_source: 'auto' | 'manual' | null`) and `PlannedLeg` (`:70`
`status: PlannedLegStatus`). No new field, no new fetch.

One thing I specifically checked, because it is the classic way this hand-copy
would silently break: `end_time` is typed `string | null`, **not** optional, so
`flight.end_time !== null` cannot be defeated by `undefined`. Had it been
`end_time?: string`, rows 5–8 would have shown the control. It does not
**[executed, rows 5–8 above]**.

Behavioural proof rather than textual: §3's table.

### AC-2 — placement, busy/error idiom, no reload — **PASS [executed]**

Placement: inside the existing `<div className="flight-actions">`, **before**
`Unlink`, same `className="btn btn-ghost"` (`:336`). State: `markBusy` /
`markError` declared beside `unlinkBusy` / `unlinkError` (`:62-63`), same
`useState(false)` / `useState('')`. Handler `handleMarkPlannedLeg()` (`:137-151`)
mirrors `handleUnlinkPlannedLeg()` (`:112-128`): set busy, clear error, `await
apiFetch`, set state on success, `setMarkError('Mark failed: ' + (err as
Error).message)` in `catch`, busy cleared in `finally`.

No reload **[executed]**: I set `window.__reviewSentinel = 'ALIVE'` on the page
before the first click and read it back after each transition. It survived
*Mark flown* → *Back to planned* → the forced 409:

```
f56_initial      sentinel: "ALIVE"
f56_after_mark   sentinel: "ALIVE"   badge Flown
f56_after_reopen sentinel: "ALIVE"   badge Planned
f56_409          sentinel: "ALIVE"
```

and `page.on('framenavigated')` logged only my four explicit `goto`s across the
whole session — no navigation between them. `grep -n "window.location.reload"
client/src/pages/FlightDetail.tsx` → no match **[executed]**.

Busy state observed, not assumed: I held the PUT for 1.2 s with request
interception and sampled the DOM mid-flight **[executed]**:

```
during mark:   [{"text":"Marking…","disabled":true},   {"text":"Unlink","disabled":false}]
during reopen: [{"text":"Reopening…","disabled":true}, {"text":"Unlink","disabled":false}]
```

The control is **disabled during its own request** — one of the things I was
asked to hunt for, and it is not there. Labels match §8.2 exactly, including the
ellipsis: all three of `Marking…`, `Reopening…`, `Unlinking…` use U+2026
**[executed]**, verified by codepoint.

§8.3 respected: no `confirm()` on the new control; `Unlink`'s confirm at `:113`
is untouched.

### AC-3 — `tsc --noEmit` exits 0, both projects — **PASS [executed]**

```
$ node -v
v20.20.2
$ npx tsc --noEmit               ; echo SERVER_TSC_EXIT=$?
SERVER_TSC_EXIT=0
$ cd client && npx tsc --noEmit  ; echo CLIENT_TSC_EXIT=$?
CLIENT_TSC_EXIT=0
```

### AC-4 — built only to a scratch outDir — **PASS [executed]**

See §1. `client/dist` and `dist/` byte-identical before and after, and the
`stat` line on `client/dist/index.html` is the same 2026-09-06 13:48:15 timestamp
it carried before this run started. The scratch bundle
(`assets/index-DIA3gNQd.js`) is a different filename from the live one
(`assets/index-B-KIRG3H.js`), which is how I know the browser below was
exercising T-006's code and not the user's shipped build.

### AC-5 — driven in headless Chromium: /flight/56, both directions — **PASS [executed]**

My own session, my own port (3210), my own scratch build and copy. DOM captured
at every step:

```
A  /flight/56, initial
   badge   Planned
   buttons Mark flown | Unlink
   paras   "Planned Leg 8 of Circumnavegação: CYXS → PAJN"
           "Planned cruise 12,000 ft · approx. 479.4 nm"
           "Linked by hand."
   (no landing note)

B  after clicking "Mark flown"
   badge   Flown
   buttons Back to planned | Unlink
   paras   "Flown Leg 8 of Circumnavegação: CYXS → PAJN"
           "Planned cruise 12,000 ft · approx. 479.4 nm"
           "flown, 0.3 nm from plan"          ← new line, no reload
           "Linked by hand."
   db      {"status":"flown","arrival_deviation_nm":0.3,
            "planned_leg_id":12,"planned_leg_link_source":"manual","trip_id":1}

C  after clicking "Back to planned"
   badge   Planned
   buttons Mark flown | Unlink
   paras   back to state A exactly (landing note gone)
   db      {"status":"planned","arrival_deviation_nm":null,
            "planned_leg_id":12,"planned_leg_link_source":"manual","trip_id":1}
```

`0.3 nm` is the figure design.md §12 E1 predicted for leg 12. `Linked by hand.`
and `Unlink` are present in **both** states.

**Frozen decision 3 — the reverse must not unlink — holds, observed through the
UI [executed].** After the reverse, the page still reads `Linked by hand.` and
still offers `Unlink`, and the database row still carries `planned_leg_id = 12`,
`planned_leg_link_source = 'manual'`, `trip_id = 1`: the flight's link and trip
are exactly what they were before the round trip. Only `status` and
`arrival_deviation_nm` moved.

Console: **zero page errors** across the whole session
(`page.on('pageerror')` → `[]`).

### AC-6 — absent on /flight/48 and on an unended flight — **PASS [executed]**

Same browser session:

```
/flight/48   (auto, ended, leg 5 flown)
   badge Flown · "flown, 0.1 nm from plan" · "Linked automatically, at takeoff."
   buttons: ['Unlink']                                    ← no mark control

/flight/57   (auto, IN THE AIR — the user's live flight, in my copy)
   badge Planned · "Linked automatically, at takeoff."
   buttons: ['Unlink']                                    ← no mark control

/flight/105  (manual, IN THE AIR — isolates end_time alone)
   badge Planned · "Linked by hand."
   buttons: ['Unlink']                                    ← no mark control
```

Flight 105 matters: 48 and 57 both fail `link_source === 'manual'`, so on their
own they never exercise the `end_time !== null` conjunct in isolation. Row 105 is
`manual` and in the air, and the control is still absent — the second conjunct is
doing real work. (T-006 got this by mutating flight 57's `link_source` in its
copy; I got it from a purpose-built fixture, which leaves the live flight's shape
alone in my copy too.)

### AC-7 — a forced 409 renders inline — **PASS [executed]**

Method: with `/flight/56` loaded and showing `Mark flown`, I moved leg 12 to
`'flown'` behind the page's back (direct write to the scratch db), then clicked
the now-stale button.

```
rendered in .edit-error, inside the flight-actions row:
"Mark failed: Planned leg 12 is 'flown', not 'planned': only a planned leg can be marked flown by hand"

pageErrors: []            ← no unhandled rejection
badge after: Planned      ← client state not advanced; the server refused
buttons after: Mark flown | Unlink   ← both re-enabled, busy cleared in finally
```

The message is the server's §5.3 text verbatim, prefixed `Mark failed: ` in the
page's existing idiom (`Unlink failed: `, `Upload failed: `). The only console
output is Chromium's own network line, `Failed to load resource: the server
responded with a status of 409 (Conflict)` — that is the browser logging the
response, not an application error; `page.on('pageerror')` stayed empty.

### AC-8 — working tree — **PASS [executed]**

`git diff --name-only` (§2) lists `client/src/pages/FlightDetail.tsx` as the
only client file changed; `client/src/types.ts` and
`client/src/components/PlannedLegRows.tsx` are unchanged. Everything else in
`git status --porcelain` belongs to phase 0/1 tasks already approved in
`reviews/phase-1.md`.

---

## 5. T-007 — acceptance criteria, checked against observed behaviour

Per this review's own criterion, each README sentence was checked against what
the app **does**, not against design.md.

### AC-1 — the section states the control; does not claim the trip page — **PASS [executed]**

New paragraph at `README.md:210-217`, in the "Linking a flight to a leg" section,
immediately after the manual-linking paragraph. Claim by claim:

| README claim | How I checked it | Result |
|---|---|---|
| "…its leg stays *planned* forever" | live leg 12 (flight 56, manual, ended) reads `status='planned'` in the live db | true |
| "On that flight's own page" | `/flight/56` renders `Mark flown` | true **[executed]** |
| "— not the trip page —" | rendered `/trip/1` and scanned every button on the page | true: 96 buttons, all `Link to leg` / `Remove` / `Unlink` / `Edit` / `Export PDF` / `Delete Trip`; `/Mark flown|Back to planned|Marking|Reopening/` does not match anywhere in the page text **[executed]** |
| "once the flight has ended" | `/flight/57` and `/flight/105`, both in the air, show no control | true **[executed]** |
| "it records how far the flight's actual arrival was from the planned destination" | clicked it; leg 12 got `arrival_deviation_nm = 0.3` and the page rendered `flown, 0.3 nm from plan` | true **[executed]** |
| "the same way the automatic check does" | recomputed every stored deviation in the **live** db from `flights.arrival_lat/lon` with `haversineNm` + the frozen rounding: 7 of 7 reproduce **exactly**, including both automatic and both manual ones; leg 12 recomputes to the 0.3 the hand path then stored | true **[executed]**, table below |
| "The same control reverses the change, back to *planned* and clearing that distance, without unlinking the flight" | clicked it; badge → `Planned`, note gone, `arrival_deviation_nm = NULL`, `planned_leg_id = 12` / `link_source = 'manual'` / `trip_id = 1` unchanged, `Linked by hand.` still shown | true **[executed]** |

Deviation parity, read-only against the live database **[executed]**:

```
fid  lid  src      status    stored  recomputed  match
47   4    manual   flown     0.4     0.4         EXACT
48   5    auto     flown     0.1     0.1         EXACT
49   6    auto     flown     0.1     0.1         EXACT
50   8    auto     flown     0.2     0.2         EXACT
51   9    auto     flown     0.4     0.4         EXACT
52   10   manual   flown     0.8     0.8         EXACT
53   11   auto     flown     0.2     0.2         EXACT
56   12   manual   planned   null    0.3         (the stuck leg)
```

### AC-2 — always 'flown', never 'diverted', however far off — **PASS [executed]**

README: "*the leg is always marked* flown*, never* diverted*, however far off the
arrival was — only the automatic check on landing can mark a leg diverted.*"

Not taken on trust. I moved a fixture flight's arrival 2° of latitude off its
planned destination and marked it flown:

```
$ PUT /api/flights/101/planned-leg-status  {"status":"flown"}
HTTP 200
leg after: {"status":"flown","arrival_deviation_nm":120.1}
UI:        badge "Flown" · "flown, 120.1 nm from plan" · buttons [Back to planned, Unlink]
```

120.1 nm off plan and still `flown` — never `diverted`. (That is also design.md
§3.4's own worked example, to the tenth.) And the sentence's second half:
`'diverted'` is unreachable from the hand path (`PATCH /api/planned-legs/:legId`
still 400s on `'diverted'`, and the new endpoint 400s on it too — §7).

### AC-3 — project-structure listing gains `src/plannedLegClose.ts` — **PASS [read]**

`README.md:263`, between `legMatcher.ts` and `journey.ts`, in the existing
`# <verb-first description>` style:

```
│   ├── plannedLegClose.ts # Gate + deviation for closing a hand-linked planned leg by hand
```

Column alignment ruling in §8 (N-3).

### AC-4 — every sentence traceable, none describing unimplemented behaviour — **PASS [executed]**

The mapping in T-007's report is to design.md; I re-did it against the running
app instead, in AC-1 and AC-2 above. **Every clause of the new paragraph is true
of the code that now exists.** Nothing in it describes behaviour no task
implemented: there is no claim about the trip page, none about `diverted` being
settable by hand, none about a confirm dialog, none about the inspector. Two
places where the prose is *incomplete* rather than wrong are recorded as
non-blocking notes (§8, N-4 and N-5).

### AC-5 — diff confined to the two regions — **PASS [executed]**

```
$ git diff --stat README.md
 README.md | 10 ++++++++++
 1 file changed, 10 insertions(+)
```

Two hunks, `@@ -207,6 +207,15 @@` and `@@ -251,6 +260,7 @@` — the "Linking a
flight to a leg" section and the project-structure listing. Ten inserted lines,
**zero deletions**, so no untouched paragraph was reflowed.

---

## 6. Design conformance (design.md §8, §7, §5.3)

| Frozen item | Status |
|---|---|
| §8.1 predicate text | Identical, and behaviourally equivalent over all 24 rows (§3) |
| §8.1 "no new field, no new fetch" | Holds — only `planned_leg_link_source`, `end_time`, `status`, all already loaded |
| §8.2 labels `Mark flown` / `Marking…` / `Back to planned` / `Reopening…` | Exact, U+2026 confirmed by codepoint |
| §8.3 no `confirm()` in either direction; `Unlink`'s confirm untouched | Holds (`:113` unchanged) |
| §8.4 placement before `Unlink`, `btn btn-ghost`, `markBusy`/`markError` beside `unlinkBusy`/`unlinkError` | Holds |
| §8.4 `setPlannedLeg`, not `setFlight`; no `window.location.reload()` | Holds — sentinel survived, no navigation logged |
| §8.4 `markError` as `<span className="edit-error">` in the same row | Holds |
| §8.5 the two live cases | Reproduced exactly, including `flown, 0.3 nm from plan` (§4 AC-5) |
| §7 the endpoint returns the leg, not the flight; nothing on `flights` moves | Holds — link, source and `trip_id` unchanged across the round trip |
| §10 H (no confirm) and §10 D (leg payload) | Both as frozen |

---

## 7. Failure paths and security — things I tried that nobody asked me to

All **[executed]** against the scratch server.

**Malformed bodies on the new endpoint** — every one a 400 with the frozen text,
none reaching the database:

```
missing status      400 {"error":"status must be 'flown' or 'planned'"}
{"status":null}     400 …
{"status":"diverted"} 400 …          ← 'diverted' is not settable, in either path
{"status":"skipped"}  400 …
empty body          400 …
[]  (array body)    400 …
{"status":{"a":1}}  400 …
{"status":1}        400 …
{"status":"flown'; drop table planned_legs;--"}   400 …
```

The last one matters for the security check: `status` is compared against two
string literals before anything else happens, and the value never reaches SQL.
`legId` comes from the database (`flight.planned_leg_id`), not from the request,
and the writer uses bound parameters. No filesystem path is derived from user
input on this route. Nothing new is logged.

```
bad id "abc"        400 {"error":"Invalid id"}
missing flight      404 {"error":"Flight not found"}
unlinked flight     409 {"error":"Flight 120 is not linked to a planned leg"}
```

**NULL arrival position (design §3.3)** — the branch with zero live rows. Seeded
it: mark flown on a flight with `arrival_lat/lon` NULL →

```
HTTP 200, leg row {"status":"flown","arrival_deviation_nm":null}
UI: badge "Flown", buttons [Back to planned, Unlink], and NO landing note line
pageErrors: []
```

Exactly what §3.3 says should happen, and it needed no client change — the
existing `plannedLegLandingNote()` returns null. Verified in the browser.

**Concurrent writes.** Clicked `Mark flown`, then clicked `Unlink` (accepting its
confirm) while the mark PUT was still in flight (held 2 s by request
interception):

```
after:  Planned Leg section gone from the page
db flight: {"planned_leg_id":null,"planned_leg_link_source":null,"trip_id":null}
db leg:    {"status":"planned","arrival_deviation_nm":null}
pageErrors: []
```

The unlink won, the leg was reset by the unlink path as it always is, the late
mark request hit the gate and was refused (`NOT_LINKED`), and the resulting
`markError` is set on a section that no longer renders. No corruption, no
unhandled rejection, no React error. Recorded as a one-line note (§8, N-6), not
a defect.

**M-4 regression check** (the F-1 409 must survive) — re-run on this tree, not
taken from phase 1:

```
PATCH /api/planned-legs/12  {"status":"planned"}  409 Planned leg 12 cannot have its status changed: linked to flight 56
PATCH /api/planned-legs/12  {"status":"skipped"}  409 (same)
PATCH /api/planned-legs/101 {"status":"flown"}    400 status must be 'planned' or 'skipped'
PATCH /api/planned-legs/120 {"status":"skipped"}  200 ok status=skipped     (unlinked leg)
PATCH /api/planned-legs/120 {"status":"planned"}  200 ok status=planned     (unlinked leg)
PATCH /api/planned-legs/120 {"status":"flown"}    400 status must be 'planned' or 'skipped'
```

All four documented behaviours of §5.6 intact, including on leg 12 — the very leg
this feature's gate admits. The new capability exists **only** at the new path.

---

## 8. Findings

**Blocking: none.**

Non-blocking follow-ups. None of these sends a task back.

**N-1 · non-blocking · `client/src/pages/FlightDetail.tsx:320-341` · the inline
arrow function is the only one of its kind in the client, and the hoisted form
was available.**

This is the judgement call I was asked to rule on. My ruling: **the hoisted form
is the better code, and the "literalness" argument does not fully carry — but
this is a follow-up, not a resend.**

The reasoning. `grep -rn "{(() =>" --include=*.tsx client/src` returns exactly
one hit, this one **[executed]**; nothing else in the client puts statements
inside JSX via an IIFE. T-006's defence is that hoisting would have forced a
`plannedLeg !== null` conjunct and so broken character-identity with §8.1. That
is true but weak: §8.1 itself says those two facts "are already guaranteed by the
enclosing conditions … so they are not restated", i.e. restating them is
*implied by* the design, not a contradiction of it. And the file already has a
natural home for derived values — `if (!flight) { … }` returns at `:236`, and
`const stats = [...]` sits at `:240`, after which `flight` is narrowed and a
`const handCloseEligible = plannedLeg !== null && …` would read exactly like its
neighbours. Nothing about the state types prevents it: `plannedLeg` is
`PlannedLegWithChildren | null`, which `!== null` narrows cleanly.

Against sending it back: the behaviour is verified correct over all 24 rows, the
comment above it names the design section, the IIFE is scoped to the button alone
so the surrounding 40 lines stay out of the diff, and the alternative is a style
preference, not a defect. Style alone does not meet the `request_changes` bar.
Worth doing on the next touch of this file.

**N-2 · non-blocking · `client/src/types.ts:60-63` (and the same wording in
`src/types.ts`) · a doc comment is now false.**

```ts
/**
 * 'linked' is deliberately absent: … 'flown' and 'diverted' are set by the
 * system only.
 */
export type PlannedLegStatus = …
```

Amendment D narrowed exactly this rule to "`diverted` is set by the system only;
`flown` is set by the system, **or by the user** on a hand-linked flight that has
ended". The comment now contradicts the shipped behaviour, and it sits in the
file a future implementer reads first. It is **correct that this run did not fix
it** — M-10 forbids modifying either types file, and T-006 respected that. It
needs its own one-line task.

**N-3 · non-blocking · `README.md:263` · the project-structure column is one
character out of alignment.**

Ruling: **fine as it is; do not reflow.** `plannedLegClose.ts` is 19 characters
where the widest existing entry is 16, so aligning it would mean re-padding all
thirteen sibling rows — which would violate T-007's own criterion 5 ("no
reflowing of untouched paragraphs") and turn a 1-line diff into a 14-line one for
a cosmetic gain inside a fenced code block. The single-space separator is the
minimal deviation and the Dispatcher chose correctly. If it ever bothers anyone,
it is a whole-listing reflow in its own commit.

**N-4 · non-blocking · `README.md:213-214` · the deviation sentence has no NULL
caveat.**

"*it records how far the flight's actual arrival was from the planned
destination*" is unconditional; when `flights.arrival_lat/lon` are NULL the
status is still set but no distance is recorded (design §3.3, and I verified the
behaviour in §7). Zero live rows are in that state and the only route to it is
`combineFlights()`, so the omission misleads nobody today. Not worth a sentence
in a user-facing README unless the state ever becomes reachable in practice.

**N-5 · non-blocking · `README.md:212-213` · "once the flight has ended, a
control marks the leg *flown*" omits the leg-status precondition.**

A hand-linked, ended flight whose leg is `diverted` or `skipped` shows **no**
control (rows 3–4, observed). The README's phrasing implies the control is there
whenever the link is manual and the flight has ended. This is exactly the wording
`plan.json` T-007 asked for ("when it appears (the link was made by hand and the
flight has ended)"), so the Dispatcher wrote what it was told; and the omitted
case has zero live rows. Note only.

**N-6 · non-blocking · `client/src/pages/FlightDetail.tsx:137-151` · a late mark
response can set `markError` on a section that has just unmounted.**

Reproduced (§7): click `Mark flown`, then `Unlink` before the PUT returns. The
unlink wins, the section disappears, the mark is refused `NOT_LINKED`, and the
error string lands in state nobody renders. No crash, no React warning, no data
effect — and the same shape already exists for `unlinkError`. The page's
per-action busy flags are the established idiom here (`uploading`, `saving`,
`exporting`, `unlinkBusy` all behave this way), so diverging to a shared "any
action in flight" lock would be the less consistent choice. Recording it only so
the next person to see it knows it was looked at.

---

## 9. What I could not verify

Nothing. All 13 acceptance criteria across the two tasks were executed here.

Two things I verified by a different route than the reports did, and say so
plainly: T-006 isolated the `end_time` conjunct by flipping flight 57's
`link_source` to `'manual'` in its copy, whereas I used a purpose-built fixture
(flight 105) and left flight 57's shape alone in mine — both are sound, mine
leaves the copy closer to the live data. And T-007's traceability map is
design.md → README, whereas I checked README → running app, which is what this
review's own criterion asks for.

---

## 10. Teardown

**[executed]**

```
$ pkill -f "$S/dist/index.js"; sleep 2
$ ss -ltn | grep -E ':(3100|3101|3210)'     → (no output)  scratch ports clear
$ ss -ltn | grep ':3000'                    → LISTEN … *:3000   the user's, untouched
$ md5sum /home/guilherme/msfslogger/flights.db
e6959a7a85e0f2fc97fea90a20586954            identical to the start of this review
$ find dist -type f -printf '%T@ %s %p\n' | sort | md5sum         25bfc6dd…  unchanged
$ find client/dist -type f -printf '%T@ %s %p\n' | sort | md5sum  ab53c9a2…  unchanged
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/status   200
```

The scratch directory (`$S`) — the database copy, both scratch builds, the four
scripts and the screenshots — was removed. No process, port, file or database
row of the user's was left changed by this review.
