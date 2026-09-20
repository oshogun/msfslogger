# Design freeze — flight replay

Run id: `2026-09-19-flight-replay`
Task: T-001. Status: frozen.

Slice this document with `.claude/tools/ctx.sh design 2026-09-19-flight-replay <n> [<n> …]`.
Section numbers are stable and are the only way downstream tasks are given
this design. Every section is written to stand on its own; cross-references
are by number.

**Numbering is internal to this document.** No `§` reference, run id, task id,
`design.md`, `plan.json` or "Amendment" label may appear in a comment in
`src/`, `client/src/` or `tests/`. Where a section's reasoning belongs in the
code, the comment states the reasoning, not a pointer to where it came from.

Contracts: `contracts/replay-engine.d.ts`, `contracts/replay-panel.d.ts`,
`contracts/sample-points.json`.

## 1. Amendments

None. This table is appended to — never renumbered — if reality contradicts a
frozen section after the freeze.

| # | Date | Section | What changed | Evidence that forced it |
|---|------|---------|--------------|-------------------------|

---

## 2. Scope, and what was measured rather than assumed

### 2.1 What this freeze covers

A client-only replay of a completed flight, opened from the flight detail
page. Three new files and two edited ones:

| File | Owner task | Holds |
|------|-----------|-------|
| `client/src/utils/replay.ts` | T-002 (and T-005) | the pure engine: constants, `Timeline`, `buildTimeline`, `sample`, the virtual↔real mapping, `ReplayEventMarker` (§5, §8) |
| `client/src/hooks/useReplayClock.ts` | T-002 | the single rAF loop and its state machine (§6) |
| `client/src/types.ts` | T-002 | the widened `FlightPoint` only (§3) |
| `client/src/components/ReplayPanel.tsx` | T-003 (and T-005) | the map, controls, readout, camera, keyboard (§7) |
| `client/src/pages/FlightDetail.tsx` | T-003 | the entry point, nothing else (§7.8) |
| `client/src/index.css` | T-003 | the `replay-*` classes (§7.9) |

Type ownership is exclusive: no task other than T-002 writes `client/src/types.ts`,
and no task other than T-002/T-005 writes `client/src/utils/replay.ts`. The
engine never imports React or Leaflet, so it is unit-testable as a pure module.

### 2.2 What this freeze does **not** cover

No schema change, no migration, no new endpoint, no change to `src/**` or
`agent/**` (§4). No trip-level replay. No replay of an in-progress flight —
the live map already covers that. No planned-route overlay on the replay map
(§10.4). Phase 2 (ACARS ticks) is scoped in §8 and is deliberately additive.

### 2.3 Environment correction — the runtime is Node **24**, not 20

`.claude/ENVIRONMENT.md` says to use Node 20. That is now wrong for anything
that loads `better-sqlite3`: `.nvmrc` pins `24`, and the installed native addon
is built for Node 24's ABI.

```
$ nvm use 20; node -e "require('better-sqlite3')"
Error: The module '…/better_sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 137. This version of Node.js
requires NODE_MODULE_VERSION 115.
$ nvm use 24; node -v → v24.21.0   # loads and opens the database fine
```

Every command in §2.4 was run under Node 24. Nothing in this run needs
`better-sqlite3` at implementation time — the tasks are client-side — but a
verifier re-running the evidence below must use 24. Do not rebuild the addon.

### 2.4 Evidence log — measured against the live logbook, read-only

All queries opened `/home/guilherme/msfslogger/flights.db` with
`{ readonly: true }` under Node 24. Nothing was written; the live server on
port 3000 was not touched.

**(a) Payload size — the reason there is no new endpoint (§4.2).**

```
largest flight: id 56, 2242 points, JSON.stringify(points) = 672,443 bytes (657 KB)
whole database: 61 flights, 58,038 points
```

**(b) Interval histogram over every flight (seconds between consecutive points).**

```
<=6 s: 50,404   7–15 s: 7,503   16–30 s: 14
31–60 s: 5   61–300 s: 8   301–900 s: 32   >900 s: 11
```

The 7–15 s band is 12.9 % of all intervals and is ordinary recording jitter —
collapsing it would be wrong. Only 60 intervals in the entire logbook exceed
30 s. This is what fixes the threshold in §5.2.

**(c) The gap-collapse rule applied to every real flight** (threshold 30 s,
collapsed span 2 s): 23 of 61 flights have at least one collapsed gap.

```
flight  points  real min  virtual min  gaps   at 16x
  23      914     672.2       83.7       9     5.2 min   (a combined flight)
  86      411     147.8       37.2       9     2.3 min
   7     1188     225.0      109.2       9     6.8 min
  80     2183     285.8      202.0      10    12.6 min
  56     2242     208.3      207.7       1    13.0 min   (largest flight)
```

Worst-case virtual duration across the logbook: 207.7 min → 13.0 min at the
default 16×, 3.2 min at 64×.

**(d) Nine equal gaps is not a data error.** `combineFlights`
(`src/db/flights.ts`, `FILLER_COUNT = 8`) inserts 8 interpolated filler points
between the two legs, which produces exactly 9 equal intervals. Flight 23's
nine 3925 s gaps are those. Each collapses independently: 9 × 2 s = 18 s of
virtual time, with the marker stepping along the filler chain. That is the
correct rendering of a combined flight — the straight filler line is real data.

**(e) A real flight crosses the antimeridian.** Flight 75, consecutive points:

```
… -179.991806, -179.999173, 179.991978, 179.984615 …
```

Raw longitude jumps 360°. `unwrapLonChain` is load-bearing on real data, not
theoretical (§5.8). The excerpt is in `contracts/sample-points.json`.

**(f) Leaflet under jsdom — three measured facts** (scratch copy of `client/`,
`npx vitest run`, real `node_modules` symlinked; nothing written to the repo):

1. A `MapContainer` with a **canvas** `Polyline` (`preferCanvas` default
   `true`, which is what `FlightMap` uses) **throws** in jsdom:
   `TypeError: Cannot read properties of null (reading 'translate')` at
   `Canvas._update` — jsdom has no 2-D context.
2. The same map with `preferCanvas={false}` (SVG renderer) renders, as does
   `MapContainer` + `TileLayer` + `Marker`. This is why §7.3 freezes
   `preferCanvas={false}` and why the panel needs no Leaflet mock in tests.
3. On a zero-size container (vitest runs with `css: false`, so the panel's
   height rule does not apply) `map.fitBounds`, `L.marker(...).addTo(map)`,
   `marker.setLatLng`, `marker.getElement()`, `map.panTo(..., {animate:false})`
   and `map.latLngToContainerPoint` all succeed. `map.getSize()` is `{x:0,y:0}`
   and `latLngToContainerPoint` returns meaningless coordinates — §7.4 has the
   guard that makes the follow camera deterministic anyway.

**(g) `requestAnimationFrame` is faked by Vitest.** Under `vi.useFakeTimers()`,
`requestAnimationFrame` exists in jsdom and `advanceTimersByTimeAsync(100)`
delivers callbacks with timestamps `[16, 32, 48, 64]`. The hook can therefore
be driven deterministically from the callback's own timestamp argument, with no
injection required — the injectable scheduler in §6.1 stays available for tests
that want explicit control.

---

## 3. Data model — the client `FlightPoint`

### 3.1 The type, and who owns it

`client/src/types.ts` currently declares a four-field `FlightPoint` with a
`timestamp` field the server has never sent. It is replaced, byte-identically
to `src/types.ts`'s `FlightPoint` (lines 96–108), by:

```ts
export interface FlightPoint {
  id: number;
  flight_id: number;
  /** ISO 8601 UTC instant. */
  ts: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  airspeed_kts: number;
  ground_speed_kts: number;
  heading_deg: number;
  vertical_speed_fpm: number;
  /** 0 | 1. SQLite has no boolean. */
  on_ground: number;
}
```

Every field is non-nullable: `flight_points` has no nullable column, and
`GET /api/flights/:id` runs `SELECT * FROM flight_points … ORDER BY ts ASC`
(`src/db/flights.ts:116`), so the wire shape is the row shape. `on_ground`
stays a number, not a boolean — the JSON carries `0`/`1` and nothing converts
it on the way out. The name is `ts`; `timestamp` is deleted, not aliased.

The file keeps its existing hand-mirroring convention (`client/src/types.ts`
header comment): there is no shared package and this run does not introduce one.

**Ownership:** `client/src/types.ts` is written by T-002 only. Engine-local
types (`Timeline`, `ReplaySample`, `ReplaySegment`, `ReplayEventMarker`,
`FrameScheduler`, `ReplayClock`) live in `client/src/utils/replay.ts` and
`client/src/hooks/useReplayClock.ts`, never in `types.ts` — so T-003 and T-005
never edit the same file as each other or as T-002.

### 3.2 Why widening breaks nothing — grepped, not assumed

```
$ grep -rn "timestamp" client/src --include=*.ts --include=*.tsx
client/src/types.ts:30:  timestamp: string;
client/src/pages/AcarsMessages.tsx:362:  … last-import timestamp …   # a comment
```

Nothing reads `point.timestamp`. The four consumers of `FlightPoint` use only
fields that survive:

| Consumer | Reads | Effect of the widening |
|---|---|---|
| `client/src/components/FlightMap.tsx` | `p.lat`, `p.lon` | none |
| `client/src/components/AltitudeChart.tsx` | `p.altitude_ft` | none |
| `client/src/utils/downsample.ts` (`lttb`) | `p.altitude_ft` | none |
| `client/src/pages/PrintFlight.tsx`, `PrintTrip.tsx` | pass arrays through `strideSample`/`lttb` | none |

No test or fixture constructs a `FlightPoint`: `client/src/test/fixtures.ts`
sets `points: []` on every flight fixture, and no `*.test.tsx` mentions
`altitude_ft`. Adding required fields to a type nothing constructs cannot break
a build. The check that proves it is `cd client && npx tsc --noEmit`.

### 3.3 No server-side type change

`src/types.ts` already has the full shape. Nothing in `src/**` is edited by
this run (§11).

---

## 4. Persistence and API — deliberately unchanged

### 4.1 No schema change, no migration

Replay reads `flight_points` rows that already exist and writes nothing. There
is no DDL in this design, so there is no migration to make idempotent and no
column that could be dropped or repurposed under live rows. The live
`flights.db` is opened by this run read-only and by the implementer tasks not
at all.

### 4.2 No new endpoint — the payload was measured, not guessed

`GET /api/flights/:id` already returns every point with every field replay
needs, and `FlightDetail` already fetches it and already holds the full
non-downsampled array in state (`flight.points`, passed straight to
`FlightMap`). Replay therefore costs **zero additional bytes**: it reuses the
object already in memory.

The measured worst case (§2.4a) is 2242 points / 657 KB of JSON for the
largest flight in the real logbook — a payload the page already downloads
today, before this feature exists. A slim `/points` endpoint would not reduce
it, because the page would still fetch the full flight.

**What would falsify this** (§12.1): a flight whose point count grows past
roughly 20,000 (≈ 6 MB, ≈ 28 h of recording at 5 s). Nothing in the logbook is
within an order of magnitude of that. If it ever happens, the fix is a
`?fields=` projection or a `/api/flights/:id/points` route — additive, and
outside this run.

### 4.3 No status codes, error bodies or client-server contract change

None of `src/routes/**` is touched. The only endpoint phase 2 adds a *caller*
for is the existing `GET /api/flights/:id/acars-messages` (§8.3) — note the
path is `…/acars-messages`, not `…/acars`.

---

## 5. The replay engine — `client/src/utils/replay.ts`

Pure module. No React, no Leaflet, no `fetch`, no `Date.now()`. Every function
is deterministic: the same points and the same virtual time always give the
same sample. Full signatures: `contracts/replay-engine.d.ts`.

### 5.1 Vocabulary

- **real time** — the instant a point was recorded, epoch ms from `ts`.
- **virtual time** — seconds along the replay timeline, `0 …
  virtualDurationSec`. Equal to real elapsed time except inside a collapsed gap.
- **wall time** — the operator's own clock. `wall = virtual / speed`.
- **segment** — the span between two consecutive recorded points.
- **gap** — a segment longer than the threshold: a recording interruption
  (sim paused, agent restarted, two flights combined), not flying.

### 5.2 Constants, and why these numbers

```ts
export const RECORD_INTERVAL_SEC = 5;   // mirrors the server's 5000 ms cadence
export const GAP_THRESHOLD_SEC = 30;    // 6 × the record interval
export const COLLAPSED_GAP_SEC = 2;
export const SPEED_STEPS = [1, 2, 4, 8, 16, 32, 64] as const;
export const DEFAULT_SPEED = 16;
```

- **`GAP_THRESHOLD_SEC = 30`.** Measured (§2.4b): 12.9 % of all real intervals
  fall in 7–15 s — ordinary jitter that must keep playing at real pace — while
  only 60 intervals in the whole logbook exceed 30 s and only 14 sit in the
  16–30 s band. 30 s is comfortably above the jitter band and below every real
  interruption. A copy of the server's own reasoning
  (`src/flightManager.ts:23`: a pause guard "so ordinary jitter is never
  mistaken for an interruption").
- **`COLLAPSED_GAP_SEC = 2`.** Long enough at 1× to read as a deliberate hold
  rather than a teleport, short enough that nine of them in a combined flight
  cost 18 virtual seconds. At 16× a gap passes in 125 ms of wall time.
- **`SPEED_STEPS`.** Powers of two from 1× to 64×. 64× replays the longest real
  flight (207.7 virtual minutes) in 3.2 min; 1× is needed to watch a landing.
  Doubling steps means the scrubber position is unaffected by a speed change
  (§6.3) and the labels stay short (`1×` … `64×`).
- **`DEFAULT_SPEED = 16`.** The median real flight in the logbook is roughly
  85 min, which is 5.3 min at 16× — long enough to watch, short enough to sit
  through. The worst case is 13 min (§2.4c).

An implementer must not invent other values; the UI offers exactly these steps.

### 5.3 `buildTimeline` — normalisation

```ts
export function buildTimeline(points: FlightPoint[], opts?: BuildTimelineOptions): Timeline;
```

Normalisation runs in this exact order, so two implementations agree:

1. **Drop** any point where `Date.parse(p.ts)` is not finite, or `p.lat` /
   `p.lon` is not finite. (A `NaN` timestamp must not poison the timeline.)
2. **Sort** ascending by parsed time, ties broken by the point's original index
   (a stable sort over `(t, originalIndex)`). The server already returns
   `ORDER BY ts ASC`; this makes the engine independent of that.
3. **Deduplicate**: a point whose time equals the previous *kept* point's time
   is dropped. The first one wins. This guarantees every segment has
   `realDurationSec > 0`, so no divide-by-zero is possible in §5.5.
4. Non-finite values in the readout fields (`altitude_ft`, `airspeed_kts`,
   `ground_speed_kts`, `heading_deg`, `vertical_speed_fpm`) are **not** a
   reason to drop a point; they are read as `0` wherever interpolation touches
   them.

`timeline.points` is the normalised array; `timeline.timesMs[i]`,
`timeline.latlngs[i]` and `timeline.points[i]` always describe the same point.
`timeline.options` records the resolved thresholds.

### 5.4 The `Timeline` shape

See `contracts/replay-engine.d.ts` for the literal declaration. The fields a
consumer relies on: `points`, `timesMs`, `latlngs`, `segments`,
`virtualDurationSec`, `realDurationSec`, `gapCount`, `startMs`, `options`.

`latlngs` is what the panel draws as its polyline **and** what `sample` reads,
so the marker can never sit off the drawn line (§5.8).

### 5.5 Segment construction and the gap-collapse rule

For `i` in `0 … points.length - 2`:

```
realDurationSec = (timesMs[i+1] - timesMs[i]) / 1000        // > 0, by §5.3 step 3
isGap           = realDurationSec > gapThresholdSec          // strict >
durationSec     = isGap ? collapsedGapSec : realDurationSec
startVirtualSec = sum of durationSec of all previous segments
```

`virtualDurationSec` is the sum of every `durationSec` — `0` when there are
fewer than two points. Segment boundaries are exact: `segments[k].startVirtualSec
+ segments[k].durationSec === segments[k+1].startVirtualSec`, accumulated in
one pass so the equality holds exactly in floating point.

**Inside a gap the marker holds.** Position, altitude, speeds, heading and
on-ground are frozen at the gap's *from*-point for the whole collapsed span,
then step to the *to*-point at its end (§5.6). The engine never interpolates
across a gap: there is no data there, and a smooth glide across a 65-minute
interruption is a lie the map would tell convincingly.

### 5.6 `sample` — the interpolation rules

```ts
export function sample(timeline: Timeline, virtualSec: number): ReplaySample | null;
```

Returns `null` **only** when `timeline.points.length === 0`.

1. Clamp `v = min(max(virtualSec, 0), virtualDurationSec)`.
2. Single point (`segments.length === 0`): return that point verbatim,
   `pointIndex = 0`, `segmentIndex = -1`, `inGap = false`, `gapRealSec = 0`,
   `realTimeMs = timesMs[0]`.
3. Otherwise binary-search `segments` for the **last** segment with
   `startVirtualSec <= v`; call it `seg` (index `segmentIndex`). At an exact
   boundary this picks the *later* segment, which is what makes the end of a
   collapsed gap land on the post-gap point.
4. `f = (v - seg.startVirtualSec) / seg.durationSec`, clamped to `[0, 1]`.
5. `hf = seg.isGap ? (f >= 1 ? 1 : 0) : f` — the hold fraction. Every field
   below uses `hf`, never `f`.
6. With `a = points[seg.fromIndex]`, `b = points[seg.toIndex]`:

| Field | Rule |
|---|---|
| `lat` | `lerp(a.lat, b.lat, hf)` |
| `lon` | `lerp(latlngs[from][1], latlngs[to][1], hf)` — unwrapped space (§5.8) |
| `altitudeFt` | `lerp(a.altitude_ft, b.altitude_ft, hf)` |
| `airspeedKnots` | `lerp(a.airspeed_kts, b.airspeed_kts, hf)` |
| `groundSpeedKnots` | `lerp(a.ground_speed_kts, b.ground_speed_kts, hf)` |
| `verticalSpeedFpm` | `lerp(a.vertical_speed_fpm, b.vertical_speed_fpm, hf)` |
| `headingDeg` | shortest arc, below |
| `onGround` | `(hf >= 1 ? b : a).on_ground === 1` — stepwise, never blended |
| `pointIndex` | `hf >= 1 ? seg.toIndex : seg.fromIndex` |
| `inGap` | `seg.isGap && hf < 1` |
| `gapRealSec` | `inGap ? seg.realDurationSec : 0` |
| `realTimeMs` | `lerp(timesMs[from], timesMs[to], hf)` |
| `virtualSec` | `v` (the clamped input) |

`lerp(x, y, t) = x + (y - x) * t`, with a non-finite `x` or `y` read as `0`
(§5.3 step 4).

**Heading — shortest arc.** Interpolating 350° → 10° linearly sweeps the long
way round and visibly spins the aircraft. The rule is:

```
d = ((b.heading_deg - a.heading_deg + 540) % 360) - 180   // signed, (-180, 180]
h = a.heading_deg + d * hf
headingDeg = ((h % 360) + 360) % 360                       // [0, 360)
```

350 → 10 at `hf = 0.5` gives `0`; 10 → 350 at `hf = 0.5` gives `0`; an exact
180° reversal resolves to `-180` (counter-clockwise, so 0 → 180 samples 270 at `hf = 0.5`) — arbitrary but deterministic, and
the `+540` form is what makes it so. JavaScript's `%` keeps the sign of the
dividend, which is why the final normalisation is `((x % 360) + 360) % 360` and
not a bare `% 360`.

### 5.7 Virtual ↔ real mapping

```ts
export function realMsFromVirtual(timeline: Timeline, virtualSec: number): number;
export function virtualFromRealMs(timeline: Timeline, realMs: number): number | null;
```

- `realMsFromVirtual` is exactly `sample(...)!.realTimeMs` (and returns
  `timeline.startMs` for an empty timeline). It is what the scrubber label and
  the readout clock use: the operator reads the *recorded* time, never virtual
  seconds.
- `virtualFromRealMs` is its inverse for phase 2 (§8): `null` when the timeline
  is empty or `realMs` lies strictly outside
  `[timesMs[0], timesMs[last]]`; otherwise the virtual offset of that instant.
  An instant **inside** a collapsed gap maps to that gap segment's
  `startVirtualSec`, so an event recorded during an interruption pins to the
  moment recording stopped rather than to an invented position.
  Implementation: binary-search `timesMs`, then add the in-segment offset —
  `seg.isGap ? 0 : (realMs - timesMs[from]) / 1000`.

Round-tripping is exact outside gaps: `virtualFromRealMs(t, realMsFromVirtual(t, v)) === v`
for any `v` not inside a gap segment. Inside a gap it is lossy by construction,
and no consumer may assume otherwise.

### 5.8 Antimeridian

`buildTimeline` computes `latlngs = unwrapLonChain(points.map(p => [p.lat, p.lon]))`
from `client/src/utils/geo.ts`, over the **full, non-downsampled** chain — the
same function and the same input order `FlightMap` uses, so an unwrapped
longitude such as `180.2°` renders against correctly tiled imagery.

Two consequences an implementer must not "fix":

1. `sample().lon` may legitimately be outside `[-180, 180]`. Do not normalise
   it before handing it to Leaflet — that is exactly the bug the unwrap exists
   to prevent. Normalise only for a human-readable coordinate display, and
   never for `setLatLng`.
2. The panel draws its polyline from `timeline.latlngs` (not from a fresh
   unwrap of its own, and not from a downsampled copy), so the marker is
   guaranteed to sit on the drawn line.

Verified against real data: flight 75 crosses the dateline
(`-179.999173 → 179.991978`, §2.4e); the excerpt is in
`contracts/sample-points.json` and is the fixture for the engine's
antimeridian test (§9.1).

### 5.9 Edge cases — the frozen answers

| Input | Answer |
|---|---|
| `points: []` | `virtualDurationSec 0`, `segments []`, `sample()` → `null`. The panel is never rendered for this (§7.8), but the engine must not throw. |
| 1 point | `virtualDurationSec 0`, `segments []`, `sample(any v)` → that point, `segmentIndex -1`. |
| 2 identical timestamps | the later is dropped (§5.3). Two points with the same `ts` therefore behave as one point. |
| unsorted input | stable-sorted by time first; output is identical to the sorted input. |
| `ts` unparseable (`NaN`) | that point is dropped; the timeline is built from the rest. |
| non-finite `lat`/`lon` | point dropped. |
| non-finite `altitude_ft` etc. | point kept; that field reads `0`. |
| `virtualSec` negative / beyond the end / `NaN` | clamped to `[0, virtualDurationSec]`; `NaN` clamps to `0`. |
| every interval a gap (e.g. 3 points 1 h apart) | `virtualDurationSec = 2 × collapsedGapSec`; playback is a sequence of holds and steps. |
| a gap as the **last** segment | reachable: `hf >= 1` at the very end returns the final point (§5.6 step 5). |

---

## 6. The clock — `client/src/hooks/useReplayClock.ts`

### 6.1 Signature

```ts
export interface FrameScheduler {
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
}
export type TickReason = 'frame' | 'seek' | 'play' | 'pause' | 'end';

export interface UseReplayClockOptions {
  virtualDurationSec: number;
  speed: number;
  onTick: (virtualSec: number, reason: TickReason) => void;
  scheduler?: FrameScheduler;
}

export interface ReplayClock {
  playing: boolean; finished: boolean;
  play(): void; pause(): void; toggle(): void;
  seekTo(virtualSec: number): void; seekBy(deltaSec: number): void;
  restart(): void; getVirtualSec(): number;
}

export function useReplayClock(opts: UseReplayClockOptions): ReplayClock;
```

`scheduler` defaults to `{ request: requestAnimationFrame, cancel: cancelAnimationFrame }`
bound to `globalThis`. It exists so a test can step frames by hand; Vitest's
fake timers already fake rAF (§2.4g), so most tests will not need it.

### 6.2 The loop — exactly one rAF chain

- Virtual time lives in a **ref**, never in React state. The only React state
  in the hook is `playing` and `finished` — two booleans that change on a user
  action or at the end of the timeline, never per frame.
- `speed`, `onTick` and `virtualDurationSec` are mirrored into refs on every
  render, so changing the speed does **not** cancel or restart the frame chain.
- Each frame, with the scheduler's timestamp `t`:

```
dt = (t - lastFrameMs) / 1000            // lastFrameMs seeded on play()
dt = min(max(dt, 0), 0.25)               // a backgrounded tab must not leap
virtual += dt * speedRef.current
if (virtual >= duration) { virtual = duration; stop; finished = true; onTick(duration, 'end') }
else { onTick(virtual, 'frame'); schedule the next frame }
```

  The `0.25 s` clamp bounds a single frame to a quarter-second of virtual time
  per speed unit — a tab restored after a minute resumes where it paused
  instead of jumping to the end.
- The loop reads the **scheduler's timestamp argument**, never `Date.now()` or
  `performance.now()`, which is what makes it deterministic under fake timers.
- Unmount cancels any pending frame. So does `pause()`. There is never more
  than one outstanding request.

### 6.3 State machine

| Call | Effect |
|---|---|
| `play()` on a stopped clock | if `finished`, first set virtual to `0` and clear `finished`; seed `lastFrameMs` on the first frame; `playing = true`; `onTick(v, 'play')`; schedule. |
| `play()` while playing | no-op. |
| `pause()` | cancel the frame, `playing = false`, `onTick(v, 'pause')`. |
| `toggle()` | `playing ? pause() : play()`. |
| `seekTo(x)` | `v = clamp(x, 0, duration)`; if `v < duration` clear `finished`; `onTick(v, 'seek')`. Does **not** change `playing` — scrubbing while playing keeps playing. |
| `seekBy(d)` | `seekTo(getVirtualSec() + d)`. |
| `restart()` | `seekTo(0)` then `play()`. |
| reaching the end | `playing = false`, `finished = true`, virtual pinned at `duration`, `onTick(duration, 'end')`. Playback **stops**; it never loops. |
| `virtualDurationSec === 0` | `play()` immediately ends: one `onTick(0, 'end')`, `finished = true`. |

A speed change mid-playback preserves position exactly, because position is
integrated, not derived from a start timestamp.

### 6.4 What the hook does not do

It knows nothing about points, maps, or samples. It never calls `sample`. The
panel owns the mapping from virtual time to pixels (§7.2).

---

## 7. Client contract — `ReplayPanel` and `FlightDetail`

### 7.1 Props

```ts
interface ReplayPanelProps {
  points: FlightPoint[];        // full, non-downsampled
  id?: string;                  // for aria-controls
  events?: ReplayEventMarker[]; // phase 2 only (§8)
  scheduler?: FrameScheduler;   // test seam
}
```

`ReplayPanel` builds its timeline once: `useMemo(() => buildTimeline(points), [points])`.
It imports `FlightPoint` from `../types`, and everything else from
`../utils/replay` / `../hooks/useReplayClock`. It does **not** import
`FlightMap` (§7.3), `downsample`, or anything from `pages/`.

### 7.2 Rendering rule — no React render per frame

The single hard rule: **an animation frame never causes a React re-render.**
`onTick` writes to the DOM through refs.

| Updated | How | Cadence |
|---|---|---|
| marker position | `markerRef.current.setLatLng([s.lat, s.lon])` | every frame |
| marker rotation | `aircraftElRef.current.style.transform = \`rotate(${s.headingDeg - 90}deg)\`` | every frame |
| scrubber thumb | `scrubberRef.current.value = String(s.virtualSec)` | ≤ 10 Hz |
| readout values | `el.textContent = …` per field ref | ≤ 10 Hz |
| follow camera | §7.4 | ≤ 10 Hz |

Throttle rule: the panel keeps a `lastUiMs` ref; the ≤ 10 Hz group runs when
`tickMs - lastUiMs >= 100`, and **always** runs (regardless of the throttle)
when `reason !== 'frame'` — so a seek, pause or end updates the display
immediately. `tickMs` is the scheduler timestamp the panel captured for this
tick; for non-`frame` reasons the panel may use its own monotonic counter.

React state in the panel is limited to: `speed`, `follow`, and the hook's
`playing`/`finished`. Four state variables, all user-driven.

The marker's rotation is applied to an **inner** element, never to the Leaflet
icon root — Leaflet owns the root's `transform` for positioning. The icon is
created once:

```ts
L.divIcon({ className: '', iconAnchor: [12, 12],
  html: `<div class="replay-aircraft" style="transform:rotate(-90deg);…">✈</div>` })
```

and the panel keeps `aircraftElRef = marker.getElement()!.firstElementChild as HTMLElement`.
`setIcon` is never called during playback (it would rebuild the DOM node 60
times a second). The `- 90` offset is because the ✈ glyph points east, the same
correction `LiveMap.tsx` makes. Verified to work under jsdom (§2.4f3).

### 7.3 The map — the panel owns its own `MapContainer`

`FlightMap.tsx` is **not** modified and **not** reused. It accepts no children,
so the aircraft marker could not be added without changing it, and it is shared
with the two print pages (§11). `ReplayPanel` renders its own map:

```tsx
<MapContainer preferCanvas={false} zoomControl center={timeline.latlngs[0]} zoom={10}>
  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
             attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' maxZoom={18} />
  <Polyline positions={timeline.latlngs} pathOptions={{ color: '#60a5fa', weight: 2.5, opacity: 0.45 }} />
  <ReplayMapController … />   {/* useMap(); creates and moves the marker */}
</MapContainer>
```

- **`preferCanvas={false}` is load-bearing**, and not only for looks: the
  canvas renderer throws under jsdom (§2.4f1), so the SVG renderer is what lets
  the panel be tested without mocking Leaflet. Track sizes are ≤ ~2.2 k points
  (§2.4a), well within SVG's comfort zone, and the polyline is drawn once.
- The track is drawn at `opacity: 0.45` so the aircraft reads clearly against
  it. Departure/arrival dots are optional and may be omitted; if drawn they use
  `timeline.latlngs[0]` / `[last]`.
- The marker is created imperatively inside the controller child with
  `useMap()` — the same pattern as `LiveMapController` — with
  `zIndexOffset: 1000`.
- On mount the controller calls `map.fitBounds(L.latLngBounds(timeline.latlngs),
  { padding: [30, 30] })` once, then `map.invalidateSize()`. It never fits
  bounds again; after that the viewport belongs to the operator and to §7.4.

### 7.4 Follow camera

Default **on**. The rule, evaluated at the ≤ 10 Hz cadence:

```
if (!follow) return;
const size = map.getSize();
if (size.x === 0 || size.y === 0) { map.panTo(pos, { animate: false }); return; }
const p = map.latLngToContainerPoint(pos);
const outside = p.x < size.x * 0.2 || p.x > size.x * 0.8
             || p.y < size.y * 0.2 || p.y > size.y * 0.8;
if (outside) map.panTo(pos, { animate: false });
```

Recentring only when the aircraft leaves the middle 60 % of the viewport keeps
the map still most of the time — a `panTo` on every tick would fight the tile
loader and make the map unreadable. `animate: false` is deliberate: an animated
pan started 10 times a second never completes. The zero-size guard makes the
behaviour defined under jsdom, where `getSize()` is `{0,0}` and
`latLngToContainerPoint` is meaningless (§2.4f3).

Switching follow **on** recenters immediately (`map.panTo(pos, { animate: false })`).
Switching it off does nothing — the map stays where it is. Any manual pan or
zoom by the operator is preserved until the aircraft next leaves the middle
box; the toggle is the only way to stop the camera moving.

### 7.5 Readout

A `<dl className="replay-readout">` of nine items, each
`<div className="replay-readout-item"><dt>LABEL</dt><dd className="replay-value" data-field="…">VALUE</dd></div>`.
The `data-field` attribute is the stable handle for both the panel's refs and
the tests.

| `data-field` | `<dt>` | Value | Source |
|---|---|---|---|
| `time` | `TIME` | `13:37:45Z` | `new Date(s.realTimeMs).toISOString().slice(11,19) + 'Z'` |
| `elapsed` | `ELAPSED` | `1h 23m` / `12m 04s` | `formatDuration(Math.round((s.realTimeMs - timeline.startMs)/1000))` |
| `alt` | `ALT` | `12,300 ft` | `formatAlt(s.altitudeFt) + ' ft'` |
| `ias` | `IAS` | `287 kt` | `formatSpeed(s.airspeedKnots) + ' kt'` |
| `gs` | `GS` | `301 kt` | `formatSpeed(s.groundSpeedKnots) + ' kt'` |
| `hdg` | `HDG` | `073°` | `String(Math.round(s.headingDeg) % 360).padStart(3,'0') + '°'` |
| `vs` | `VS` | `+1,200 fpm` / `-800 fpm` | sign, then `Math.abs(Math.round(s.verticalSpeedFpm/10)*10).toLocaleString()`, then ` fpm` |
| `state` | `STATE` | `On ground` / `Airborne` | `s.onGround` |
| `point` | `POINT` | `431 / 914` | `s.pointIndex + 1` and `timeline.points.length` |

`formatAlt`/`formatSpeed`/`formatDuration` are the existing
`client/src/utils/format.ts` helpers — no new formatter module. `formatAlt`
group-separates via `toLocaleString`, so a test asserting an altitude string
must either use a value below 1000 or match the grouped form.

When `sample().inGap` is true the panel adds the class `replay-readout--gap`
to the `<dl>` and sets `data-field="state"` to
`Recording gap — ${formatDuration(Math.round(s.gapRealSec))}`. Nothing else
changes; the other fields keep showing the held values, which is the truth.

### 7.6 Controls and accessibility

A `<div className="replay-controls">` holding, in order:

| Control | Markup | Notes |
|---|---|---|
| play/pause | `<button className="btn btn-primary replay-play" aria-label="Play replay" \| "Pause replay" \| "Restart replay">` | text `Play` / `Pause` / `Restart`; `Restart` when `finished` |
| scrubber | `<input type="range" className="replay-scrubber" min="0" max={virtualDurationSec} step="0.1" defaultValue="0" aria-label="Replay position" aria-valuetext={…}>` | uncontrolled (`defaultValue` + ref); `onChange` → `clock.seekTo(Number(e.target.value))` |
| position label | `<span className="replay-time" data-field="scrub">` | the same string as the `time` readout, updated with it |
| speed | `<select className="replay-speed" aria-label="Replay speed">` with one `<option value={s}>{s}×</option>` per `SPEED_STEPS` | `onChange` → `setSpeed(Number(...))` |
| follow | `<label className="replay-follow"><input type="checkbox" checked={follow} onChange={…}/> Follow aircraft</label>` | default checked |

Accessibility rules:

- Every control carries a visible label or an `aria-label`; no icon-only button
  without one.
- The scrubber's `aria-valuetext` is updated with the same throttled write as
  its `value`, so a screen reader announces `13:37:45Z`, not `4821.3`.
- The readout is **not** a live region: it is a `<dl>` with no `aria-live`.
  Announcing nine values ten times a second is unusable; the operator reads it
  visually and can pause to inspect it.
- The panel root is `<section className="replay-panel" id={id} tabIndex={0}
  aria-label="Flight replay">`, so it can take focus for §7.7.

### 7.7 Keyboard

Handled by an `onKeyDown` on the panel root. The handler returns immediately if
`event.target` is an `input`, `select`, `textarea` or a `[contenteditable]`
element — the range input and the select keep their native key behaviour, and
no key is handled twice.

| Key | Action |
|---|---|
| `Space` | `clock.toggle()`, `preventDefault()` (stops the page scrolling) |
| `ArrowRight` / `ArrowLeft` | `clock.seekBy(±5)` virtual seconds |
| `Shift+ArrowRight` / `Shift+ArrowLeft` | `clock.seekBy(±30)` |
| `Home` / `End` | `clock.seekTo(0)` / `clock.seekTo(virtualDurationSec)` |

Seeks are in **virtual** seconds, so an arrow press moves the same distance
along the scrubber at every speed. No global (`document`-level) listener is
registered: the shortcuts work when the panel has focus, and never steal keys
from the rest of the page.

### 7.8 `FlightDetail` entry

One new block, placed **between** the existing "GPS Track" section and the
"Altitude Profile" section, and rendered only when
`(flight.points?.length ?? 0) >= 2` — the same guard the altitude chart already
uses:

```tsx
{(flight.points?.length ?? 0) >= 2 && (
  <div className="replay-section">
    <div className="section-title">Replay</div>
    <button className="btn btn-ghost" aria-expanded={replayOpen} aria-controls="replay-panel"
            onClick={() => setReplayOpen(o => !o)}>
      {replayOpen ? 'Hide replay' : 'Replay flight'}
    </button>
    {replayOpen && <ReplayPanel id="replay-panel" points={flight.points!} />}
  </div>
)}
```

- One new state variable, `const [replayOpen, setReplayOpen] = useState(false)`.
  Everything else on the page is untouched.
- **Closed by default and mounted on demand.** No second Leaflet map exists
  until the operator asks for one, which is what keeps the page's cost and the
  existing end-to-end assertions unchanged (§11.4).
- The button lives in its own section rather than in the bottom
  `.flight-actions` row so the panel opens next to the map it relates to, not
  four sections below the button that opened it.
- The planned route is **not** drawn on the replay map (§10.4). The GPS Track
  map directly above already shows it, and `PLANNED_ROUTE_COLOR` is private to
  `FlightMap.tsx`; copying it would create a second source of truth for a
  colour that is deliberately frozen.

### 7.9 CSS

New classes in `client/src/index.css`, all prefixed `replay-`:
`.replay-section`, `.replay-panel`, `.replay-map` (height `420px`, matching
`#map`, with the same radius and border), `.replay-controls`, `.replay-play`,
`.replay-scrubber`, `.replay-time`, `.replay-speed`, `.replay-follow`,
`.replay-readout`, `.replay-readout-item`, `.replay-value`,
`.replay-readout--gap`, `.replay-aircraft`, and (phase 2) `.replay-ticks`,
`.replay-tick`. No existing rule is edited, and nothing targets `#map`,
`#live-map`, `.map-section`, `.chart-section` or `.print-*`.

---

## 8. Phase-2 hook points — ACARS ticks on the scrubber

Frozen now so phase 2 (T-005) is additive and needs no redesign.

### 8.1 The type already exists in the engine

`ReplayEventMarker { id: number; realMs: number; label: string; category: string }`
lives in `client/src/utils/replay.ts` from phase 1 (§5), and `ReplayPanel`
already declares `events?: ReplayEventMarker[]` (§7.1). Phase 2 adds callers,
not shapes.

### 8.2 The DOM slot exists in phase 1

The scrubber is wrapped in `<div className="replay-scrubber-wrap">` containing
the range input and an empty `<div className="replay-ticks" aria-hidden="true">`.
Phase 1 renders the wrapper and the empty ticks container; phase 2 fills it
with one absolutely positioned
`<button className="replay-tick replay-tick--{category}" style={{ left: pct }}
title={label}>` per event, where

```
v = virtualFromRealMs(timeline, ev.realMs)     // §5.7
if (v === null) skip the event entirely
pct = (v / timeline.virtualDurationSec) * 100 + '%'
```

Clicking a tick calls `clock.seekTo(v)`. `aria-hidden` on the container keeps
the ticks out of the screen-reader path — the scrubber's own label already
carries the position — and the buttons are reachable by the operator's mouse.

### 8.3 Where the events come from

`GET /api/flights/:id/acars-messages` (`src/routes/acars.ts:48`) returns
`AcarsThread { flight_id, planned_leg_id, messages: AcarsMessage[] }`, oldest
first. The mapping is `id → message.id`, `realMs → Date.parse(message.sent_at)`,
`label → \`${message.label ?? message.category} — ${message.body.slice(0, 60)}\``,
`category → message.category`. Fetched lazily when the panel mounts. A failed
or non-200 fetch is swallowed: `events` stays `[]` and replay works exactly as
in phase 1 — ticks are an ornament, never a dependency.

---

## 9. Test plan — what the tests must cover

### 9.1 `client/src/utils/replay.test.ts` (engine, pure)

Fixtures are hand-built arrays of the widened `FlightPoint`; the antimeridian
and gap excerpts in `contracts/sample-points.json` are real data and may be
pasted in. Required cases:

1. **Midpoint interpolation** — two points 10 s apart; `sample(tl, 5)` returns
   the arithmetic mean of `lat`, `lon`, `altitude_ft`, `airspeed_kts`,
   `ground_speed_kts`, `vertical_speed_fpm`.
2. **Heading shortest arc** — 350° → 10° at the midpoint is `0`, not `180`; the
   reverse 10° → 350° is also `0`; a 90° → 100° case stays `95`.
3. **Heading normalisation** — the result is always in `[0, 360)`; no `-10` and
   no `370`.
4. **Gap collapse** — three points at `t=0, 5 s, 3600 s`: `virtualDurationSec`
   is `5 + COLLAPSED_GAP_SEC`, `gapCount === 1`, and sampling anywhere strictly
   inside the collapsed span returns the pre-gap point's position with
   `inGap === true` and `gapRealSec === 3595`.
5. **Gap boundary** — sampling exactly at the end of the collapsed span returns
   the post-gap point (`pointIndex === 2`, `inGap === false`).
6. **Sub-threshold interval is not a gap** — a 15 s interval (real jitter,
   §2.4b) has `isGap === false` and plays at real pace.
7. **`on_ground` steps, never blends** — a segment from `on_ground: 1` to
   `on_ground: 0` returns `true` for every `hf < 1` and `false` at `hf === 1`.
8. **Antimeridian** — the flight-75 excerpt yields a strictly continuous
   longitude sequence in `timeline.latlngs` (no step > 180°), and a sample
   between the two straddling points has a `lon` between them in unwrapped
   space (i.e. `> 179.9` or `< -179.9`, never near `0`).
9. **0 points** — `buildTimeline([])` gives `virtualDurationSec 0`,
   `segments []`; `sample(tl, 0)` is `null`; nothing throws.
10. **1 point** — `sample` at any `v` returns that point with
    `segmentIndex === -1`.
11. **Duplicate timestamps** — a duplicated `ts` is dropped; `points.length`
    reflects it; no segment has `durationSec === 0`.
12. **Unsorted input** — shuffling the input array produces a `Timeline`
    identical to the sorted one.
13. **`NaN` / unparseable `ts`** — dropped; the remaining points build a valid
    timeline.
14. **Clamping** — `sample(tl, -10)` equals `sample(tl, 0)`; `sample(tl, 1e9)`
    equals `sample(tl, virtualDurationSec)`; `sample(tl, NaN)` equals
    `sample(tl, 0)`.
15. **Segment continuity** — for every `k`, `startVirtualSec + durationSec`
    of segment `k` equals `startVirtualSec` of segment `k+1` exactly.
16. **`realMsFromVirtual` / `virtualFromRealMs` round trip** — exact outside
    gaps; an instant inside a gap maps to the gap's `startVirtualSec`; an
    instant before the first or after the last point returns `null`.
17. **Custom options** — `buildTimeline(pts, { gapThresholdSec: 10,
    collapsedGapSec: 1 })` reclassifies a 15 s interval as a gap, proving the
    thresholds are not hard-coded inside the loop.

### 9.2 `client/src/hooks/useReplayClock.test.ts`

Driven with `vi.useFakeTimers()` (rAF is faked, §2.4g) or an injected
`FrameScheduler`; never with real time.

1. `play()` advances virtual time: after 1 s of fake time at speed 1, `onTick`
   has fired with a value near 1 (±1 frame).
2. Speed multiplies: the same elapsed fake time at speed 8 advances ~8×.
3. `pause()` freezes: no further `'frame'` tick after the pause, and
   `getVirtualSec()` is unchanged across another 1 s of fake time.
4. Changing `speed` mid-play preserves position — the value does not jump at
   the moment of the change.
5. Reaching the end stops: `playing === false`, `finished === true`, the last
   tick reason is `'end'` and its value is exactly `virtualDurationSec`.
6. `play()` while `finished` restarts from 0 and clears `finished`.
7. `seekTo` clamps to `[0, duration]` and does not change `playing`.
8. `seekBy` is relative and clamps the same way.
9. `virtualDurationSec === 0`: `play()` ends immediately with one `'end'` tick.
10. Unmount cancels the pending frame — no tick fires after unmount (assert the
    scheduler's `cancel` was called, or that `onTick` stops).
11. A frame delivered after a long stall advances by at most `0.25 s × speed`.

### 9.3 `client/src/components/ReplayPanel.test.tsx`

Rendered with the existing `renderWithProviders`; no Leaflet mock (§2.4f2).

1. Renders play/pause, scrubber, speed select and follow checkbox, each
   findable by its accessible name.
2. The readout shows the first point's values on mount (`data-field="alt"`
   etc.).
3. Moving the scrubber (`fireEvent.change`) updates the readout to the sampled
   values and does not start playback.
4. Play then pause with fake timers: the readout advances, then stops changing.
5. Reaching the end leaves the button labelled `Restart`; clicking it plays
   from the start again.
6. The aircraft marker moves without a React re-render of the map: assert
   either that `L.Marker.prototype.setLatLng` was called more times than the
   `MapContainer` subtree rendered, or that a render-counting spy on a map
   child stays constant across frames.
7. Marker rotation is applied to `.replay-aircraft`'s inline `transform`, and
   equals `heading - 90` degrees for the sampled heading.
8. `Space` on the focused panel toggles playback; `ArrowRight` seeks forward;
   a key pressed while the scrubber has focus is **not** handled twice.
9. A flight whose points are all within one gap still renders (no crash, no
   `NaN` in the readout).

### 9.4 `client/src/pages/FlightDetail.test.tsx` (additions only)

1. No Replay button for a flight with `points: []` or one point.
2. The Replay button appears for a flight with ≥ 2 points, and the panel is
   **not** in the document until it is clicked.
3. Clicking the button mounts the panel; clicking again unmounts it.
4. The existing tests in this file keep passing unmodified.

### 9.5 Commands

```
cd client && npx vitest run src/utils/replay.test.ts src/hooks/useReplayClock.test.ts
cd client && npx vitest run            # the whole client suite, including the panel
cd client && npx tsc --noEmit
cd client && npm run test:types
```

Under Node 24 (§2.3). Never `npm run build` in this checkout — it overwrites
the `client/dist/` the user's running server serves. Any click-through check
builds in a scratch copy of the tree.

---

## 10. Alternatives considered

### 10.1 A new `/api/flights/:id/points` endpoint

**Rejected.** The page already has the array in memory; a second endpoint would
add a contract, a cache-invalidation question and a server change for zero
bytes saved (§4.2). Measured worst case 657 KB, already downloaded today.
Revisit only at the falsification threshold in §12.1.

### 10.2 Skipping gaps entirely (zero virtual span) instead of collapsing to 2 s

**Rejected.** A zero-length segment gives the operator no signal that recording
stopped; the aircraft would teleport mid-flight with no explanation, and 23 of
61 real flights contain at least one gap (§2.4c). A 2 s hold with a
"Recording gap — 1h 05m" readout (§7.5) tells the truth cheaply. The opposite
choice — playing gaps at real speed — was rejected on the same evidence: flight
23 would spend 588 of its 672 minutes showing a motionless aircraft.

### 10.3 Reusing `FlightMap` with a new optional `children` prop

**Rejected**, on two independent grounds. `FlightMap` is shared with
`PrintFlight`/`PrintTrip` and the PDF pipeline, so every change to it is a
change to the print output's blast radius; and it uses the canvas renderer,
which cannot mount under jsdom (§2.4f1), so the panel's tests would need a
Leaflet mock. An own `MapContainer` with `preferCanvas={false}` costs ~20 lines
of JSX and leaves `FlightMap.tsx` byte-identical (§11.1).

### 10.4 Drawing the planned route on the replay map

**Rejected for phase 1.** `PLANNED_ROUTE_COLOR` and the procedure-note wording
are deliberately private to `FlightMap.tsx` ("Frozen outside the flown-track
colour so it is identical on the trip map, this flight map and the printed
map"); a second copy in `ReplayPanel` would be a second source of truth for a
frozen colour. The planned route is already visible on the GPS Track map
directly above the replay section. If it is wanted later, the right move is to
export the constant from a shared module — a refactor of `FlightMap`, out of
scope here.

### 10.5 React state for the readout at 10 Hz instead of direct DOM writes

**Rejected.** A `setState` ten times a second re-renders the panel and the
`MapContainer` subtree, and react-leaflet then diffs a 2200-point polyline
prop on every one of those renders. Direct `textContent` writes through refs
are still fully visible to Testing Library queries, so nothing is lost in
testability. The rule is stated as a test in §9.3 case 6 so it cannot quietly
regress.

### 10.6 Interpolating position continuously and letting Leaflet animate

**Rejected.** `marker.setLatLng` with CSS transitions or `panTo({animate:true})`
per frame queues animations that never finish at 10–60 Hz and makes the marker
lag the readout. One imperative write per frame from a single rAF loop is both
simpler and exact.

### 10.7 Looping at the end

**Rejected.** A logbook replay that silently restarts makes the operator
distrust the clock they are reading. Stop, show `Restart`, and let them ask
(§6.3).

---

## 11. Must-not-change list

The Reviewer checks these one by one. Each is grep- or command-checkable.

1. **`client/src/components/FlightMap.tsx` is byte-identical.** `git diff --stat`
   shows no entry for it. The GPS Track map on the flight page, the trip map
   and the print maps all keep rendering exactly as today, including the
   planned-route overlay and its colour.
2. **The print pages are byte-identical**: `client/src/pages/PrintFlight.tsx`
   and `client/src/pages/PrintTrip.tsx` appear in no diff. They keep importing
   `strideSample`/`lttb`/`MAP_MAX_POINTS`/`CHART_MAX_POINTS` from
   `client/src/utils/downsample.ts`, which is also unmodified, and keep passing
   `preferCanvas={false}`, `zoomControl={false}` and `onReady` to `FlightMap`.
   The PDF export path is untouched end to end.
3. **KML export is untouched**: `src/kmlExport.ts`, its route and
   `tests/kmlExport.test.ts` appear in no diff. `git diff --stat -- src/ tests/ agent/`
   is empty for the whole run.
4. **The existing flight-detail DOM survives.** `#map` still contains exactly
   the GPS Track map, so the end-to-end assertion
   `main.locator('#map .leaflet-marker-icon')).toHaveCount(2)`
   (`client/e2e/specs/data-viz.spec.ts`) still passes: the replay map is a
   different container, and it is not mounted until the operator clicks
   (§7.8). The `Points`, `Distance`, `Departure`/`Arrival` stat cards, the
   Altitude Profile section and the bottom `.flight-actions` row keep their
   markup and order.
5. **`AltitudeChart` keeps working on the same data** — the widening only adds
   fields (§3.2); the chart reads `altitude_ft`, which is unchanged.
6. **No server behaviour changes.** No route, no schema, no `flights.db` write,
   no agent change. The live server on port 3000 is neither restarted nor
   rebuilt over.
7. **The existing client test suite passes unmodified** — the only edits to
   existing test files are *additions* in `FlightDetail.test.tsx` (§9.4);
   `AllFlights`, `TripDetail`, `Home`, `AcarsMessages`, `Prefiles`, `Login`
   specs are untouched.
8. **No run-artifact reference reaches the source tree**: no `§`, run id, task
   id, `design.md`, `plan.json`, phase or review file name in any comment under
   `client/src/`.

---

## 12. Risks, and what would falsify this design

1. **Payload growth.** The no-new-endpoint decision (§4.2) rests on 2242 points
   / 657 KB being the worst real case. A 20 000-point flight (~6 MB) would make
   the flight page's single fetch the bottleneck. Falsifier: a `point_count`
   above ~20 000 in `flights`. Response: a projection endpoint, additive.
2. **SVG renderer performance.** `preferCanvas={false}` (§7.3) is measured safe
   for jsdom and reasonable for ≤ 2.2 k points, but SVG paths degrade faster
   than canvas as point counts rise. Falsifier: visible jank scrubbing a long
   flight on the operator's machine. Response: draw the static track with
   `strideSample(points, MAP_MAX_POINTS)` while keeping the marker on the full
   unwrapped chain — a one-line change inside `ReplayPanel`, no contract
   movement (the sampled copy is for drawing only, exactly as the print pages
   already do it).
3. **The 2 s collapsed gap is a judgement call.** Nine consecutive collapsed
   gaps in a combined flight (§2.4d) read as a stutter rather than one pause.
   Falsifier: the operator calls it confusing. Response: `COLLAPSED_GAP_SEC` is
   a named constant and `buildTimeline` takes it as an option — a value change,
   not a redesign. Merging adjacent gap segments is the follow-up if it matters.
4. **Timestamps are the agent's clock, not the sim's.** Points recorded while
   the sim is paused are simply absent, which is why gaps exist at all. If the
   agent's clock steps (NTP correction, machine sleep), a segment can be
   spuriously long and collapse. The behaviour is then *wrong but safe*: a
   hold, not a crash. Nothing in this design can distinguish the two cases;
   only a sim-time column could, and that is a schema change.
5. **`requestAnimationFrame` in a background tab.** Browsers throttle rAF to
   ~1 Hz or stop it entirely when the tab is hidden. The `0.25 s` per-frame
   clamp (§6.2) means a replay left in a background tab falls behind rather
   than leaping; this is deliberate and should not be "fixed" with a
   `Date.now()` delta, which would reintroduce the leap.
6. **Fake-timer rAF is a Vitest/jsdom detail.** §2.4g was measured on the
   installed versions. If a future upgrade stops faking rAF, the tests switch
   to the injected `FrameScheduler` (§6.1) with no production change — which is
   exactly why the seam exists.
7. **Environment drift.** `.claude/ENVIRONMENT.md` still says Node 20 while the
   repo pins 24 (§2.3). An implementer following it literally will hit an ABI
   error the moment they touch `better-sqlite3`. This run does not need the
   database, but the doc should be corrected outside this run.
