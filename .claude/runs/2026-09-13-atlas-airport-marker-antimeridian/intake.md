# Intake — Atlas airport dots displaced across the antimeridian

Tier: **one implementer + one Reviewer** (single seam: `client/src/components/JourneyMap.tsx`,
no new contract — reuses the existing exported `unwrapLonChains` from
`client/src/utils/geo.ts` unchanged).

## Goal

User's Atlas overview map shows two isolated dots near Kamchatka/Russia,
disconnected from the rest of the route even though the route visually
continues near Alaska (their airport there, UHPP Yelizhovo, ~158.7°E, is close
to Alaska across the antimeridian/180° line — this is the same trip whose
countries/progress bugs were just fixed in
`.claude/runs/2026-09-13-atlas-countries-progress-fix/`).

## Root cause (confirmed by investigation, not to be re-derived)

Commit `290a172` ("Thread antimeridian unwrap continuity across legs, not just
within one") added `unwrapLonChains` (`client/src/utils/geo.ts:59-80`) and
wired it into both `JourneyMap.tsx` and `TripMap.tsx` so that **polylines**
crossing the antimeridian draw continuously — each leg's track points get
shifted by a running multiple of 360° so consecutive points never jump more
than 180°, producing values that can legitimately sit outside ±180° (e.g.
-195°) purely so the line renders in one continuous strip.

That commit's own review explicitly scoped out point markers as "pre-existing,
untouched by this diff, out of scope": `JourneyMap.tsx:90-102`'s airport
`CircleMarker`s still use raw, unshifted `a.lat`/`a.lon` straight from
`JourneyAirport` (sourced from `flights.departure_lat/lon` /
`arrival_lat/lon` in `src/journey.ts:217-228`, never touched by the unwrap
logic). So the polyline for a leg crossing the antimeridian is drawn in
unwrapped space near Alaska, but the airport dot for that same leg's Kamchatka
endpoint is plotted at its raw ~+158.7°E — nowhere near where the unwrapped
line actually lands on screen.

**`TripMap.tsx` already gets this right** and is the pattern to follow:
its waypoint/departure/arrival `Marker`s are positioned from the unwrapped
chain arrays, never from raw lat/lon —
`TripMap.tsx:154` (`position={chain[i]}`), `TripMap.tsx:171`
(`position={latlngs[0]}`), `TripMap.tsx:174`
(`position={latlngs[latlngs.length - 1]}`). `JourneyMap.tsx` is the one place
that regressed to raw coordinates, because its airport markers are a
deduped-by-ICAO aggregate (`JourneyAirport[]`, one dot per airport regardless
of visit count) rather than one marker per leg endpoint like `TripMap.tsx`.

## Frozen decision for this run

In `client/src/components/JourneyMap.tsx`, derive each airport's marker
position from the already-computed unwrapped `trackChains` (built by the
existing `legTrackChains()` at `JourneyMap.tsx:28-30`) instead of from the
airport's raw `lat`/`lon`:

- Build a `Map<string, [number, number]>` from ICAO to unwrapped position by
  walking `ordered` legs (already sorted by `seq`) together with their
  corresponding `trackChains[legIdx]` entry, in order:
  - if `leg.departureIcao` isn't in the map yet, set it to `chain[0]`
    (the chain's first point);
  - if `leg.arrivalIcao` isn't in the map yet, set it to
    `chain[chain.length - 1]` (the chain's last point).
  Use **first occurrence in flight-chronological order**, matching how the
  server already picks the airport's stored name/lat/lon on first visit and
  only increments `visits` afterward (`src/journey.ts:217-224`'s `note()`
  helper) — so client and server agree on "first occurrence wins" as the
  tie-break for a repeatedly-visited airport.
  Skip a leg whose corresponding chain is empty (defensive; a leg with no
  track points, e.g. a manually-created flight with no recorded GPS data).
- When rendering each `CircleMarker` (`JourneyMap.tsx:90-102`), use this
  computed position as `center`, falling back to the airport's raw
  `[a.lat, a.lon]` only if the ICAO never appears as a departure/arrival on
  any leg with a non-empty track (shouldn't normally happen, since the
  airports list is derived from the same flights as the legs — a defensive
  fallback only, not the expected path).
- Do not change `unwrapLonChains`, `unwrapLonChain`, `legTrackChains`, or
  anything in `client/src/utils/geo.ts` — this is purely about which
  coordinate source `JourneyMap.tsx` reads from for its airport markers.
- Do not touch `TripMap.tsx`, `FlightMap.tsx`, or the server (`src/journey.ts`)
  — `JourneyAirport.lat`/`.lon` stay as real, unshifted geographic coordinates
  in the API response; the unwrap only happens client-side for rendering,
  exactly as it already does for polylines.

## Success criteria

1. A trip with a leg crossing the antimeridian (e.g. Alaska ↔ Kamchatka/UHPP)
   shows the Kamchatka airport dot positioned at the end of that leg's drawn
   polyline in `JourneyMap`, not detached on the opposite side of the map.
2. Airports not involved in any antimeridian crossing render at their normal,
   unchanged position (no visible regression for the common case — verify
   against a trip/fixture with no antimeridian crossings at all, position
   should be numerically identical to before since `unwrapLonChains` leaves
   non-crossing chains unshifted).
3. An airport visited multiple times still renders as a single dot (existing
   `visits` dedup/count behavior unchanged) at the position from its first
   chronological visit.
4. `npm test` (existing Vitest suite) stays green — this run's fix is
   client-only, so it may not have existing client-side test infrastructure;
   check `client/` for an existing test setup before deciding whether to add
   one (do not build new test infrastructure from scratch for this fix if
   none exists — verify by reasoning/inspection plus a manual dev-server check
   instead, and say so explicitly in the report).
5. `npm run build` (or the client's own build/typecheck script, check
   `client/package.json`) stays clean.
6. Manually verify in a running dev client (scratch port, not the user's
   live server) with a trip that has an antimeridian-crossing leg, or a
   `ts-node`/browser-console reasoning check if a live visual check isn't
   feasible — screenshot or describe what was seen.

## Allowed paths

`client/src/components/JourneyMap.tsx` only. (Read access to
`client/src/utils/geo.ts` and `client/src/types.ts` for reference, but no
edits there.)

## Non-negotiables

- Never touch the user's running server or live `flights.db` — this is a
  client-rendering fix; verify with a scratch dev server/build, not the live
  app on port 3000.
- No schema/API/contract change — `JourneyAirport`'s shape and the server
  response are untouched; this is purely how the client chooses what to draw.
