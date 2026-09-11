# Intake — antimeridian wrap on flown-track polylines

## Goal

User-reported bug (screenshot, Combined Route map on a trip spanning the
Pacific): some legs render as a straight line jumping to the opposite side of
the screen instead of following a continuous track. Root cause identified by
inspection: `client/src/utils/geo.ts`'s `unwrapLonChain` already fixes exactly
this for *planned* routes (design.md T-008, DoD 7) but its own doc comment
(lines 24-27) states the limitation verbatim:

> This is applied only to the planned-route layer. Flown tracks are unchanged
> — they never unwrap — which is a pre-existing limitation this feature does
> not extend to...

That documented gap is what the user is now hitting. Fix: apply the existing,
already-frozen `unwrapLonChain` utility to flown-track polylines (and their
bounds computation) wherever they're drawn.

## Success criteria

- A flown track whose points cross the antimeridian renders as one continuous
  line across the dateline, not a jump across the map — verified visually with
  a synthetic fixture (points straddling ±180°) in a scratch page/build, not
  just by reading the diff.
- `map.fitBounds` / bounds computation for flown tracks uses the unwrapped
  chain too, so the map doesn't zoom out to the whole world when a track
  crosses the dateline (same class of bug `unwrapLonChain` already prevents
  for planned routes).
- No change to planned-route rendering, markers, tooltips, colors, or any
  other visual behavior. No change when a track does *not* cross the
  antimeridian (pixel-identical to before, per `unwrapLonChain`'s
  no-op behavior on chains that never jump >180°).
- `npx tsc` / `npm run build` (client) clean.

## Scope (single seam: reuse `unwrapLonChain`, no new contract)

- `client/src/components/TripMap.tsx` — flown-leg `Polyline` (line ~146) and
  `BoundsController`'s `flownPoints` (line ~45).
- `client/src/components/FlightMap.tsx` — flown `latlngs` `Polyline` (line
  ~144) and its `BoundsController` (already imports `unwrapLonChain` for the
  planned chain at line 92 — same treatment needed for `latlngs`).
- `client/src/components/JourneyMap.tsx` — per-leg `Polyline` `positions={leg.track}`
  (line ~52) and `FitAll`'s bounds (line ~20-22).

## Explicitly out of scope

- `client/src/components/LiveMap.tsx` — single in-progress flight, map is
  always actively panned/centered on the live position (never `fitBounds` on
  the whole track), so this class of bug doesn't manifest the same way.
  Leaving it alone keeps the fix minimal; not part of the reported symptom.
- Any change to `unwrapLonChain` itself — it's correct and already used by
  planned routes; this run only widens where it's called.
- No Designer step: no schema, endpoint, or shared-type change. Reusing a
  frozen, already-documented utility.

## Frozen decisions from the user

None beyond the report itself (screenshot + "some display on the other side
of the screen rather than a continuous line").

## Tier

Tier 2 — one Dispatcher + one Reviewer. Three files, one mechanical technique,
no new contract.
