# Phase 4 review — automatic leg matching (T-018)

**Task:** T-018 · reviewer · phase 4
**Scope:** T-015 (`src/legMatcher.ts`, `src/inspect-legmatch.ts`), T-016 (`src/flightManager.ts`,
`getFlightPlannedLegId()` in `src/db.ts`), T-017 (`client/src/components/FlightMap.tsx`,
`client/src/pages/FlightDetail.tsx`, `client/src/components/TripMap.tsx`, `client/src/utils/geo.ts`)
**Base:** `8cec371` · branch `feat/lnmpln-trip-planner-phase4-matcher` · phases 3 and 4 both uncommitted
**Out of scope, confirmed undisturbed:** `client/src/App.tsx` (Override route only, mtime 09-01),
`client/src/pages/Override.tsx` (untouched, mtime 09-01), the `── The Override ──` block at the end
of `client/src/index.css`. Phase-3 files (`src/server.ts` 03:31, `src/types.ts` 04:24,
`TripDetail.tsx` 04:24, `PlannedLegRows.tsx` 03:52, `Home.tsx` 03:46, `index.css` 03:46) all carry
mtimes **before** `reviews/phase3.md` (04:40) — phase 4 modified none of them.

---

## Verdict

# `approve`

**I could not produce a false positive.** Nine deliberate attempts across two hand-built trips and
one real one — including takeoffs sitting *exactly* on one planned departure with a second eligible
leg 9.6 nm away — every one refused with `AMBIGUOUS` and left the flight unlinked. There is no
nearest-wins fallback anywhere in the path. That is the single thing this review existed to
establish, and it holds.

Six defect-injecting mutations of the matcher and of `geo.ts` were all caught by
`inspect-legmatch.ts` with a non-zero exit, so the harness is a real gate and not a rubber stamp.
The frame path's database and airport-scan call profile is byte-identical to `8cec371` under a
50-frame flight, measured. A flight recorded with no active trip is identical to the pre-change
baseline in all 21 non-timestamp columns, measured against a `git worktree`. Five forced throws
inside the auto-link and arrival paths each degraded to an unlinked flight with the row still
written and closed.

Four findings follow. None of them is a false-positive risk and none blocks the merge: F-1 is a
data-loss path that is **not reachable from the current UI**, F-2 is a coverage gap that will let a
future Amendment-C regression pass silently, F-3 is unimplemented UI for a column phase 4 has just
started writing, F-4 is dead code. F-1 and F-3 should be routed as follow-ups; F-2 is worth one
small addition to the harness before phase 5 builds on top of this.

---

## Verification method, and what I did *not* run

Everything below marked **[executed]** was run and its output read. Everything marked **[read]** was
established by reading the code only.

All execution was against **copies** of `flights.db` (plus `-wal` and `-shm`, copied together) in
`/tmp/.../scratchpad/sb-*`, on ports 3311–3395, under Node 20.20.2. The live database and the
user's server on port 3000 were never written to and never touched; the live baseline is re-checked
at the bottom of this review and is unchanged.

One side effect to declare honestly: T-017's DoD required `npm run build:client`, so I ran it in the
repo. That refreshed `client/dist`, which the live server on :3000 serves. No source file was
changed by this review; `git status --porcelain` is identical to its state at the start (21 entries).
A `git worktree` at `8cec371` was created for the baseline comparisons and has been removed.

Nothing in this review was left unrun. Every DoD item was reached by execution.

---

## Per-task verdicts

### T-015 — `src/legMatcher.ts`, `src/inspect-legmatch.ts` — **approve**

| DoD | Verdict | Evidence |
|---|---|---|
| Pure; no `./db`, `./airports`, `fs`, `http` | pass **[executed]** | `src/legMatcher.ts:26-27` imports exactly `./geo` and `type LegMatchCandidate` from `./types`. `grep -nE "from './(db\|airports)'\|from 'fs'\|from 'http'\|require\("` → no hits. `src/geo.ts` itself imports nothing. |
| Every refusal returns a documented code; no bare null | pass **[executed]** | Every `return` in `matchPlannedLeg` (`src/legMatcher.ts:149-234`) carries a `reason`; the shared constructor is `refusal()` at `src/legMatcher.ts:237`. Harness invariant "reason-code coverage 10/10" |
| Harness prints expected vs actual and exits non-zero on disagreement | pass **[executed]** | `npx ts-node src/inspect-legmatch.ts` → `23 scenarios, 0 failures`, `EXIT=0`. Six mutations each produced `exit=1` (table below). |
| Required scenario coverage | pass **[executed]** | Rows 1 (exact), 2 (8 nm), 3 (40 nm), 5 (AMBIGUOUS), 6/7 (flown/diverted), 9 (linked), 10 (skipped), 15 (snippet), 16 (no active trip), 22/23 (antimeridian). |
| Coordinates drawn from real fixtures | pass **[read]** | `src/inspect-legmatch.ts:52-58` — KSBA/KMRY_A/KMRY_B/KSTS/KACV/KSFO/KLAX, each annotated with the file it came from. 17 of 23 rows marked `REAL`. |
| AMBIGUOUS stays SYNTHETIC and says so | pass **[read]** | Header `src/inspect-legmatch.ts:18-33` states it in the provenance block; the row itself carries a `SYNTH` marker and a note. |
| Antimeridian asserted explicitly | pass **[executed]** | Rows 22–23. Mutating `geo.ts` to a degree-delta (`Math.hypot`) failed rows 20, 21 **and** 22. |
| Does not modify `src/flightManager.ts` | n/a for this file | T-016 owns that change. |
| `npx tsc --noEmit` passes | pass **[executed]** | exit 0. |
| IFR long-leg case (293 nm) | pass **[executed]** | Rows 19–20, measured 293 nm. |

**Mutation testing of the harness [executed].** The harness's value is entirely in whether it fails
when the matcher is wrong, so I broke the matcher six ways in a scratch copy of `src/`:

| Mutation | Caught | What failed |
|---|---|---|
| M1 `AMBIGUOUS` → nearest-wins (`if (false)`, `nearest(eligible)`) | yes, exit 1 | row 5 + `MISSING: AMBIGUOUS` |
| M2 `haversineNm` → degree-delta | yes, exit 1 | rows 20, 21, 22 |
| M3 drop the `tripId === activeTripId` filter | yes, exit 1 | row 17 + `MISSING: NO_PLANNED_LEGS` |
| M4 swap refusal precedence (linked before flown) | yes, exit 1 | row 11 |
| M5 `DEPARTURE_RADIUS_NM` 10 → 50 | yes, exit 1 | row 3 |
| M6 `nearest(near)` → `near[0]` in step 5 | yes, exit 1 | row 12 + three order-independence failures |

M1 is the important one: the harness fails loudly on exactly the change that would corrupt a trip's
record. The order-independence and `startTime`/`aircraft`-inertness invariants earn their place —
M6 was caught twice over, once by the scenario and once by the reversed-candidate check.

**On `nearbyLegIds` meaning two things [executed].** Code, contract and log line all agree, and I
confirmed each against real log output rather than by reading:

- `AMBIGUOUS` → eligible ids (`src/legMatcher.ts:215-222`, `idsAscending(eligible)`). Observed:
  `Flight #48 not linked — AMBIGUOUS (legs 5, 6 within 10 nm)`.
- other post-radius outcomes → all ids in radius (`src/legMatcher.ts:206`, `:232`). Observed:
  `LEG_ALREADY_FLOWN (leg 5 within 10 nm, nearest 0.0 nm)`.
- pre-radius outcomes → empty (`src/legMatcher.ts:238`). Observed: `NO_ACTIVE_TRIP` with no
  parenthetical, `NO_LEG_IN_RADIUS (nearest planned departure 159.8 nm away)`.

`contracts/planned-legs.d.ts:562-580` documents all three cases verbatim and matches. Do not collapse
them.

### T-016 — `src/flightManager.ts` + `getFlightPlannedLegId()` — **approve**

| DoD | Verdict | Evidence |
|---|---|---|
| `startFlight()` consults the matcher after `findNearestAirport()`, links, logs one line | pass **[executed]** | `src/flightManager.ts:165` (after `insertFlight` at `:163`). Observed: `[FlightManager] Flight #48 linked to planned leg #5 (KSBA→KMRY, 0.0 nm, MATCHED)` — the `§13.5` format exactly. |
| Refusal → flight created as today, one line, never silent | pass **[executed]** | 9 of 10 reason codes reached through `/api/ingest`, each with a log line. Table below. |
| `endFlight()` applies the deviation rule and logs it | pass **[executed]** | `src/flightManager.ts:225`, `:293-330`. Observed `landed 39.5 nm from planned KLAX — leg #8 marked diverted` (`arrival_deviation_nm = 39.5`) and `landed 0.0 nm from planned KMRY — leg #5 marked flown` (`= 0`). |
| No-active-trip row identical to pre-change | pass **[executed]** | worktree comparison below. |
| Verified without MSFS through `/api/ingest` | pass **[executed]** | every scenario in this review. |
| Matcher runs once per flight start, not per frame | pass **[executed]** | 63 frames over HTTP → **1** match log line. |
| Candidates loaded once; no new airport scan on the frame path | pass **[executed]** | call-profile measurement below. |
| Auto-linked flight can still be unlinked from the UI; unlink survives restart | pass **[executed]** | restart test + Puppeteer click, below. |

**DoD 3 — no-active-trip row, column for column [executed].** Two sandboxes over the same DB copy
with `is_active` cleared: one served by a `git worktree` at `8cec371`, one by the working tree. The
same takeoff (3 frames) → 8 en-route frames → 12 landing frames was replayed into each.

- `PRAGMA table_info(flights)` identical in both: 23 columns, same names, same order.
- Diff over all 23 columns: **`start_time` and `end_time` only** — the two wall-clock values, which
  differ because the runs happened 2.4 s apart. All 21 other columns byte-equal, including
  `planned_leg_id`, `planned_leg_link_source`, `planned_leg_prev_trip_id`, all `NULL`.
- Base log: `Departure airport: KIWA` / `Flight #49 started` / `Flight #49 ended — 1 points, 0.0 nm, 0s`.
  New log: the same three lines plus `Flight #49 not linked — NO_ACTIVE_TRIP`.

**DoD 6 — the frame path [executed].** Every export of `./db` and `./airports` was wrapped with a
counter *in process* (no repo file modified — the compiled `import` is a property access at call
time, so the wrapper intercepts), then `FlightManager.onFrame` was driven directly with a phase
marker. Run twice: once with the real clock, once with a fake clock advancing 6 s per frame so
`RECORD_INTERVAL_MS = 5000` fires on **every** cruise frame — the worst case.

| Phase | `8cec371` | working tree |
|---|---|---|
| TAKEOFF (3 frames) | `findNearestAirport:1, insertFlight:1, insertPoint:1` | `findNearestAirport:1, insertFlight:1, getActiveTripId:1, getPlannedLegCandidatesForActiveTrip:1, insertPoint:1` |
| CRUISE (50 frames, fake clock) | `insertPoint:50` | `insertPoint:50` |
| LANDING (12 frames) | `findNearestAirport:1, closeFlight:1` | `findNearestAirport:1, closeFlight:1, getFlightPlannedLegId:1` |

**The cruise phase is identical.** Zero new per-frame queries, zero new airport scans;
`findNearestAirport` stays at exactly 2 calls per flight in both, as `§20` item 10 requires.

On the matched path the same measurement shows TAKEOFF gaining `getPlannedLegById:1` and
`linkFlightToPlannedLeg:1`, and LANDING gaining `getPlannedLegById:1` and `recordPlannedLegArrival:1`.
**The §13.5 amendment matches the code and the second read is genuinely once-per-flight** — it appears
once in a 65-frame flight and never in the CRUISE column. The amendment is accurate as written.

**DoD 4 — forced throws [executed].** Five faults injected one at a time, each replacing a real db
export with a thrower:

| Injected fault | Flight row | Leg | Log |
|---|---|---|---|
| `getActiveTripId` | written, closed, `end_time` set, link `NULL` | untouched | `auto-link failed, flight recorded unlinked: Error: INJECTED FAULT…` |
| `getPlannedLegCandidatesForActiveTrip` | same | untouched | same |
| `getPlannedLegById` (label lookup) | same | untouched | same |
| `linkFlightToPlannedLeg` | same | untouched | same |
| `recordPlannedLegArrival` | written, closed, **link kept** (`planned_leg_id: 5`, `auto`) | stays `planned`, deviation `NULL` | `arrival not recorded on its planned leg: Error: INJECTED FAULT…` |

In no case was a flight lost, truncated or left open. `src/flightManager.ts:286` and `:329` catch and
`console.warn` with the error object, so the failure is diagnosable rather than swallowed. The
`try`/`catch` does what its comment claims — established by forcing it, not by reading it.

Note on the third row: because the label read is deliberately placed *before* the link write
(`src/flightManager.ts:270-271`), a throw from the cosmetic lookup costs the link entirely. That is
the right trade — `getPlannedLegById` throwing means the database is broken and the link write would
have failed too — but it is worth knowing that the "read before the write" comment buys log honesty
at the price of the link, not the other way round.

**DoD 5 — no silent refusal [executed].** Driven through `/api/ingest` against real fixtures:

| Reason code | Reached in production | Observed line |
|---|---|---|
| `MATCHED` | yes | `Flight #51 linked to planned leg #5 (KSBA→KMRY, 0.0 nm, MATCHED)` |
| `NO_ACTIVE_TRIP` | yes | `Flight #48 not linked — NO_ACTIVE_TRIP` |
| `NO_PLANNED_LEGS` | yes | `Flight #49 not linked — NO_PLANNED_LEGS` |
| `NO_LEG_IN_RADIUS` | yes | `Flight #50 not linked — NO_LEG_IN_RADIUS (nearest planned departure 159.8 nm away)` |
| `AMBIGUOUS` | yes | `Flight #48 not linked — AMBIGUOUS (legs 5, 6 within 10 nm)` |
| `LEG_ALREADY_FLOWN` | yes | `Flight #52 not linked — LEG_ALREADY_FLOWN (leg 5 within 10 nm, nearest 0.0 nm)` |
| `LEG_ALREADY_LINKED` | yes | `Flight #55 not linked — LEG_ALREADY_LINKED (leg 7 within 10 nm, nearest 0.0 nm)` |
| `LEG_SKIPPED` | yes | `Flight #56 not linked — LEG_SKIPPED (leg 7 within 10 nm, nearest 0.0 nm)` |
| `SNIPPET_NO_DEPARTURE_AIRPORT` | **yes** | `Flight #57 not linked — SNIPPET_NO_DEPARTURE_AIRPORT (leg 8 within 10 nm, nearest 0.0 nm)` |
| `FLIGHT_ALREADY_LINKED` | **no** — structurally unreachable | see F-4 |

Nine of ten reachable, every one logged, none silent.

### T-017 — `FlightMap.tsx`, `FlightDetail.tsx`, `TripMap.tsx`, `client/src/utils/geo.ts` — **approve**

| DoD | Verdict | Evidence |
|---|---|---|
| Planned route drawn as a dashed line beneath the flown track, same visual language as T-008 | pass **[executed]** | `PLANNED_ROUTE_COLOR = '#94a3b8'`, `weight: 2`, `dashArray: '6 6'`, rendered before the flown `Polyline` in JSX. Canvas pixel sample on the linked page: **620 px of `#94a3b8` and 1170 px of `#60a5fa`**; after unlink, **0 px** planned and 1218 px flown. |
| `FlightDetail` names the leg and its trip; unlink works with no manual reload | pass **[executed]** | Headless click on `Unlink` → section gone, planned pixels 0, markers 9 → 2, **URL unchanged**, no navigation. Rendered text: `PLANNED LEG \| PLANNED Leg 1 of UI VFR chain: KSBA → KMRY \| Planned cruise 7,500 ft · approx. 201.2 nm \| Linked by hand. \| Unlink`. |
| A flight with no link renders exactly as today, including the map | pass **[executed]** | **Pixel-identical.** Same sandbox database, same flight (#45), two servers — one serving the `8cec371` client build, one the working-tree build; OSM tiles aborted at the request interceptor so only our own vector rendering is compared. Full page: both 56 696 B, SHA-256 `b421265ed5e550eb…`, **identical: true**. `#map` element alone: both 13 122 B, `d8b0e174bf913bc0…`, **identical: true**. |
| New prop optional; `PrintFlight` unaffected; PDF export still renders | pass **[executed]** | `plannedLeg?:` optional; `FlightDetail.tsx:367` is the only caller passing it. `GET /api/flights/45/export.pdf` → 200, 239 051 B, `%PDF-`; `GET /api/trips/2/export.pdf` → 200, 30 174 B, `%PDF-`. |
| `npm run build:client` with no TypeScript errors | pass **[executed]** | `tsc && vite build`, 102 modules, exit 0. |
| Divergence left visible, never snapped (`§20` item 29) | pass **[executed + read]** | See below. |

**No snapping, warping or clipping [executed + read].** By reading: `plannedChain`
(`FlightMap.tsx:92`) derives only from `sortedWaypoints`; `latlngs` derives only from `points`;
neither expression references the other. `unwrapLonChain` shifts longitudes by multiples of 360°
relative to the **planned chain's own first point**, never toward the flown track. The only place
the two meet is `BoundsController` (`FlightMap.tsx:153`), which fits bounds over the union and
changes no coordinate.

By execution: I linked the real `KONT→KLAX` flight (#44, 395 points) to the real IFR
`KSFO→EBAYE→KLAX` leg on purpose, so the two lines start ~230 nm apart. The stored waypoints are
`[KSFO 37.618023,-122.375519] [EBAYE 35.868721,-120.260559] [KLAX 33.942474,-118.409332]`; the flown
track runs `[34.055,-117.611] → [33.937,-118.391]`. The rendered map shows the dashed slate line
drawn from KSFO through EBAYE to KLAX and the blue track sitting well away from it, with no
attraction between them. The divergence is left exactly as the file describes it.

The procedure note is present and correct on the IFR leg, including the `CUSTOM` qualifier `§5.4g`
requires: `SID WESLA5 · 28L · SUSEY | STAR IRNMN2 · 24R · BURGL | APP KLAX24R · 24R (custom — not a
published procedure)`.

**Waypoint markers** are keyed `${plannedLeg.id}-${w.seq}` and tooltipped `Leg N · IDENT`, per `§18`
and Amendment A item 23 — never by ident alone. 7 markers for the 7-waypoint KSBA→KMRY leg, plus the
2 flight endpoints, matching the observed count of 9.

**`unwrapLonChain` extraction.** Moving it out of `TripMap.tsx` into `client/src/utils/geo.ts`
verbatim is a good change — it removes a copy before a second one could drift — and `TripMap.tsx`'s
diff is a pure deletion plus one import. See F-5 for the process note.

---

## DoD 2 — the deliberate false-positive attempt

**This is the finding the plan put the weight on, so here is the whole method.**

The real fixtures cannot produce it: KSBA→KMRY→KSTS→KACV is a chain and no two legs share a
departure. So I built two `.lnmpln` files by hand — `KSFO→KSAN` and `KOAK→KLAS`, real airport
reference points **9.62 nm apart**, comfortably inside `DEPARTURE_RADIUS_NM = 10` — imported both
into one trip through the real `POST /api/trips/:id/planned-legs` endpoint, marked it active, and
replayed takeoffs through `/api/ingest`.

| # | Takeoff position | Distance to leg 1 / leg 2 | Result |
|---|---|---|---|
| A1 | midpoint KSFO–KOAK | 4.8 / 4.8 nm | `AMBIGUOUS (legs 5, 6 within 10 nm)` — unlinked |
| A2 | **exactly over KSFO** | **0.0** / 9.6 nm | `AMBIGUOUS (legs 5, 6 within 10 nm)` — unlinked |
| A3 | **exactly over KOAK** | 9.6 / **0.0** nm | `AMBIGUOUS (legs 5, 6 within 10 nm)` — unlinked |

A2 and A3 are the ones that matter. A nearest-wins matcher would link both, and both would be
plausible to a user. This one refuses, and the flight row comes back
`{"trip_id":null,"planned_leg_id":null,"planned_leg_link_source":null}` every time. There is no
distance tie-break, no `seq` tie-break and no ident tie-break anywhere on the path.

I then repeated it with **real** data: the two real fixtures that both depart KMRY
(`KMRY→KSTS` and `KMRY→KSFO`) imported into one trip. Takeoff at KMRY → `AMBIGUOUS (legs 7, 8 within
10 nm)`, unlinked. Real coordinates, real import path, same refusal.

**And the saving grace holds [executed].** `§13.2` argues strict refusal is affordable because
ambiguity resolves itself. Both resolutions were tested:

- **A4** — skip leg 2, take off over KSFO again → `linked to planned leg #5 (KSFO→KSAN, 0.0 nm,
  MATCHED)`. Exactly one eligible candidate, clean match.
- **B2** — link the first KMRY flight to leg 1 by hand, take off at KMRY again →
  `linked to planned leg #8 (KMRY→KSFO, 0.0 nm, MATCHED)`, with leg 7 still holding flight 52. The
  survivor matches and the predecessor keeps its link.

I could not construct a false positive. I do not believe one is reachable through the auto path.

---

## DoD 7 & 8 — end to end against the two real trips

Imported by naming the three files **explicitly**, in alphabetical order — which is reverse route
order — never by globbing `VFR*`:

```
VFR Charles M Schulz - Sonoma Coun (KSTS) to California Redwood Coast-Humbo (KACV).lnmpln
VFR Monterey Rgnl (KMRY) to Charles M Schulz - Sonoma Coun (KSTS).lnmpln
VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln
```

Chain-sorting put them back in route order — `seq 1 KSBA→KMRY`, `seq 2 KMRY→KSTS`, `seq 3 KSTS→KACV`
— and the IFR fixture went into a **second** trip as `KSFO→KLAX`.

| Step | Active trip | Takeoff | Result |
|---|---|---|---|
| 1 | VFR | KSBA | `linked to planned leg #5 (KSBA→KMRY, 0.0 nm, MATCHED)` — **leg 1 only**, not 2 or 3 |
| 2 | VFR | land KMRY | `landed 0.0 nm from planned KMRY — leg #5 marked flown` |
| 3 | VFR | **KSFO** | `NO_LEG_IN_RADIUS (nearest planned departure 57.4 nm away)` — the IFR trip's KSFO leg is **not** a candidate |
| 4 | VFR | KMRY | `linked to planned leg #6 (KMRY→KSTS, 0.0 nm, MATCHED)` — **leg 1 still linked to flight 48** |
| 5 | IFR | **KSBA** | `NO_LEG_IN_RADIUS (nearest planned departure 227.7 nm away)` — the VFR trip's KSBA leg is **not** a candidate |
| 6 | IFR | KSFO | `linked to planned leg #8 (KSFO→KLAX, 0.0 nm, MATCHED)` |
| 7 | IFR | land 39.5 nm from KLAX | `leg #8 marked diverted`, `arrival_deviation_nm = 39.5` |

Steps 3 and 5 are the scoping test in both directions, against two real trips. Final leg table:

| leg | trip | seq | route | status | dev nm | linked flight |
|---|---|---|---|---|---|---|
| 4 | 1 (user's) | 1 | KMRY→KSFO | planned | — | 47 |
| 5 | 2 (VFR) | 1 | KSBA→KMRY | flown | 0 | 48 |
| 6 | 2 (VFR) | 2 | KMRY→KSTS | flown | 0 | 50 |
| 7 | 2 (VFR) | 3 | KSTS→KACV | planned | — | — |
| 8 | 3 (IFR) | 1 | KSFO→KLAX | diverted | 39.5 | 52 |

The user's own pre-existing trip 1 and its manually linked flight 47 were never candidates and were
never touched, at any point.

---

## The four things the dispatchers flagged

**`SNIPPET_NO_DEPARTURE_AIRPORT` has never fired end to end — it does now [executed].** I imported
`samples/lnmpln/synthetic/snippet-non-airport-endpoints.lnmpln` through the real import endpoint
(201; `departure_ident: "WP1"`, `departure_is_airport: 0`, `is_snippet: 1`, at
`34.383888/-120.128807`), marked its trip active, and replayed a takeoff at that waypoint:

```
[FlightManager] Flight #57 not linked — SNIPPET_NO_DEPARTURE_AIRPORT (leg 8 within 10 nm, nearest 0.0 nm)
```

The refusal is reachable through the real path end to end. It is no longer synthetic-only.

**`FLIGHT_ALREADY_LINKED` is structurally unreachable from `startFlight()` — confirmed.** See F-4.

**Amendment C is load-bearing, and it is working today [executed].** Both codes it protects fire in
production right now: `LEG_ALREADY_FLOWN` and `LEG_ALREADY_LINKED` were each reached through
`/api/ingest` (table above), and each named a leg 0.0 nm away rather than degrading to a
`NO_LEG_IN_RADIUS` pointing 160 nm up the coast. `src/db.ts:1068` has no `WHERE status …` clause.
What would catch a future regression: **nothing**. See F-2.

**The matched path's second query — the amendment matches the code [executed].** `getPlannedLegById`
appears exactly once in the TAKEOFF phase of a matched flight and never in the CRUISE phase of a
50-frame flight. Once per flight, only on a match, exactly as `§13.5` now says.

**`nearbyLegIds` means different things per reason — code, log and contract agree [executed].**
Detailed under T-015 above.

---

## Adversarial probes of my own

**Can a flight attach to a leg of a non-active trip through any path? [executed]** Not
automatically. Deactivating every trip and taking off directly over a planned KMRY departure gives
an unlinked flight and no candidates at all. Two independent guards: `src/db.ts:1068` joins
`trips … AND t.is_active = 1`, and `src/legMatcher.ts:168` re-filters by `activeTripId` regardless
of what the caller passed. The manual `PUT /api/flights/:id/planned-leg` *does* reach any trip's
legs — that is deliberate and documented at `src/server.ts:613-616` and `§12.3`, since it is the
escape hatch for a bad auto-match and must not be constrained by the mechanism it corrects.

**Two legs from the same field, one already flown [executed].** Covered above as A4/B2 — the
survivor matches cleanly, exactly as `§13.2` claims.

**Does an auto-linked flight survive a server restart mid-flight, and can it still be unlinked?
[executed]** Yes to both. Auto-linked at takeoff, then `SIGINT` the server mid-flight and restart:
the row still reads `{"end_time":null,"trip_id":2,"planned_leg_id":5,"planned_leg_link_source":"auto"}`
and `GET /api/flights/:id` returns `{pl:5, src:"auto", trip:2}`. `flightState` returns to `IDLE`
(in-memory state lost, unchanged from before this feature). `PUT … {plannedLegId:null}` after the
restart → 200, link cleared, leg back to `planned`. Nothing about the link is held only in memory.

**`endFlight()` reached from `onCrash()` and `onSimDisconnect()`, nowhere near an airport
[executed].** Crash at 5.0°N 150.0°W with an unlinked flight: closed cleanly, `end_time` written.
Sim-disconnect with a *linked* flight at the same mid-Pacific position:
`landed 2448.6 nm from planned KMRY — leg #5 marked diverted`, `arrival_deviation_nm = 2448.6`, link
kept, no exception. Ugly number, honest record, no special case — which is what `§14` asks for.

**Mid-flight mutation of the link [executed].** The comment at `src/flightManager.ts:296-300` claims
the link is re-read at landing rather than remembered. Forced, all three ways:

- **Unlink mid-flight, land at the planned destination** → nothing written, leg stays `planned`, no
  log line. The remembered-match bug the comment warns about does not exist.
- **Re-link mid-flight to a different leg, then land** → the *new* leg 7 is marked
  `diverted, 284.1 nm`; the original leg 5 is untouched. Correct.
- **Delete the linked leg mid-flight, then land** → `deletePlannedLeg` clears the flight's three
  `planned_leg_*` columns and restores `trip_id`; landing then writes nothing and the flight closes
  normally.

**Can `arrival_deviation_nm` be lost or overwritten? [executed]** By the documented paths, yes and by
design: unlink clears it (that is how a leg is reopened, `§14`), deleting the flight clears it via
`clearPlannedLegLink`, deleting the trip removes the leg entirely. A same-leg re-link does **not**
touch it — the `§12.2` no-op guard holds, and it also preserves `planned_leg_link_source: 'auto'`
through a manual same-leg re-link (verified). Skipping a linked leg is refused with a 409, and
linking a second flight to a held leg is refused with a 409 naming the holder. **One undocumented
path does lose it — F-1.**

**Combining and deleting [executed].** `deleteFlight` → leg back to `planned`, deviation `NULL`.
`deleteTrip` on a trip holding a link-moved flight → the flight's `trip_id` is restored from
`planned_leg_prev_trip_id` and all three `planned_leg_*` columns cleared before the cascade fires
(Amendment C-2 working as written); ordinary trip membership untouched.

**Concurrency.** `better-sqlite3` is synchronous and Node is single-threaded, so the auto-link cannot
interleave with a concurrent manual link. No probe needed; stating it so the next reader does not
wonder.

---

## Findings

### F-1 — `PATCH /api/planned-legs/:legId {status:'planned'}` silently destroys `arrival_deviation_nm` on a still-linked flown or diverted leg — **medium** — `src/db.ts:1032`, `src/server.ts:584`

**[executed]** A leg diverted at 42.9 nm with its flight still linked:

```
PATCH /api/planned-legs/5 {"status":"planned"}          -> 200
before: {"status":"diverted","arrival_deviation_nm":42.9}
after:  {"status":"planned", "arrival_deviation_nm":null}
flight: {"planned_leg_id":5,"planned_leg_link_source":"auto"}   <- link kept
```

`setPlannedLegStatus` guards only the `'skipped'` direction against a linked flight
(`src/db.ts:1043-1045`). `'planned'` passes straight through and always clears
`arrival_deviation_nm` in the same statement. Two consequences:

1. The deviation record is destroyed with nothing left to recover it from. `§14` says the deviation
   is "a visible fact rather than a silent absence"; this makes it a silent absence.
2. The resulting state is not one of `§15`'s five. `§15` defines `linked` as `status='planned'` **plus
   a linked flight with `end_time IS NULL`** — "being flown right now". Here the flight has landed, so
   a completed leg renders as in-flight.

`§15`'s transition table has no `flown|diverted → imported` transition triggered by a `PATCH`; the
only two listed are unlink and flight-delete, both of which also break the link. The `PATCH` reaching
this state is unintended.

**Not reachable from the current UI**, which is why this is medium rather than high: the only caller
is `handleToggleSkip` (`client/src/pages/TripDetail.tsx:371`), which sends `'planned'` **only** when
`leg.status === 'skipped'` (`PlannedLegRows.tsx:182`). Clicking "Skip" on a linked flown leg sends
`'skipped'` and gets the 409, surfaced correctly.

This is phase-3 code (T-012), but phase 4 is the phase that makes it matter: before T-016 nothing
ever wrote `arrival_deviation_nm`, so there was nothing to lose. Suggested fix, matching the shape of
the guard already there: in `setPlannedLegStatus`, refuse `'planned'` too when the leg has a linked
flight — or narrow it to refuse only when the current status is `'flown'`/`'diverted'`, so un-skipping
keeps working.

### F-2 — nothing would catch a re-introduced status filter in `getPlannedLegCandidatesForActiveTrip()` — **medium** — `src/db.ts:1068`, `src/inspect-legmatch.ts`

**[executed]** Amendment C is exactly the kind of correction that reverts by accident: the function's
old name (`getUnflownPlannedLegsForActiveTrip`) *endorsed* the filter, and adding
`WHERE l.status NOT IN ('flown','diverted')` back would look like an optimisation. Nothing fails if
someone does. The three reason codes degrade to `NO_LEG_IN_RADIUS`, the user still gets an unlinked
flight, and the only symptom is a log line that names a leg 160 nm away instead of the obstacle 0 nm
away.

`inspect-legmatch.ts` cannot catch it: it is pure by design and hand-builds every candidate, so it
never executes the SQL. `grep` confirms `getPlannedLegCandidatesForActiveTrip` has exactly one
runtime caller (`src/flightManager.ts:257`) and no test, harness or inspect tool touches it. The
protection today is the comment at `src/db.ts:1052-1066` and the contract at
`contracts/planned-legs.d.ts:664-673` — both good, both advisory.

Suggested fix, small: add a database-backed section to `inspect-legmatch.ts` (or a `--db` mode) that
opens a temporary SQLite file, inserts one trip with a `flown` leg, a `skipped` leg and a linked leg,
calls the real loader, and asserts all three come back. That is the one assertion that makes
Amendment C self-defending, and it costs perhaps forty lines in a file that already owns this
invariant conceptually.

### F-3 — `arrival_deviation_nm` is written but rendered nowhere, and no remaining task will render it — **medium** — `client/src/types.ts:130`

**[executed]** `grep -rn "arrival_deviation_nm" client/src/` returns exactly one hit: the type
declaration. Phase 4 now writes this column on every landing of a linked flight — I observed
`0`, `39.5`, `42.9`, `84.5`, `284.1` and `2448.6` in this review — and no view shows any of them.

`§14` is explicit: *"The UI shows, on the leg row: the badge `Diverted`, the planned destination
ident, the actual arrival (`flights.arrival_icao`, or the coordinates when it did not resolve), the
deviation in nm, and an unlink control"*, and *"the trip page can show 'flown, 3.1 nm from plan' as
well as 'diverted, 47 nm from LEMD'"*. Today the badge is there (`plannedLegBadge`,
`PlannedLegRows.tsx:12-19`) and the number is not, on either the trip page or `FlightDetail`'s new
Planned Leg section.

This is a scheduling gap rather than a coding one, and it needs an Orchestrator decision: T-013
(phase 3) built the leg row before the column could ever be non-null, T-017's DoD does not mention
the deviation, and **no phase-5 task touches `PlannedLegRows.tsx`, `TripDetail.tsx` or
`FlightDetail.tsx`** — T-019 is the live panel, T-020 is `journey.ts`, T-021 is `PrintTrip`. Unless a
task is added, `§14`'s UI contract will never be implemented, and the user will see a `Diverted`
badge with no way to learn by how much.

The smallest honest fix is one line in `FlightDetail`'s Planned Leg section, where the leg object is
already in hand, plus one in the ghost row.

### F-4 — `FLIGHT_ALREADY_LINKED` is dead in production — **low** — `src/legMatcher.ts:156-157`, `src/flightManager.ts:261`

**Confirmed unreachable [read + executed].** `flightAlreadyLinkedTo` is a hardcoded `null` literal at
the only production call site, and `insertFlight()` runs one line earlier at
`src/flightManager.ts:163`, so the row provably cannot carry a link. `grep` shows `matchPlannedLeg`
has exactly two callers: `flightManager.ts:251` and the harness. My production sweep reached 9 of the
10 reason codes; this is the one that cannot be reached.

**Does it matter? Only a little, and I would leave it.** Step 0 is a cheap guard at the top of a
function whose contract admits a caller that does not yet exist — the design's own rule in Amendment
C is that a guard belongs at the layer every caller passes through, and this is that layer. Deleting
it would move the safety of a future second caller into that caller's own discipline, which is the
mistake C exists to name. It is exercised by harness row 18.

Two things are worth doing, both one-line: the comment at `src/flightManager.ts:258-260` says step 0
"exists for the manual path" — the manual path is `linkFlightToPlannedLeg`, which does not call the
matcher at all, so that sentence points at something that is not true. And `§13.4` should record that
this code is currently unreachable in production, so a future reviewer does not spend an hour
looking for a way to trigger it, as I did.

### F-5 — files edited outside their `allowed_paths` — **low** — process

**[read]** Three files were changed by phase 4 that their task does not list:

- `src/db.ts` — T-016's `allowed_paths` are `src/flightManager.ts` and `src/index.ts`;
  `getFlightPlannedLegId()` landed at `src/db.ts:1119`.
- `client/src/components/TripMap.tsx` and `client/src/utils/geo.ts` — T-017's `allowed_paths` are
  `FlightMap.tsx` and `FlightDetail.tsx`.

All three edits are good ones and the request envelope names them, so the Orchestrator clearly
sanctioned them; I record it only because `§4.2` already established that widening `allowed_paths` is
a plan amendment rather than an implementation detail, and because `plan.json` still reads as though
these files were untouched.

One consequence I could not fully close: `src/db.ts` has an mtime inside the phase-4 window, so I
cannot diff it against its phase-3-approved state to prove nothing *else* changed there. I verified
the phase-4-relevant behaviours directly instead — `getPlannedLegCandidatesForActiveTrip` has no
status filter, `linkFlightToPlannedLeg`'s no-op guard holds, `unlinkFlightFromPlannedLeg`,
`clearPlannedLegLink`, `deleteTrip` and `combineFlights` all behave as `§16` and Amendment C describe
— all by execution. A committed phase-3 snapshot would have made this checkable rather than
inferable.

---

## Residual risks

1. **The 10 nm radius is still a reasoned guess.** Unchanged from `§21` item 2. Everything I measured
   was at 0.0 nm or beyond 40 nm; nothing in this review exercises the 8–12 nm band against a real
   MSFS takeoff, because no real takeoff exists to exercise it with. The tuning knob
   (`radiusNm` override, harness row 4) works.
2. **`AMBIGUOUS` still has no real-fixture coverage in the harness**, and now cannot: I produced it
   only by assembling two real KMRY departures that belong to different trips into one trip. That is
   real coordinates and an invented trip, which is what the harness header already says. The refusal
   is now proven end to end through `/api/ingest`, which is stronger than it was, but the shape it
   guards against has still never appeared in genuine Little Navmap output.
3. **The planned route unwraps across the antimeridian; the flown track does not.**
   `client/src/utils/geo.ts:29` anchors the unwrap on the planned chain's own first point, and
   `FlightMap.tsx:153` fits bounds over the union. For a dateline-crossing leg the planned line could
   be drawn near +190° while the flown track sits near −170°, putting them a world apart on screen and
   zooming the map out to fit both. The comment acknowledges the flown-track limitation as
   pre-existing; what is new is that the two layers now share one `fitBounds`. No fixture crosses
   180°, so this is unobserved and untestable with what exists.
4. **`recordArrivalOnPlannedLeg` uses `flightManager`'s private `haversineNm`** (`:316`), while the
   departure radius uses `src/geo.ts`. Both formulas are identical today — I read both — and `§20`
   item 21 forbids migrating the private copies in this feature, so this is correct as built. It is
   nonetheless the exact drift `§4.1` warns about, now with the two ends of a single leg judged by two
   different copies of the same function.
5. **`describeRefusal` hardcodes `DEPARTURE_RADIUS_NM`** in its "within N nm" text
   (`src/flightManager.ts:46`) rather than the radius actually used. Harmless today — the override is
   never passed in production — but it will lie during the tuning pass if anyone wires the override
   through.
6. **The `<Alternates>` element still has no real coverage at all**, unchanged from `§21` item 1 and
   untouched by phase 4.

---

## Live baseline

Re-checked read-only against `flights.db` at the end of the review. The user's server on port 3000
was never touched and is still listening.

| | Expected | Found |
|---|---|---|
| flights | 35 | **35** |
| trips | 1 | **1** |
| planned legs | 1 | **1** |
| active trips | 1 | **1** |
| linked flights | 1 | **1** |

The one link is flight 47 → leg 4 (`KMRY→KSFO`, `manual`, `status planned`,
`arrival_deviation_nm NULL`) — the user's own hand-made link through the phase-3 UI, exactly as it
was before this review started. `git status --porcelain` is unchanged (21 entries, same list). The
`8cec371` worktree has been removed.
