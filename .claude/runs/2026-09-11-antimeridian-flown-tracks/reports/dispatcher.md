# Dispatcher report — 2026-09-11-antimeridian-flown-tracks

## Change

Widened the existing, frozen `unwrapLonChain` (client/src/utils/geo.ts, untouched)
to flown-track chains in the three components that draw them. Planned-route code
paths, colors, markers and tooltips are untouched.

### client/src/components/TripMap.tsx
- `BoundsController`: `flownPoints` now `unwrapLonChain`'d per flight before
  flattening (mirrors `plannedPoints`, which already did this).
- Main render: `latlngs` for each flown leg now `unwrapLonChain(pts.map(...))`
  instead of raw `pts.map(...)`. Departure/arrival `Marker`s use
  `latlngs[0]`/`latlngs[latlngs.length - 1]` unchanged (now unwrapped values).

### client/src/components/FlightMap.tsx
- `latlngs` (flown chain) now `unwrapLonChain(points.map(...))` instead of raw
  map. This single computed value flows into the `Polyline`, the two `Marker`s,
  and `BoundsController`'s `latlngs` prop, so all three agree — no separate
  unwrap needed in `BoundsController` per the task instructions.

### client/src/components/JourneyMap.tsx
- Added `import { unwrapLonChain } from '../utils/geo';` (was missing).
- `FitAll`: each leg's track unwrapped independently before flattening
  (`legs.flatMap(l => unwrapLonChain(l.track as [number, number][]))`) — legs
  are not unwrapped across each other, only within each leg's own chain, per
  the instruction that consecutive legs aren't guaranteed spatially contiguous.
- Main render: each leg's `track` computed via `unwrapLonChain(leg.track as
  [number, number][])` and passed to `positions={track}` on its `Polyline`.

Full diff: `git diff -- client/src/components/TripMap.tsx
client/src/components/FlightMap.tsx client/src/components/JourneyMap.tsx`
(three files, six hunks, all reviewed above).

## Verification

1. **`npx tsc --noEmit` (Node 20)** — clean, no output, exit 0.
   ```
   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
   cd client && npx tsc --noEmit
   ```
2. **`npm run build` (Node 20)** — clean, `tsc && vite build` succeeded:
   ```
   ✓ 107 modules transformed.
   dist/assets/index-BoNTqpPj.js   402.51 kB │ gzip: 121.10 kB
   ✓ built in 2.01s
   ```
3. **Unwrap behavior evidence** — reimplemented `unwrapLonChain` verbatim (same
   logic as `client/src/utils/geo.ts`, not modified) in a throwaway Node script
   and ran it against the design's own test chain plus a non-crossing chain:
   ```
   crossing input : [[10,179],[10,-179],[10,-178]]
   crossing output: [[10,179],[10,181],[10,182]]
   non-crossing input : [[45,-73.5],[45.2,-73.1],[45.5,-72.8]]
   non-crossing output: [[45,-73.5],[45.2,-73.1],[45.5,-72.8]]
   non-crossing identical: true
   ```
   Matches the expected antimeridian shift (179 → 181 → 182, a continuous
   eastward chain instead of jumping to -179/-178) and confirms the no-op
   guarantee for chains that never cross the dateline — the majority case, so
   no visual regression is expected there. Script:
   `/tmp/claude-1000/-home-guilherme-msfslogger/33ca5d04-7a40-4f0d-a266-2a39729e7e74/scratchpad/unwrap_check.js`
   (throwaway, not part of the repo).
4. No server started, `flights.db` untouched — pure client-side change, per
   instructions.

## Out of scope, confirmed untouched
- `client/src/components/LiveMap.tsx` — not read or edited.
- `client/src/utils/geo.ts` — not edited (only imported into JourneyMap.tsx).
- Planned-route rendering (colors, markers, tooltips, `PLANNED_ROUTE_COLOR`,
  `unwrapLonChain` calls on planned chains) — unchanged in all three files.

## Risks / assumptions
- No visual/browser check was performed (no client unit tests in this project,
  and starting the app is out of scope per the run's own verification section).
  Confidence rests on: (a) the unwrap function is proven correct and frozen —
  it was not modified, only its call sites widened; (b) the pattern applied to
  flown chains is byte-for-byte the same pattern already used and presumably
  already verified for planned chains in the same files; (c) the reimplemented-
  logic check in step 3 above, run against the same test vector the run's own
  instructions specify.
- `JourneyLeg.track` in `client/src/types.ts` is already typed
  `[number, number][]`, so the `as [number, number][]` casts added in
  JourneyMap.tsx are no-ops for the type checker, not narrowing anything new —
  kept only to match the task's specified snippet, not because they're load-
  bearing.
