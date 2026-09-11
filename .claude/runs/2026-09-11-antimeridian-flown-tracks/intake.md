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

## Amendment 2026-09-11 — first fix was incomplete

User reported "still not working for planned legs" after the first fix shipped
(commit b37d000). Investigation (read-only query against the live `flights.db`,
trip 1 "Circumnavegação", 24 planned legs) found a second, more fundamental bug
that the first fix and its review both missed:

`unwrapLonChain` correctly prevents a >180° jump *within* one chain, but every
caller ran it once per leg (or per flight), each anchored to its own first
point. Two chains that are meant to connect (leg N's last waypoint == leg N+1's
first waypoint) can land exactly 360° apart if there's an odd number of
antimeridian crossings between them anywhere earlier in the route — confirmed
with real data: leg 19 (PADK→PASY) unwraps to end at lon -185.89°, leg 20
(the next planned leg, also PADK→PASY — a duplicate-leg data quirk) starts
its own independent unwrap at lon -176.64° raw; by leg 21 (PASY→UHPP) the
accumulated drift lands it 360° from where leg 19 ended, a clean gap at the
shared airport (PASY). Corrected from an earlier draft of this note, which
attributed the 360° gap directly to the 19→21 boundary — verified by an
independent Reviewer re-running the same query against the live `flights.db`.

Fix: added `unwrapLonChains` to `client/src/utils/geo.ts` — threads one
running reference longitude across an ordered sequence of chains (rather than
resetting per chain) while still returning one array per input chain, so each
leg/flight still renders as its own `Polyline`. Applied in `TripMap.tsx`
(planned legs sorted by `seq`, and flights, each as their own threaded group)
and `JourneyMap.tsx` (legs sorted by `seq`). `FlightMap.tsx` was not touched —
it only ever draws one flight + one planned leg, so there's no cross-chain
boundary to thread.

Verified against trip 1's real 24 legs (read-only `better-sqlite3` query, not
just synthetic data): after threading, every leg-to-leg boundary gap is ~0°
except one (leg 19→20, a pre-existing duplicate-leg data quirk unrelated to
this bug — leg 20 restarts from PADK rather than continuing from leg 19's
PASY endpoint).

This time implemented directly by the Orchestrator (not dispatched) given the
diagnosis was already concrete; still routed through an independent Reviewer
before merge per the non-negotiable that the Orchestrator does not review its
own work.
