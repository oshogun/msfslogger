# Design — 2026-09-08-ai-traffic-map

Frozen contract for gathering AI traffic from SimConnect via the Windows agent
and rendering it on the existing live map. Every field name, unit, id, limit and
timing below is normative. Downstream tasks quote it; they do not paraphrase it
and they do not re-decide it.

Read with `.claude/tools/ctx.sh design 2026-09-08-ai-traffic-map <n>`, never by
opening the whole file.

## Amendments

| # | Date | Section | What reality contradicted | Evidence |
|---|------|---------|---------------------------|----------|
| 1 | 2026-09-08 | §9.1 row S36 | The row claimed a bare `GET /api/ingest/traffic` returns `404`. It does not: `src/server.ts:776` registers `app.get('*', ...)` as an SPA catch-all after every API route, so any unmatched `GET` — this one included — returns `200 text/html` (`client/dist/index.html`). Existing behaviour, not something this run changes. | T-002 review; confirmed by reading `src/server.ts:776-778` |
| 2 | 2026-09-08 | §3.8 step 3, §3.6, §5.5/§4.6, §4.5, §10.4 | T-002 review raised five non-blocking implementability gaps, folded in during the same pass as amendment 1: (a) §3.8's finite-value filter omitted `id`, so one bad id from the sweep buffer would repeat a `400` every sweep instead of being dropped agent-side; (b) `lastSweepAt`'s initial value was unstated; (c) the file/module home of the four shared pure functions (`roundCoord`/`roundAlt`/`normHeading`/`distanceM`) was unstated even though both `src/trafficStore.ts` and `src/ingest.ts` need them; (d) `express.json()`'s default 100 KB body-size limit and its `413` weren't named as a possibility (unreachable at the ~26 KB a 200-object batch produces, but worth saying so explicitly rather than leaving it looking like an oversight); (e) §3.6's "an `outOf === 0` event is delivered for an empty sky" is inferred from the vendor sample, not observed against a running sim, and wasn't in the §10.4 risk table. | T-002 review |
| 3 | 2026-09-08 | §1.4, §3.5, §3.8 | The original §3.8 put `buildTrafficBatch` (plus the §3.5 env-var parsing) inside `agent/agent.js` itself, exported via `module.exports` behind a `require.main === module` guard, on the theory that this alone made it requireable by `agent/inspect-traffic.js` without a live SimConnect connection. It does not: `agent/agent.js`'s first statement is a top-level `require('node-simconnect')` (unconditional, not behind the guard), and that package is not installed anywhere on this machine (`agent/node_modules` does not exist) — so merely `require()`-ing `agent/agent.js` throws `Cannot find module 'node-simconnect'` regardless of the guard, which would make T-006's own acceptance criterion of a zero-dependency inspector unsatisfiable. Fix: `buildTrafficBatch`, the §3.5 env-var parsing (`TRAFFIC_ENABLED`, `trafficRadiusM`), and `MAX_BATCH_OBJECTS` move to a **new** file, `agent/traffic.js` — plain JS, no `require` of `node-simconnect` or anything else, `module.exports = { buildTrafficBatch, TRAFFIC_ENABLED, trafficRadiusM }`. `agent/agent.js` gains one line, `const { buildTrafficBatch, TRAFFIC_ENABLED, trafficRadiusM } = require('./traffic.js');`, alongside its existing requires, and no longer needs the `require.main === module` guard for testability (it may keep one if convenient, but it is no longer load-bearing). Nothing about the batch-assembly rules, field names, or truth tables in §9.2 changes — only which file the code lives in. | Direct inspection: `head -15 agent/agent.js` shows the unconditional top-level require; `ls agent/node_modules` returns "No such file or directory" |

Amendments edit the affected section in place, keep its number, and add a row
here.

## 1. Overview and data flow

### 1.1 The shape of the change

One new one-way channel is added beside the existing flight-data channel. It
shares the agent process, the HTTP ingest router, and the `/api/status` poll,
and it shares nothing else — no shared SimConnect ids, no shared server state,
no database.

```text
MSFS ──SimConnect──> agent/agent.js ──HTTP──> src/ingest.ts ──> src/flightManager.ts ──> flights.db
       REQ_FLIGHT_DATA=0                      POST /api/ingest/frame     (unchanged, untouched)
       every 1 s                              (unchanged, untouched)

MSFS ──SimConnect──> agent/agent.js ──HTTP──> src/ingest.ts ──> src/trafficStore.ts ──> GET /api/status
       REQ_TRAFFIC=1                          POST /api/ingest/traffic   in-memory only,      "traffic" key
       every 2 s, one-shot                                               never persisted      (§6)
                                                                                              │
                                                                            client/src/components/LiveMap.tsx
                                                                            one marker per object (§7)
```

The traffic path never writes to `flights.db`, never calls any `FlightManager`
method, and never changes `AppState`. Its only read of existing state is
`flightManager.appState.lastFrame`, used read-only to order objects when the
retention cap bites (§5.5).

### 1.2 Frozen constants

Every number the four implementation tasks need, in one place. These names are
the ones the code uses.

| Constant | Value | Lives in | Meaning |
|---|---|---|---|
| `DEF_TRAFFIC` | `1` | `agent/agent.js` | SimConnect data definition id for the traffic definition. Distinct from `DEF_FLIGHT_DATA = 0`. |
| `REQ_TRAFFIC` | `1` | `agent/agent.js` | SimConnect request id for the traffic sweep. Distinct from `REQ_FLIGHT_DATA = 0`. |
| `TRAFFIC_SWEEP_MS` | `2000` | `agent/agent.js` | Minimum wall-clock gap between two `requestDataOnSimObjectType` calls. |
| `TRAFFIC_RADIUS_M` (default) | `40000` | `agent/agent.js` | Sweep radius in metres (~21.6 NM). Overridable by env var, §3.5. |
| `MAX_BATCH_OBJECTS` | `200` | `src/ingest.ts` and `agent/agent.js` | Server rejects a batch with more than this many objects (§4.5). The agent truncates to this before posting (§3.8). |
| `MAX_RETAINED_OBJECTS` | `100` | `src/trafficStore.ts` | Hard cap on objects the server keeps and exposes (§5.5). |
| `TRAFFIC_STALE_MS` | `10000` | `src/trafficStore.ts` | Age past which the whole retained set is discarded (§5.4). Deliberately equal to `ingest.ts`'s existing `STALE_TIMEOUT_MS`. |

### 1.3 Decisions this design freezes

| Question (from intake) | Answer | Section |
|---|---|---|
| Which SimConnect variables per AI aircraft | lat, lon, altitude, true heading, ground velocity, on-ground — six, in that order | §3.2 |
| Range | 40 000 m default, overridable by `TRAFFIC_RADIUS_M`, clamped to [1000, 200000] | §3.5 |
| Object identity and staleness | Keyed by SimConnect object id; the batch is a full snapshot that replaces the set; the whole set expires 10 s after the last accepted batch | §5 |
| Ingest payload shape and endpoint | `POST /api/ingest/traffic`, body `{"objects":[…]}` | §4 |
| Marker visual distinction | 16 px amber ✈ (grey when on ground), no auto-pan, altitude tooltip; the user's own 24 px marker is untouched | §7 |
| Ground / parked traffic | Parked aircraft dropped agent-side (`onGround && groundSpeedKnots < 1`); moving ground traffic kept and drawn grey | §3.7, §7.2 |

### 1.4 File and type ownership

No two tasks write the same file.

| File | New? | Owning task | Contains |
|---|---|---|---|
| `src/types.ts` | no | T-003 | `export interface TrafficObject` (§2.1). Append only; nothing existing is edited. |
| `src/trafficStore.ts` | yes | T-003 | `TrafficStore` class: `replace()`, `read()` (§5) |
| `src/ingest.ts` | no | T-003 | `POST /traffic` route and its validator (§4) |
| `src/server.ts` | no | T-003 | constructs `TrafficStore`, passes it to `createIngestRouter`, spreads `traffic` into `/api/status` (§6) |
| `src/inspect-traffic.ts` | yes | T-003 | CLI transcription of §9.1 |
| `client/src/types.ts` | no | T-004 | `TrafficObject` mirror and `Status.traffic?` (§6.3). Append only. |
| `client/src/components/LiveMap.tsx` | no | T-004 | `makeTrafficIcon`, traffic effect (§7) |
| `agent/agent.js` | no | T-006 | `DEF_TRAFFIC`/`REQ_TRAFFIC`, sweep, requires `agent/traffic.js` (§3) |
| `agent/traffic.js` | yes | T-006 | Pure, dependency-free: `buildTrafficBatch`, `TRAFFIC_ENABLED`, `trafficRadiusM` parsing, `MAX_BATCH_OBJECTS` (§3.5, §3.8). No `require` of `node-simconnect` or anything else — this is what makes it runnable on a machine without the package installed (Amendment #3). |
| `agent/inspect-traffic.js` | yes | T-006 | CLI transcription of §9.2, requires only `agent/traffic.js` |
| `agent/README.md`, `README.md` | no | T-006 | env vars and the "not logged" statement |

`src/index.ts` is **not** touched: `createServer(flightManager)` keeps its
signature and constructs the store internally.

### 1.5 No new dependencies

Nothing here adds an npm package to the server, the client or the agent.
`node-simconnect` stays at `^4.1.1` — the API used (§3.1) has been present since
4.0.0. No DDL, no migration, no `flights.db` write: this run has no persistence
layer at all, which is why the usual "Persistence" section of a design is
replaced by §5, an in-memory store.

## 2. Traffic record — the wire shape

### 2.1 The record

One JSON object per aircraft. This is the same shape on both wires: agent →
server (inside a batch, §4.3) and server → client (inside `/api/status`, §6.2).

```ts
// src/types.ts (server, owner T-003) and client/src/types.ts (client, owner T-004).
// The two declarations are byte-identical; neither imports from the other,
// matching how SimFrame / StatusFrame are already mirrored in this project.
export interface TrafficObject {
  id: number;
  lat: number;
  lon: number;
  altitudeFt: number;
  headingDeg: number;
  onGround: boolean;
}
```

### 2.2 Field by field

| Field | Type | Unit / range | Required on the agent→server wire? | Present on the server→client wire? |
|---|---|---|---|---|
| `id` | integer | SimConnect object id, `>= 0`. Not stable across sim sessions; unique within one sweep. | yes | always |
| `lat` | number | degrees, `-90 .. 90` | yes | always |
| `lon` | number | degrees, `-180 .. 180` | yes | always |
| `altitudeFt` | number | feet MSL (`PLANE ALTITUDE`), any finite value | yes | always |
| `headingDeg` | number | degrees true, any finite value inbound; normalised to `[0, 360)` by the server | yes | always |
| `onGround` | boolean | `SIM ON GROUND` | **optional**, defaults to `false` | always |

`onGround` is the only optional field, and it is optional in exactly one
direction. If the agent omits it, the server stores `false` (§4.6 step 3). By
the time the record reaches the client, all six fields are present with these
types — the client never has to handle an absent field on a `TrafficObject`, and
must not add defensive defaults that would mask a server bug.

`traffic` as a whole *can* be absent from `/api/status`; that is a different
question and is answered in §6.4.

### 2.3 Why exactly these six

The bias is towards the smallest record that §7 actually renders:

- `lat`, `lon` → marker position.
- `headingDeg` → icon rotation.
- `onGround` → icon colour (grey vs amber, §7.2).
- `altitudeFt` → tooltip text (§7.4).
- `id` → marker identity across polls, so a marker is moved rather than
  destroyed and recreated (§7.3).

Nothing else is carried. In particular there is no `title`, no tail number, no
airspeed and no vertical speed — see §6.5 (alternatives) for why.

### 2.4 Rounding is part of the contract

The server rounds every record once, at ingest, before storing it (§4.6). The
stored value is what `/api/status` returns verbatim. All four pure functions
below — `roundCoord`, `roundAlt`, `normHeading`, and `distanceM` (§5.5) — are
exported from `src/trafficStore.ts` and imported by `src/ingest.ts`, which is
the only other file that needs them; they are not duplicated. The formulas
must be implemented exactly as written so an inspector can predict the output:

```ts
const roundCoord = (x: number) => Math.round(x * 1e6) / 1e6;          // 6 dp, ~0.11 m
const roundAlt   = (x: number) => Math.round(x);                       // whole feet
const normHeading = (h: number) => (((Math.round(h * 10) % 3600) + 3600) % 3600) / 10;
```

`normHeading` rounds to one decimal **first** and wraps in the integer domain
**second**. Both orderings matter:

- Rounding first means `359.97` becomes `0`, not `360.0` — the output range is
  closed-open `[0, 360)` with no exceptions.
- Wrapping over integer tenths (`% 3600`) rather than over degrees avoids the
  float residue that `-12.2 + 360` produces, so `-12.25` serialises as `347.8`
  and not `347.79999999999995`.

Worked values for all three formulas are in §8.

## 3. Agent-side gathering

Owner: T-006, file `agent/agent.js` (plus the new `agent/inspect-traffic.js`).

### 3.1 `requestDataOnSimObjectType` is one-shot, not a subscription

**Verified, not assumed.** `node-simconnect` is not installed in this checkout,
so the published package was fetched and read:

```text
npm pack node-simconnect@4.1.1   ->  node-simconnect-4.1.1.tgz
tar xzf node-simconnect-4.1.1.tgz
```

Three findings from `package/`:

1. `dist/SimConnectConnection.d.ts:176` —
   `requestDataOnSimObjectType(dataRequestId, dataDefinitionId, radiusMeters, type): number`.
   There is no `period` parameter, unlike `requestDataOnSimObject`
   (`:167`), which takes a `SimConnectPeriod`. A call that cannot express a
   period cannot establish one.
2. `dist/SimConnectConnection.js:264-270` — the implementation writes exactly
   four uint32s (request id, definition id, radius, type) into packet `0x0f`
   and sends it. Nothing is registered, nothing is retained.
3. `samples/typescript/trafficRadar/trafficRadar.ts`, the package's own traffic
   sample, calls `handle.requestDataOnSimObjectType(...)` **from inside its
   `simObjectData` handler** — that is, it re-issues the request on every 1 Hz
   tick of its separate `requestDataOnSimObject(..., SimConnectPeriod.SECOND)`
   subscription. The sample would not do this if the call were periodic.

Corroborated by the MSFS SDK page for `SimConnect_RequestDataOnSimObjectType`,
whose example drives the call from a timer event with a `requestEveryXSec`
setting, and which documents `dwRadiusMeters` as *"Double word containing the
radius in meters. If this is set to zero only information on the user aircraft
will be returned, although this value is ignored if type is set to
SIMCONNECT_SIMOBJECT_TYPE_USER."*

**Consequence, frozen:** the agent must re-issue the request itself. There is no
subscription to establish at connect time and no unsubscribe to perform at
disconnect time. The re-request strategy is §3.6.

The reply event is `simObjectDataByType`
(`dist/SimConnectConnection.d.ts:42`), typed `RecvSimObjectData`, whose fields
are `requestID`, `objectID`, `defineID`, `flags`, `entryNumber`, `outOf`,
`defineCount`, `data` (`dist/recv/RecvSimObjectData.d.ts`). One event fires per
in-range object. `entryNumber` is 1-based; `outOf` is the total for the sweep.
The package sample's `if (recvSimObjectData.outOf === 0) return;` establishes
that an event with `outOf === 0` is delivered when the sweep found nothing —
§3.6 relies on that.

### 3.2 The data definition

`DEF_TRAFFIC = 1`, distinct from `DEF_FLIGHT_DATA = 0`. Registered once, right
after the existing flight-data definition, inside `tryConnect()`.

Read order below is the registration order and the two must never diverge —
same rule as the existing definition.

| # | SimConnect variable | Units | Type | Read with |
|---|---|---|---|---|
| 1 | `PLANE LATITUDE` | `degrees` | `FLOAT64` | `data.readFloat64()` |
| 2 | `PLANE LONGITUDE` | `degrees` | `FLOAT64` | `data.readFloat64()` |
| 3 | `PLANE ALTITUDE` | `feet` | `FLOAT64` | `data.readFloat64()` |
| 4 | `PLANE HEADING DEGREES TRUE` | `degrees` | `FLOAT64` | `data.readFloat64()` |
| 5 | `GROUND VELOCITY` | `knots` | `FLOAT64` | `data.readFloat64()` |
| 6 | `SIM ON GROUND` | `bool` | `INT32` | `data.readInt32() !== 0` |

`GROUND VELOCITY` is read but **not** sent on the wire — it exists only to drive
the parked-aircraft filter in §3.7. `PLANE ALTITUDE` (MSL) is used rather than
the sample's `INDICATED ALTITUDE` so traffic altitude and the user's own
`altitudeFt` mean the same thing.

No `TITLE` / `STRING256` field: it would add up to 256 bytes per object to a
batch that can carry 200 of them, and §7 renders no text from the aircraft
model. See §6.5.

### 3.3 The request

```js
handle.requestDataOnSimObjectType(REQ_TRAFFIC, DEF_TRAFFIC, trafficRadiusM, SimObjectType.AIRCRAFT);
```

`REQ_TRAFFIC = 1`, distinct from `REQ_FLIGHT_DATA = 0`. `SimObjectType` is added
to the existing `require('node-simconnect')` destructure.

`SimObjectType.AIRCRAFT` (enum value 2) is the type asked for — not `ALL` (which
would pull boats and ground vehicles, neither of which this feature draws) and
not a second `HELICOPTER` sweep (which would double the request rate for a rare
object class; noted as a follow-up in §10.3, not done here).

### 3.4 Excluding the user's own aircraft

The user's aircraft **is** returned by an `AIRCRAFT` sweep — the SDK's
"radius zero returns only the user aircraft" wording quoted in §3.1 says so
directly. Two guards, applied in this order, both inside `buildTrafficBatch`
(§3.8):

1. **By object id.** The existing `simObjectData` handler is extended to
   destructure `objectID` alongside `requestID` and `data`, and to record it
   into a module-level `userObjectId` on every `REQ_FLIGHT_DATA` frame. Any
   swept object whose `id === userObjectId` is dropped. Because the sweep is
   only ever triggered from inside that same handler (§3.6), `userObjectId` is
   guaranteed non-null by the time any sweep result arrives — there is no
   "not yet known" case to handle.
2. **By position.** Any object whose `Math.abs(lat - userLat) <= 0.0001` **and**
   `Math.abs(lon - userLon) <= 0.0001` (≈ 11 m) is dropped, using the lat/lon
   from the frame that triggered the sweep. This is a backstop for the case
   where the sim reports a different object id for the user in a byType sweep
   than it does for an `OBJECT_USER` request. Two distinct aircraft cannot have
   their reference points 11 m apart, so it costs nothing real.

Guard 1 alone is expected to be sufficient. Guard 2 exists because a duplicate
"you" marker sitting on top of the user's own aircraft is the single most
visible way this feature can look broken, and the risk is called out in §10.4.

### 3.5 Radius and the opt-out

Both env vars are read once at process start, by `agent/traffic.js` (Amendment
#3) — not inline in `agent/agent.js` — so they can be exercised by
`agent/inspect-traffic.js` without `node-simconnect` installed.

| Env var | Default | Semantics |
|---|---|---|
| `TRAFFIC_ENABLED` | enabled | Disabled **iff** `String(value).trim().toLowerCase()` is exactly one of `0`, `false`, `off`, `no`. Unset, empty, or any other value means enabled. |
| `TRAFFIC_RADIUS_M` | `40000` | Sweep radius in metres. `Number(value)`, then `Math.round`, then clamped to `[1000, 200000]`. Non-finite or unparseable falls back to `40000` and logs one warning line. |

```js
const TRAFFIC_ENABLED = !['0', 'false', 'off', 'no']
  .includes(String(process.env.TRAFFIC_ENABLED ?? '').trim().toLowerCase());
```

Note that an *empty* `TRAFFIC_ENABLED=` is enabled, because `''` is not in the
list. That is deliberate and stated so nobody "fixes" it.

When `TRAFFIC_ENABLED` is disabled the agent registers no traffic data
definition, issues no `requestDataOnSimObjectType`, installs no
`simObjectDataByType` handler and posts nothing to `/api/ingest/traffic`. The
agent logs exactly one line at startup, `[Agent] AI traffic gathering disabled
(TRAFFIC_ENABLED)`. Everything on the flight-data path behaves identically to
today.

The same variable name with the same semantics is the server-side kill switch —
see §5.6. They are read independently; setting one does not imply the other.

40 000 m is chosen as roughly TCAS range: far enough that traffic appears before
it is relevant, near enough that a busy terminal area does not routinely exceed
the retention cap. It is a constant with an override rather than a computed
value because nothing in the system knows the user's zoom level.

### 3.6 Sweep cadence

The sweep is driven from the existing `simObjectData` handler — the same 1 Hz
tick that already posts `/api/ingest/frame` — and is throttled to at most one
sweep per `TRAFFIC_SWEEP_MS = 2000`. `lastSweepAt` is module-level state,
initialised to `0` (not `Date.now()`), so the very first frame after connect
always triggers an immediate sweep rather than waiting out the first 2 s
window:

```js
if (TRAFFIC_ENABLED && Date.now() - lastSweepAt >= TRAFFIC_SWEEP_MS) {
  lastSweepAt = Date.now();
  sweepBuffer = [];
  handle.requestDataOnSimObjectType(REQ_TRAFFIC, DEF_TRAFFIC, trafficRadiusM, SimObjectType.AIRCRAFT);
}
```

No `setInterval` is added: a new timer would keep firing while SimConnect is
disconnected and would need its own teardown on every reconnect. Driving off the
frame tick means traffic gathering starts, stops and reconnects exactly when the
flight-data pipeline does, for free.

2 s rather than 1 s halves the batch traffic on the LAN for a display whose
objects are, by construction, not the thing the user is flying. The client polls
`/api/status` faster than that (1 s while FLYING, §6.3); traffic markers
therefore update on every other poll at best. That is accepted.

Assembling one sweep from its N events:

```js
handle.on('simObjectDataByType', ({ requestID, objectID, entryNumber, outOf, data }) => {
  if (requestID !== REQ_TRAFFIC) return;
  if (outOf === 0) { postTrafficBatch([]); return; }   // sweep found nothing
  if (entryNumber <= 1) sweepBuffer = [];              // authoritative reset
  sweepBuffer.push(decodeTrafficRecord(objectID, data));
  if (entryNumber >= outOf) { postTrafficBatch(buildTrafficBatch(sweepBuffer, ...)); sweepBuffer = []; }
});
```

- `outOf === 0` posts an **empty batch**, it does not skip the post. The batch is
  a snapshot (§5.2); an empty snapshot is how the server learns the sky is clear.
- The buffer is reset both when a sweep is issued and when `entryNumber <= 1`
  arrives. The second reset is the authoritative one because it keys on data
  rather than on request timing, and it bounds the buffer even if a sweep's tail
  is never delivered.
- A sweep whose tail is lost simply never flushes; the previous snapshot then
  ages out server-side after 10 s and the map clears. Self-healing, no unbounded
  growth. Risk noted in §10.4.

### 3.7 Ground and parked aircraft

Filtered at the agent, by one rule:

> Drop the object if `onGround === true` **and** `groundSpeedKnots < 1`.

So parked and gate-held aircraft never leave the Windows machine, while
taxiing, lining-up and rolling aircraft do and are drawn grey (§7.2).

The alternative of dropping every on-ground object was rejected: at a busy
airport it would show an empty map at exactly the moment the user is most likely
to look, which reads as "the feature is broken". The alternative of filtering
nothing was rejected because a single large airport's parked fleet can fill the
100-object retention cap on its own and crowd out the airborne traffic that
matters. `1 knot` is the threshold; it is a constant, not configurable.

### 3.8 `buildTrafficBatch` — a pure, testable function

**Lives in `agent/traffic.js` (Amendment #3), not in `agent/agent.js`.** This
file has no `require` of `node-simconnect` or anything else, so
`agent/inspect-traffic.js` can exercise §9.2 without SimConnect, without a
network, and without the package installed at all — which matters, because
`agent/agent.js`'s own top-level `require('node-simconnect')` throws on a
machine where that package is absent, and a `require.main === module` guard
around `tryConnect()` does not change that:

```js
// agent/traffic.js — no requires of node-simconnect or anything else
function buildTrafficBatch(sweep, userObjectId, userLat, userLon) { /* returns TrafficObject[] */ }
```

`sweep` is an array of `{ id, lat, lon, altitudeFt, headingDeg, groundSpeedKnots, onGround }`
as decoded from the buffer. The function applies, in this order:

1. Drop `id === userObjectId` (§3.4 guard 1).
2. Drop objects within 0.0001° of `userLat`/`userLon` in both axes (§3.4 guard 2).
3. Drop objects where `id` is not `Number.isInteger` or is negative, or where
   any of `lat`, `lon`, `altitudeFt`, `headingDeg` is not `Number.isFinite`
   (covers `NaN`, `Infinity`, `undefined`, missing). Without this, a single
   malformed `id` from the sweep buffer would ride into every batch and trip
   the server's §4.5 row-6 `400` on a 2 s repeat, forever — dropping it
   agent-side is strictly better than a batch that never gets accepted.
4. Drop objects where `onGround === true && groundSpeedKnots < 1` (§3.7).
5. De-duplicate by `id` into a `Map`: insertion order is the **first**
   occurrence's position, the retained value is the **last** occurrence's. This
   is what `new Map()` plus repeated `.set()` does natively; implement it that
   way rather than reproducing the rule by hand.
6. Truncate to the first `MAX_BATCH_OBJECTS = 200` in that order, so the agent
   can never trip the server's 400 in §4.5.
7. Emit each survivor as a `TrafficObject` (§2.1) — `groundSpeedKnots` is
   dropped here, `onGround` is carried.

No rounding is done agent-side; §2.4 rounding is the server's job, done once.

`agent/traffic.js` ends with
`module.exports = { buildTrafficBatch, TRAFFIC_ENABLED, trafficRadiusM,
MAX_BATCH_OBJECTS }`. `agent/agent.js` adds one line alongside its existing
requires — `const { buildTrafficBatch, TRAFFIC_ENABLED, trafficRadiusM } =
require('./traffic.js');` — and is otherwise unchanged in how it starts up;
`npm start` (`node agent.js`) still calls `tryConnect()` unconditionally, no
`require.main === module` guard is needed for testability now that the pure
logic lives in a separate, dependency-free file.

## 4. Ingest contract

Owner: T-003, file `src/ingest.ts`.

### 4.1 Endpoint

`POST /api/ingest/traffic` — router path `/traffic` on the existing router
mounted at `/api/ingest` by `src/server.ts:109`. `POST` only; no `GET`, no
`DELETE`.

### 4.2 Authentication

`x-ingest-token` applies, using the **same** `checkAuth` helper and the same
`INGEST_TOKEN` env var as `/frame` and `/event`. A wrong or missing token when
`INGEST_TOKEN` is set returns `401` with `{"error":"Invalid or missing ingest
token"}` and leaves the store untouched. When `INGEST_TOKEN` is unset, all
requests pass, exactly as today. Traffic must not be the one unauthenticated
hole in the ingest surface.

### 4.3 Request body

```
{ "objects": TrafficObject[] }
```

An object with exactly one meaningful key. The wrapper — rather than a bare JSON
array — exists so the four malformed-body cases in §4.5 can be told apart in the
error message, and so a future batch-level field (a sweep timestamp, a sequence
number) does not require a breaking shape change.

`Content-Type: application/json`. Parsed by the existing `express.json()`
middleware; no new body parser, no size middleware. That middleware's default
100 KB body-size limit applies and is left as is: a 200-object batch serialises
to roughly 26 KB (§8.3's ~98 bytes/object extrapolated, plus JSON overhead per
object being larger than the rounded §8.2 output since §8.1's raw values carry
more digits), well under the limit, so express's own `413 Payload Too Large`
is not a reachable outcome in normal operation and is not one of §4.5's rows.
A worked example is in §8.1.

### 4.4 Success response

`204 No Content`, empty body — identical to `/frame` and `/event`.

### 4.5 Error responses

Checked in this exact order; the first failure wins and the store is left
**completely unchanged**, including its `receivedAt` timestamp.

| Order | Condition | Status | Body |
|---|---|---|---|
| 1 | Token required and wrong/missing | `401` | `{"error":"Invalid or missing ingest token"}` |
| 2 | Traffic disabled server-side (§5.6) | `204` | *(empty — no validation runs, no 400 is ever returned in this mode)* |
| 3 | Body is not a non-null, non-array JSON object | `400` | `{"error":"Traffic batch must be a JSON object"}` |
| 4 | `objects` is absent or not an array | `400` | `{"error":"Traffic batch requires an objects array"}` |
| 5 | `objects.length > 200` | `400` | `{"error":"Traffic batch exceeds 200 objects"}` |
| 6 | Element at index *i* fails §4.6 validation | `400` | `{"error":"Invalid traffic object at index 2"}` — the literal index, lowest first |

Over the batch limit is a **rejection, not a truncation**. A server that
silently truncated would hide an agent bug behind a half-drawn map, and the
agent already truncates to 200 itself (§3.8), so reaching this case means
something is wrong and should say so.

One bad element rejects the **whole batch**, not just that element. Because a
batch is a snapshot (§5.2), dropping bad rows and accepting the rest would make
the affected aircraft look like they had left range — a silent wrong answer in
place of a loud 400.

### 4.6 Validation and normalisation of one element

An element is valid iff, treating it as `Record<string, unknown>`:

```ts
Number.isInteger(o.id) && (o.id as number) >= 0 &&
Number.isFinite(o.lat) && o.lat >= -90  && o.lat <= 90 &&
Number.isFinite(o.lon) && o.lon >= -180 && o.lon <= 180 &&
Number.isFinite(o.altitudeFt) &&
Number.isFinite(o.headingDeg) &&
(o.onGround === undefined || typeof o.onGround === 'boolean')
```

`Number.isFinite` rejects `NaN`, `±Infinity`, `null`, `undefined`, strings and
missing keys in one predicate — a `NaN` coordinate that slipped past the agent
is a `400`, never a marker at (NaN, NaN). Unknown extra keys are ignored, not
rejected: they are dropped by the normalisation below, which constructs a fresh
object rather than spreading the input.

A valid batch is then processed as follows, in this order:

1. Build `TrafficObject` per element:
   `{ id, lat: roundCoord(lat), lon: roundCoord(lon), altitudeFt: roundAlt(altitudeFt), headingDeg: normHeading(headingDeg), onGround: o.onGround === true }` — formulas in §2.4.
2. De-duplicate by `id` through a `Map` (first-occurrence order, last-occurrence
   value), same rule and same mechanism as §3.8 step 5.
3. `onGround` defaulting already happened in step 1: absent or any non-`true`
   value that passed validation becomes `false`.
4. Apply the retention cap (§5.5).
5. Replace the store (§5.2) and set `receivedAt = Date.now()`.
6. Respond `204`.

### 4.7 What the traffic route must not do

It does **not** call `markConnected()`, does not touch `lastFrameAt`, does not
call any `FlightManager` method, and does not write to `flights.db`.
Agent-connectivity is defined by the flight-data pipeline alone; a traffic post
must never be able to hold `appState.connected` true while frames have stopped.
See §10.1.

## 5. Server state and pruning

Owner: T-003, new file `src/trafficStore.ts`.

### 5.1 The store

```ts
class TrafficStore {
  private objects: TrafficObject[] = [];
  private receivedAt = 0;
  replace(objects: TrafficObject[]): void;   // sets receivedAt = Date.now()
  read(now?: number): TrafficObject[];       // applies §5.4 staleness, returns [] when stale
}
```

One instance, created inside `createServer()` in `src/server.ts`, passed as a
second parameter to `createIngestRouter(flightManager, trafficStore)` and closed
over by the `/api/status` handler. Not a module-level singleton, so a scratch
server in a test process starts empty. `src/index.ts` is unchanged.

The array holds the objects in the order §4.6 produced them; `/api/status`
returns that order verbatim. The client does not depend on the order, but making
it deterministic makes §8 and §9 checkable.

### 5.2 Snapshot semantics — the central rule

**Every accepted batch replaces the entire retained set.** The store keeps no
history and no per-object timestamps.

Therefore:

- An object present in batch *N* and absent from batch *N+1* is **gone
  immediately** on batch *N+1* — no grace period, no fade. Its marker disappears
  on the next poll. This is the correct answer for an aircraft that left the
  40 km radius or that the sim unloaded, and it is the whole reason the batch is
  a full sweep rather than a delta.
- An object absent from batch *N+1* and present again in batch *N+2* is simply
  present again, treated as brand new. No interpolation across the gap, no
  memory that it was ever here before.
- Nothing is merged across batches. There is no code path in which the store
  holds an object that was not in the most recently accepted batch.

### 5.3 Keying

By `TrafficObject.id`, the SimConnect object id, and only within a single batch
— used to de-duplicate (§4.6 step 2) and, on the client, to move an existing
marker instead of recreating it (§7.3). SimConnect object ids are not stable
across sim sessions and this design never assumes they are.

### 5.4 Staleness

Individual objects are never stale. The **set** is stale, as a unit:

> The retained set is stale when `Date.now() - receivedAt > TRAFFIC_STALE_MS`
> (10 000). Strictly greater: at exactly 10 000 ms it is still fresh.

Evaluated **lazily, on read** — inside `TrafficStore.read()`, which is called
from the `/api/status` handler. When `read()` finds the set stale it empties
`objects` (releasing the memory) and returns `[]`.

No `setInterval` is added for pruning. The existing 5 s watchdog in `ingest.ts`
is left alone. A timer would produce behaviour indistinguishable from the lazy
check — nothing observes the store except `/api/status` — while adding a handle
that keeps the event loop alive and a second place where "how old is too old" is
decided.

10 000 ms is five missed 2 s sweeps, and is deliberately the same number as
`ingest.ts`'s existing `STALE_TIMEOUT_MS`, so traffic vanishes from the map at
the same moment the app decides the agent is gone.

### 5.5 The retention cap and its ordering rule

At most `MAX_RETAINED_OBJECTS = 100` objects are retained. Applied at ingest
(§4.6 step 4), after de-duplication, before `replace()`.

If the de-duplicated batch has 100 or fewer objects, it is stored as is and no
ordering is computed.

If it has more than 100:

- If `flightManager.appState.lastFrame` is `null`, keep the **first 100 in
  post-de-duplication array order**. Nothing better is knowable.
- Otherwise, sort a copy of the array by great-circle distance from
  `(lastFrame.lat, lastFrame.lon)` ascending, ties broken by ascending `id`, and
  keep the first 100. `Array.prototype.sort` is stable in ES2019+, and the
  explicit `id` tiebreak means the result does not depend on that.

The distance function, written out so two implementations agree bit for bit:

```ts
const R = 6371000;                                   // metres
const rad = (d: number) => (d * Math.PI) / 180;
function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

Haversine with `R = 6371000` and the `Math.min(1, …)` domain clamp. Only the
*ordering* is used, never the value, so the choice of earth radius is immaterial
— but it is pinned anyway so the inspector in §9.1 can predict the retained set.

This read of `flightManager.appState.lastFrame` is the only interaction between
the traffic path and existing state. It is read-only and it never dereferences
past `lat`/`lon`.

### 5.6 The server-side kill switch

`TRAFFIC_ENABLED`, same name and same parsing rule as the agent's (§3.5), read
once when `createIngestRouter` is constructed.

When disabled:

- `POST /api/ingest/traffic` returns `204` and discards the body, **after** the
  auth check and **before** any validation (§4.5 order, row 2). It does not
  return 404, 403 or 503: an agent pointed at a traffic-disabled server would
  log a warning on every post at 0.5 Hz, and the operator who set the flag does
  not want that noise.
- The server logs exactly one line the first time a batch is discarded:
  `[Ingest] Traffic disabled (TRAFFIC_ENABLED) — discarding batch`.
- `GET /api/status` never includes the `traffic` key, because the store stays
  empty and §6.4's rule is length-based.

Together with §3.5 this gives an operator two independent off switches, one on
each machine, neither of which requires a code change.

## 6. Client-visible API

### 6.1 Traffic rides on `GET /api/status`

No new polling endpoint. Traffic is added to the existing status response.

Rationale: the client already runs exactly one poll loop
(`client/src/hooks/useStatus.ts`), whose cadence — 1 s while `FLYING`, 3 s
otherwise — is already the right shape for traffic, and the map already
re-renders from `status`. A `/api/traffic` endpoint would add a second loop, a
second error path, a second "is it stale" question, and would let the marker set
and the own-aircraft position drift out of step by up to one poll interval. The
size argument does not bite: a 100-object payload at the §2.4 rounding is about
10 KB (§8.3), on a LAN, at most once a second.

### 6.2 Response shape

`GET /api/status` gains exactly one key:

```
traffic?: TrafficObject[]
```

Present **iff** `trafficStore.read()` returns a non-empty array. Never `null`,
never `[]` — absent instead. Implemented with the same spread idiom the
`plannedLeg` key already uses at `src/server.ts:139`:

```ts
const traffic = trafficStore.read();
res.json({
  connected, flightState, currentFlightId, paused, pauseFlags,
  simRunning: …, onGround: …, aircraft: …, frame: …,
  ...(plannedLeg ? { plannedLeg } : {}),
  ...(traffic.length ? { traffic } : {}),
});
```

Elements are `TrafficObject` (§2.1), already rounded and normalised (§2.4), in
store order (§5.1). Every element has all six fields; see §2.2.

A worked response is in §8.2.

### 6.3 Client type and cadence

`client/src/types.ts` gains the `TrafficObject` mirror from §2.1 and one
optional member on the existing interface:

```ts
export interface Status {
  // …existing members unchanged…
  plannedLeg?: PlannedLegLiveStatus;
  traffic?: TrafficObject[];
}
```

Optional, so every existing consumer of `Status` compiles untouched.

Poll cadence is **unchanged**: `useStatus.ts` keeps `s.flightState === 'FLYING'
? 1000 : 3000` and gains no traffic-specific logic, no second timer, and no new
state. Traffic arrives as a property of the status object it already sets.

### 6.4 Backwards compatibility, precisely

**When no traffic has ever been posted**, `trafficStore.read()` returns `[]`,
`traffic.length` is `0`, the spread contributes nothing, and the response object
literal has **no `traffic` property at all**. `JSON.stringify` therefore emits
exactly the same bytes it emits today for the same `AppState` — not
`"traffic":[]`, not `"traffic":null`, nothing.

This is why an old client cannot tell the difference: there is no difference to
tell. The same holds for a server with `TRAFFIC_ENABLED` off (§5.6), for a
server whose agent predates this run, and for the 10 s after an agent stops
posting (§5.4). The key is absent in all four cases, and in all four cases the
correct rendering is "no traffic markers".

The client's rule follows from that and is stated once here, for §7 to
implement: **`status.traffic ?? []`**. Absent and empty are the same thing and
mean "remove every traffic marker".

### 6.5 Alternatives considered

| Decision | Options | Chosen and why |
|---|---|---|
| Where traffic is exposed | fold into `/api/status`; separate `GET /api/traffic`; WebSocket/SSE | **Fold into `/api/status`.** One loop, one error path, markers and own position always from the same instant. A socket would be a new transport for the whole app to maintain, for a feature that tolerates 1–2 s latency by construction. |
| Absent vs `[]` when empty | `"traffic":[]` always; omit the key | **Omit.** Byte-identical to today's response for an unchanged state, which makes the regression check in §10.2 a diff rather than an argument. Matches the existing `plannedLeg` precedent. |
| Delta vs snapshot batches | send only changes; send the full sweep each time | **Snapshot** (§5.2). A delta needs an explicit "removed" list, a sequence number and a resync path; a snapshot needs none of them, and SimConnect hands the agent a full sweep anyway. |
| Per-object vs per-set staleness | timestamp each object; timestamp the set | **Per-set** (§5.4). With snapshot semantics, per-object timestamps would all carry the same value, so they would encode nothing. |
| Traffic in `flights.db` | persist a track per object; keep in memory | **Memory only.** Frozen by the intake, confirmed here: the user asked to *display*, not to log, and persisting up to 100 objects at 0.5 Hz would outgrow the flight log itself within one session. |
| Carry `title` / tail number | yes; no | **No.** Up to 256 bytes × 200 objects per batch for text §7 does not render. A tooltip showing the model is a natural follow-up once the marker layer exists (§10.3). |
| Prune with a timer | `setInterval`; lazy on read | **Lazy** (§5.4). Nothing observes the store except `/api/status`; a timer would add an event-loop handle and a second definition of "too old". |

## 7. Client rendering

Owner: T-004, file `client/src/components/LiveMap.tsx`.

### 7.1 What is not touched

`makeAircraftIcon` keeps its current definition exactly: `L.divIcon`,
`className: ''`, 24 px `✈`, `line-height:1`,
`filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))`, `transform:rotate(${headingDeg -
90}deg)`, `iconAnchor: [12, 12]`, and the marker's `zIndexOffset: 1000`. The
existing own-aircraft effect — including its `if (!frame) return;` guard, its
`lat === 0 && Math.abs(lon - 90) < 0.01` null-island guard, its `map.setView(pos,
10)` on first fix, its `map.panTo` on later fixes, and the track polyline fetch —
is unchanged, and traffic code is not added inside it.

`LiveMap` still returns `null` when `status.frame` is falsy, so traffic is only
ever drawn on a map that exists because the user's own position exists. That is
existing behaviour and it stays.

### 7.2 The traffic icon

A new sibling function in the same file:

```tsx
function makeTrafficIcon(headingDeg: number, onGround: boolean) {
  const color = onGround ? '#9ca3af' : '#fbbf24';
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${headingDeg - 90}deg);font-size:16px;line-height:1;color:${color};opacity:.85;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))">✈</div>`,
    iconAnchor: [8, 8],
  });
}
```

Differences from `makeAircraftIcon`, exhaustively — these five and nothing else:

| Property | Own aircraft | Traffic |
|---|---|---|
| `font-size` | `24px` | `16px` |
| `color` | inherited (unset) | `#fbbf24` airborne, `#9ca3af` on ground |
| `opacity` | unset (1) | `.85` |
| `filter` | `drop-shadow(0 1px 3px rgba(0,0,0,.8))` | `drop-shadow(0 1px 2px rgba(0,0,0,.7))` |
| `iconAnchor` | `[12, 12]` | `[8, 8]` (half of 16, so the glyph centres on the fix) |
| `zIndexOffset` | `1000` | `0` — the user's own aircraft is always on top |

The `headingDeg - 90` rotation is identical, for the same reason: the `✈` glyph
points east. Do not re-derive that offset and do not "correct" it.

### 7.3 Marker lifecycle

A `Map` of live markers, held in a ref beside the existing ones in
`LiveMapController`:

```tsx
const trafficRef = useRef<Map<number, L.Marker>>(new Map());
```

A **separate** `useEffect` with dependency array `[status]`, so it runs once per
successful poll and cannot be short-circuited by the own-aircraft guards in
§7.1:

1. `const traffic = status.traffic ?? [];`
2. For each record: if `trafficRef.current` has `record.id`, call `setLatLng`,
   `setIcon(makeTrafficIcon(...))` and `setTooltipContent` on the existing
   marker. Otherwise create `L.marker([lat, lon], { icon: makeTrafficIcon(...),
   zIndexOffset: 0 })`, `bindTooltip` (§7.4), `addTo(map)`, and put it in the Map
   under `record.id`.
3. Build a `Set` of the ids in this batch. For every entry in
   `trafficRef.current` whose id is not in that Set: `map.removeLayer(marker)`
   and delete the entry.

Markers are moved, never recreated, while an id persists — recreating them on
every poll would restart the Leaflet DOM node and make the tooltip flicker.

A second, separate `useEffect(() => () => { … }, [])` removes every marker in
`trafficRef.current` and clears the Map on unmount, so navigating away from the
live map leaves no layers behind.

### 7.4 Tooltip

`marker.bindTooltip('', { direction: 'top', offset: [0, -8] })` at creation,
content set on creation and on every update to `` `${record.altitudeFt} ft` ``.
`altitudeFt` is already a whole number (§2.4), so no client-side formatting is
needed and none should be added. This is the only place `altitudeFt` is
rendered, and it is why the field is on the wire at all (§2.3).

### 7.5 The map never moves for traffic

The traffic effect must not call `setView`, `panTo`, `flyTo`, `fitBounds`,
`setZoom` or `invalidateSize`. Not on the first traffic record, not when the set
changes size, not ever. The map's viewport is owned exclusively by the
own-aircraft effect, which pans to follow the user. A map that jumped to a
newly-appeared AI aircraft would be actively hostile during a flight.

### 7.6 Failure and disconnect

| Situation | What happens to the markers | Why |
|---|---|---|
| A single `/api/status` poll throws | Nothing. Markers stay exactly where they are. | `useStatus` does not call `setStatus` on error, so `status` keeps its previous value, so the traffic effect does not re-run. |
| Polls keep failing | Markers stay frozen until a poll succeeds. | Same reason. A network blip must not blank the map. |
| Server up, agent stopped | Markers all disappear ≤ 10 s later, in one step. | The set goes stale (§5.4), `traffic` becomes absent (§6.4), `status.traffic ?? []` is empty, step 3 of §7.3 removes everything. |
| Agent running, sky empty | Markers all disappear on the next poll. | The agent posts an empty batch (§3.6), the store is replaced with `[]`, the key goes absent. |
| Server has `TRAFFIC_ENABLED` off | No markers ever appear. | §5.6. |
| Old server, new client | No markers ever appear, no errors. | The key is absent, `?? []` handles it (§6.4). |

There is no "stale marker" styling and no client-side ageing. The server owns
staleness entirely; the client draws what the last successful poll said.

## 8. Worked example

Implementers copy these verbatim into `curl` commands. The two blocks are the
same instant, related by §4.6 normalisation and §2.4 rounding.

### 8.1 What the agent posts

`POST /api/ingest/traffic`, `Content-Type: application/json`, plus
`x-ingest-token: <token>` when `INGEST_TOKEN` is set. Three objects, at full
double precision, exactly as decoded from the sweep buffer — note the
un-normalised headings `372.5` and `-12.25`, and that object 27 is on the ground
but moving (it survived §3.7 because its ground velocity was ≥ 1 kt, which is
not carried on the wire).

```json
{
  "objects": [
    { "id": 12, "lat": 47.44982716239, "lon": -122.3091455117, "altitudeFt": 4325.68359375, "headingDeg": 158.4472999572, "onGround": false },
    { "id": 13, "lat": 47.53100482118, "lon": -122.2005913734, "altitudeFt": 11250.125, "headingDeg": 372.5, "onGround": false },
    { "id": 27, "lat": 47.44001139298, "lon": -122.3083019876, "altitudeFt": 433.1, "headingDeg": -12.25, "onGround": true }
  ]
}
```

Response: `204 No Content`, empty body.

### 8.2 What `GET /api/status` then returns

With the user mid-flight (`flightState: "FLYING"`, flight 412 open, not paused):

```json
{
  "connected": true,
  "flightState": "FLYING",
  "currentFlightId": 412,
  "paused": false,
  "pauseFlags": 0,
  "simRunning": 2,
  "onGround": false,
  "aircraft": "Cessna 172 Skyhawk G1000",
  "frame": {
    "lat": 47.4502,
    "lon": -122.3088,
    "altitudeFt": 4180.2,
    "airspeedKnots": 112.4,
    "groundSpeedKnots": 118.9,
    "headingDeg": 160.1,
    "verticalSpeedFpm": 480.5,
    "onGround": false
  },
  "traffic": [
    { "id": 12, "lat": 47.449827, "lon": -122.309146, "altitudeFt": 4326, "headingDeg": 158.4, "onGround": false },
    { "id": 13, "lat": 47.531005, "lon": -122.200591, "altitudeFt": 11250, "headingDeg": 12.5, "onGround": false },
    { "id": 27, "lat": 47.440011, "lon": -122.308302, "altitudeFt": 433, "headingDeg": 347.8, "onGround": true }
  ]
}
```

The `plannedLeg` key is absent here because this flight is not linked to a
planned leg. That is existing behaviour and is unrelated to traffic.

### 8.3 Every transformation, checked

| In | Rule (§2.4) | Out |
|---|---|---|
| `lat 47.44982716239` | `Math.round(x*1e6)/1e6` | `47.449827` |
| `lon -122.3091455117` | `Math.round(x*1e6)/1e6` | `-122.309146` |
| `lat 47.53100482118` | " | `47.531005` |
| `lon -122.2005913734` | " | `-122.200591` |
| `lat 47.44001139298` | " | `47.440011` |
| `lon -122.3083019876` | " | `-122.308302` |
| `altitudeFt 4325.68359375` | `Math.round(x)` | `4326` |
| `altitudeFt 11250.125` | " | `11250` |
| `altitudeFt 433.1` | " | `433` |
| `headingDeg 158.4472999572` | `(((round(h*10) % 3600)+3600)%3600)/10` → `1584 → 1584` | `158.4` |
| `headingDeg 372.5` | `3725 % 3600 = 125` | `12.5` |
| `headingDeg -12.25` | `round(-122.5) = -122`; `-122 % 3600 = -122`; `+3600 = 3478` | `347.8` |

Rendered by §7: object 12 amber (airborne) with tooltip `4326 ft`, object 13
amber with `11250 ft`, object 27 grey (`onGround: true`) with `433 ft`. All three
at 16 px, rotated by `heading - 90`, and the map does not move to any of them.

The whole table above was executed rather than hand-computed: feeding §8.1's
`objects` through the three §2.4 formulas under Node 20 reproduces §8.2's
`traffic` array exactly (`JSON.stringify` equality, `MATCH: true`), and the
§9.1 heading edges come out as `359.97 → 0`, `-10 → 350`, `370 → 10`.

`JSON.stringify` of §8.2's `traffic` array is **293 bytes for 3 objects**, i.e.
98 bytes per object, i.e. ~9.8 KB at the 100-object cap — the number quoted in
§6.1.

## 9. Truth tables

These rows are the specification. `src/inspect-traffic.ts` (T-003) and
`agent/inspect-traffic.js` (T-006) transcribe them **by hand**; an inspector that
computes its expected column by calling the code under test proves nothing. If a
row here is ever found to disagree with the implementation, that is a question
for this document, not something to reconcile quietly in the inspector.

### 9.1 Server store — staleness, pruning, rejection

Baseline for every row: a fresh `TrafficStore`, `INGEST_TOKEN` unset unless
stated, `TRAFFIC_ENABLED` unset unless stated, `flightManager.appState.lastFrame`
null unless stated. "Read" means `GET /api/status`.

| # | Scenario | Expected |
|---|---|---|
| S1 | Batch of 3 valid objects, read immediately | `204`; response has `traffic` with the 3 objects, in post-de-duplication order, rounded per §2.4 |
| S2 | Same, read 9 999 ms after the batch | `traffic` still present with all 3 — the threshold is strictly greater than 10 000 |
| S3 | Same, read at exactly 10 000 ms | `traffic` still present with all 3 |
| S4 | Same, read at 10 001 ms | `traffic` key **absent**; store's internal array emptied |
| S5 | Batch A = ids [12, 13, 27], then batch B = ids [12, 13] | After B: `traffic` has exactly ids 12 and 13. Object 27 is gone on the very next read, with no grace period |
| S6 | Batch A = [12, 13], batch B = [12], batch C = [12, 13] | After C: ids 12 and 13, with 13's values taken solely from C. No memory of 13's earlier values, no interpolation |
| S7 | Empty batch `{"objects":[]}` | `204`; `receivedAt` updated; `traffic` key absent on the next read |
| S8 | Batch of 150 valid objects, `lastFrame` null | `204`; exactly 100 retained — the first 100 in post-de-duplication array order |
| S9 | Batch of 150 valid objects, `lastFrame` at (47.45, -122.31) | `204`; exactly 100 retained — the 100 with the smallest §5.5 haversine distance from (47.45, -122.31), ties broken by ascending `id` |
| S10 | Batch of exactly 100 objects | `204`; all 100 retained; no distance computed |
| S11 | Batch where id 42 appears twice, at indices 0 and 4, with different lat | `204`; one record for id 42, holding index 4's values, positioned where index 0 was |
| S12 | Batch of 200 objects | `204` — 200 is the limit, not one past it. Then trimmed to 100 by S8/S9's rule |
| S13 | Batch of 201 objects | `400` `{"error":"Traffic batch exceeds 200 objects"}`; store contents and `receivedAt` both unchanged |
| S14 | Batch of 5 where index 2 has `"lat": "47.4"` | `400` `{"error":"Invalid traffic object at index 2"}`; **none** of the 5 stored; previous contents unchanged |
| S15 | Batch of 5 where indices 1 and 3 are both invalid | `400` naming index **1** — the lowest failing index |
| S16 | Object with `"lat": null` | `400` at that index (`Number.isFinite(null)` is false) |
| S17 | Object with `"lon": 181` | `400` at that index (range check) |
| S18 | Object with `"id": 12.5` | `400` at that index (`Number.isInteger` false) |
| S19 | Object with `"id": -1` | `400` at that index (`id >= 0`) |
| S20 | Object with `"onGround"` absent | Valid; stored as `onGround: false` |
| S21 | Object with `"onGround": "true"` (string) | `400` at that index — only a boolean or absence is accepted |
| S22 | Object with `"headingDeg": -10` | Valid; stored as `350` |
| S23 | Object with `"headingDeg": 370` | Valid; stored as `10` |
| S24 | Object with `"headingDeg": 359.97` | Valid; stored as `0` — rounds to 360.0 then wraps |
| S25 | Object with an extra key `"title": "A320"` | Valid; stored without `title`; `/api/status` never echoes it |
| S26 | Body is `[]` (a bare array) | `400` `{"error":"Traffic batch must be a JSON object"}` |
| S27 | Body is `{"aircraft": []}` (no `objects`) | `400` `{"error":"Traffic batch requires an objects array"}` |
| S28 | Body is `{"objects": {}}` | `400` `{"error":"Traffic batch requires an objects array"}` |
| S29 | `INGEST_TOKEN=secret`, no `x-ingest-token` header | `401` `{"error":"Invalid or missing ingest token"}`; store untouched |
| S30 | `INGEST_TOKEN=secret`, correct header | Behaves as S1 |
| S31 | `TRAFFIC_ENABLED=0`, valid batch of 3 | `204`; store untouched; `traffic` key absent on read. One `[Ingest] Traffic disabled…` log line, only on the first discarded batch |
| S32 | `TRAFFIC_ENABLED=0`, batch of 201 objects | `204`, **not** `400` — the kill switch short-circuits before validation |
| S33 | Valid batch accepted while `appState.connected === false` | `connected` stays `false`; `lastFrameAt` unchanged; no `FlightManager` method called |
| S34 | No traffic ever posted | `/api/status` has no `traffic` key; response bytes identical to the pre-run server for the same `AppState` |
| S35 | Traffic posted, then 10 001 ms of silence, then a fresh batch of 2 | `traffic` present with those 2 — expiry does not disable the store |
| S36 | `GET /api/ingest/traffic` | `200`, `text/html`, the body of `client/dist/index.html` — **not** `404`. `src/server.ts:776` registers `app.get('*', ...)` as an SPA catch-all after every API route, and it swallows any unmatched `GET`, `/api/ingest/frame` included. This is existing behaviour, unrelated to and unchanged by this run |

### 9.2 Agent batch assembly — `buildTrafficBatch`

Baseline for every row: `userObjectId = 1`, user at `(47.4500, -122.3000)`,
`TRAFFIC_ENABLED` unset. "Sweep" is the decoded buffer; "batch" is the returned
array. Rules applied in the §3.8 order.

| # | Sweep contains | Expected batch |
|---|---|---|
| A1 | 3 objects, ids 5, 7, 9, all airborne and finite | All 3, in sweep order, each with the six §2.1 fields and no `groundSpeedKnots` |
| A2 | ids 1, 5, 9 (id 1 is the user) | ids 5 and 9. The user's own object is dropped by guard 1 (§3.4) |
| A3 | id 88 at `(47.45000, -122.30000)`, i.e. the user's exact position, different id | Dropped by guard 2 — both axes within 0.0001° |
| A4 | id 88 at `(47.45009, -122.30009)` (0.00009° away in both axes) | Dropped by guard 2 — 0.00009 ≤ 0.0001 |
| A5 | id 88 at `(47.45020, -122.30000)` (0.0002° north) | **Kept** — outside the guard-2 box |
| A6 | id 5 with `lat: NaN` | id 5 dropped; every other object in the sweep kept |
| A7 | id 5 with `lon: undefined` | id 5 dropped; the rest kept |
| A8 | id 5 with `altitudeFt: NaN` | id 5 dropped — the finite check covers all four of lat/lon/altitudeFt/headingDeg |
| A9 | id 5 with `headingDeg: Infinity` | id 5 dropped |
| A10 | id 5 `onGround: true`, `groundSpeedKnots: 0` | Dropped — parked (§3.7) |
| A11 | id 5 `onGround: true`, `groundSpeedKnots: 0.9` | Dropped — below the 1 kt threshold |
| A12 | id 5 `onGround: true`, `groundSpeedKnots: 1` | **Kept**, with `onGround: true` — the rule is `< 1`, not `<= 1` |
| A13 | id 5 `onGround: true`, `groundSpeedKnots: 25` | Kept, `onGround: true` — a taxiing aircraft is traffic |
| A14 | id 5 `onGround: false`, `groundSpeedKnots: 0` | Kept, `onGround: false` — the filter needs both conditions |
| A15 | id 42 twice, at sweep indices 0 and 3, with different lat | One entry for id 42 holding index 3's values, at index 0's position in the batch |
| A16 | 250 valid objects | The first 200 in post-filter order; objects 201-250 dropped agent-side, so the server's `400` (S13) is never reached in normal operation |
| A17 | 200 valid objects | All 200 — the truncation is to 200, not below it |
| A18 | Empty sweep, delivered as one event with `outOf === 0` | An empty batch `{"objects":[]}` **is posted**. The post is not skipped — §5.2 needs it to clear the set |
| A19 | Sweep where every object is filtered out by A2/A6/A10 | An empty batch `{"objects":[]}` is posted, same as A18 |
| A20 | `TRAFFIC_ENABLED=off` | No data definition registered, no `requestDataOnSimObjectType` issued, no `simObjectDataByType` handler installed, no post. `TRAFFIC_ENABLED` exported as `false`. One startup log line |
| A21 | `TRAFFIC_ENABLED=` (empty string) | Enabled — the empty string is not in the disable list (§3.5) |
| A22 | `TRAFFIC_RADIUS_M=5000` | `trafficRadiusM === 5000` |
| A23 | `TRAFFIC_RADIUS_M=500` | `trafficRadiusM === 1000` — clamped to the lower bound |
| A24 | `TRAFFIC_RADIUS_M=999999` | `trafficRadiusM === 200000` — clamped to the upper bound |
| A25 | `TRAFFIC_RADIUS_M=abc` | `trafficRadiusM === 40000` and one warning line |
| A26 | `TRAFFIC_RADIUS_M` unset | `trafficRadiusM === 40000` |
| A27 | A `simObjectDataByType` event with `requestID !== REQ_TRAFFIC` | Ignored entirely — no buffer write, no post |
| A28 | A `simObjectData` event with `requestID !== REQ_FLIGHT_DATA` | Ignored entirely, as today — `userObjectId` is not updated from it and no frame is posted |

## 10. Must-not-change

The Reviewer checks these one at a time. Each names the evidence that settles it.

### 10.1 The flight-logging pipeline

1. **`src/flightManager.ts` is not edited.** `git diff --stat` for this run shows
   no change to it. The traffic path calls no `FlightManager` method; its only
   contact is a read of `appState.lastFrame.lat/lon` in §5.5.
2. **`POST /api/ingest/frame` is unchanged** — same path, same `isValidFrame`
   predicate over the same ten `SimFrame` fields, same `400 {"error":"Invalid
   frame payload"}`, same `204`, same `markConnected()` call, same
   `flightManager.onFrame(req.body)`.
3. **`POST /api/ingest/event` is unchanged** — same six accepted `type` values,
   same `pause` flags check, same errors.
4. **The 10 s / 5 s agent watchdog in `src/ingest.ts` is unchanged**, and
   `lastFrameAt` is written only by `markConnected()`, which the traffic route
   never calls (§4.7). A server receiving traffic but no frames still goes
   `disconnected` on schedule.
5. **`src/types.ts`'s `SimFrame` and `AppState` gain no members and lose none.**
   `TrafficObject` is appended as a new, independent interface.
6. **`src/index.ts` is not edited.** `createServer(flightManager)` keeps its
   one-parameter signature.
7. **Nothing traffic-related reaches `flights.db`.** No DDL, no migration, no
   `INSERT`, no `UPDATE`, no new table, no new column, no `src/db.ts` change. A
   server restart loses all traffic, by design. The live database's md5 is
   unchanged by any traffic operation.

### 10.2 `GET /api/status`

The handler at `src/server.ts:111-141` keeps every key it has today, with the
same name, the same type, and the same absence semantics:

| Key | Type | Semantics that must not change |
|---|---|---|
| `connected` | boolean | always present |
| `flightState` | `'IDLE' \| 'FLYING' \| 'ENDED'` | always present |
| `currentFlightId` | `number \| null` | always present, `null` when idle |
| `paused` | boolean | always present |
| `pauseFlags` | number | always present |
| `simRunning` | number | always present; `lastFrame?.simRunning ?? 0` |
| `onGround` | boolean | always present; `lastFrame?.onGround ?? true` |
| `aircraft` | `string \| null` | always present; `lastFrame?.aircraft ?? null` |
| `frame` | `StatusFrame \| null` | always present; `null` with no frame; same eight sub-fields |
| `plannedLeg` | object | **absent**, never `null`, unless `FLYING` and linked |

`traffic` is added as an eleventh key with the same conditional-spread treatment
as `plannedLeg`. With no traffic posted, the serialised response is byte-identical
to the pre-run server's for the same `AppState` (§6.4, row S34).

`client/src/types.ts`'s `Status` gains only the optional `traffic` member; no
existing member is edited.

### 10.3 The agent

1. **`DEF_FLIGHT_DATA = 0` and `REQ_FLIGHT_DATA = 0` keep their values**, and
   the flight-data definition's ten variables keep their order, units and types.
2. **The `simObjectData` handler still ignores every `requestID` except
   `REQ_FLIGHT_DATA`.** The `if (requestID !== REQ_FLIGHT_DATA) return;` guard on
   the first line stays exactly where it is. Traffic replies arrive on a
   different event (`simObjectDataByType`) with a different request id, so the
   two handlers cannot interfere. The only edits inside the existing handler are
   additive: destructuring `objectID`, assigning `userObjectId`, and the
   throttled sweep trigger — all after the existing frame `postJson` call.
3. **The five system-event subscriptions and the reconnect logic are
   unchanged**, including the 5 s `RECONNECT_DELAY_MS` and the
   `quit`/`close`/`error` handlers.
4. **`node-simconnect` stays at `^4.1.1`**; `agent/package.json`'s dependency
   list is unchanged.
5. **`npm start` in `agent/` still works**, notwithstanding the
   `require.main === module` guard added in §3.8.
6. Explicit non-goals for this run: no helicopter/boat/ground-vehicle sweep, no
   aircraft model or tail number on the wire, no server-side SimConnect
   connection, no traffic history, no traffic in the flight PDF or the logbook.

### 10.4 Risks

| Risk | What would falsify the design | Mitigation already in the design |
|---|---|---|
| The user's own aircraft comes back in an `AIRCRAFT` sweep with an object id that differs from the one reported for `OBJECT_USER`, producing a duplicate marker on top of the user | A duplicate marker at the user's position in the first live flight test | Guard 2 in §3.4 — the 0.0001° position match — catches it independently of ids |
| A sweep's tail event is never delivered, so `buildTrafficBatch` never flushes | Traffic markers vanishing every 10 s during a live flight while the agent logs no error | The `entryNumber <= 1` reset bounds the buffer, and the 10 s expiry (§5.4) means the map self-corrects on the next complete sweep. Not further mitigated; if it is seen, this is an amendment |
| MSFS 2024 changes `simObjectDataByType` delivery, or `SimObjectType.AIRCRAFT` excludes some traffic class the user cares about | Live traffic visibly missing from the map while it is visible in the sim | Radius and enum are both single named constants in §1.2 / §3.3; changing either is a one-line amendment |
| 100 objects at 1 Hz over a slow link makes `/api/status` heavy | Poll latency rising with traffic density | Rounding (§2.4) holds a record at ~110 bytes; the cap (§5.5) holds the payload at ~11 KB; `MAX_RETAINED_OBJECTS` can be lowered without touching any other section |
| `PLANE ALTITUDE` returns something unexpected for AI objects (some SimConnect variables behave differently on non-user objects) | Tooltips showing implausible altitudes in a live flight | Only the tooltip depends on it; markers still draw correctly. This is the one field in §2.2 whose behaviour on AI objects has **not** been verified against a running sim, because no sim is reachable from this machine |
| The 1 kt parked threshold hides traffic the user expected to see, or the 0.5 Hz sweep looks jerky | User feedback after the first flight | Both are single constants (§3.6, §3.7); neither is load-bearing for any other rule |
| §3.6's claim that SimConnect delivers one `simObjectDataByType` event with `outOf === 0` for an empty sky is inferred from the vendor sample's own guard clause, not observed against a running sim | An empty sky producing no event at all, rather than an `outOf === 0` one, during the first live flight test | If no event ever arrives, `sweepBuffer` simply never flushes for that sweep and the previous snapshot ages out after 10 s (§5.4) — same self-correcting behaviour as the lost-tail-event risk above, just slower to clear. Not further mitigated; if observed, this is an amendment |
