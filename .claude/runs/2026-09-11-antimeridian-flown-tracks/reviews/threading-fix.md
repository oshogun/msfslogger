# Review: antimeridian chain-threading fix (amendment, 2nd pass)

## Verdict: approve

All 6 "what to check" items verified independently by reading the diff and
re-deriving/re-running the checks myself (not by reading the implementer's
report — none was read; there was no separate Dispatcher report for this
amendment since the Orchestrator implemented it directly per the envelope).

## 1. `unwrapLonChain` unchanged

`git diff -- client/src/utils/geo.ts` shows only added lines (`+`), zero
removed/changed lines inside the original function body. The diff hunk starts
after the function's closing brace. Confirmed byte-for-byte unchanged.

## 2. `TripMap.tsx` / `JourneyMap.tsx` diffs read in full

- **Sort order**: `sortedPlannedLegs`/`sortedLegs` sort by `a.seq - b.seq`
  before threading. Flights have no `seq` (checked `types.ts` `Flight`
  interface — no `seq` field), and are threaded in prop-array order; traced
  that order back to `src/db.ts:474/498`: `SELECT * FROM flights WHERE
  trip_id = ? ORDER BY start_time ASC` — already chronological, so threading
  order matches route order for flights too. `JourneyLeg.seq` traced to
  `src/journey.ts:162-168`: assigned `i+1` after `[...flights].sort(by
  start_time)` — also chronological. Thread order is correct in both files.
- **Same threaded chain used for markers**: `TripMap.tsx` waypoint markers use
  `chain[i]` where `chain = plannedChains[legIdx]` (line ~154); flight
  departure/arrival markers use `latlngs[0]`/`latlngs[latlngs.length-1]` where
  `latlngs = flightChainsArr[i]` (lines 171-174). No stale raw-coordinate
  array left in either file. `JourneyMap.tsx` has no leg-endpoint markers
  (only airport `CircleMarker`s, which use `a.lat`/`a.lon` directly — pre-
  existing, untouched by this diff, out of scope).
- **Bounds use the same threaded chains**: `BoundsController` in `TripMap.tsx`
  now calls `flightChains(flights).flat()` / `plannedLegChains(plannedLegs).flat()`
  — same helpers as the render. `FitAll` in `JourneyMap.tsx` calls
  `legTrackChains(legs).flat()` — same helper as the render.

## 3. `unwrapLonChains` logic — independently verified

Compiled `client/src/utils/geo.ts` with `tsc` to plain JS (no reimplementation)
and ran it under Node 20 with my own test chains:

- Two chains sharing an endpoint after an internal antimeridian crossing
  thread to an exact shared boundary lon (181 == 181), vs. no threading.
- A length-1 chain sandwiched between two normal chains both inherits
  `prevLon` correctly and propagates it forward: `[[0,170],[0,179]]`,
  `[[0,-179]]`, `[[0,-178],[0,-170]]` → `[[181]]` then `[182,190]` — correct
  on both sides.
- Back-to-back empty chains: `unwrapLonChains([[a],[],[],[b]])` returns 4
  entries, the two empty ones stay empty, `prevLon` carries across them
  unaffected — chain count and per-index correspondence preserved.
- A chain alone at the head of the list (prevLon starts null) produces
  byte-identical output to calling `unwrapLonChain` on it directly — confirms
  no regression for the single-chain case (`FlightMap.tsx`'s use case).

**Live-data recomputation** (read-only, `better-sqlite3`, Node 20, trip_id=1,
24 planned legs, `flights.db` md5 `a738aecd5803ac0e20bd3a0d198558ab` before
and after — unchanged): computed per-leg-boundary gaps myself, independent of
the intake's numbers:

```
leg 19 -> 20  gapBefore=  9.24  gapAfter=  9.24   (unrelated data quirk, unchanged by threading — leg 20 duplicates leg 19's PADK->PASY with slightly different waypoints)
leg 20 -> 21  gapBefore=360.00  gapAfter=  0.00   (the antimeridian bug — fixed)
```

All other 21 boundaries had negligible (<1°) gaps before and after. This
confirms the fix, and refines the intake's account slightly: the 360° jump is
between legs 20→21, not 19→21 as narrated (leg 20 sits between them and was
apparently netted out in the intake's phrasing) — a wording nit, not a defect.

## 4. Index alignment across filtered legs/flights

Reimplemented the scenario directly: `unwrapLonChains([[chain0], [], [chain2]])`
— the empty middle entry is preserved as its own array-index, so
`plannedChains[legIdx]` / `flightChainsArr[i]` (built from the same unfiltered,
identically-sorted array as the `.map()` that does the early `return null`)
stay aligned. `Array.prototype.sort` is stable and deterministic on the same
input/comparator, so `sortedPlannedLegs(plannedLegs)` called separately in
`plannedLegChains()` and in the render produces the same order both times —
no desync.

## 5. Build / typecheck / tests

- `cd client && npx tsc --noEmit` → exit 0, no output.
- `cd client && npm run build` → `✓ 107 modules transformed`, built in 2.16s,
  clean.
- `npm test` (root, Node 20) → `Test Files 14 passed (14)`, `Tests 266 passed
  (266)` — matches the expected count, unaffected by this client-only change.

## 6. Scope / live-server safety

- `git status --porcelain -- client/ src/` (excluding the intake doc under
  `.claude/runs/`) shows exactly the 3 claimed files:
  `client/src/components/JourneyMap.tsx`, `client/src/components/TripMap.tsx`,
  `client/src/utils/geo.ts`. `FlightMap.tsx` diff is empty — confirmed still
  imports and uses only `unwrapLonChain` (single-chain, both `latlngs` and
  `plannedChain`).
- No server started by me. `flights.db` md5 identical before/after
  (`a738aecd5803ac0e20bd3a0d198558ab`) — read-only queries only.
- Note (non-blocking, environmental): `npm run build` under `client/` writes
  to `client/dist`, which `src/server.ts:154` (`express.static(...'client',
  'dist')`) serves directly to the live server with no restart needed —
  unlike the root server build, a client build takes effect immediately.
  ENVIRONMENT.md's "does not disturb the live process" framing was written
  with the server `dist/` in mind; worth a note for future reviewers that a
  client build is a slightly sharper edge than a server build, though in this
  case the tree was left in a fully shippable state (this fix, uncommitted),
  so no harm done here.

## Findings

None blocking. No non-blocking follow-ups beyond the environmental note above
and the intake wording nit (both informational, item 3 and item 6).

## Summary

6/6 "what to check" items verified independently, all pass. The threading fix
is correct: `unwrapLonChain` is untouched, `unwrapLonChains` correctly threads
a running reference across chain boundaries (including length-1 and empty
chains), both call sites sort by chronological/route order before threading
and read markers/bounds from the same threaded arrays, index alignment across
filtered (empty) legs/flights holds, and the live-data recomputation
reproduces the reported 360° gap and confirms it collapses to ~0° after the
fix. `tsc`, client build, and the 266-test server suite are all clean.
