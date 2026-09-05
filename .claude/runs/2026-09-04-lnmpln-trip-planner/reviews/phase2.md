# T-009 — Review of phase 2 (T-008: planned route on the trip map)

**Overall verdict: `approve`.** No blocking defect. One non-blocking finding
(marker hover occlusion at coincident endpoints), listed at the end.

Diff reviewed: `client/src/components/TripMap.tsx`, `client/src/pages/TripDetail.tsx`
(uncommitted working-tree changes on `feat/lnmpln-trip-planner-phase2`, base
`7d4e0c3`). `client/src/App.tsx`, `client/src/index.css` and `Override.tsx` are
the user's own unrelated work per the Orchestrator's note and are out of scope.

Everything below was independently reproduced: a scratch copy of the live
database (`npm run backup` → `backups/20260905-021106`, 34 flights / 1 trip /
empty `planned_legs`, re-verified unchanged at the end), a `git worktree` at
`7d4e0c3` for the pre-T-008 baseline, and a headless-Chromium harness
(puppeteer, already a project dependency) driving the real running app —
not the Dispatcher's own report.

## T-008 definition_of_done — verdicts

1. **Optional prop, PrintTrip unaffected — holds.** `PrintTrip.tsx` has zero
   references to `plannedLegs` (grep confirms); `TripMap.tsx:109`'s default
   `plannedLegs = []` makes every branch a no-op when omitted. Confirmed by
   rendering `/api/trips/1/export.pdf` from the `7d4e0c3` baseline and from a
   phase-2 build against byte-identical data: page 1 (trip overview + map) and
   page 5 (a leg detail + GPS track) are visually indistinguishable at 100%
   zoom, not just marker-count-equal. Also re-exported the PDF for a trip whose
   `planned_legs` array is populated (3 legs) — still 37 pages, still no planned
   overlay on any page, 8.6s, no hang. This is stronger evidence than T-008's
   own report, which only compared marker counts because MD5s differed on
   tile-load timing — a reasonable fallback, but the pixel comparison across a
   worktree baseline was available and is more direct.
2. **Dashed, off-palette, tooltip, drawn beneath — holds.** `#94a3b8` dashed
   (`TripMap.tsx:157`) is outside `LEG_COLORS` (`:8`); planned legs render
   before flights in JSX (`:144` vs `:172`), and Leaflet stacks canvas layers in
   add order, confirmed visually (dashed line never occluded by the flown
   track). Tooltip hover-tested live: `"Leg 1 (planned) — KSFO → KLAX ·
   approx. 293.5 nm"` plus the procedure line (see DoD 9).
3. **Waypoint markers, ident on hover — holds.** Hover-tested against the real
   VFR fixture: `Leg 1 · SUDDO`, `Leg 1 · OINGO`, `Leg 1 · ZORAN`, `Leg 1 ·
   HMPBK`, `Leg 1 · GIPVY`, matching the `Leg ${seq} · ${ident}` format frozen
   in design.md §18.
4. **Fitted map, no flights — holds.** Built a trip with one imported IFR leg
   (KSFO→KLAX) and zero flights: no "No GPS points recorded" text, map fits to
   California, dashed route and waypoint marker visible after zooming in
   (`TripMap.tsx:110-114`, `:117-122`).
5. **Pixel-comparable, no planned legs — holds.** Same PDF comparison as (1);
   also true by construction — `plannedLegs=[]` short-circuits every new branch.
6. **PDF export unaffected — holds.** See (1).
7. **Antimeridian — holds, and the comment's mechanism claims check out.**
   Built a synthetic PANC→RJTT leg (waypoints at lon 178, then −179) in a
   scratch DB and loaded it live: the dashed line draws as one continuous,
   correctly-oriented path across the Bering Sea/dateline — not a backwards
   wrap across the rest of the world, not a broken segment. Verified the two
   factual claims in the `unwrapLonChain` comment (`TripMap.tsx:30-48`) against
   installed Leaflet 's source rather than taking them on faith:
   `SphericalMercator.project` multiplies `lng` linearly with no ±180 clamp
   (`leaflet-src.js`, `project: function`), and `GridLayer`'s `noWrap` option
   defaults to `false` (`leaflet-src.js:11239`), so the default `TileLayer` here
   (no `noWrap` set) tiles modulo 360°. Both are exactly what the comment
   claims. Also unit-tested `unwrapLonChain` standalone for a non-crossing chain
   (unchanged) and a multi-crossing zigzag (stays continuous) — no discontinuity
   > 180° anywhere.
8. **`npm run build:client` clean — holds.** Ran it twice independently (once in
   a from-scratch checkout, once in a second clean copy): `tsc && vite build`,
   0 errors both times.
9. **Divergence left visible, procedures named — holds.** Loaded the real IFR
   fixture and hover-tested the polyline directly (not just read the code):
   tooltip text is exactly `"...SID WESLA5 · STAR IRNMN2 · APP KLAX24R (planned
   route excludes SID/STAR/approach legs)"` (`procedureNote`, `TripMap.tsx:64-73`,
   wired at `:149,161`). No snapping/interpolation code exists anywhere in the
   diff — the polyline is `leg.waypoints` sorted by `seq`, nothing else
   (`:144-148`). Visually confirmed on the near-coincident KSBA→KMRY
   VFR/flown-track pair (see below) that the dashed line is never bent toward
   the solid one.

## T-009's own four items

1. **Independently loaded trip pages with and without planned legs.** Built
   four scratch trips: the real KSBA→KMRY VFR leg alongside its actual flown
   flight (#46) in one trip, a flights-only trip, a planned-legs-only trip
   (IFR, no flights), and a synthetic dateline trip. All screenshotted from the
   live app.
2. **PDF optionality confirmed by rendering and comparing.** Done via the
   `7d4e0c3` worktree baseline described in DoD 1/5/6 above — actual pixel
   comparison, not inference.
3. **Distinguishability judged directly, including near-coincident case.**
   This is the reviewer's judgement call the task asks for, and it holds. On
   the flight-46/VFR-leg overlap trip, the flown track (solid, `#60a5fa`,
   weight 2.5) and the planned route (dashed `6 6`, `#94a3b8`, weight 2) run a
   few miles apart along most of the route and converge to the same airport at
   both ends; at every zoom level tested the dash pattern reads unambiguously
   even where the lines are only a few pixels apart, including right at the
   KMRY arrival where the dashed line arrives from an inland heading while the
   solid track curves in along the coast to the same point. The distinguishing
   signal is the dash, not the color — the two colors (light blue vs. slate)
   are close enough in hue that color alone would be marginal on some tile
   backgrounds, which is exactly why the DoD asked for more than "a different
   shade," and the dash pattern delivers that.
4. **Verdict below, with file:line findings.**

## Findings

- **F-1 (minor, non-blocking).** `TripMap.tsx:164-168` vs `:182-187`: when a
  planned leg's endpoint coincides exactly with a flown flight's departure or
  arrival airport (the common case — real routes start/end where the aircraft
  did), the flight's own endpoint marker is added later in JSX and sits on top
  at the identical pixel position, making the planned waypoint marker
  underneath (and its `Leg N · <ICAO>` tooltip) unreachable by hover.
  Reproduced directly: hovering the shared KSBA point on the overlap trip
  yields only `"Leg 1 departure"`, never `"Leg 1 · KSBA"`. Not a DoD violation
  — DoD 3 is satisfied by every en-route waypoint, and the endpoint idents are
  already shown in the polyline's own tooltip label and the legs table — but
  worth a follow-up (z-index the planned endpoint markers above flight
  markers, or skip rendering a planned marker at a coordinate the flight
  already marks).
- **Note, not a finding.** `mkWaypointIcon()` (`TripMap.tsx:23-28`) allocates a
  new `L.divIcon` per marker per render instead of a module-level constant like
  `mkIcon` almost is; harmless at the waypoint counts this feature produces,
  not worth a diff on its own.

## Environment notes

Live `flights.db` re-verified untouched at the end: 34 flights, 1 trip, empty
`planned_legs` — same as the `npm run backup` snapshot taken at the start.
All scratch servers (ports 3901-3903), the `git worktree`, and background
processes were torn down before finishing.
