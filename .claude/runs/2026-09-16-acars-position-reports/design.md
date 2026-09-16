# Design freeze — ACARS OOOI events and enroute position reports

Run id: `2026-09-16-acars-position-reports`
Task: T-001 (designer). Implemented by T-002 (`backend_sr`), checked by T-003 (`reviewer`).

This document is the contract. An implementer working from it should not have
to make an architectural decision; where a decision was genuinely open, §8
records the options and why one was taken.

Facts already established by the Orchestrator's code reading are in
`intake.md` and are cited, not re-derived. Everything below that names a
file:line was re-read during this freeze.

Sections are numbered and the numbers are stable — `.claude/tools/ctx.sh design
2026-09-16-acars-position-reports 4 6.2` slices by them.

## 0. Amendments

| # | Date | Section(s) | Change | Evidence that forced it |
|---|------|-----------|--------|-------------------------|
| — | —    | —         | None yet. | — |

---

## 1. OOOI event mapping and message scope

### 1.1 The instrumentation that already exists

`FlightManager`'s machine is `IDLE -> GROUND -> FLYING -> IDLE`
(`src/flightManager.ts:234-291`). The instants it already knows, all on the
1 Hz frame path (`agent/agent.js:221-225` requests `SimConnectPeriod.SECOND`,
posted to `src/ingest.ts:201` → `flightManager.onFrame`):

| Instant | Where | Condition |
|---|---|---|
| Aircraft is parked | `enterGround()` (`:368`) | 5 consecutive `isParkedFrame` frames (`src/groundState.ts:21,49`) — stationary **and** (engines off **or** parking brake set) |
| Aircraft is airborne | `startFlight()` (`:527`) via `checkAirborneDebounce()` (`:314`) | 3 consecutive frames `!onGround && airspeedKnots > 30` |
| Aircraft is back on the surface | the `FLYING` branch of `onFrame` (`:281`) | `frame.onGround === true` — read on every frame already |
| Aircraft has stopped | `endFlight()` (`:574`) | 10 consecutive frames `onGround && groundSpeedKnots < 5` |

Two consequences drive everything in this section:

- **`endFlight()` is not touchdown.** It needs the aircraft to be nearly
  stopped for ~10 s, so on a normal arrival it fires at the first prolonged
  stop after landing — the stand, or a long hold — not on the runway. The
  app's own duration is measured to that instant (`:574-600`).
- **There is no "left the stand" transition.** `GROUND` is exited only by
  rotation, slew, a >10 nm jump, or sim exit; the comment at `:268-269` is
  explicit that taxiing does not leave the state.

### 1.2 The frozen mapping

| Event | Fires from | `sent_at` | `estimated` |
|---|---|---|---|
| **OUT** | `startFlight()` (`src/flightManager.ts:527`), using the **off-blocks memo** recorded in the `GROUND` branch of `onFrame` — see §1.3 | the memo's instant when one exists, otherwise `startTime` (the takeoff instant `startFlight()` already computes at `:528`) | `false` when the memo exists, `true` when it does not |
| **OFF** | `startFlight()`, immediately after OUT | `startTime` | `false` |
| **ON** | the `FLYING` branch of `onFrame`, on the **first frame with `frame.onGround === true`** for this flight (§1.4) | that frame's `new Date().toISOString()` | `false` |
| **ON** (fallback) | `endFlight()`, only when no touchdown frame was ever seen (crash, sim exit or agent loss while airborne) | `endTime` (`:577`) | `true` |
| **IN** | `endFlight()`, immediately after the ON fallback | `endTime` | `false` |

Rationale in one line each: OFF and IN are exactly the two existing
transitions; ON is a boolean the frame path already evaluates, not a new
state; OUT is the only one of the four the app has no evidence for, so it is
memoised when the aircraft moves under a ground session and degrades to the
takeoff instant otherwise.

**A flight that reaches `FLYING` with no antecedent `GROUND` state in this
session still files all four events.** This is the stated choice for the case
the acceptance criteria call out: OUT is *not* skipped and is *not* backfilled
from any other source — it is filed from `startFlight()` with
`sent_at = startTime`, `estimated: true`, and a body line that says so
(`OUT TIME ESTIMATED - NO GROUND SESSION, TIME TAKEN AT TAKEOFF`, §2.4). That
case is reached by: an airborne start, a runway start where the parked
debounce never ran, an agent that sends neither `parkingBrake` nor
`enginesRunning` (so `isParkedFrame()` is never true —
`src/groundState.ts:49-57`), or a server started mid-taxi.

### 1.3 The off-blocks memo (the only new signal)

One in-memory field on `FlightManager`, no state, no timer, no persistence:

```
// set in the GROUND branch of onFrame(), after the slew and anchor checks
// (src/flightManager.ts:259-271) and BEFORE checkAirborneDebounce(frame, inSlew)
if (this.outBlocksAt === null && frame.onGround && frame.groundSpeedKnots >= TAXI_OUT_SPEED_KTS) {
  this.outBlocksAt = new Date().toISOString();
}
```

- `TAXI_OUT_SPEED_KTS = 3`, a new exported constant in `src/flightManager.ts`
  (beside `MAX_COUNTED_GAP_MS`, which is already exported for tests). Chosen
  above `GROUND_SPEED_MAX_KTS = 1` (`src/groundState.ts:29`) so a stand roll
  or a wind-pushed reading does not read as a pushback, and below any real
  pushback or taxi speed.
- **Reset points, exhaustive.** `enterGround()` on success (a new or adopted
  session starts parked); `resetGroundTracking()` (`:519`, every exit from
  GROUND that is not a flight); `startFlight()`, after the OUT message has
  been built. Never set while `this.state !== 'GROUND'`.
- No debounce. The memo is the *first* qualifying frame, and GROUND is only
  entered after a 5-frame parked debounce, so a single spurious frame costs an
  OUT a few minutes early — acceptable, and stated in §10.

### 1.4 The touchdown flag

A second in-memory field, `onEventFiled: boolean`, reset to `false` in
`startFlight()`. In the `FLYING` branch of `onFrame`, after
`this.recordPoint(frame)` (`:279`) and before the landed-debounce block
(`:281`):

```
if (frame.onGround && !this.onEventFiled) this.fileTouchdownOn(frame);
```

`fileTouchdownOn()` sets `this.onEventFiled = true` **first**, then resolves
the station with one `findNearestAirport(frame.lat, frame.lon)` call and files
ON. The flag is what keeps this to **one** airport lookup and **one** insert
attempt per flight rather than one per rollout frame; the dedup key (§2.2) is
the backstop, not the mechanism.

`endFlight()` then files its ON fallback only when `this.onEventFiled === false`.

### 1.5 Ownership of the new in-memory state

All four fields are private to `FlightManager` (`src/flightManager.ts`), reset
in `startFlight()` alongside the existing per-flight counters (`:552-563`):

| Field | Type | Initial | Reset where |
|---|---|---|---|
| `outBlocksAt` | `string \| null` | `null` | §1.3 |
| `onEventFiled` | `boolean` | `false` | `startFlight()` |
| `positionReportIntervalMs` | `number` | `0` | `startFlight()` (§3.4) |
| `lastPositionReportWindow` | `number` | `0` | `startFlight()` |

Nothing else in the tree reads them; none is exposed on `AppState`, on
`/api/status`, or in any response body.

### 1.6 Scope: `flight_id`, `planned_leg_id`, or both

**Every message this feature writes — all four OOOI events and every position
report — is written with `flight_id` set and `planned_leg_id` NULL.** No
leg-only row is ever produced by this feature, so the question of reconciling
a leg-scoped OOOI row to a `flight_id` later **does not arise**: there is
nothing to reconcile.

Why this is possible even though the intake flagged that "a ground-session OUT
may have no flights row yet": under §1.2, OUT is *filed* inside
`startFlight()`, after `insertFlight()` has returned an id (`:530`), even
though it is *timestamped* to the earlier off-blocks memo. A row's `sent_at`
and the moment it is inserted are independent, and the thread is ordered by
`sent_at` (`src/db/acarsMessages.ts:124`).

Why `planned_leg_id` is deliberately left NULL:

- The flight's own link is the authoritative one and it is mutable — the user
  can link or unlink an in-progress flight from the UI, which is exactly why
  `recordArrivalOnPlannedLeg()` re-reads it from the row rather than
  remembering it (`src/flightManager.ts:744-748`). A `planned_leg_id` stamped
  on a message would survive an unlink and keep surfacing that message in a
  leg thread nothing links to any more, and nothing in this design would ever
  correct it.
- It is redundant for the flight thread: `listAcarsMessagesForFlight()` already
  returns the flight's own rows **plus** the rows of whatever leg the flight is
  linked to (`src/db/acarsMessages.ts:118-126`), so a flight-scoped row is in
  the thread unconditionally.

The consequence, stated so the reviewer can check it: these messages appear on
`/flight/:id/acars` and **not** on `/planned-leg/:legId/acars`, whose reader is
`listAcarsMessagesForPlannedLeg()` (`src/db/acarsMessages.ts:132-139`). That
satisfies the story's acceptance criterion 4 ("visible in the same per-flight
thread as other ACARS messages") and is the intended behaviour, not an
oversight: a position report is a fact about a flight, and the pre-flight leg
page is for messages that exist before a flight does.

The leg id is still recorded where it is harmless and useful: inside
`payload_json` (§2.6), which no read of this table joins on.

### 1.7 Emission order within a transition

Two messages can share a `sent_at` (OUT/OFF when the memo is absent; the ON
fallback and IN always). The thread orders by `sent_at ASC, id ASC`
(`src/db/acarsMessages.ts:124`), so insertion order is the tie-break and is
frozen:

- In `startFlight()`: **OUT, then OFF.**
- In `endFlight()`: **ON (fallback), then IN.**

Verified in §11.3: the prototype thread reads back OUT, OFF, ON, IN in that
order with all four sharing a timestamp.

### 1.8 Exact insertion points in `startFlight()` and `endFlight()`

`startFlight()` (`src/flightManager.ts:527-572`), in the existing order of the
method:

1. Unchanged: `startTime`, `dep = findNearestAirport(...)`, `insertFlight(...)`.
2. **New, before the ground-session close block at `:538`** (which is what
   nulls `groundSessionCache` at `:545`) — capture, do not emit:
   `outAirportIcao = this.groundSessionCache?.airportIcao ?? null`,
   `outStand = this.groundSessionCache?.parkingPosition ?? null`,
   `outAt = this.outBlocksAt`.
3. Unchanged: ground-session close, `plannedLegCache = null`,
   `autoLinkPlannedLeg(...)`, the per-flight counter resets and the
   `appState` assignments (`:539-566`).
4. **New, after `:566` and before the existing
   `console.log('[FlightManager] Flight #… started …')` at `:568`**: resolve
   the interval (§3.4), log it, emit OUT then OFF (§1.7), then set
   `this.outBlocksAt = null`. `this.plannedLegCache` is populated by now, so
   `destinationIdent` and `plannedLegId` are available.
5. Unchanged: `this.writePoint(frame)` (`:571`). The window gate (§4.2)
   guarantees this first point files no position report.

`endFlight()` (`:574-617`):

1. Unchanged through `recordArrivalOnPlannedLeg(this.currentFlightId, frame)`
   (`:608`).
2. **New, immediately after `:608` and before the field resets at `:610`** —
   `currentFlightId`, `plannedLegCache` and the resolved `arr` are all still
   in hand: emit the ON fallback if `!this.onEventFiled`, then IN (§1.7).
3. Unchanged: the resets at `:610-616`.

Placing the emissions *after* `closeFlight()` and `recordArrivalOnPlannedLeg()`
follows the reasoning already written into this file at `:737-753`: by the
time an ACARS write can fail, the flight and the leg's arrival are already
safely recorded.

---

## 2. Message contract — dedup keys, labels, bodies, payloads

Every message in this feature is `direction: 'downlink'` (the cockpit
reporting to dispatch) and uses a category that
`KNOWN_ACARS_CATEGORIES` already contains (`src/acars.ts:21-23`): `'oooi'` for
the four OOOI events, `'position-report'` for position reports. No new
category, no validator change, no schema change (§7).

### 2.1 Key shape

The precedent is `dispatchDedupKey`/`loadsheetRequestDedupKey`/
`loadsheetReplyDedupKey` (`src/acars.ts:140-148`): `<category>:<scope>:<id>`,
e.g. `dispatch:leg:29`. These keys extend it with the discriminator the scope
alone cannot carry — the event name, or the interval window:

```
<category>:<scope>:<scope-id>:<discriminator>
```

The `dedup_key` column is free-form text with a partial unique index
(`src/db/schema.ts:243-245, 261-262`), so this needs no migration. The
schema's own illustrative comment writes `'oooi:81:OUT'` (`:243`); that string
is a comment only — nothing produces or parses it (the one occurrence in the
suite, `tests/db/acarsMessages.test.ts:148`, is an arbitrary seed string) — so
the four-part form above is chosen instead, because it keeps the
`:<scope>:` segment that every shipped key already has.

### 2.2 The five keys

| Message | `dedup_key` | Built by |
|---|---|---|
| OUT | `oooi:flight:<flightId>:OUT` | `oooiDedupKey(flightId, 'OUT')` |
| OFF | `oooi:flight:<flightId>:OFF` | `oooiDedupKey(flightId, 'OFF')` |
| ON | `oooi:flight:<flightId>:ON` | `oooiDedupKey(flightId, 'ON')` |
| IN | `oooi:flight:<flightId>:IN` | `oooiDedupKey(flightId, 'IN')` |
| Position report | `position-report:flight:<flightId>:<windowIndex>` | `positionReportDedupKey(flightId, windowIndex)` |

`windowIndex` is the integer defined in §4.2: `Math.floor((reportAtMs -
flightStartMs) / intervalMs)`, and it is what makes **two reports from the
same interval window impossible**. Even if the in-memory
`lastPositionReportWindow` guard were bypassed — a second frame in the same
5-second write slot, a duplicated agent POST, a retried request — the second
insert computes the same `windowIndex`, hits the same key, and
`insertAcarsMessageOnce()` returns the stored row with `created: false`
without writing (`src/db/acarsMessages.ts:61-93`, partial unique index at
`src/db/schema.ts:261-262`). Verified in §11.3.

The same mechanism is what makes the ON fallback safe: it uses the identical
key as the touchdown ON, so first writer wins and exactly one ON row can exist
per flight.

`flightId` is `flights.id`, an AUTOINCREMENT primary key that is never reused,
so a key can never collide across flights.

### 2.3 Labels

| Message | `label` |
|---|---|
| OUT / OFF / ON / IN | `'OUT'` / `'OFF'` / `'ON'` / `'IN'` — the event word, matching the schema's own example of a label (`src/db/schema.ts:229`) |
| Position report | `'POS REPORT'` (frozen constant `POSITION_REPORT_LABEL` in `src/acars.ts`) |

The client renders `message.label || message.category` with a category badge
(`client/src/pages/AcarsMessages.tsx:55`), and both badge classes already
exist (`client/src/index.css:1021-1022`).

### 2.4 OOOI body

Two lines, plus a third only when the instant is an approximation:

```
<EVENT> <ICAO or ----> <HHMM>Z
ACFT <aircraft or UNKNOWN>[ STAND <stand>][ DEST <ident>]
[<EVENT> TIME ESTIMATED - <reason>]
```

- `<HHMM>Z` is UTC from `sent_at` (`hhmmz()`, §6.2).
- `STAND` is appended only when a stand is known — in practice OUT only, from
  the ground session's `parkingPosition` (`src/flightManager.ts:164-178`).
- `DEST` is appended only when the flight is linked to a planned leg
  (`plannedLegCache.destinationIdent`).
- The reason strings are frozen and produced by `oooiEstimatedReason()` (§6.2),
  never typed at a call site:
  - `OUT` → `NO GROUND SESSION, TIME TAKEN AT TAKEOFF`
  - `ON` → `NO TOUCHDOWN DETECTED, TIME TAKEN AT FLIGHT END`
  - `OFF`, `IN` → `TIME APPROXIMATE` (defined for totality; §1.2 never passes
    `estimated: true` for these two)

Rendered by the prototype (§11.2), verbatim:

```
OUT KSBA 1432Z
ACFT Airbus A320neo STAND A4 DEST KLAX
```
```
OUT ---- 1432Z
ACFT Airbus A320neo
OUT TIME ESTIMATED - NO GROUND SESSION, TIME TAKEN AT TAKEOFF
```
```
IN KLAX 1519Z
ACFT Airbus A320neo DEST KLAX
```

### 2.5 Position-report body

Five lines, fixed order:

```
POSITION REPORT
<lat> <lon> <HHMM>Z
<level> GS <gs> HDG <hdg>
NEXT <ident> DEST <ident> <remaining> NM
ETE <HHMM or ----> ETA <HHMM>Z or ----Z
```

- `<lat> <lon>` is `formatLatLon()` (§4.4), e.g. `N3425.6 W11950.5`.
- `<level>` is the existing `levelText()` (`src/acars.ts:163`): `FL330` at or
  above 18 000 ft, `4500FT` below.
- `<gs>` is `Math.round(frame.groundSpeedKnots)`; `<hdg>` is
  `String(Math.round(frame.headingDeg)).padStart(3, '0')`.
- `<remaining>` is `remainingDistanceNm.toFixed(1)` from
  `getPlannedLegStatus()` (§4.1).
- `ETE` uses the existing `hhmm()` (`src/acars.ts:155`), which already renders
  `null` as `----`; `ETA` is `----Z` on the same condition (§4.3).

Rendered by the prototype (§11.2), verbatim:

```
POSITION REPORT
N3425.6 W11950.5 1432Z
FL330 GS 452 HDG 098
NEXT RZS DEST KLAX 128.4 NM
ETE 0017 ETA 1449Z
```
```
POSITION REPORT
N3500.0 W12000.0 1432Z
900FT GS 0 HDG 000
NEXT WPT DEST KSBA 0.0 NM
ETE ---- ETA ----Z
```

Every body is far under `MAX_ACARS_BODY_LENGTH = 4096` (`src/acars.ts:32`);
the only unbounded inputs are `aircraft` (a SimVar title, ~60 chars) and
waypoint idents. `validateAcarsBody()` is **not** called on these bodies —
neither the dispatch release nor the load sheet calls it either
(`src/routes/plannedLegs.ts:297-306`, `src/routes/acars.ts:456-475`) — because
the writer is the server and the text is generated, not submitted.

### 2.6 `payload_json`

Machine-readable twins, opaque to every reader in this tree (`src/db/schema.ts:234-236`).
Written for both kinds; nothing in this feature reads them back.

OOOI (`OooiPayload`):

```json
{"v":1,"event":"OUT","at":"2026-09-16T14:32:07.412Z","airport_icao":"KSBA",
 "stand":"A4","estimated":false,"planned_leg_id":12}
```

Position report (`PositionReportPayload`):

```json
{"v":1,"at":"2026-09-16T14:42:07.412Z","window":1,"lat":34.426201,"lon":-119.841507,
 "altitude_ft":33000,"groundspeed_kts":452.3,"heading_deg":97.6,
 "next_waypoint":"RZS","destination":"KLAX","remaining_nm":128.4,
 "ete_sec":1023,"eta":"2026-09-16T14:59:10.412Z","planned_leg_id":12}
```

Rules: `v` is `1`; `lat`/`lon`/`groundspeed_kts`/`heading_deg`/`altitude_ft`
are the frame's values unrounded; `remaining_nm` is
`getPlannedLegStatus()`'s already-rounded value; `ete_sec` and `eta` are
`null` together when the ETA is unavailable (§4.3); `planned_leg_id` is the
linked leg (always non-null for a position report, may be null for OOOI).

### 2.7 Complete row shapes

| Column | OOOI | Position report |
|---|---|---|
| `flight_id` | the flight | the flight |
| `planned_leg_id` | `NULL` (§1.6) | `NULL` (§1.6) |
| `direction` | `'downlink'` | `'downlink'` |
| `category` | `'oooi'` | `'position-report'` |
| `label` | `'OUT'`/`'OFF'`/`'ON'`/`'IN'` | `'POS REPORT'` |
| `body` | §2.4 | §2.5 |
| `payload_json` | §2.6 | §2.6 |
| `correlation_id` | `NULL` (nothing replies to these) | `NULL` |
| `dedup_key` | §2.2 | §2.2 |
| `sent_at` | §1.2 | the point's own `ts` (§3.2) |
| `read_at` | `NULL` (untouched, as everywhere) | `NULL` |

---

## 3. Where it runs in the frame path, and the config knob

### 3.1 No new loop, no new timer

Every emission in this feature is reached from a call that the agent's 1 Hz
`POST /api/ingest/frame` already makes (`src/ingest.ts:201`). Concretely:

- OUT/OFF — inside `startFlight()`, which only `checkAirborneDebounce()`
  calls, which only `onFrame()` calls.
- ON — inside the `FLYING` branch of `onFrame()`.
- IN and the ON fallback — inside `endFlight()`, whose callers are
  `onFrame()`, `onCrash()` and `onSimDisconnect()` (`src/flightManager.ts:238,
  284, 294, 302`), all of which are agent-driven today.
- Position reports — at the end of `writePoint()`, which is reached only from
  `recordPoint()` (throttled to `RECORD_INTERVAL_MS = 5000`,
  `src/flightManager.ts:779-782`) and from `startFlight()`'s first point.

**This design adds no `setInterval`, no `setTimeout`, no `process.nextTick`,
no async scheduling and no polling of any kind.** The only `setInterval` in the
server stays the one that already exists for the stale-agent check
(`src/ingest.ts:187-192`), untouched. A position report can only ever be filed
on a frame that has already travelled `onFrame -> recordPoint -> writePoint`;
if the agent stops posting, nothing fires at all.

### 3.2 The exact point of the interval check

At the **end of `writePoint()`** (`src/flightManager.ts:784-822`), after the
existing final statement `this.interrupted = false;` (`:821`), as the last
statement of the method:

```
this.maybeFilePositionReport(frame, now, ts);
```

`now` and `ts` are the values `writePoint()` already computed at `:787-788`, so
a report's `sent_at` is byte-identical to the `flight_points.ts` of the point
it was derived from — the track and the message agree on the instant, and no
second clock read happens.

`maybeFilePositionReport(frame, nowMs, ts)` runs these steps in this order and
returns early at the first that fails:

1. `if (this.currentFlightId === null) return;` — defensive; `writePoint()`
   already returned at `:785` in that case.
2. `if (this.positionReportIntervalMs <= 0) return;` — reports disabled (§3.4).
3. `if (this.plannedLegCache === null) return;` — **the no-route skip** (§5.1).
4. `const windowIndex = Math.floor((nowMs - this.flightStartMs) / this.positionReportIntervalMs);`
   `if (windowIndex < 1 || windowIndex <= this.lastPositionReportWindow) return;`
5. `this.lastPositionReportWindow = windowIndex;` — **advanced before the
   write**, so a failed insert is not retried on the next point 5 s later.
6. `const status = this.getPlannedLegStatus(frame.lat, frame.lon);`
   `if (status === null) return;`
7. Build the message with the pure builder (§6.3) and hand it to
   `fileAcarsMessageOnce()` (§6.4), which owns the try/catch.

Steps 1-6 are pure in-memory arithmetic; step 7 is one small `INSERT` at most
once per interval per flight.

Whole-method safety: `maybeFilePositionReport()`'s body is itself wrapped in a
`try { … } catch (err) { console.warn(…) }` so that nothing here — including
the known latent throw in `getPlannedLegStatus()` for a degenerate
single-waypoint leg (§10.6) — can propagate into the point-recording path.

### 3.3 Cost

Per flight this adds: 4 OOOI inserts, one insert per interval window, and
exactly one extra `findNearestAirport()` call (§1.4). Per *frame* it adds two
integer comparisons in the `GROUND` branch (§1.3), one boolean test in the
`FLYING` branch (§1.4), and — only on a frame that already passed the 5 s
record throttle — steps 1-4 above. The `findNearestAirport()` budget stated at
`src/flightManager.ts:676-681` goes from two calls per flight to three, still
never per frame.

### 3.4 The config knob

| | |
|---|---|
| Name | `POSITION_REPORT_INTERVAL_MIN` |
| Unit | **minutes** (fractional allowed; `0.5` = 30 s) |
| Default | `10` (600 000 ms) |
| Disabled | exactly `0` — OOOI still files, position reports do not |
| Floor | `0.5` min; any positive value below it is clamped up |
| Read where | `process.env.POSITION_REPORT_INTERVAL_MIN`, **read directly**, once per flight, in `startFlight()` |
| Parsed by | `parsePositionReportIntervalMs()` in `src/acars.ts` (pure, §6.2) |

**It is not added to `AppConfig`/`ENV_VARS` in `src/config.ts`**, and the
reason is that module's own header: it is "the only module in the server that
reads `process.env` for **security-relevant** settings", and the comment goes
on to list `PORT`, `EXPORT_BASE_URL`, `TRAFFIC_ENABLED` and `SIMCONNECT_*` as
keeping their existing readers (`src/config.ts:1-5`). A reporting cadence
cannot be set to an insecure value — the worst a bad value does is file more
or fewer messages — so it follows the `TRAFFIC_ENABLED` precedent of a direct
read at the point of use (`src/ingest.ts:20-22, 157`). This is a confirmation,
not a deferral: the implementer must not touch `src/config.ts`.

Parse rules, in order (the order matters: `Number('')` is `0`, which would
otherwise read as "disabled"):

1. `const s = String(raw ?? '').trim();` if `s === ''` → default 600 000.
2. `const n = Number(s);` if `!Number.isFinite(n)` → default 600 000.
3. if `n === 0` → `0` (disabled).
4. if `n < 0` → default 600 000 (a negative cadence is a typo, not an opt-out).
5. if `n < 0.5` → `30_000`.
6. otherwise → `Math.round(n * 60_000)`.

Default of 10 minutes: real ACARS enroute reporting is 10-30 min; 10 min keeps
a 12-hour long-haul to 72 rows (~15 KB) while still producing at least one
report on the short sim legs this logbook mostly holds (the story's acceptance
criterion 2 needs ≥1 report between OFF and ON).

Misconfiguration is visible rather than silent: `startFlight()` logs one line
per flight next to the existing `Flight #N started` line —
`[FlightManager] Flight #12 position reports every 10.0 min` or
`[FlightManager] Flight #12 position reports disabled (POSITION_REPORT_INTERVAL_MIN=0)`.
Format the number as `(ms / 60000).toFixed(1)`.

Reading the env var once per flight rather than once per module load means an
operator who restarts the server picks up a new value, and a test can set the
variable before driving frames — without a per-frame `process.env` read.

---

## 4. Position-report selection, ETA and formatting

### 4.1 Inputs, all existing

A report is built from exactly two sources, both already in hand:

- `this.getPlannedLegStatus(frame.lat, frame.lon)` (`src/flightManager.ts:633-656`)
  — `plannedLegId`, `destinationIdent`, `nextWaypointIdent`, and
  `remainingDistanceNm`: the great-circle distance to the next waypoint plus
  the rest of the filed chain to the destination, rounded to 0.1 nm. It reads
  the in-memory `plannedLegCache` and issues no query.
- The `SimFrame` the current `writePoint()` call is recording: `lat`, `lon`,
  `altitudeFt`, `groundSpeedKnots`, `headingDeg` (`src/types.ts:1-18`).

**`getPlannedLegStatus()` returns no new field and `PlannedLegLiveStatus`
(`src/types.ts:255-264`) gains none.** The ETA is derived at the call site
from `remainingDistanceNm` and the frame's `groundSpeedKnots`. This keeps
`GET /api/status`'s response shape — and its hand-mirrored twin at
`client/src/types.ts:333-341` — byte-identical (§9.3).

### 4.2 Which frames produce a report

Window arithmetic, evaluated in `maybeFilePositionReport()` (§3.2 step 4):

```
windowIndex = Math.floor((nowMs - flightStartMs) / positionReportIntervalMs)
file iff windowIndex >= 1 && windowIndex > lastPositionReportWindow
```

`flightStartMs` is the existing field set in `startFlight()`
(`src/flightManager.ts:561`), i.e. wall-clock at takeoff — so window 1 closes
one interval after OFF and the report lands on the first recorded point at or
after it (within the 5 s record throttle). Properties this buys:

- **At most one report per window, ever** — the in-memory guard plus the
  window-keyed dedup key (§2.2).
- **No catch-up burst.** After a pause, a slew, or a stretch where the agent
  stopped posting, only the *current* window fires; skipped windows are
  skipped for good. Verified in §11.4: a 95-minute flight with a 12-minute
  pause files 9 reports at a 10-minute interval, one of them at the 52-minute
  mark on resume, never two at once.
- `windowIndex >= 1` means the first point (written by `startFlight()` itself,
  `:571`) never files a report, so nothing is filed at the OFF instant.
- A leg linked by hand mid-flight (`refreshPlannedLegForFlight()`, `:666`)
  starts reporting at the next recorded point, because its `windowIndex` is
  already greater than `lastPositionReportWindow`.

### 4.3 ETA formula

```
MIN_ETA_GROUND_SPEED_KTS = 30

estimateEnrouteSec(remainingNm, gsKts):
  if (!Number.isFinite(remainingNm) || remainingNm < 0)            -> null
  if (!Number.isFinite(gsKts) || gsKts < MIN_ETA_GROUND_SPEED_KTS) -> null
  return Math.round((remainingNm / gsKts) * 3600)          // seconds
```

- **Unit: seconds**, to the destination (not to the next fix), because
  `remainingDistanceNm` is to the destination via the next fix.
- ETA instant `= Date.parse(at) + eteSec * 1000`, rendered as `HHMMZ` UTC; the
  ISO form goes in `payload_json` (§2.6).
- **At zero or near-zero groundspeed the result is `null`, never `Infinity`,
  `NaN` or a divide-by-zero**: the guard is a comparison, and the division is
  only reached when `gsKts >= 30`. `hhmm(null)` already renders `----`
  (`src/acars.ts:155-160`), and the ETA field renders `----Z`. Both
  `ete_sec` and `eta` are `null` in the payload. Prototype output for
  `gs = 0` and `gs = 12` is in §2.5 and §11.2.
- 30 kt is chosen as the floor because below it the quotient is not an
  estimate of anything (600 nm at 5 kt is "120 hours"), and because the
  machine only enters `FLYING` above 30 kt indicated
  (`src/flightManager.ts:315`), so a cruising aircraft is never below it.
- No smoothing, no averaging, no history: the estimate is instantaneous
  groundspeed, which is why the body labels it `ETE`/`ETA` on one line and the
  distance is already flagged `distanceIsApproximate` upstream
  (`src/types.ts:263`).

### 4.4 Coordinate formatting

`formatLatLon(lat, lon)` → `"<N|S>DDMM.M <E|W>DDDMM.M"`, e.g.
`N3425.6 W11950.5`. Rules, so two implementations agree exactly:

1. Hemisphere from the sign, `>= 0` → `N`/`E`, `< 0` → `S`/`W` (so `-0.0004`
   renders `S0000.0`; verified in §11.2).
2. `abs = Math.abs(v)`, `deg = Math.floor(abs)`,
   `min = Math.round((abs - deg) * 600) / 10` (minutes to one decimal).
3. Carry: `if (min >= 60) { deg += 1; min = 0; }`.
4. Degrees `String(deg).padStart(2,'0')` for latitude, `padStart(3,'0')` for
   longitude; minutes `min.toFixed(1).padStart(4,'0')`.
5. No antimeridian wrap: `lon = 179.9999` renders `E18000.0` (verified in
   §11.2). That is a display of the rounded position, not a coordinate used in
   any computation, so the carry past 180 is accepted rather than special-cased.

---

## 5. Degradation paths

### 5.1 No route attached — the skip condition

**Skip condition: `this.plannedLegCache === null`**, tested as step 3 of
`maybeFilePositionReport()` (§3.2), before any window arithmetic and before
any call to `getPlannedLegStatus()`.

On that path the method returns immediately. Consequences, each checkable:

- **Zero `position-report` rows** for that flight — the only writer is step 7,
  which is unreachable.
- **No thrown exception**: the test is a null comparison on a private field.
- **No `console.error` and no `console.warn`**: nothing is logged on this path
  at all, at any frame. (The only logging this feature adds is the one
  per-flight interval line in §3.4 and the emitter's failure warning in §6.4,
  which is unreachable here.)
- `lastPositionReportWindow` is not advanced, so a leg linked later in the
  flight begins reporting immediately (§4.2).
- **OOOI is unaffected.** All four events are filed for an unlinked flight;
  their bodies simply omit the ` DEST <ident>` clause (§2.4) and their payload
  carries `planned_leg_id: null`.

This is the story's acceptance criterion 3, and it holds for every way a
flight can be unlinked: no active trip, no candidate leg within the radius, an
`AMBIGUOUS`/`LEG_ALREADY_FLOWN` refusal (`src/flightManager.ts:729-731`), a
leg the user unlinked by hand mid-flight, or an auto-link that threw and
degraded to an unlinked flight (`:732-734`).

### 5.2 No ground session before departure

`outBlocksAt` is `null`, so OUT is timestamped to the takeoff instant and
marked estimated (§1.2). Four messages are still filed. This is the normal
outcome for an agent that sends neither `parkingBrake` nor `enginesRunning`
(`src/groundState.ts:44-47` — the intended degradation, already documented
there), for an airborne start, and for a runway start.

### 5.3 Flight that ends in the air

`onCrash()` and `onSimDisconnect()` call `endFlight()` with the last frame
(`src/flightManager.ts:293-307`), and `simRunning === 0` does the same
(`:238`). No touchdown frame was ever seen, so `onEventFiled` is `false` and
the ON fallback files ON at `endTime`, marked estimated, immediately followed
by IN. The quartet is complete; the bodies say the ON time is not a touchdown.

### 5.4 Server restarted mid-flight

`FlightManager` is in-memory: after a restart it is `IDLE` with no
`currentFlightId`, exactly as today, and the open `flights` row is closed by
the hand-close path (`src/plannedLegClose.ts`). No further OOOI or position
report is filed for that flight, and **none is backfilled** — this feature
writes only from live transitions. A duplicate is structurally impossible
anyway: `flights.id` is not reused, so no key from the lost flight can be
regenerated.

### 5.5 An ACARS write fails

Swallowed in one place (§6.4) with a `console.warn`. Flight recording, point
recording, duration accounting, leg linking and ground sessions all proceed
unchanged. This mirrors the existing rule written at
`src/flightManager.ts:684-687` and at `src/routes/plannedLegs.ts:287-293`:
nothing about messaging may stand between a sim session and the row that
records it.

---

## 6. New code — modules, types, frozen signatures

### 6.1 Module and type ownership

| File | Change | Owns |
|---|---|---|
| `src/acars.ts` | **add only** (new section at the end, after the weather section) | every pure rule: dedup keys, bodies, payload builders, the message builders, the interval parser, `OooiEventInput`, `PositionReportInput` |
| `src/types.ts` | **add only** (new entries at the end of the `── ACARS ──` section, after `AcarsThread` at `:397`) | `OooiEvent`, `OooiPayload`, `PositionReportPayload` |
| `src/acarsEvents.ts` | **new file** | the single impure seam: `insertAcarsMessageOnce` + try/catch + log |
| `src/flightManager.ts` | **modify** | the four in-memory fields (§1.5), `TAXI_OUT_SPEED_KTS`, the emission call sites (§1.8, §3.2) |
| `tests/helpers/index.ts` | **add only** | `acarsEventsMock` + its default, wired into `resetMocks()` (§6.5) |
| `tests/acars.test.ts`, `tests/flightManager.*.test.ts` | add cases / add the mock (§6.5, §12) | — |

No other file changes. In particular `src/db/acarsMessages.ts` gains no new
query, `src/db/schema.ts` is untouched (§7), `src/config.ts` is untouched
(§3.4), `src/legMatcher.ts` and `src/groundState.ts` are untouched, and the
client is untouched (§7.4).

`src/acars.ts`'s header contract is preserved: the new functions read no
database, no environment and no clock. `parsePositionReportIntervalMs()` takes
the string and returns a number — the `process.env` read stays at the call
site in `src/flightManager.ts`, exactly as `parseBooleanEnv()` is structured
in `src/config.ts:75-78`. `Date.parse()`/`new Date(iso)` on a **caller-supplied
ISO string** is arithmetic on an argument, not a clock read; no function below
calls `Date.now()` or `new Date()` with no argument.

### 6.2 `src/acars.ts` — OOOI

```ts
// Declared once, in src/types.ts (§6.1):
//   export type OooiEvent = 'OUT' | 'OFF' | 'ON' | 'IN';
// src/acars.ts imports it — `import type { OooiEvent, OooiPayload,
// PositionReportPayload } from './types';` — beside its existing type import
// at src/acars.ts:9, and declares no second copy.

export const POSITION_REPORT_LABEL = 'POS REPORT';
export const MIN_ETA_GROUND_SPEED_KTS = 30;
export const DEFAULT_POSITION_REPORT_INTERVAL_MIN = 10;
export const MIN_POSITION_REPORT_INTERVAL_MIN = 0.5;

export interface OooiEventInput {
  flightId: number;
  event: OooiEvent;
  /** ISO 8601 UTC; becomes sent_at and the HHMMZ in the body. */
  at: string;
  /** Station ICAO, or null when no airport resolved within range. */
  airportIcao: string | null;
  /** Stand/gate from the ground session; null everywhere else. */
  stand: string | null;
  /** frame.aircraft, or null. */
  aircraft: string | null;
  /** plannedLegCache.destinationIdent, or null when the flight is unlinked. */
  destinationIdent: string | null;
  /** Recorded in payload_json only; the row stays flight-scoped (see §1.6). */
  plannedLegId: number | null;
  /** True when `at` is not the instant the event name describes (see §1.2). */
  estimated: boolean;
}

/** 'oooi:flight:12:OUT'. See §2.2. */
export function oooiDedupKey(flightId: number, event: OooiEvent): string;

/** The frozen wording of the third body line. Total: defined for all four. */
export function oooiEstimatedReason(event: OooiEvent): string;

/** '<HHMM>Z' UTC from an ISO instant; '----Z' for an unparseable string. */
export function hhmmz(iso: string): string;

/** The two- or three-line OOOI body. See §2.4. */
export function buildOooiBody(input: OooiEventInput): string;

/** The payload_json twin. See §2.6. */
export function buildOooiPayload(input: OooiEventInput): OooiPayload;

/** The whole row, ready for insertAcarsMessageOnce(). See §2.7. */
export function buildOooiMessage(
  input: OooiEventInput,
): CreateAcarsMessage & { dedup_key: string };
```

### 6.3 `src/acars.ts` — position reports

```ts
export interface PositionReportInput {
  flightId: number;
  /** The interval window this report belongs to; >= 1. See §4.2. */
  windowIndex: number;
  /** ISO 8601 UTC — the recorded point's own ts. Becomes sent_at. */
  at: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  groundSpeedKnots: number;
  headingDeg: number;
  /** From getPlannedLegStatus(). */
  nextWaypointIdent: string;
  destinationIdent: string;
  remainingDistanceNm: number;
  plannedLegId: number;
}

/** 'position-report:flight:12:3'. See §2.2. */
export function positionReportDedupKey(flightId: number, windowIndex: number): string;

/** 'N3425.6 W11950.5'. See §4.4. */
export function formatLatLon(lat: number, lon: number): string;

/** Seconds to destination, or null at/below MIN_ETA_GROUND_SPEED_KTS. See §4.3. */
export function estimateEnrouteSec(remainingNm: number, gsKts: number): number | null;

/** The five-line body. See §2.5. */
export function buildPositionReportBody(input: PositionReportInput): string;

/** The payload_json twin. See §2.6. */
export function buildPositionReportPayload(input: PositionReportInput): PositionReportPayload;

/** The whole row, ready for insertAcarsMessageOnce(). See §2.7. */
export function buildPositionReportMessage(
  input: PositionReportInput,
): CreateAcarsMessage & { dedup_key: string };

/** Minutes -> ms, with the default/disabled/floor rules of §3.4. */
export function parsePositionReportIntervalMs(raw: string | undefined): number;
```

### 6.4 `src/acarsEvents.ts` — the one impure seam

```ts
/**
 * Files a server-generated ACARS message exactly once and never throws.
 * Returns true iff a row was created. `context` is the log prefix subject,
 * e.g. 'Flight #12 OUT'.
 */
export function fileAcarsMessageOnce(
  msg: CreateAcarsMessage & { dedup_key: string },
  context: string,
): boolean;
```

Behaviour, frozen: call `insertAcarsMessageOnce(msg)`
(`src/db/acarsMessages.ts:61`); on `created === true` log
`[ACARS] ${context} filed (${msg.dedup_key})`; on `created === false` log
nothing and return `false`; on any throw, `console.warn('[ACARS] ' + context +
' not filed:', err)` and return `false`. It exists for three reasons: one
try/catch instead of six, one log vocabulary, and **one module for the
existing `FlightManager` test files to mock** (§6.5) so they stay hermetic.

### 6.5 Test-harness contract

`src/flightManager.ts` will import `src/acarsEvents.ts`, which transitively
imports `src/db/acarsMessages.ts` → `src/db/connection.ts` → `better-sqlite3`.
The four test files that construct a `FlightManager` today mock `../src/db` and
`../src/airports` (`tests/flightManager.test.ts:22-23`,
`state:24-25`, `duration:21-22`, `ground:22-28`) but would otherwise reach the
real emitter, where `getDb()` returns `undefined` before `initDb()`
(`src/db/connection.ts:51-53`) and every emission would log a warning.

Frozen: **all four `tests/flightManager.*.test.ts` files add**

```ts
vi.mock('../src/acarsEvents', async () => (await import('./helpers')).acarsEventsMock);
```

and `tests/helpers/index.ts` gains, in its own style (owner of its defaults):

```ts
export const acarsEventsMock = { fileAcarsMessageOnce: vi.fn() };
```

with `installAcarsEventsMockDefaults()` setting
`.mockReset().mockImplementation(() => true)`, called from module scope and
from `resetMocks()` (`tests/helpers/index.ts:278-282`) alongside the two
existing installers. Assertions are then made on
`acarsEventsMock.fileAcarsMessageOnce.mock.calls`, which carry the whole frozen
row — category, label, body, dedup key, `sent_at` — so the wiring and the
wording are checked in one place. `tests/ingestScope.test.ts` needs no change:
it imports `FlightManager` as a type only (`:17`).

---

## 7. Persistence, API surface and client contract

### 7.1 Persistence — no DDL change, no migration

This feature writes rows to an existing table and changes no schema object.
The substrate it depends on already exists and is already load-bearing for the
shipped dispatch-release and load-sheet features:

```sql
-- src/db/schema.ts:208-254 (unchanged by this run)
CREATE TABLE IF NOT EXISTS acars_messages ( … dedup_key TEXT … );
-- src/db/schema.ts:261-262 (unchanged by this run)
CREATE UNIQUE INDEX IF NOT EXISTS idx_acars_messages_dedup
  ON acars_messages(dedup_key) WHERE dedup_key IS NOT NULL;
```

Migration steps: **none.** `applySchema()` runs on every `initDb()`
(`src/db/connection.ts:25-32`) and every statement in it is
`CREATE … IF NOT EXISTS`, so any database the current build has opened already
has the table and the partial unique index — the shipped
`POST /planned-legs/:legId/acars-messages/loadsheet` path would fail without
it. Nothing is dropped, renamed, repurposed or backfilled; the only write is
`INSERT`. It is therefore safe against the user's live `flights.db` with real
rows in it, and safe to deploy by restarting the server on the existing file.

Storage: ~200-300 bytes per row; a 12-hour flight at the default interval adds
~76 rows (~20 KB). `idx_acars_messages_flight` already covers the thread read
(`src/db/schema.ts:256`).

### 7.2 API surface — no new endpoints

No route is added, removed or changed. Two existing responses gain rows:

- `GET /api/flights/:id/acars-messages` → `AcarsThread` (`src/types.ts:391-397`)
  now includes `oooi` and `position-report` entries in `messages`, in the same
  `sent_at ASC, id ASC` order, with the same `AcarsMessage` shape
  (`src/types.ts:354-370`). Status codes, error bodies and the `404` for an
  unknown flight are untouched.
- `GET /api/planned-legs/:legId/acars-messages` is **unchanged** — this feature
  writes no leg-scoped row (§1.6).

No request body, query parameter or header changes anywhere. `POST
/api/flights/:id/acars-messages` (the canned-message route) is untouched: the
new categories are server-written only and are not added to `CANNED_MESSAGES`.

### 7.3 Wire types

`AcarsMessage` is unchanged, so the wire contract is unchanged. The two new
payload interfaces (`OooiPayload`, `PositionReportPayload`, §2.6) describe the
*contents* of the opaque `payload_json` string, which the transport never
parses (`src/types.ts:362-363`); they live in `src/types.ts` only and are
**not** mirrored into `client/src/types.ts`, because no client reads them.

### 7.4 Client contract — no change required

`client/src/pages/AcarsMessages.tsx` already renders any message with a
category badge and falls back to a neutral badge for unknown categories
(`:29-36`), and `'position-report'` and `'oooi'` are both already in its
`KNOWN_CATEGORIES` list (`:32`) **and** already have badge colours
(`client/src/index.css:1021-1022`). Bodies are rendered verbatim in
`.acars-msg-body` (`:57`), which preserves the newlines these bodies rely on,
as the multi-line dispatch release already demonstrates. `client/src/types.ts`
needs no edit: `AcarsCategory` there already lists both (`:496`).

**T-002 must not modify anything under `client/`.** If a reviewer finds a
client change in the diff, that is a defect, not an improvement.

Documentation: the repo's `README.md` does not enumerate environment variables
(`TRAFFIC_ENABLED` is not in it either; configuration lives in the external
wiki), so no README change is required by this run.

---

## 8. Alternatives considered

### 8.1 OUT and IN collapsed onto OFF and ON

The simplest reading of the intake: file OUT and OFF together from
`startFlight()`, ON and IN together from `endFlight()`, with OUT and IN marked
as approximations. **Rejected** because `endFlight()` is not touchdown (§1.1) —
ON and IN would then *both* be the wheels-stop instant, and the four-event
thread would carry two pairs of identical timestamps and almost no
information. The chosen mapping costs one boolean test per frame (§1.4) and
one memo (§1.3) and produces four genuinely distinct instants on a normal
flight.

### 8.2 Leg-scoped OUT filed at first movement, before a flights row exists

Attractive because the ground session knows the stand and the leg, so OUT
could be filed the moment the aircraft moves, with `planned_leg_id` only.
**Rejected** on three counts: (a) a ground session with no linked leg has no
scope to file under at all — `insertAcarsMessage*()` refuses a row with
neither id (`src/db/acarsMessages.ts:32-34`) — so a flight without a route
would get no OUT, breaking the story's own acceptance criterion 3; (b) a
leg-scoped key (`oooi:leg:<id>:OUT`) would suppress OUT on the second flight
of a re-flown leg; (c) it would require a reconciliation rule to relate the row
to the eventual flight. Timestamping OUT from the memo but filing it under the
flight (§1.6) gets the accurate time with none of this.

### 8.3 IN from the post-arrival ground session

`enterGround()` after a landing is a true "parked at the stand" signal
(parking brake set or engines shut down), which is a better *definition* of
block-in than "the aircraft stopped". **Rejected** because it requires new
cross-transition memory (which flight just ended, when, and at which airport),
a staleness window, and an airport-agreement rule to avoid attributing a
ground session at a different airport to the previous flight — and it still
files nothing at all when the pilot quits on the runway, when the session is
adopted from a manual row, or when the agent does not report the ground
SimVars, i.e. IN would be intermittently missing. `endFlight()` fires on every
path a flight can end by (`src/flightManager.ts:238, 284, 294, 302`), and it is
already the instant this app calls the end of the flight and measures duration
to, so the ACARS thread and the logbook agree.

### 8.4 A sequence counter instead of a window index in the report key

`position-report:flight:12:3` meaning "the third report" is equivalent while
the process lives, but it is derived from a counter rather than from the
clock, so it cannot be recomputed by a second writer and cannot express "the
same window". The window index is recomputable from `(now, flightStartMs,
interval)` alone, which is exactly the property acceptance criterion 3 of the
task asks for (§2.2).

### 8.5 An ETA field on `PlannedLegLiveStatus`

Adding `etaSec`/`eta` to `getPlannedLegStatus()`'s return would let the live
panel show an ETA too. **Rejected for this run**: it changes `/api/status`'s
response shape and forces a matching hand-edit of the mirrored client type
(`client/src/types.ts:333-341`), which is a second contract and a second
consumer to review, for no requirement in this story. The formula is a pure
function (§6.3) and can be lifted into the status payload by a later run
without touching anything frozen here.

### 8.6 `POSITION_REPORT_INTERVAL_MIN` in `AppConfig`

Rejected — see §3.4 for the reason tied to `src/config.ts`'s own header.

### 8.7 A dedicated timer for position reports

Rejected by the story's non-functional note and by §3.1: a timer would keep
filing reports from a stale last frame after the agent disconnected, which is
exactly the failure the frame-driven design cannot have.

---

## 9. Must-not-change list

The Reviewer should check these one at a time.

1. **Flight and point persistence.** `insertFlight`, `insertPoint`,
   `closeFlight` call sites and argument order unchanged;
   `RECORD_INTERVAL_MS = 5000` unchanged; `pointCount`, `distanceNm`,
   `maxAltitudeFt`, `maxAirspeedKts` accumulation unchanged.
2. **Duration accounting.** `activeMs`, `interrupted`, `MAX_COUNTED_GAP_MS`
   and the tail-interval logic in `endFlight()` (`src/flightManager.ts:577-584`)
   are untouched; `tests/flightManager.duration.test.ts` passes unmodified
   except for the added `vi.mock` line (§6.5).
3. **State machine.** Transitions, their conditions and the constants
   `AIRBORNE_DEBOUNCE_FRAMES = 3`, `LANDED_DEBOUNCE_FRAMES = 10`,
   `GROUND_DEBOUNCE_FRAMES = 5`, `GROUND_SPEED_MAX_KTS = 1`,
   `GROUND_REANCHOR_NM = 10` are unchanged. The new code adds statements to
   the `GROUND` and `FLYING` branches; it changes no `break`, no `case`, and
   no assignment to `this.state` or `appState.flightState`.
4. **Ground sessions.** `enterGround()`, `matchGroundPlannedLeg()`,
   `closeOpenGroundSession` reasons, adoption/gap-fill semantics and
   `refreshGroundSession()` are unchanged. Nothing in this feature writes to
   `ground_sessions`.
5. **Planned-leg linking.** `autoLinkPlannedLeg()`,
   `refreshPlannedLegForFlight()`, `recordArrivalOnPlannedLeg()` and every log
   line they emit are unchanged; `matchPlannedLeg()` is not called by this
   feature.
6. **`/api/status`.** Response shape identical, including the conditional
   `plannedLeg` key and every field of `PlannedLegLiveStatus`
   (`src/types.ts:255-264`, mirrored at `client/src/types.ts:333-341`).
   `getPlannedLegStatus()` keeps its signature and return type.
7. **Schema and existing ACARS behaviour.** No DDL change, no migration, no
   change to `KNOWN_ACARS_CATEGORIES`, `CANNED_MESSAGES`,
   `dispatchDedupKey`/`loadsheetRequestDedupKey`/`loadsheetReplyDedupKey` or
   their emitters, and no change to any function in
   `src/db/acarsMessages.ts`.
8. **No new scheduling.** Zero new `setInterval`/`setTimeout`/`setImmediate`
   /`process.nextTick`; the stale-agent interval in `src/ingest.ts:187-192` is
   the only timer in the server and stays as it is.
9. **Failure isolation.** No ACARS failure can alter flight recording: every
   emission goes through the try/catch in `src/acarsEvents.ts` (§6.4), and
   `maybeFilePositionReport()` is itself wrapped (§3.2).
10. **Client untouched.** No file under `client/` is modified (§7.4).
11. **Airport lookups stay off the per-frame path.** `findNearestAirport()` is
    called at most three times per flight, never inside `recordPoint()` or
    `writePoint()`.
12. **`src/config.ts` untouched** (§3.4).

---

## 10. Risks, and what would falsify this design

1. **A touch-and-go files ON early.** The first `onGround` frame wins and the
   dedup key prevents a correction, so a practice circuit shows ON at the
   first touch. Accepted: the alternative — waiting for the aircraft to stop —
   is what §8.1 rejects. Falsified if the user reports ON times that are
   routinely wrong on normal arrivals.
2. **`endFlight()` can fire at a long hold.** Ten consecutive frames under
   5 kt on a taxiway ends the flight today; IN inherits that, so an IN can be
   early. This is pre-existing behaviour of the logbook, not new, and IN
   agrees with the flight record by construction (§8.3).
3. **The off-blocks memo can trip early.** A tow, a slope roll, or a
   groundspeed spike above 3 kt at the stand sets OUT early. Bounded: it can
   only ever be early, never late, and only within one ground session.
4. **Report volume on very long flights.** 10-minute default → 72 rows in
   12 hours. Bounded and configurable, including fully off (§3.4).
5. **A synchronous `INSERT` on the frame path.** One small `better-sqlite3`
   insert per interval window, in a request handler that already inserts a
   track point every 5 s. Falsified if frame handling shows measurable latency
   at the report instant.
6. **Latent throw in `getPlannedLegStatus()`.** A planned leg with fewer than
   two waypoints makes `waypoints[nextIdx]` undefined
   (`src/flightManager.ts:640-645`) — a pre-existing hazard on `/api/status`,
   not introduced here. Contained by the wrapper in §3.2; **not fixed in this
   run** (out of scope, and fixing it would change `/api/status` behaviour,
   which §9.6 forbids). Worth a follow-up run.
7. **Wall-clock windows versus flown time.** Windows are measured from
   `flightStartMs` on the wall clock, so a paused sim consumes windows without
   flying; the effect is a skipped report, never a duplicate (§4.2, verified
   §11.4).
8. **Estimated-instant wording.** If the user finds `OUT ... EST` noisy on
   every airborne-start flight, the fix is a wording change in one pure
   function (§6.2), not a structural one.
9. **Test-hermeticity regression.** If T-002 forgets a `vi.mock` from §6.5,
   the flightManager suites start touching the real emitter. Falsified
   immediately by a `[ACARS] … not filed` warning in test output.

---

## 11. Prototype evidence

Everything below was run under Node 20 against a **scratch** database in the
session scratchpad. The live `flights.db` was never opened by these runs, and
no scratch artefact was written into the repository. Script:
`/tmp/claude-1000/-home-guilherme-msfslogger/2d27a6f6-b9a2-421d-85b9-f187074dde0a/scratchpad/proto/freeze.js`.

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
node freeze.js      # FLIGHTS_DB_PATH -> <scratchpad>/proto/scratch.db, created empty
```

The script implements the §6.2/§6.3 builders *in the prototype file* (not in
`src/`), requires the already-built `dist/db/*` and `dist/acars.js` for the
real `initDb`/`insertAcarsMessageOnce`/`levelText`/`hhmm`, and prints:

### 11.1 What was verified

| Assumption | Result |
|---|---|
| The frozen key format survives the real partial unique index | yes, §11.3 |
| A second file of the same event/window creates no row | yes, `created: false`, same row id |
| The thread read returns the four OOOI rows in OUT, OFF, ON, IN order when they share a `sent_at` | yes, §11.3 |
| ETA never divides by zero or renders `Infinity` | yes, §11.2 (`gs = 0` and `gs = 12` both render `----`) |
| Window arithmetic never produces a burst after a pause | yes, §11.4 |

### 11.2 Rendered bodies (verbatim program output)

```
OUT KSBA 1432Z
ACFT Airbus A320neo STAND A4 DEST KLAX

OUT ---- 1432Z
ACFT Airbus A320neo
OUT TIME ESTIMATED - NO GROUND SESSION, TIME TAKEN AT TAKEOFF

OFF KSBA 1432Z
ACFT Airbus A320neo DEST KLAX

ON KLAX 1512Z
ACFT Airbus A320neo DEST KLAX

ON ---- 1512Z
ACFT Airbus A320neo DEST KLAX
ON TIME ESTIMATED - NO TOUCHDOWN DETECTED, TIME TAKEN AT FLIGHT END

IN KLAX 1519Z
ACFT Airbus A320neo DEST KLAX

POSITION REPORT
N3425.6 W11950.5 1432Z
FL330 GS 452 HDG 098
NEXT RZS DEST KLAX 128.4 NM
ETE 0017 ETA 1449Z

POSITION REPORT
S0000.0 E18000.0 1432Z
4500FT GS 12 HDG 360
NEXT ABCDE DEST NZAA 900.2 NM
ETE ---- ETA ----Z

POSITION REPORT
N3500.0 W12000.0 1432Z
900FT GS 0 HDG 000
NEXT WPT DEST KSBA 0.0 NM
ETE ---- ETA ----Z
```

(128.4 nm at 452 kt = 0.2841 h = 17.0 min → `ETE 0017`, `ETA 1449Z` from
`1432Z`. The second sample is the deliberate antimeridian/equator edge from
§4.4: `lon 179.9999` carries to `E18000.0`, `lat -0.0004` renders `S0000.0`.)

### 11.3 Dedup against the real table

```
OUT filed twice -> created: true false ids: 1 1 key: oooi:flight:1:OUT
same-window report filed twice -> created: true false rows share id: true
thread:
        1:oooi:OUT:oooi:flight:1:OUT
        3:oooi:OFF:oooi:flight:1:OFF
        4:oooi:ON:oooi:flight:1:ON
        5:oooi:IN:oooi:flight:1:IN
        6:position-report:POS REPORT:position-report:flight:1:1
        8:position-report:POS REPORT:position-report:flight:1:2
```

Note the id gaps (2, 7): a conflicting `INSERT … DO NOTHING` still consumes a
rowid. Harmless — the thread orders by `sent_at, id` and no id is exposed as a
sequence — but worth knowing before someone reads a gap as a lost message.

### 11.4 Window arithmetic over a 95-minute flight with a 12-minute pause

Synthetic 1-per-5-s track, 10-minute interval, frames suppressed between
minute 40 and minute 52 (the paused case, where `writePoint()` never runs):

```
reports over a 95-min flight with a 12-min pause: 9 w1@10min w2@20min w3@30min
w4@40min w5@52min w6@60min w7@70min w8@80min w9@90min
```

One report per window, one report on resume (window 5 at 52 min), no burst,
no duplicate.

### 11.5 What was *not* prototyped, and why

The Orchestrator's environment denied a read-only query against the live
`flights.db`, so no statistics from the user's real logbook (flight-duration
distribution versus the 10-minute default, real touchdown-to-stop intervals)
are in this document. The design does not rest on them: the default interval
is configurable and the ON/IN instants are derived from code-read transition
conditions (§1.1), not from observed data. If the user wants the default
tuned to their actual leg lengths, that is a one-line change to
`DEFAULT_POSITION_REPORT_INTERVAL_MIN` and needs no other part of this freeze
revisited.

---

## 12. Test plan T-002 writes against

Test-first is possible for everything in §6.2 and §6.3 — the signatures are
frozen. Suggested coverage, all hermetic (no database, no clock, no network):

**`tests/acars.test.ts`** (extend the existing file):

1. `oooiDedupKey` for all four events; `positionReportDedupKey` for windows
   1 and 7.
2. `buildOooiBody` — with and without stand, with and without destination,
   with `airportIcao: null` (`----`), with `estimated: true` for OUT and for ON
   (the two frozen reason strings).
3. `hhmmz` — midnight (`0000Z`), a value needing zero padding, an unparseable
   string (`----Z`).
4. `formatLatLon` — the three §11.2 samples, plus a value whose minutes round
   to 60 (carry), plus exactly `0`/`-0`.
5. `estimateEnrouteSec` — normal, `gs = 29.999` → `null`, `gs = 0` → `null`,
   `gs = NaN`/`Infinity` → `null`, negative distance → `null`.
6. `buildPositionReportBody` — normal and `ETE ---- ETA ----Z`.
7. `buildOooiMessage`/`buildPositionReportMessage` — the whole row: direction,
   category, label, dedup key, `sent_at`, `planned_leg_id` **absent/null**,
   `payload_json` parsing back to the §2.6 shape.
8. `parsePositionReportIntervalMs` — unset, `''`, `'  '`, `'10'`, `'0'`
   (disabled), `'-5'` (default), `'0.1'` (floor 30 000), `'abc'` (default),
   `'2.5'` (150 000).

**`tests/flightManager.*.test.ts`** (via `acarsEventsMock`, §6.5):

9. A scripted normal flight — parked frames → GROUND, taxi frames ≥ 3 kt,
   airborne debounce, cruise, a touchdown frame, ten stopped frames — files
   exactly four OOOI messages, in OUT/OFF/ON/IN order, OUT timestamped to the
   taxi frame and **not** marked estimated.
10. An airborne start (no GROUND) files four events with OUT estimated at
    `startTime`.
11. `onCrash()` from `FLYING` with no touchdown frame files ON (estimated) then
    IN; a crash *after* a touchdown frame files exactly one ON, not two.
12. Repeated `onGround` frames during a long rollout file exactly one ON and
    make exactly one `findNearestAirport` call.
13. With a linked leg and a fake clock, a flight driven past one interval files
    exactly one position report per window, with the expected dedup key, and
    two frames inside the same window file one message.
14. **No leg linked** (`plannedLegCache === null`): frames past several
    intervals file zero `position-report` messages, the four OOOI messages
    still file, and `console.warn`/`console.error` are never called.
15. `POSITION_REPORT_INTERVAL_MIN=0` files zero position reports and four OOOI
    messages.
16. A leg linked mid-flight via `refreshPlannedLegForFlight()` starts
    reporting at the next recorded point.

**Beyond Vitest**, the evidence a report should name:
`npm test`, `npm run test:types`, `npx tsc`, and one end-to-end check against a
**scratch** server on a non-3000 port with a scratch `FLIGHTS_DB_PATH`: post a
scripted frame sequence to `/api/ingest/frame`, then
`curl .../api/flights/<id>/acars-messages` and show the four OOOI rows and the
position reports, with `flights.db`'s live copy untouched (per
`.claude/ENVIRONMENT.md`).
