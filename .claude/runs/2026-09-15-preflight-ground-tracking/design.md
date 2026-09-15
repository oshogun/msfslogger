# Design freeze — pre-flight / ground tracking

Run `2026-09-15-preflight-ground-tracking`. Frozen 2026-09-15.

This document is the contract for every task in the run. Sections 1–7 are the
seven the plan asked for, in the plan's order; §8–§10 are the closers the
Designer role always writes (alternatives, must-not-change, risks) and §11
records what was actually run against real inputs. Each section is written to
be read on its own, because that is how it will be delivered — cross-references
are by number (“see §4.3”) so an agent handed one section knows what else to
pull:

    .claude/tools/ctx.sh design 2026-09-15-preflight-ground-tracking 4 5.2

**Numbering is internal to this document.** No `§` reference, run id, task id,
“design.md”, or amendment label may appear in a comment in `src/`,
`client/src/`, `agent/` or `tests/`. Where a section's reasoning belongs in the
code, the comment states the reasoning itself.

## Amendments

| # | Date | Section | What changed | Evidence that forced it |
|---|------|---------|--------------|-------------------------|
| — | —    | —       | None yet.    | —                       |

## Summary of what is frozen

* A third `FlightState`, `'GROUND'`, entered from telemetry after a 5-frame
  debounce and left only at takeoff, sim exit, crash, slew, or a 10 nm position
  jump (§1).
* Six SimVars appended — *after* `TITLE` — to the agent's flight-data
  definition, producing three **optional** `SimFrame` fields (§2).
* One new table, `ground_sessions`, with a database-enforced “at most one open
  session” invariant and no `ALTER TABLE` anywhere (§3).
* No new geometry: `findNearestAirport()` and `matchPlannedLeg()` are reused
  unmodified; only the calling code is new (§4).
* Four ground-session endpoints, one new `/api/status` key, three leg-scoped
  ACARS routes (§5).
* One generalised ACARS page reachable from two routes, one ground card on
  Home, one link per unflown planned-leg row (§6).
* Automatic detection is primary; manual entry refines or corrects it and is
  labelled in the UI as a fallback, in frozen wording (§7).

---

## 1. The ground state in `src/flightManager.ts`

Today the machine is `IDLE → FLYING → IDLE`. This section adds one state and
changes no existing transition. The airborne test, `AIRBORNE_DEBOUNCE_FRAMES`,
the landed test, `LANDED_DEBOUNCE_FRAMES`, `startFlight()`'s and `endFlight()`'s
bodies and the point-recording path are all untouched (§9).

### 1.1 The state value

`FlightState` (src/types.ts) becomes:

```ts
export type FlightState = 'IDLE' | 'GROUND' | 'FLYING' | 'ENDED';
```

`'GROUND'` is the new value. `'ENDED'` stays exactly where it is — nothing
assigns it today and nothing in this run starts to.

`'GROUND'` means: *the aircraft is parked, and an open `ground_sessions` row
describes where.* The implication runs one way only —

    flightState === 'GROUND'  ⇒  an open ground session exists
    an open ground session    ⇏  flightState === 'GROUND'

— because a manually entered session (§5.2) is an operator statement about the
world, not a telemetry claim, and may exist with no agent connected at all.
§5.5 and §7.5 depend on this asymmetry.

### 1.2 Constants

Declared beside `AIRBORNE_DEBOUNCE_FRAMES` / `LANDED_DEBOUNCE_FRAMES`, but
**exported from `src/groundState.ts`** (§4.1) so the pure module and its
inspector share one copy:

```ts
export const GROUND_DEBOUNCE_FRAMES = 5;   // frames, ~1 Hz -> ~5 s
export const GROUND_SPEED_MAX_KTS = 1;     // strict <, ground speed only
export const GROUND_REANCHOR_NM = 10;      // §4.5
```

`GROUND_DEBOUNCE_FRAMES = 5` sits deliberately above `AIRBORNE_DEBOUNCE_FRAMES`
(3) and below `LANDED_DEBOUNCE_FRAMES` (10): entering the gate state is not
urgent — nothing is lost by taking five seconds — but a parked aircraft is a
far quieter signal than a landing rollout, so it needs less settling than a
touchdown does.

`GROUND_SPEED_MAX_KTS = 1` is compared **strictly less than**, against
`groundSpeedKnots` only. Indicated airspeed is not used: a parked aircraft in a
20 kt wind reads 20 kt IAS, and a rule built on it would never fire at an
exposed stand.

### 1.3 Entry (`IDLE → GROUND`)

Entry requires `GROUND_DEBOUNCE_FRAMES` **consecutive** frames for which
`isParkedFrame(frame)` (§4.1) is true. The predicate, stated here in full so it
can be implemented twice and agree:

```
isParkedFrame(frame) :=
      frame.simRunning !== 0
  &&  frame.simRunning !== 3                      // not slew
  &&  frame.onGround === true
  &&  frame.groundSpeedKnots < 1                  // GROUND_SPEED_MAX_KTS, strict
  && (   (frame.enginesRunning !== undefined && frame.enginesRunning === 0)
      || frame.parkingBrake === true )
```

The last clause is the whole of “parked”: **engines off, or parking brake set.**
Either alone is enough — cold-and-dark and ready-for-taxi-at-the-gate are both
real pre-flight states. When neither field is present (an agent that predates
this run, §2.4) the clause is false and the state is never entered; that is the
designed degradation, not an oversight.

A single non-qualifying frame resets the counter to 0. It is not decremented
and there is no hysteresis: one 4 kt lurch on a slope costs five seconds, which
costs nothing.

Pause does **not** block entry. Cockpit prep at the gate with the sim paused is
the normal case this feature exists for, and `isPaused` suppresses point
recording, which is the only thing pausing is supposed to suppress. Slew does
block it, for the same reason slew blocks `IDLE → FLYING` today.

On the frame that trips the debounce, in this order:

1. `getOpenGroundSession()` (§3.3).
   * **None** → resolve the airport (§4.2), match a planned leg (§4.3), insert a
     row with `source = 'auto'` (§3.3).
   * **An open row exists** → adopt it; do not insert. Fill only columns that
     are `NULL`, per §7.2. Never rewrite `source`.
2. Remember the session id and the anchor position (`frame.lat`, `frame.lon`)
   in memory for §4.5 and §5.5.
3. `this.state = 'GROUND'; this.appState.flightState = 'GROUND';`
   `this.groundStreak = 0;`
4. Log one line: `[FlightManager] Ground session #<id> — <ICAO or 'no airport
   within 10 nm'>`, plus the leg-match reason exactly as `autoLinkPlannedLeg()`
   already logs refusals.

No `flights` row is created, no point is recorded, and
`appState.currentFlightId` stays `null`. A ground session is not a flight.

### 1.4 While in `GROUND`

Nothing is written per frame. Specifically: no `insertPoint`, no distance or
duration accumulation, no `findNearestAirport` call (it is O(number of
airports) and is budgeted at one call per session, §4.2), no leg re-match.

Taxiing does **not** leave the state. The session covers everything from
engines-off to rotation — pushback, taxi and the hold are part of the
pre-flight, and the ACARS context must not vanish at the moment the crew starts
using it. The state ends at rotation or when the session is contradicted; see
§1.5.

### 1.5 Exits

| From `GROUND`, when | Session closed with `ended_reason` | New state |
|---|---|---|
| The airborne test passes for `AIRBORNE_DEBOUNCE_FRAMES` frames — identical predicate and constant as from `IDLE` | `'flight-started'`, and `flight_id` set to the new flight's id | `FLYING` |
| `frame.simRunning === 0` | `'sim-exit'` | `IDLE` |
| `frame.simRunning === 3` (slew) | `'slew'` | `IDLE` |
| Position is more than `GROUND_REANCHOR_NM` from the anchor (§4.5) | `'superseded'` | `IDLE` |
| `onSimDisconnect()` — only if the session is `source = 'auto'` (§7.4) | `'sim-exit'` | `IDLE` |
| `onCrash()` — only if the session is `source = 'auto'` (§7.4) | `'crash'` | `IDLE` |
| `DELETE /api/ground-sessions/current` (§5.4) | `'manual'` | `IDLE` |

On the takeoff path the close happens **inside `startFlight()`**, after
`insertFlight()` returns, so the id exists to stamp; it is wrapped in its own
`try/catch` that logs and swallows, for exactly the reason
`autoLinkPlannedLeg()` does: nothing about a ground session may stand between a
sim session and the flight row that records it.

On every other path the close happens before the state assignment, also inside
a `try/catch` that logs and swallows. A close that failed leaves an open row
that the next entry adopts (§7.2) or that the operator clears (§5.4); neither
is worse than a thrown exception in the frame handler.

`FLYING → GROUND` is **not** a transition. `endFlight()` still goes to `IDLE`,
unchanged; the aircraft then re-enters `GROUND` through §1.3 five frames after
it is parked, which is how “cold-and-dark shutdown after a flight” produces a
session at the arrival airport.

### 1.6 `onCrash()`, `onSimDisconnect()`, `setPaused()`

Both `onCrash()` and `onSimDisconnect()` today read:

```ts
if (this.state === 'FLYING' && this.appState.lastFrame) this.endFlight(...);
```

That branch is unchanged. Each gains an `else if (this.state === 'GROUND')`
branch that closes an `'auto'` session with `'crash'` / `'sim-exit'`
respectively and sets `IDLE`. A `'manual'` session is left open and the state
still returns to `IDLE` — see §7.4 for why absence of the agent is not evidence
against something the operator typed.

`setPaused()` is unchanged and has no effect on `GROUND` (§1.3).

### 1.7 Ordering inside `onFrame()`

The `IDLE` case keeps its existing `if / else` for the airborne streak
**byte-for-byte**, and the ground test is appended after it, guarded so it
cannot run in the same frame that started a flight:

```
case 'IDLE':
    <existing airborne block, unchanged>
    if (this.state !== 'IDLE') break;      // startFlight() already ran
    <ground debounce block>
    break;

case 'GROUND':
    <slew / re-anchor checks>              // §1.5
    <the same airborne block as IDLE>      // shared helper or duplicated verbatim
    break;
```

The two streak counters are independent: the airborne block resets only
`airborneStreak`, the ground block only `groundStreak`. The `simRunning === 0`
early-return at the top of `onFrame()` gains the `GROUND` close described in
§1.5 and otherwise keeps its shape.

---

## 2. Agent → server telemetry contract

Every name below was checked against the MSFS SDK SimVar reference, not
inferred (§11). The agent change is additive and mechanical: six entries in one
data definition, six reads, three keys on the posted frame.

### 2.1 SimVars appended to `DEF_FLIGHT_DATA`

Added **after** the existing `TITLE` entry (§2.5), in exactly this order:

| # | SimVar string | Unit argument | `SimConnectDataType` | Bytes |
|---|---|---|---|---|
| 11 | `'BRAKE PARKING INDICATOR'` | `'bool'` | `INT32` | 4 |
| 12 | `'NUMBER OF ENGINES'` | `'number'` | `INT32` | 4 |
| 13 | `'GENERAL ENG COMBUSTION:1'` | `'bool'` | `INT32` | 4 |
| 14 | `'GENERAL ENG COMBUSTION:2'` | `'bool'` | `INT32` | 4 |
| 15 | `'GENERAL ENG COMBUSTION:3'` | `'bool'` | `INT32` | 4 |
| 16 | `'GENERAL ENG COMBUSTION:4'` | `'bool'` | `INT32` | 4 |

i.e. six calls in the established shape:

```js
handle.addToDataDefinition(DEF_FLIGHT_DATA, 'BRAKE PARKING INDICATOR', 'bool', SimConnectDataType.INT32);
```

Why these four exact things:

* **`BRAKE PARKING INDICATOR`**, not `PARKING BRAKE POSITION` (which does not
  exist) and not `BRAKE PARKING POSITION`. The SDK documents
  `BRAKE PARKING INDICATOR` as `Bool`, non-settable — a read-only indicator,
  which is precisely what this is. `BRAKE PARKING POSITION` is documented as a
  settable position value and is the one developers report trouble with.
* **Indices 1..4 fixed.** The SDK documents `NUMBER OF ENGINES` as “minimum 0,
  maximum 4”, so four indices cover every aircraft and the data block keeps a
  constant size. A definition rebuilt per aircraft would be a new mechanism;
  this is six more rows in a table.
* `NUMBER OF ENGINES` is read so a single-engine aircraft is not reported as
  “1 of 4 running”; combustion flags above the engine count are ignored (§2.2).

`DEF_TRAFFIC` is not touched. No system event is added: `FlightLoaded` stays
logged-and-dropped as it is today, and the “operator loaded a new flight
somewhere else” case is handled server-side by the re-anchor rule (§4.5)
instead of by a new event type.

### 2.2 Read order in the `simObjectData` handler

The existing ten reads are unchanged and stay in their current order, ending
with `const aircraft = data.readString256() ?? 'Unknown';`. Appended after them:

```js
// Guarded, not assumed: if the sim rejected any of the new definition entries
// the block is short, and reading past its end throws a RangeError that would
// take the whole frame with it. 6 x INT32 = 24 bytes.
const hasGroundVars = data.remaining() >= 24;

const parkingBrakeRaw = hasGroundVars ? data.readInt32() : 0;
const engineCountRaw  = hasGroundVars ? data.readInt32() : 0;
const combustion      = hasGroundVars
  ? [data.readInt32(), data.readInt32(), data.readInt32(), data.readInt32()]
  : [];
```

Derivation, frozen:

```
engineCount    = Math.max(0, Math.min(4, engineCountRaw))
enginesRunning = combustion.slice(0, engineCount).filter(v => v !== 0).length
parkingBrake   = parkingBrakeRaw !== 0
```

`enginesRunning` counts only the first `engineCount` flags, so a twin never
reports four.

### 2.3 The new `SimFrame` fields

The frame object posted to `/api/ingest/frame` keeps every existing key, in its
existing order, and appends these three **only when `hasGroundVars` is true**:

| Field | Type | Meaning |
|---|---|---|
| `parkingBrake` | `boolean` | `BRAKE PARKING INDICATOR !== 0` |
| `engineCount` | `number` | `NUMBER OF ENGINES`, clamped to 0..4 |
| `enginesRunning` | `number` | How many of engines 1..`engineCount` are burning |

When `hasGroundVars` is false the three keys are **omitted entirely** — not
sent as `null`, not sent as `0`. “Absent” is the only representation of
“unknown”, and §1.3 treats unknown as not-parked.

`src/types.ts`:

```ts
export interface SimFrame {
  // ... every existing field unchanged ...
  /** Absent when the agent predates this field or the sim rejected the SimVar. */
  parkingBrake?: boolean;
  engineCount?: number;
  enginesRunning?: number;
}
```

Sample payloads: `contracts/samples/frame-with-ground-telemetry.json` and
`contracts/samples/frame-from-old-agent.json`.

### 2.4 `isValidFrame()` in `src/ingest.ts`

The ten existing predicates are unchanged. Three are appended, in the same
`typeof`-per-field style, each admitting absence:

```ts
(f.parkingBrake === undefined || typeof f.parkingBrake === 'boolean') &&
(f.engineCount === undefined || (typeof f.engineCount === 'number' && Number.isFinite(f.engineCount))) &&
(f.enginesRunning === undefined || (typeof f.enginesRunning === 'number' && Number.isFinite(f.enginesRunning)))
```

A frame carrying a *wrong-typed* new field is still rejected with 400 — that is
a broken sender. A frame *omitting* them is accepted, because that is the
operator's current agent, on a Windows box that is upgraded by hand and
separately from this server.

### 2.5 Why the new entries go after `TITLE`

A SimConnect data block is positional: the reads only line up because the
registration order does. If the sim refuses one entry (an unknown name on some
build, a variable withdrawn in a future update), the block is **shorter**, and
every read after the missing item decodes the wrong bytes. Placing the new
entries last means a rejected new SimVar can corrupt nothing that exists today
— latitude stays latitude — and the `remaining()` guard turns the failure into
three absent fields instead of a thrown `RangeError`.

This is verified, not assumed: in `node-simconnect` 4.2.0,
`RecvSimObjectData.data` is a `RawBuffer` whose `limit` is the received
packet's length, `remaining()` is a public method returning `limit - offset`,
and every read goes through `assertReadable()`, which throws
`RangeError('Illegal offset: …')` past the end (§11). An uncaught throw inside
the `simObjectData` listener takes down the agent's frame loop, i.e. all flight
logging — which is why the guard is part of the frozen contract and not an
implementer's discretion.

### 2.6 Deviation from the plan's stated acceptance criterion

The plan's record for the flightManager task says “a frame missing one is
rejected with 400, not silently defaulted.” This design deliberately does the
opposite, and the Reviewer should read §2.4 rather than that line. Rejecting
frames that omit the new fields would mean: the moment the operator restarts
their server with this feature, and until they separately update and restart
the agent on the MSFS machine, **every frame is 400 and no flight is logged at
all.** The agent is deployed by hand on another host (it is a standing gotcha
in this project's memory), so that window is real and unbounded. Nothing is
“silently defaulted”: an absent field is absent all the way through, and its
only consequence is that ground detection does not fire.

---

## 3. Persistence

### 3.1 DDL

Verbatim, pasteable into the `db.exec(\`…\`)` literal in `applySchema()`
(`src/db/schema.ts`), placed after the `acars_messages` block and its indexes
and before the `auth_user` block. The full commented copy is
`contracts/ground-sessions.sql`; the statements are:

```sql
    CREATE TABLE IF NOT EXISTS ground_sessions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      source                  TEXT    NOT NULL CHECK (source IN ('auto', 'manual')),
      airport_icao            TEXT,
      airport_name            TEXT,
      lat                     REAL,
      lon                     REAL,
      parking_position        TEXT,
      parking_position_source TEXT    CHECK (parking_position_source IN ('auto', 'manual')),
      planned_leg_id          INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL,
      planned_leg_link_source TEXT    CHECK (planned_leg_link_source IN ('auto', 'manual')),
      aircraft                TEXT,
      started_at              TEXT    NOT NULL,
      ended_at                TEXT,
      ended_reason            TEXT,
      flight_id               INTEGER REFERENCES flights(id) ON DELETE SET NULL,
      created_at              TEXT    NOT NULL,
      updated_at              TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ground_sessions_started ON ground_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_ground_sessions_leg     ON ground_sessions(planned_leg_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ground_sessions_open
      ON ground_sessions(ended_at IS NULL) WHERE ended_at IS NULL;
```

Column notes that are contract, not commentary:

* `source` is written once, at insert, and **never rewritten** (§7.2). The
  finer grain lives in `parking_position_source` and
  `planned_leg_link_source`, so “detected the airport, operator named the
  stand” is representable without lying about either.
* `lat` / `lon` are the **aircraft's** position at entry, not the airport's.
  It is the more precise fact, it is what §4.5 measures against, and
  `findNearestAirport()` does not return airport coordinates anyway. Both are
  `NULL` on a manual session (the endpoint has no position to record).
* `airport_icao` is nullable, and an automatic session is created even when no
  airport resolves within 10 nm. The row is what the manual fallback attaches
  to (§7.2); refusing to create it would leave the operator with nothing to
  correct.
* `ended_reason` has no `CHECK`, for the reason `acars_messages.category` has
  none: a later reason must not require a table rewrite. Its vocabulary is in
  §1.5.
* Both foreign keys are `ON DELETE SET NULL`. A ground session records that the
  aircraft sat somewhere; deleting the leg or the flight does not make that
  untrue.
* The partial `UNIQUE` index is the “at most one open session” invariant, in
  the same spirit as `idx_trips_active`. The expression is load-bearing:
  SQLite treats `NULL`s in a unique index as distinct, so `UNIQUE(ended_at)`
  would constrain nothing; `ended_at IS NULL` evaluates to the integer `1` for
  every covered row, and uniqueness over that is exactly the invariant. A
  `SQLITE_CONSTRAINT` from it means a caller opened a session without closing
  the previous one — fix the caller, never the index.

### 3.2 No `ALTER TABLE`, and why

This design adds **no column to any existing table**, so it adds no
`PRAGMA table_info` guard. The flight ↔ session link lives on the new table's
side (`ground_sessions.flight_id`), which is the direction that needs no
migration on a database already holding the operator's 55 flights and 22
planned legs. `CREATE TABLE IF NOT EXISTS` is itself the idempotence guard for
a brand-new table; the `PRAGMA` idiom exists only for columns added to tables
that already shipped.

Applying the DDL is safe while the live server holds the database open in WAL
mode, and re-applying it is a no-op — both measured, not assumed (§11).

### 3.3 `src/db/groundSessions.ts` — the function surface

A new module beside `src/db/acarsMessages.ts`, same rules: no `express`, no
`http`, no route logic; reads never use `SELECT *`; the column list is written
out in DDL order so a column added later cannot silently change a response
shape.

```ts
const COLUMNS = `
  id, source, airport_icao, airport_name, lat, lon,
  parking_position, parking_position_source,
  planned_leg_id, planned_leg_link_source, aircraft,
  started_at, ended_at, ended_reason, flight_id, created_at, updated_at
`;

/** Inserts an open session and returns the stored row. Throws if one is already open. */
export function insertGroundSession(input: CreateGroundSession): GroundSession;

/** The open row, or null. */
export function getOpenGroundSession(): GroundSession | null;

export function getGroundSessionById(id: number): GroundSession | null;

/** Stamps ended_at/ended_reason (and flight_id when given). No-op returning null if none is open. */
export function closeOpenGroundSession(
  reason: GroundSessionEndReason, flightId?: number | null,
): GroundSession | null;

/** Sets parking_position + parking_position_source on the open row. */
export function updateOpenGroundSessionParking(
  parkingPosition: string | null, source: GroundSessionSource,
): GroundSession | null;

/** §7.2's adopt step: writes ONLY the columns that are currently NULL. */
export function fillOpenGroundSessionGaps(patch: Partial<CreateGroundSession>): GroundSession | null;

/** Most recent first. For a future history view; capped by `limit`. */
export function listGroundSessions(limit: number): GroundSession[];
```

`updated_at` is set by every write; `created_at` and `started_at` only at
insert. Every multi-statement function runs inside `getDb().transaction(...)`,
as `insertAcarsMessage` does.

**Import path.** Callers import from `'./db/groundSessions'` (or
`'../db/groundSessions'`) directly, exactly as `src/routes/acars.ts` imports
`'../db/acarsMessages'`. `src/db.ts` is **not** edited in this run — it is in no
task's allowed paths — so these functions are deliberately not part of the
`./db` barrel.

### 3.4 If a later amendment adds a column

Then, and only then, the established guard applies — appended after the
`db.exec` block in `applySchema()`, in the same style as the `flights`
migrations:

```ts
const groundCols = (db.prepare('PRAGMA table_info(ground_sessions)').all() as { name: string }[]).map(c => c.name);
if (!groundCols.includes('<new_column>')) {
  db.exec('ALTER TABLE ground_sessions ADD COLUMN <new_column> TEXT');
}
```

A column is never dropped or repurposed under live rows.

---

## 4. Detection and auto-link algorithm

**No new geo-matching algorithm is invented by this run.**
`findNearestAirport()` (`src/airports.ts`) and `matchPlannedLeg()`
(`src/legMatcher.ts`) are reused **as-is, unmodified**, with the same
`DEPARTURE_RADIUS_NM` candidate set `autoLinkPlannedLeg()` already uses. Only
the calling code is new. Neither file is in any implementation task's allowed
paths, and that is intentional.

### 4.1 The pure module `src/groundState.ts`

Isolated the same way `src/legMatcher.ts` is: no `db` import, no `express`
import, no I/O, no clock. It owns the three constants from §1.2 and exports:

```ts
/** §1.3's predicate, in full. The only place it exists. */
export function isParkedFrame(frame: SimFrame): boolean;

/** streak + 1 when parked, else 0. Pure; the caller holds the counter. */
export function nextParkedStreak(streak: number, frame: SimFrame): number;

/** streak >= GROUND_DEBOUNCE_FRAMES. */
export function hasParkedDebounce(streak: number): boolean;

/** §4.5. Uses haversineNm from src/geo.ts — the same helper legMatcher.ts uses. */
export function hasLeftAnchor(
  anchorLat: number, anchorLon: number, lat: number, lon: number,
): boolean;
```

`FlightManager` holds `groundStreak: number` and the anchor, exactly as it
already holds `airborneStreak` / `landedStreak`. The decision lives in the pure
module; the state lives in the machine.

### 4.2 Airport resolution

```ts
const ap = findNearestAirport(frame.lat, frame.lon);   // default maxNm = 10
```

Called **exactly once per session entry**, from the same kind of place
`startFlight()` calls it, and never from `onFrame`/`recordPoint`. The default
radius is kept — sharing the number with `DEPARTURE_RADIUS_NM` is why a
session's `airport_icao` and a matched leg's `departure_ident` either agree or
both abstain (`legMatcher.ts`'s own reasoning, reused here rather than
re-derived).

`ap` is `{ icao, name } | null`; `null` means `airport_icao` and `airport_name`
stay `NULL` and the session is still created (§3.1).

### 4.3 Planned-leg matching

```ts
const result = matchPlannedLeg({
  lat: frame.lat,
  lon: frame.lon,
  startTime,                                  // ISO, for the log only
  aircraft: frame.aircraft,
  activeTripId: getActiveTripId(),
  candidates: getPlannedLegCandidatesForActiveTrip(),
  flightAlreadyLinkedTo: null,
});
```

Identical arguments to `autoLinkPlannedLeg()`, no `radiusNm` override, same
`DEPARTURE_RADIUS_NM`. On `result.reason === 'MATCHED'`, the session gets
`planned_leg_id = result.plannedLegId` and
`planned_leg_link_source = 'auto'`. Every other reason leaves both `NULL` and
logs the refusal with its reason code, in the shape `describeRefusal()` already
produces.

What this **must not** do, and the Reviewer should check each one:

* It does not write `flights.planned_leg_id` and does not call
  `linkFlightToPlannedLeg()`. A ground session does not consume a leg.
* It does not change `planned_legs.status` and does not call
  `recordPlannedLegArrival()`.
* It therefore cannot make a leg look `LEG_ALREADY_LINKED` to the takeoff
  matcher later: `matchPlannedLeg()` reads `linkedFlightId`, which only a
  `flights` row sets. The existing takeoff auto-link stays authoritative and
  unchanged (§9).
* The whole block is inside one `try/catch` that logs and swallows, mirroring
  `autoLinkPlannedLeg()`: a leg-match failure degrades to an unlinked session,
  never to a lost session or a thrown frame handler.

### 4.4 Parking position on the automatic path

No SimVar publishes the parking spot's name (§8.2), so the automatic path has
exactly one honest source: a matched leg's `planned_legs.departure_start` —
Little Navmap's `<Departure>` element, the stand the plan starts at.

```
if a leg matched and leg.departure_start is non-null:
    parking_position        = leg.departure_start
    parking_position_source = 'auto'
else:
    both stay NULL
```

`departure_start` is commonly `NULL` in real files (the schema says so), so in
practice the stand usually comes from the operator (§5.2) — which is exactly
the case the manual fallback exists for, and the honest division of labour
between §7's two paths.

### 4.5 The re-anchor rule

The anchor is the aircraft position recorded at entry (§1.3 step 2). On every
frame while in `GROUND`:

```
hasLeftAnchor(anchorLat, anchorLon, frame.lat, frame.lon)
  := haversineNm(anchorLat, anchorLon, frame.lat, frame.lon) > GROUND_REANCHOR_NM   // 10
```

True → close the session with `'superseded'`, go to `IDLE`, reset
`groundStreak` to 0. The next five parked frames open a fresh session at the
new place.

This is how “the operator loaded a different flight at a different airport”
resolves without a new agent event: MSFS teleports the aircraft, the anchor
check fires on the first frame after the jump, and the stale session closes.
Ten nautical miles is chosen to match `DEPARTURE_RADIUS_NM` and
`findNearestAirport`'s default: below it the session's airport is still the
right airport, above it, by construction, it may not be. No real taxi covers 10
nm, and a real flight leaves through `FLYING`.

For a manual session with `NULL` coordinates that the machine has adopted, the
anchor is the first `GROUND` frame's position, held in memory only; the row's
`lat`/`lon` are filled by the same adopt step (§7.2), since they were `NULL`.

### 4.6 The CLI inspector `src/inspect-groundstate.ts`

Mirrors `src/inspect-legmatch.ts`'s harness exactly: a shebang, a header
explaining what is real and what is synthetic, a `SCENARIOS` table of
`{ name, frames, expectEntryAt }`, expected-vs-actual printed per row, and
`process.exitCode = 1` if any row disagrees. Run with
`npx ts-node src/inspect-groundstate.ts`.

The table must contain at least these fourteen rows, which are already written
and passing as a reference oracle in
`prototypes/ground-entry-rule.js` (§11) — reproduce them against the real
`src/groundState.ts`:

1. cold and dark at a gate — enters on the 5th qualifying frame, not the 4th
2. ready-for-taxi spawn (engines running, brake set) — enters
3. engines running, brake released, stationary at the hold — never enters
4. taxiing with the brake released — never enters
5. engines off but rolling at 3 kts (pushback/tow) — never enters
6. exactly 1.0 kt ground speed — never enters (the comparison is strict)
7. 0.9 kt — enters
8. a one-frame jolt resets the streak — entry slips by exactly one frame
9. slew at the gate — never enters
10. `simRunning === 0` — never enters
11. an old agent's frames (no new fields at all) — never enters, never throws
12. old agent, then updated mid-session — enters 5 frames after the first
    complete frame
13. cold-and-dark shutdown after a flight (taxi in, brake, cut engines)
14. engine failure **in the air** — never enters, because `onGround` is false

Plus one row the harness asserts separately: a takeoff sequence trips the
airborne debounce at the same frame index with and without the new fields
present — the `IDLE → FLYING` rule is unchanged (§9).

---

## 5. REST surface

### 5.1 Router, mounting, auth

New file `src/routes/groundSessions.ts` exporting
`createGroundSessionsRouter(flightManager: FlightManager): Router`. It takes the
manager because two things need it: `aircraft` for a manual session comes from
`flightManager.appState.lastFrame?.aircraft ?? null`, and every write calls
`flightManager.refreshGroundSession()` so the live cache behind §5.5 cannot
drift from the row — the same problem, and the same solution, as
`refreshPlannedLegForFlight()` for manual leg links.

Mounted in `src/server.ts` with `app.use('/api', createGroundSessionsRouter(flightManager));`
after the ACARS router and **before** the SPA catch-all. It therefore sits
behind `app.use('/api', requireAuth)` and `requireSameOrigin`, like every other
non-ingest route.

One further change in `src/server.ts`: the scoped `SyntaxError` handler at the
bottom (which turns a malformed JSON body into `{ error, code: 'INVALID_BODY' }`
for the settings and ACARS paths) gains
`|| req.path === '/api/ground-sessions' || req.path === '/api/ground-sessions/current'`.
Its existing `endsWith('/acars-messages')` and `endsWith('/acars-messages/wx')`
clauses already cover the new leg-scoped routes in §5.6 — no change needed
there.

All bodies are `application/json`. All error bodies are
`{ error: string, code: string }` (`GroundSessionErrorBody`, §6.1).

### 5.2 `POST /api/ground-sessions` — manual entry

Request body (`CreateGroundSessionRequest`):

```json
{ "icao": "EGLL", "parking_position": "Stand 231", "planned_leg_id": 17 }
```

* `icao` — **required**. Normalised with `normaliseIcao()` and validated with
  `isValidIcaoShape()` from `src/acars.ts` (reused, not reimplemented).
* `parking_position` — optional, trimmed, max 120 characters; `''` and absent
  both store `NULL`.
* `planned_leg_id` — optional; must exist.

Behaviour, by what is already open (this is §7.3 in endpoint form):

| Open session | Action | Status | Body |
|---|---|---|---|
| none | insert `source = 'manual'`, `parking_position_source = 'manual'` when a stand was given, `planned_leg_link_source = 'manual'` when a leg was given, `lat`/`lon` `NULL`, `aircraft` from the last frame | **201** | `GroundSession` |
| `source = 'auto'`, **same** `airport_icao` | refine in place: set the stand and/or the leg, `source` stays `'auto'`, the `*_source` columns for what was given become `'manual'` | **200** | the updated `GroundSession` |
| `source = 'auto'`, **different** `airport_icao` (or it was `NULL`) | close it with `'corrected'`, insert the manual one | **201** | the new `GroundSession` |
| `source = 'manual'` | close it with `'superseded'`, insert the new one | **201** | the new `GroundSession` |

Both branches that close-then-insert run in one transaction, so the partial
unique index can never see two open rows.

Errors: `400 INVALID_BODY` (not a JSON object, or `icao` missing/not a string),
`400 INVALID_ICAO` (fails `isValidIcaoShape`), `404 PLANNED_LEG_NOT_FOUND`,
`500 { error }`.

Sample request and both response shapes:
`contracts/samples/ground-session-manual-request.json`,
`contracts/samples/ground-session-auto.json`,
`contracts/samples/ground-session-auto-refined-by-operator.json`.

### 5.3 `GET /api/ground-sessions/current`

Always **200**, never 404:

```json
{ "session": null }
```

or `{ "session": { …GroundSession… } }`. An envelope rather than a bare row or
a bare `null`, so “no session” needs no status-code special case in the client
and a future `{ session, recent }` needs no new type.

### 5.4 `PATCH` and `DELETE /api/ground-sessions/current`

`PATCH` body `{ "parking_position": "Gate A12" }` (`UpdateGroundSessionRequest`;
`null` or `''` clears it). Sets `parking_position` and
`parking_position_source = 'manual'` on the open row, whatever its `source`.
**200** with the updated `GroundSession`; `404 NO_OPEN_GROUND_SESSION` when
none is open; `400 INVALID_BODY` when `parking_position` is neither a string
nor `null`.

`DELETE` closes the open row with `ended_reason = 'manual'` and returns **200**
with the closed `GroundSession`; `404 NO_OPEN_GROUND_SESSION` otherwise. If the
machine was in `GROUND`, it returns to `IDLE` (§1.5) — that is what
`flightManager.refreshGroundSession()` does when it finds no open row.

### 5.5 `GET /api/status`

Exactly one key is added, `groundSession`, spread in by the same conditional
idiom `plannedLeg` and `traffic` already use:

```ts
const groundSession = flightState === 'GROUND'
  ? flightManager.getGroundSessionStatus()
  : null;
...
  ...(plannedLeg ? { plannedLeg } : {}),
  ...(groundSession ? { groundSession } : {}),
  ...(traffic.length ? { traffic } : {}),
```

**Present if and only if `flightState === 'GROUND'`.** Never `null`, never an
empty object. In every other state the response is byte-identical to today's —
that is the test the Reviewer should run.

`getGroundSessionStatus()` returns `GroundSessionLiveStatus` (§6.1) from an
in-memory cache built at entry and rebuilt by `refreshGroundSession()`; it
issues no query per poll, for the reason `getPlannedLegStatus()` issues none.
`tripId` / `tripName` / `departureIdent` / `destinationIdent` come from the
matched leg at cache-build time (`getPlannedLegById`, `getTripName` — the same
two reads `buildPlannedLegCache()` already makes) and are `null` when the
session has no leg.

Full example: `contracts/samples/status-ground.json`.

### 5.6 Leg-scoped ACARS routes

Added to `src/routes/acars.ts`, beside the loadsheet route that is already
leg-scoped. Each is the flight-scoped route's twin with `planned_leg_id` where
`flight_id` was; all validation reuses the pure helpers in `src/acars.ts`
(`findCannedMessage`, `findCannedMessageByBody`, `cannedMessageIdList`,
`CLIENT_DIRECTION`, `normaliseIcao`, `isValidIcaoShape`, the WX body builders) —
no validation logic is duplicated. Existence is checked with
`getPlannedLegById(legId)`; missing → `404 PLANNED_LEG_NOT_FOUND`; a
non-numeric id → `400 INVALID_ID`.

**`GET /api/planned-legs/:legId/acars-messages`** → **200**
`PlannedLegAcarsThread`:

```json
{ "planned_leg_id": 17, "messages": [ /* AcarsMessage, sent_at ASC, id ASC */ ] }
```

The read is `listAcarsMessagesForPlannedLeg(legId)` from
`src/db/acarsMessages.ts` — already written, currently unused, built for
exactly this. Leg rows only: once a flight exists and is linked, the
flight-scoped thread is the superset view and stays the place to read it.
Example: `contracts/samples/planned-leg-acars-thread.json`.

**`POST /api/planned-legs/:legId/acars-messages`** — canned message. Request
body is `SendCannedAcarsMessageRequest`, unchanged: `{ canned_id }` preferred,
`{ body }` accepted, `direction`/`category` rejected when they disagree.
Everything stored comes from the canned entry; the insert carries
`planned_leg_id: legId` and no `flight_id`. **201** with the stored
`AcarsMessage`. Errors, identical to the flight-scoped route: `400
UNKNOWN_CANNED_MESSAGE`, `400 NOT_A_CANNED_MESSAGE`, `400 INVALID_BODY`,
`403 DIRECTION_NOT_PERMITTED`, `403 CATEGORY_NOT_PERMITTED`. No dedup — pressing
the button twice files two messages, as on a real MCDU.

**`POST /api/planned-legs/:legId/acars-messages/wx`** — request body
`{ "icao": "EGLL" }`. Same flow as the flight-scoped WX route, including that
“no METAR on file” and a `WeatherFetchError` are both successful outcomes that
file a rejection reply. **201** with `PlannedLegWxRequestResponse` (§6.1) —
`WxRequestResponse` field for field, with `planned_leg_id` replacing
`flight_id`. Errors: `400 INVALID_BODY`, `400 INVALID_ICAO`,
`404 PLANNED_LEG_NOT_FOUND`.

**`POST /api/planned-legs/:legId/acars-messages/loadsheet` already exists** and
is unchanged by this run (§9). It is listed here because the client page in
§6.2 calls all four.

No leg status is checked by any of these: a `skipped` or `flown` leg still
answers, exactly as the loadsheet route already does. Refusing would be a new
rule, and this run adds none.

---

## 6. Client contract

### 6.1 Types and their owning file

`src/types.ts` owns the declarations; `client/src/types.ts` mirrors them **by
hand**, and neither file imports from the other — the rule `SimFrame`,
`StatusFrame`, `TrafficObject` and the ACARS shapes already follow. Full text:
`contracts/server-types.d.ts` and `contracts/client-types.d.ts`.

Added to **both** files, identically:

| Type | Kind | Fields |
|---|---|---|
| `GroundSessionSource` | union | `'auto' \| 'manual'` |
| `GroundSessionEndReason` | open union | `'flight-started' \| 'sim-exit' \| 'crash' \| 'slew' \| 'superseded' \| 'corrected' \| 'manual' \| (string & {})` |
| `GroundSession` | row | `id`, `source`, `airport_icao`, `airport_name`, `lat`, `lon`, `parking_position`, `parking_position_source`, `planned_leg_id`, `planned_leg_link_source`, `aircraft`, `started_at`, `ended_at`, `ended_reason`, `flight_id`, `created_at`, `updated_at` — nullability exactly as §3.1 |
| `CreateGroundSessionRequest` | request | `icao: string`, `parking_position?: string \| null`, `planned_leg_id?: number \| null` |
| `UpdateGroundSessionRequest` | request | `parking_position: string \| null` |
| `CurrentGroundSessionResponse` | response | `session: GroundSession \| null` |
| `GroundSessionLiveStatus` | computed | `groundSessionId`, `source`, `airportIcao`, `airportName`, `parkingPosition`, `parkingPositionSource`, `plannedLegId`, `plannedLegLinkSource`, `tripId`, `tripName`, `departureIdent`, `destinationIdent`, `startedAt` |
| `PlannedLegAcarsThread` | response | `planned_leg_id: number`, `messages: AcarsMessage[]` |
| `PlannedLegWxRequestResponse` | response | `planned_leg_id`, `icao`, `available`, `request`, `reply`, `weather` |

Server-only (not mirrored): `CreateGroundSession` (the db insert argument) and
`GroundSessionErrorBody`.

Changed in both files: `Status` gains **one optional key**,
`groundSession?: GroundSessionLiveStatus`, placed between `plannedLeg` and
`traffic`. `Status.flightState` is already typed `string` on the client, so
`'GROUND'` needs no other change there.

### 6.2 Routes and components

One new client route:

```
/planned-leg/:legId/acars   ->  <AcarsMessages />
```

registered in `client/src/App.tsx` beside the existing
`/flight/:id/acars`, inside the authenticated `<Routes>` block.

**`client/src/pages/AcarsMessages.tsx` is generalised, not duplicated.** It
reads `useParams<{ id?: string; legId?: string }>()` and derives one scope:

* `legId` present → leg scope. Thread from
  `GET /api/planned-legs/:legId/acars-messages` (`PlannedLegAcarsThread`),
  canned sends to `POST /api/planned-legs/:legId/acars-messages`, WX to
  `POST /api/planned-legs/:legId/acars-messages/wx`, load sheet to the existing
  `POST /api/planned-legs/:legId/acars-messages/loadsheet`. `plannedLegId` is
  the route param, so the REQUEST LOADSHEET button is enabled from the first
  render and the departure/destination WX quick-fill buttons work via the
  existing `GET /api/planned-legs/:legId` lookup. Back link goes to the leg's
  trip; title reads `ACARS Messages — Planned leg #<legId>`.
* `id` present → flight scope: every request, label and back link exactly as
  today. **This path must be byte-for-byte unchanged in behaviour** (§9).

A sibling component would have meant a new file, and no task in this run may
create one under `client/src/pages/`; generalising also guarantees the two
scopes cannot drift apart visually.

### 6.3 The trip page link

`client/src/components/PlannedLegRows.tsx` — `GhostLegRow`'s first actions cell
gains one `<Link to={`/planned-leg/${leg.id}/acars`}>ACARS</Link>` styled as
`btn btn-ghost`, beside “Link flight”. Ghost rows are exactly the unflown legs
(`linked_flight_id === null`), so the link appears precisely where a leg has no
flights row yet — the case this run exists for — and disappears on its own once
a flight is linked, when the flight page's own ACARS link takes over.

`client/src/pages/TripDetail.tsx` needs no prop change; the link is
self-contained in the row.

### 6.4 The Home ground card and the manual form

`client/src/pages/Home.tsx` renders, above the existing flight-log content and
below `<LivePanel>`, a ground card built from **one** session object resolved in
this precedence:

1. `status.groundSession` when present (`flightState === 'GROUND'`) — the live
   one;
2. otherwise the `session` from `GET /api/ground-sessions/current`.

Both describe the same row when both exist (`groundSessionId === session.id`),
so there is no drift to reconcile; the rule only fixes which is read.

The card shows: airport (`ICAO — name`, or “Airport not resolved”), stand
(`parking_position`, or “Stand not set”), a source chip reading `Detected` for
`source === 'auto'` and `Manual entry` for `'manual'`, the linked leg's route
with a link to `/planned-leg/<id>/acars` when `planned_leg_id` is set, and
`started_at` through the existing `formatDate`.

Below the card, always rendered, the manual form: an ICAO text input, a
free-text stand input, an optional planned-leg select, a submit that
`POST`s `CreateGroundSessionRequest` to `/api/ground-sessions`, and the §7.6
wording. It is a section **inside `Home.tsx`**, not a new file.

`client/src/components/LivePanel.tsx` keeps its `flightState !== 'FLYING'`
early return unchanged; the ground card is Home's, not LivePanel's, so nothing
about the in-flight panel moves.

### 6.5 Fetch and poll behaviour

`useStatus` is unchanged — including its 1 s/3 s cadence, which means a
`GROUND` session appears within one 3 s poll of the debounce tripping, with no
reload. Home fetches `GET /api/ground-sessions/current` on mount, on its
existing 10 s `loadFlights` interval, on `visibilitychange`, and immediately
after any successful ground-session write. Every call goes through `apiFetch`
and the existing `UnauthorizedError` handling; a failed ground fetch sets a
local message and never blocks the flight log from rendering.

---

## 7. Manual vs automatic precedence

One sentence first, because everything below follows from it: **automatic
detection is the primary mechanism, and manual entry is how the operator
corrects or completes what detection could not.** Manual entry is never
presented as an equal alternative (§7.6), and neither path silently overwrites
the other's explicit statement.

### 7.1 One open session, ever

Enforced by the database (§3.1), not by convention. Every rule below is
therefore about *which* row is open and *what it contains*, never about
reconciling two.

### 7.2 Automatic entry never overwrites a manual value

When the debounce trips (§1.3) and a session is already open, the machine
**adopts** it instead of inserting:

* It writes **only columns that are currently `NULL`** — typically `lat`/`lon`
  and, if the operator did not name one, `planned_leg_id` (with
  `planned_leg_link_source = 'auto'`), plus `updated_at`.
* It never writes `source`.
* It never replaces a non-`NULL` `airport_icao`, `airport_name`,
  `parking_position` or `planned_leg_id`.
* If the airport it resolved disagrees with the open session's
  `airport_icao`, the operator's value **wins** and one line is logged naming
  both. Detection cannot silently move the aircraft to a different airport
  than the one the operator typed; §7.3 is how the operator changes their mind.

### 7.3 Manual entry over an automatic session: refine, or correct

`POST /api/ground-sessions` against an open **automatic** session (§5.2):

* **Same ICAO** → *refinement*. The row is updated in place, `source` stays
  `'auto'`, and only what the operator supplied changes, with its `*_source`
  column set to `'manual'`. Answer **200**. This is the common case: detection
  found the airport, the operator names the stand.
* **Different ICAO** → *correction*. Detection was wrong about the place, so
  its session is closed with `ended_reason = 'corrected'` and a fresh
  `source = 'manual'` session is inserted in the same transaction. Answer
  **201**.

`PATCH /api/ground-sessions/current` is refinement-only and always stamps
`parking_position_source = 'manual'`.

### 7.4 Who may close whose session

| Event | Closes an `'auto'` session | Closes a `'manual'` session |
|---|---|---|
| A flight starts (§1.5) | yes — `'flight-started'` | yes — `'flight-started'` |
| Sim exit / agent disconnect | yes — `'sim-exit'` | **no** |
| Crash | yes — `'crash'` | **no** |
| Slew | yes — `'slew'` | **no** |
| Position jumps > 10 nm (§4.5) | yes — `'superseded'` | yes — `'superseded'` |
| `DELETE /api/ground-sessions/current` | yes — `'manual'` | yes — `'manual'` |
| A new manual entry | `'corrected'` or refined (§7.3) | `'superseded'` |

The asymmetry is the point. A disconnected agent is *absence of evidence* — the
operator may be typing a stand precisely because no agent is running — while a
10 nm jump is *evidence to the contrary* and invalidates any session, however
it was created. Only the flight actually starting, or the operator, ends a
manual session otherwise.

### 7.5 What the client shows when both notions exist

Exactly one card (§6.4), sourced from `status.groundSession` when
`flightState === 'GROUND'` and from `GET /api/ground-sessions/current`
otherwise; they are the same row when both exist. The card always names its
`source` (`Detected` / `Manual entry`). The manual form stays visible and
usable in both cases — an operator must be able to correct a wrong detection
without waiting for it to end — but it is never the thing the page leads with,
and it is never rendered as a choice of two equal paths.

### 7.6 The exact wording, frozen

The manual section renders these two strings verbatim; they are the
grep-checkable artifact of this whole section:

* Section heading: **`Manual entry (fallback)`**
* Helper line directly beneath it:
  **`msfslogger detects your airport and stand automatically. Use this only when detection could not resolve your position.`**

The submit button reads **`Set ground position`**. No wording anywhere in the
client may present manual entry as the primary or the recommended path.

---

## 8. Alternatives considered

### 8.1 Tolerant vs strict frame validation

*Chosen:* the three new `SimFrame` fields are optional and a frame omitting
them is accepted (§2.4). *Rejected:* requiring them and answering 400. The
agent lives on another machine and is updated by hand; strict validation makes
a server upgrade silently stop all flight logging until the operator also
upgrades the agent. The cost of the tolerant choice is that “ground detection
never fires” has two causes (old agent, or genuinely not parked) — which one
log line at connect time resolves, and which no user ever loses data to.

### 8.2 Reading a gate name from the sim

*Rejected:* `ATC ON PARKING SPOT` and friends. It appears in community behaviour
scripts but I could not confirm it in the current SDK SimVar reference, and no
documented SimVar publishes the parking spot's *name* at all (that data lives in
the airport BGL). A data-definition entry the sim rejects shortens the block and
misaligns every read after it (§2.5), so an unverified SimVar is not a small
risk. The automatic path therefore takes a stand only from a matched leg's
`departure_start` (§4.4), and the operator supplies it otherwise — which is a
large part of why the manual fallback exists at all.

### 8.3 `GENERAL ENG COMBUSTION:index` vs `ENG COMBUSTION:index`

Both are documented `Bool`. `ENG COMBUSTION:index` reads slightly more
naturally (“True if the indexed engine is running”, non-settable), but
`GENERAL ENG COMBUSTION:index` is the one nearly every SimConnect client in the
wild reads for exactly this, so it is the better-exercised path across aircraft
add-ons. Frozen as `GENERAL ENG COMBUSTION:1..4`; switching is a one-line
amendment if a real cockpit disagrees.

### 8.4 Whether taxiing leaves the ground state

*Chosen:* it does not (§1.4) — the session runs from engines-off to rotation.
*Rejected:* closing the session when the aircraft starts moving. That would
delete the ACARS context at pushback, i.e. at the exact moment the crew starts
using it, and would make `flightState === 'GROUND'` flicker during a long taxi.
The cost is that `GROUND` is a slightly broader claim than “parked”; §1.1
states what it actually means so nothing downstream is confused by it.

### 8.5 One open session, enforced where

*Chosen:* a partial `UNIQUE` index on the expression `ended_at IS NULL`.
*Rejected:* an `is_open INTEGER` column with a partial index on it (a second
source of truth that can disagree with `ended_at`), and enforcing it only in
`src/db/groundSessions.ts` (a convention, not a guarantee). The expression
index was measured to work, including the SQLite `NULL`-distinctness trap that
makes the naive `UNIQUE(ended_at)` useless (§11).

### 8.6 A separate leg-scoped ACARS page

*Chosen:* generalise `AcarsMessages.tsx` over two route shapes (§6.2).
*Rejected:* a second page component — it would need a new file that no task in
this run is allowed to create, and two copies of a message thread drift.

### 8.7 Where the ground card lives

*Chosen:* `Home.tsx`. *Rejected:* `LivePanel.tsx`, which is the in-flight panel
and whose `flightState !== 'FLYING'` early return is relied on elsewhere;
putting a ground card inside it would mean changing that guard and touching the
flying path for a feature that never flies.

### 8.8 A `FlightLoaded` ingest event instead of the re-anchor rule

*Rejected:* the agent already receives the event but only logs it; forwarding it
would add a new field to the event protocol, a new server branch, and a new way
for the agent and server to disagree about versions. The 10 nm anchor check
(§4.5) covers the same case with arithmetic the server already does, and also
covers teleports the event does not fire for.

---

## 9. Must-not-change list

Each line is a behaviour this design guarantees is untouched. The Reviewer
should check them one at a time.

1. **`IDLE → FLYING`**: `!inSlew && !frame.onGround && frame.airspeedKnots > 30`
   for `AIRBORNE_DEBOUNCE_FRAMES = 3` consecutive frames. Same predicate, same
   constant, same frame index, whether or not the new telemetry fields are
   present.
2. **`FLYING → IDLE`**: `frame.onGround && frame.groundSpeedKnots < 5` for
   `LANDED_DEBOUNCE_FRAMES = 10`. Unchanged.
3. **`startFlight()` / `endFlight()`**: flight row insert, point recording,
   `RECORD_INTERVAL_MS`, `MAX_COUNTED_GAP_MS`, distance/duration accumulation,
   `findNearestAirport` at both ends, and the `[FlightManager]` log lines —
   all unchanged apart from the single session-close call added inside
   `startFlight()` after `insertFlight()` (§1.5).
4. **Takeoff auto-link** (`autoLinkPlannedLeg`) and **arrival recording**
   (`recordArrivalOnPlannedLeg`): unchanged, and still the only writers of
   `flights.planned_leg_id` and `planned_legs.status` (§4.3).
5. **`src/legMatcher.ts` and `src/airports.ts`**: not edited by any task in this
   run. `DEPARTURE_RADIUS_NM`, `ARRIVAL_RADIUS_NM` and `findNearestAirport`'s
   default `maxNm = 10` keep their values.
6. **`GET /api/status`** is byte-identical to today's response whenever
   `flightState !== 'GROUND'`. `plannedLeg` and `traffic` keep their exact
   presence rules.
7. **`POST /api/ingest/frame`** accepts every frame it accepts today, with the
   same 400 body for the same malformed frames, and `/api/ingest/traffic` and
   `/api/ingest/event` are untouched.
8. **Flight-scoped ACARS**: `GET`/`POST /api/flights/:id/acars-messages`,
   `POST /api/flights/:id/acars-messages/wx` and
   `POST /api/planned-legs/:legId/acars-messages/loadsheet` keep their paths,
   bodies, status codes and error codes. `AcarsThread`, `WxRequestResponse`,
   `LoadsheetRequestResponse` and `AcarsErrorBody` are not modified.
9. **`/flight/:id/acars`** renders exactly as it does today after
   `AcarsMessages.tsx` is generalised (§6.2), including its back link, title,
   subtitle and the disabled state of REQUEST LOADSHEET for an unlinked flight.
10. **The trip page's leg table**: `interleaveTripRows`, the badge vocabulary,
    the ghost-row layout and every existing action keep their behaviour; one
    link is added to the actions cell (§6.3).
11. **`src/db.ts`, `src/db/acarsMessages.ts`, `src/db/plannedLegs.ts`,
    `src/acars.ts`**: not edited. `listAcarsMessagesForPlannedLeg` is *called*
    for the first time, not changed.
12. **The existing Vitest suite passes untouched.** No fixture, helper or
    existing test file is edited to accommodate this feature; new tests go in a
    new file.
13. **`agent/traffic.js`, `DEF_TRAFFIC`, the traffic sweep and every
    pause/crash/event handler** in `agent/agent.js` are untouched, and the
    posted frame's ten existing keys keep their names and order.
14. **The live `flights.db` and the server on port 3000** are never written to
    or restarted by any task in this run.

---

## 10. Risks

1. **The SimVar names cannot be exercised here.** There is no SimConnect on
   this machine; §2's names are verified against the SDK reference and the read
   path is verified against `node-simconnect`'s source, but the first real proof
   is the operator's own sim. Falsified by: the agent logging a SimConnect
   exception at startup, or `parkingBrake`/`enginesRunning` arriving constant.
   Mitigated by §2.5 (nothing existing can misalign) and §2.4 (a short block
   degrades to absent fields).
2. **`BRAKE PARKING INDICATOR` on add-on aircraft.** Complex study-level
   aircraft sometimes drive their own brake logic through local variables and
   leave the standard SimVar idle. If so, cold-and-dark still works (engines
   off is the other half of §1.3's clause) and only the “ready-for-taxi with
   brake set, engines running” case is missed. Falsified by a report of “no
   ground session at the gate with engines running”.
3. **`enginesRunning === 0` is not exactly “cold and dark”.** An aircraft with
   engines off but avionics and APU live still reads zero. That is deliberate —
   the feature is about being parked, not about the electrical state — but it
   means a session can open during an engine-out checklist at a hold with the
   brake set. Harmless (it is still a real ground position) and visible.
4. **Adoption of a stale manual session.** An operator who types a stand and
   then flies from somewhere else without deleting it gets that manual session
   adopted at the new place only if it is within 10 nm; beyond that §4.5 closes
   it. Between 0 and 10 nm the wrong stand can survive into a new session.
   Accepted: it is the operator's own statement, one click from correcting, and
   §7.2's alternative (letting detection overwrite it) is the failure mode this
   whole section exists to prevent.
5. **`GROUND` spans pushback and taxi** (§1.4, §8.4), so “on ground, parked” is
   not what the state literally asserts for its whole life. Anything downstream
   that reads `flightState === 'GROUND'` as “stationary” would be wrong;
   nothing in this design does.
6. **Poll latency.** `useStatus` polls at 3 s outside `FLYING`, so the ground
   card can appear up to ~8 s after the aircraft is parked (5 s debounce + one
   poll). Acceptable for a pre-flight affordance; changing the cadence is out
   of scope and would affect every other consumer.
7. **`ground_sessions` grows without a retention policy.** One row per
   pre-flight is small (the operator has 55 flights), and `listGroundSessions`
   takes a limit, but nothing prunes. Revisit only if a history view ships.

---

## 11. What was prototyped, and against what

Everything below was run on this machine under Node 20
(`nvm use 20`), and its output is reproducible with the commands named.

**The DDL, against a copy of the operator's real database.**
`prototypes/ground-sessions-ddl.js`, run against a scratch copy of `flights.db`
(55 flights, 22 planned legs) taken with its `-wal` and `-shm`:

```
node .claude/runs/2026-09-15-preflight-ground-tracking/prototypes/ground-sessions-ddl.js <scratch-copy.db>
→ 9/9 checks passed
```

It proved: the DDL applies over real rows; a second application is a no-op
(identical `sqlite_master.sql`, 17 columns, no duplicates); a second *open*
session is refused with `UNIQUE constraint failed: index
'idx_ground_sessions_open'`; closing the first admits a second; six closed
sessions coexist; `CHECK constraint failed: source IN ('auto', 'manual')`
rejects an unknown source; deleting a real planned leg with
`PRAGMA foreign_keys = ON` leaves the session row standing with
`planned_leg_id` set to `NULL` (rolled back); `flights` and `planned_legs` row
counts are unchanged. The live `flights.db` md5 was
`6f68531cfcd1b04bce789cb748f19041` before and after — only the scratch copy was
written to.

**The entry rule, as a reference oracle.**
`prototypes/ground-entry-rule.js` implements §1.3/§4.1 once and runs the
fourteen scenarios of §4.6 plus the airborne-regression assertion:

```
node .claude/runs/2026-09-15-preflight-ground-tracking/prototypes/ground-entry-rule.js
→ 15/15 checks passed
```

This is what fixed the thresholds: the strict `<` on 1.0 kt, the streak reset on
a single jolt, and the two old-agent rows, each of which would otherwise have
been an implementer's judgement call.

**The SimVar names**, against the MSFS SDK SimVar reference (read 2026-09-15):

* `BRAKE PARKING INDICATOR` — `Bool`, not settable, “Parking brake indicator”.
* `BRAKE PARKING POSITION` — documented alongside it as the settable position
  form; rejected in §2.1.
* `PARKING BRAKE POSITION` — does not exist; the name in the task brief was
  approximate.
* `GENERAL ENG COMBUSTION:index` — `Bool`, settable, the indexed combustion
  flag. `ENG COMBUSTION:index` also exists (§8.3).
* `NUMBER OF ENGINES` — `Number`, not settable, “minimum 0, maximum 4”, which
  is why §2.1 stops at index 4.
* `ATC ON PARKING SPOT` — **not** confirmed in the current reference; rejected
  (§8.2).

**The frame-read failure mode**, against `node-simconnect` 4.2.0's own source
(`dist/RawBuffer.js`, `dist/recv/RecvSimObjectData.js`,
`dist/SimConnectSocket.js`): the packet's `RawBuffer` is constructed with
`limit` = the received message body's length; `remaining()` is public and
returns `limit - offset`; every read goes through `assertReadable()`, which
throws `RangeError` past the end. Hence the `data.remaining() >= 24` guard in
§2.2 and the append-after-`TITLE` rule in §2.5.

**The client gap** was confirmed by the Planner before this freeze and is not
re-derived here: `AcarsMessages.tsx` is reachable only via `/flight/:id/acars`,
and `listAcarsMessagesForPlannedLeg` exists in `src/db/acarsMessages.ts` with no
caller. §5.6 and §6.2 are built directly on that finding.
