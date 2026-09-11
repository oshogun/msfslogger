# Review — 2026-09-11-antimeridian-flown-tracks (Dispatcher)

## Verdict: approve

All acceptance criteria verified independently by re-reading the diff and
re-running commands (not by trusting the dispatcher's report, which was read
only for its `risks` section and as a map of what to check).

## Criteria verified

1. **`geo.ts` byte-for-byte unchanged** — `git diff -- client/src/utils/geo.ts`
   → empty. `git status --porcelain -- client/src/utils/geo.ts` → empty. Confirmed.

2. **`LiveMap.tsx` untouched** — not in `git status --porcelain` output (only
   `FlightMap.tsx`, `JourneyMap.tsx`, `TripMap.tsx` modified). Confirmed.

3. **Flown-track chains unwrapped before `Polyline`/`fitBounds`, markers use
   the same unwrapped array** — read full diff (`git diff -- <3 files>`)
   directly, not the report:
   - `TripMap.tsx`: `BoundsController`'s `flownPoints` now
     `flights.flatMap(f => unwrapLonChain((f.points||[]).map(...)))` (per-flight
     unwrap, mirrors `plannedPoints`'s per-leg unwrap already there). Main
     render's `latlngs` now `unwrapLonChain(pts.map(...))`; `Marker`s read
     `latlngs[0]` / `latlngs[latlngs.length-1]` — same array, not stale raw
     `pts`. Planned-route code paths (`chain`, `plannedPoints`) untouched.
   - `FlightMap.tsx`: `latlngs` now `unwrapLonChain(points.map(...))`; both
     `Marker`s and `BoundsController` (`latlngs` prop) consume this single
     value — verified by reading lines 90, 145, 148, 153. Planned chain
     (`plannedChain`) untouched, already unwrapped before this change.
   - `JourneyMap.tsx`: import added; per-leg `track = unwrapLonChain(leg.track
     as [number,number][])` feeds `positions={track}`. `JourneyLeg.track` is
     already typed `[number, number][]` in `client/src/types.ts:331`, so the
     cast is a genuine no-op (checked directly, not just trusted).

4. **`FitAll` unwraps per-leg, not across the flattened chain** — read the
   actual line: `legs.flatMap(l => unwrapLonChain(l.track as [number,number][]))`.
   `unwrapLonChain` is called *inside* the `flatMap` callback, once per leg,
   before flattening — each leg's own chain is unwrapped independently and
   only concatenated afterward. This is correct; a `unwrapLonChain(legs.flatMap(l
   => l.track))` (unwrap after flatten) would have been the wrong,
   cross-leg-continuity bug the criterion warns against, and that is not what's
   here.

5. **`tsc`/`build` clean, Node 20** — ran myself:
   ```
   cd client && npx tsc --noEmit   → exit 0, no output
   npm run build                    → tsc && vite build, "✓ built in 1.96s"
   ```

6. **`unwrapLonChain` behavior, independently re-derived** — reimplemented the
   function from the `geo.ts` source I read myself and ran my own test
   vectors (not the dispatcher's numbers):
   ```
   eastbound crossing  [[35,170],[36,178],[37,-179],[38,-170]]
     → [[35,170],[36,178],[37,181],[38,190]]        (monotonic eastward, correct)
   westbound crossing  [[35,-170],[36,-178],[37,179],[38,170]]
     → [[35,-170],[36,-178],[37,-181],[38,-190]]    (monotonic westward, correct)
   non-crossing US chain [[40,-100],[41,-95],[42,-90]]
     → unchanged (no-op, correct)
   single point / empty chain → returned unchanged, no crash
   ```

7. **No server started, `flights.db` untouched** — this review touched no
   server process and ran no write against the live db. `flights.db` md5
   `2ece9276981356de25db8f8a442ab746` (read-only check, `flights.db` is
   gitignored and untracked so a git-level confirmation isn't available, but
   nothing in this change or review path writes to it — pure client diff,
   `npm test`/`tsc`/`vite build` don't touch it).

## Additional check beyond the checklist

Ran `npm test` (Vitest) as a belt-and-suspenders regression check even though
this is a client-only change: `266 passed (14 files)`. Unaffected as expected,
confirms no accidental server-side edit slipped in.

## Findings

None. No blocking or non-blocking findings.

## Scope

All three changed files (`TripMap.tsx`, `FlightMap.tsx`, `JourneyMap.tsx`) are
exactly the files named in the intake's scope section. No other files touched.

## Notes on report accuracy (for calibration, not a finding)

The dispatcher's report claimed "six hunks" across the three files and typed
casts as "no-ops, kept only to match the task's snippet" — both checked
independently against the raw diff and `types.ts` and found accurate.
