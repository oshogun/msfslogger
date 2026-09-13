# Implement report — atlas-airport-marker-antimeridian

## Change

`client/src/components/JourneyMap.tsx` only.

- Added `export function airportPositions(ordered, trackChains): Map<string, [number, number]>`.
  Walks `ordered` legs by index, skips a leg whose `trackChains[i]` is empty,
  and for each non-null `departureIcao`/`arrivalIcao` sets `chain[0]` /
  `chain[chain.length - 1]` in the map only if the ICAO isn't already a key
  (first occurrence wins, matching `src/journey.ts`'s `note()` tie-break).
- Computed `const unwrappedAirportPositions = airportPositions(ordered, trackChains)`
  in `JourneyMap` alongside the existing `ordered`/`trackChains`.
- `CircleMarker`'s `center` now reads
  `unwrappedAirportPositions.get(a.icao) ?? [a.lat, a.lon]` instead of the raw
  `[a.lat, a.lon]`.

No edits to `utils/geo.ts`, `TripMap.tsx`, `FlightMap.tsx`, or any server file.
`git status --short client/` shows only `JourneyMap.tsx` modified.

## Verification

1. **Test infrastructure check.** `client/package.json` has only `dev` /
   `build` (`tsc && vite build`) / `preview` scripts, no test runner, and
   `find src -iname "*.test.*"` under `client/src` returned nothing. Per the
   task's fallback instruction, no test harness was built from scratch.
   Instead: careful inline reasoning (above) plus a standalone verification
   script that bundles the **real** `JourneyMap.tsx` with `esbuild` (already
   present transitively via `vite`, no new dependency installed) and calls
   the actual exported `airportPositions` against realistic fixtures. DOM
   packages (`react`, `react-dom`, `react-leaflet`, `leaflet`) were stubbed
   at the esbuild-plugin level only to permit importing the module under
   plain Node (they touch `window` at import time) — `airportPositions`
   itself never touches them.

2. **Manual/scripted antimeridian check.** Script (scratch, deleted after
   run): fixture leg `PANC (-149.99) → UHPP (raw 158.7, Kamchatka)` with an
   intermediate track point past the dateline. Run:
   `node <verify-script>.mjs` (Node 20.20.2 via nvm) →
   ```
   chains: [[[61.17,-149.99],[60,-170],[58,-182],[53.17,-201.3]]]
   positions: [["PANC",[61.17,-149.99]],["UHPP",[53.17,-201.3]]]
   PASS depOk: true arrOk: true arrUnwrapped(differs from raw 158.7): true
   ```
   UHPP's marker lands at `-201.3` (the unwrapped chain endpoint,
   `158.7 - 360`), not the raw `158.7` — matching the polyline's own
   endpoint exactly, confirming the fix. A full browser visual check
   wasn't run: doing so would require either a live-data dev server
   (disallowed — proxies to the real `localhost:3000`/`flights.db`) or
   editing files outside `allowed_paths` to inject fixture data, which the
   envelope restricts to `JourneyMap.tsx` only.

3. **Build/typecheck.**
   `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20; cd client && npm run build`
   →
   ```
   > tsc && vite build
   ✓ 107 modules transformed.
   ✓ built in 2.14s
   ```
   Clean, no errors.

4. **Non-crossing regression guard.** Same script, fixture `KJFK → KBOS`
   (no dateline crossing):
   ```
   KJFK marker vs raw departure: [40.6413,-73.7781] [40.6413,-73.7781] equal: true
   KBOS marker vs raw arrival: [42.3656,-71.0096] [42.3656,-71.0096] equal: true
   ```
   Confirms `unwrapLonChains` is a no-op here and the marker position is
   numerically identical to the pre-fix raw-coordinate behavior.

5. **Live server / `flights.db`.** Not touched. No dev server was started
   against real data; only `npm run build` (writes to `client/dist`, not the
   server's `dist/`) and the standalone Node script were run.

Additional fixtures exercised in the same script (not required by the
acceptance criteria but cheap to check given the function was already
imported): repeated-ICAO first-occurrence-wins, and a leg with an empty
`track` array being defensively skipped rather than throwing — both behaved
as designed.

## Risks / unverified

- No true browser/Leaflet visual render was performed (see criterion 2) —
  confidence rests on the fixture script calling the real, unmodified
  `airportPositions` plus the unchanged `unwrapLonChains`, which is the same
  computation the component performs at render time on the same inputs.
- No real UHPP-crossing trip exists in the live/fixture data that I inspected
  (none was searched for, since it would have required touching the live
  DB); the fixture is a constructed, realistic approximation of the scenario
  named in the goal.
- `airportPositions` was exported (previously an internal helper) to make
  the standalone script's import possible, mirroring `legColor`, which was
  already exported from this file for the same reason.
