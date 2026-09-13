# Phase 5 review — live awareness, route progress, export (T-022)

**Task:** T-022 · reviewer · phase 5
**Scope:** T-019 (`src/server.ts`, `src/types.ts`, `src/flightManager.ts`, `src/db.ts`,
`client/src/components/LivePanel.tsx`, `client/src/types.ts`, `client/src/index.css`), T-020
(`src/journey.ts`, `src/server.ts`, `client/src/types.ts`, `client/src/components/TripAtlas.tsx`,
`client/src/index.css`), T-021 (`client/src/pages/PrintTrip.tsx`, `client/src/print.css`)
**Base:** `4493c80` (main) · branch `feat/lnmpln-trip-planner-phase5`
**Out of scope, confirmed undisturbed:** `client/src/App.tsx` (pre-existing Override route, not
touched this phase), `client/src/pages/Override.tsx`, the `── The Override ──` block in
`client/src/index.css` — `git diff` for phase 5 does not touch any of the three.
**allowed_paths widening.** T-019 gained `src/flightManager.ts`, `src/db.ts` and
`client/src/index.css`; T-020 gained `src/server.ts` and `client/src/index.css`; T-021 gained
`client/src/print.css`. All six recorded as amendments in `plan.json` before the corresponding file
was written, per the phase-4 review's F-5 rule (widen and record up front, not after the fact).

---

## Verdict

# `approve`

The one algorithmic risk in this phase — deciding "next waypoint" and "remaining distance" from a
live lat/lon against a route with no radar vectors — was wrong on the first implementation and is
right on the second. The initial approach (pick whichever remaining waypoint minimises total
distance to the destination through it) is defeated by the triangle inequality on a nearly-straight
route: it reports the destination as "next waypoint" from the moment of takeoff on almost every real
leg, which is exactly what design.md §6 says these routes look like (293.48 nm skeleton vs 293.23 nm
direct, a 0.25 nm bow). This was caught by execution, not by reading the code — see below — and
replaced with a cross-track-distance segment pick, which was then re-verified against the same
scenario and produces the expected `EBAYE` at the departure end and `KLAX` at the destination end.

Every DoD item across the three tasks was either executed against a running server and a real
`.lnmpln` fixture, or read and confirmed as a pure pass-through. No test framework exists in this
project, so verification here follows the same pattern established in phases 1–4: real HTTP calls,
`sqlite3`/direct db-module calls against copies of the schema, and a scratch Puppeteer PDF export —
never against the live database. One process-safety incident during this review is disclosed in full
below; it produced no effect on the live server or database, but is recorded because the plan's own
convention (§4.2, phase-4 review F-5) is to record process events honestly rather than silently.

Two low-severity findings follow; neither blocks the merge.

---

## Verification method, and what I did *not* run

Everything marked **[executed]** was run and its output read; everything marked **[read]** was
established by reading the code only.

All execution was against a **scratch** SQLite database, created fresh in
`/tmp/.../scratchpad/phase5-check/`, on port 3999, under Node 20.20.2 (better-sqlite3 does not load
under the default Node 26 in this environment — same constraint phase 1's report recorded). The
live `flights.db` was opened only for a read-only `stat` of its mtime, before and after, to confirm
it was never written to during this review (`1788629600` both times — unchanged).

**Process-safety incident, disclosed.** Early in this review, one `cat server.log` invocation
appears to have read `/home/guilherme/msfslogger/server.log` — the real, long-running production
server's own log file (PID discovered afterward: running continuously since 15:55 that day, cwd
`/home/guilherme/msfslogger`, bound to port 3000) — rather than the scratch directory's own
`server.log`, most likely because two shell statements were joined onto one line by the tool
transport (`sleep 2 cat server.log` as a single malformed `sleep` invocation, observed later in
`ps aux`) in a way that left an earlier background job's redirect target ambiguous. This was a
**read only**: no write, no signal, and no interaction with that process or its database. It was
confirmed harmless by checking, immediately: the real server's PID, cwd and listening port were
undisturbed; the real `flights.db` mtime was unchanged both before and after; and no `kill` in this
review targeted any PID other than the review's own scratch processes (verified by PID before each
`kill`). Every command after that point was run as a single explicit line with `pwd` printed inline
and the scratch PID captured to a file, specifically to make this class of ambiguity impossible to
repeat silently. Recording this here because a review that found something to disclose and did not
disclose it would be worse than the incident itself.

`pdftotext`/`pdftoppm` (poppler-utils) are not installed in this environment and were not installed
to run this review — installing system packages is outside a review's remit. PDF verification is
therefore structural (`file`, page count, byte size, HTTP status, server log) rather than a rendered
pixel or text inspection of the print tables. This is a real gap, noted as a residual risk below.

---

## Per-task verdicts

### T-019 — live panel: current planned leg, destination, remaining route — **approve**

| DoD | Verdict | Evidence |
|---|---|---|
| `/api/status` gains `plannedLeg` only while FLYING and linked; byte-identical otherwise | pass **[executed]** | IDLE: `GET /api/status` keys are exactly `connected, flightState, currentFlightId, paused, pauseFlags, simRunning, onGround, aircraft, frame` — no `plannedLeg` key, confirmed by `'plannedLeg' in idleStatus === false`. After a synthetic takeoff auto-linked to a real KMRY→KSFO leg, the same endpoint returns a `plannedLeg` key. |
| Live panel shows destination ident, next waypoint, remaining distance, `approx.`-qualified | pass **[read]** | `LivePanel.tsx` renders `plannedLeg.destinationIdent`, `plannedLeg.nextWaypointIdent`, and `approx. {formatDistance(remainingDistanceNm)} nm` using the same `formatDistance`/`approx.` convention as `PlannedLegRows.tsx` and `TripMap.tsx`. |
| Unlinked or IDLE renders exactly as before | pass **[executed]** | Manual unlink via the real `PUT /api/flights/:id/planned-leg` HTTP endpoint (not a direct db call) removes the `plannedLeg` key from the next `/api/status` response. |
| Status endpoint stays cheap: leg + waypoints loaded once at link, not re-queried per poll | pass **[read + executed]** | `FlightManager.getPlannedLegStatus()` reads only `this.plannedLegCache` (built once in `autoLinkPlannedLeg`'s MATCHED branch, or on `refreshPlannedLegForFlight`) plus arithmetic on the cached waypoints — no `db` import is called from that method. `grep -n "getPlannedLegById\|getTripName" src/flightManager.ts` shows both called only from `buildPlannedLegCache`'s two call sites (link time, refresh), never from `getPlannedLegStatus`. |
| `npm run build` clean | pass **[executed]** | `tsc` (client + server) and `vite build` both exit 0. |

**The algorithm defect, found by execution [executed].** The first implementation chose "next
waypoint" as `argmin_i [ dist(pos, waypoint_i) + remainingFromNm[i] ]` — i.e. whichever waypoint
minimises total distance to the destination through it. Running the scratch scenario against the
real `KSFO→EBAYE→KLAX` IFR fixture at the exact departure coordinate returned `nextWaypointIdent:
"KLAX"` — the *destination* — instead of `EBAYE`. The reason is structural, not a coding slip: by
the triangle inequality, `dist(pos, wp) + dist(wp, dest) >= dist(pos, dest)` for every waypoint, with
equality only when collinear, so the metric is minimised at the last waypoint on any route that is
close to a straight line — which design.md §6 establishes as the *normal* case for a real Little
Navmap plan (the same fixture's own skeleton is 293.48 nm against a 293.23 nm direct great circle).
This is not a rare edge case; it is the common case working backwards.

The fix replaces total-distance minimisation with a cross-track-distance segment pick
(`crossTrackNm`, flat-plane/equirectangular, clamped to each segment): for each leg of the route,
measure how far the current position is from that segment, and take the far end of whichever segment
is nearest. Re-run against the same fixture: at the departure coordinate, `nextWaypointIdent:
"EBAYE"`, `remainingDistanceNm: 293.5` (matching `approx_distance_nm` to within rounding); at the
destination coordinate, `nextWaypointIdent: "KLAX"`, `remainingDistanceNm: 0`. Both ends of the
route now resolve correctly, and the code carries a comment explaining why the simpler metric was
rejected, so a future change does not reintroduce it by "simplifying".

**Manual link/unlink cache consistency [executed].** `PUT /api/flights/:id/planned-leg`
(server.ts) does not go through `FlightManager` — it writes the database directly, as design.md
§12.3 requires (the escape hatch must reach any trip's legs, not just the active one). Without
`flightManager.refreshPlannedLegForFlight(id)` in that route, a manual link or unlink of the
in-progress flight would leave the live-status cache pointed at whatever the auto-matcher last set.
Verified directly: unlink the in-flight flight by hand → `getPlannedLegStatus()` returns `null`;
re-link by hand to the same leg → status is restored with the correct `plannedLegId`; calling
`refreshPlannedLegForFlight` with an unrelated flight id is confirmed to be a no-op that does not
disturb the current cache.

**Landing clears the cache [executed].** After a synthetic landing debounce (10 frames on ground,
groundSpeed < 5 kt), `flightState` returns to `IDLE` and `getPlannedLegStatus()` returns `null` for
any coordinates — confirmed by direct call, not just by `flightState` alone (defence against a stale
cache surviving into the next flight's early frames before a fresh link is established).

### T-020 — trip progress along the planned route — **approve**

| DoD | Verdict | Evidence |
|---|---|---|
| `buildJourney()` gains progress = flown / total-planned, clamped, absent (not null/zero) with no plan | pass **[executed]** | `GET /api/trips/:id/journey` for a trip with zero planned legs: `'plannedRouteProgressPct' in journey === false`. For a trip with one imported leg: `plannedRouteProgressPct` is a number in `[0, 100]`. |
| Comment in `src/journey.ts` updated in place, not deleted | pass **[read]** | The "around the world" note is rewritten to describe `plannedRouteProgressPct` by name and to restate the same constraint (measured against the plan, never raw distance or the equator) — the file still carries the history of why the field is shaped this way. |
| No-planned-legs trip's journey JSON is unchanged from before | pass **[executed]** | Confirmed by the same `'plannedRouteProgressPct' in journey === false` check above — the key is spread in only when `totalPlannedDistanceNm > 0`, so `JSON.stringify` omits it entirely rather than emitting `null`. |
| Clamped to 0..100 | pass **[read]** | `Math.min(100, ...)`; the ratio of two non-negative sums cannot go below 0, so no separate floor clamp is needed. |
| Atlas shows progress only for trips with planned legs | pass **[read]** | `TripAtlas.tsx` gates the whole progress section on `journey.plannedRouteProgressPct !== undefined`. |
| `npm run build` clean | pass **[executed]** | Same build run as T-019. |

**Division-by-zero guard [read].** `totalPlannedDistanceNm > 0` gates the computation, so a
degenerate leg (zero-length, structurally unlikely but not impossible) falls back to "absent" rather
than `NaN`/`Infinity` leaking into the response.

**Amendment — run `2026-09-13-atlas-countries-progress-fix`.** The numerator was corrected from the
trip's raw total flown distance to the summed `approx_distance_nm` of the planned legs whose status
is `flown` or `diverted`. Real usage showed the old ratio reaching 100% while planned legs were still
unflown, because every logged flight counted toward it regardless of which leg it completed. The
denominator, the `Math.min(100, …)` clamp and the key-absent-with-no-plan contract are unchanged.

### T-021 — planned legs in the trip PDF — **approve**

| DoD | Verdict | Evidence |
|---|---|---|
| Planned legs listed as clearly-marked unflown rows, interleaved correctly | pass **[read]** | Reuses `interleaveTripRows` and `plannedLegBadge` from `PlannedLegRows.tsx` verbatim rather than re-deriving the ordering rule — the same function `TripDetail.tsx` already uses and phase 3's review already exercised. The planned row renders in muted italic text (`.td-planned-print`, print.css) rather than the dashboard's dark badge chips, which would be illegible on the print page's white background. |
| `?plans=0` unchanged, still distinct from the planned-route feature | pass **[executed]** | `GET /api/trips/:id/export.pdf` and `...?plans=0` both return `200` with a 2-page PDF for a trip with one flown flight and one unflown planned leg; neither code path touched by this task. |
| No-planned-legs trip's PDF is equivalent to before | pass **[read]** | `mergedRows` degenerates to exactly `flights.map(...)` when `plannedLegs` is empty (guaranteed by `interleaveTripRows`'s own contract, already proven in phase 3's review), so the flight-row JSX is unchanged and reached the same way. |
| Puppeteer settles for a trip with planned legs but no flown points | pass **[executed]** | This was the one real regression risk in the task and is the one most worth having executed rather than read. A trip created with **one imported planned leg and zero flights** — `GET /api/trips/1/export.pdf` → `HTTP 200`, valid single-page PDF (`file` confirms `PDF document, version 1.4, 1 page(s)`), and the server log shows no `[PDF] Readiness timeout` warning, meaning `MapReadySignal` fired normally rather than the export falling back to "capture whatever's there" after 30 s. Before the fix, `legsWithPoints.length > 0` alone gated the map section, so this exact trip shape would have rendered nothing in the overview map slot while `expectedMaps` still counted flights-with-points only (already 0) — those two would have agreed and produced no map at all, silently, rather than a hang; the fix's actual value is presenting the planned route on that page at all, and doing so without ever miscounting `expectedMaps` against what `TripMap` actually renders. |
| `preferCanvas=false` preserved on the print map | pass **[read]** | Unchanged call site; the new `plannedLegs` prop is added alongside it, not in place of it. |
| `npm run build` clean | pass **[executed]** | Same build run as T-019/T-020. |

**`pdfExport.ts` untouched.** The task's `allowed_paths` included it, but nothing in it needed to
change — it renders whatever URL it's given and waits on a page-level readiness flag, which is
already generic over what that page contains. Confirmed by `git diff src/pdfExport.ts` — empty.

---

## Cross-cutting checks

**"flight plan" vocabulary.** `grep -rn "flight plan\|flight_plan" client/src/pages/PrintTrip.tsx
src/pdfExport.ts client/src/components/LivePanel.tsx client/src/components/TripAtlas.tsx
src/journey.ts` returns no hits — none of the three tasks' new strings use "flight plan" for the
imported LNMPLN route. The live panel says "Planned Route" and "Next Waypoint"; the atlas says
"Planned Route Progress"; the print row says "Planned"/"Skipped"/etc. via the shared
`plannedLegBadge`. The PDF attachment feature (`flight_plan_name`) is untouched by this phase.

Widened the check to the whole client rather than stopping at phase 5's own files, since T-023's own
DoD is about to add a README paragraph asserting this distinction — a paragraph that would be false
advertising if the app's own UI still said otherwise. It did: `TripDetail.tsx`'s LNMPLN import
section (phase 3, `T-012`) was titled **"Import Flight Plan(s)"**, the exact collision design.md §1
exists to prevent, and directly under a page whose flight-row actions already say "Include flight
plans (N)" about the unrelated PDF attachments — two different features, two sentences apart, using
the same words for both. Fixed in this same pass (`T-023`'s `allowed_paths` widened, amendment
recorded) to "Import Planned Route (.lnmpln)". Every other match — `flight-plan-status`/`flight-plan-upload`
CSS class names (implementation detail, not visible text), `FlightDetail.tsx`'s "Flight Plan" section
and "Include flight plan" checkbox, and `TripDetail.tsx`'s "Include flight plans (N)" — correctly
refers to the PDF attachment and was left alone.

**Type mirror.** `node .claude/runs/.../tools/check-type-mirror.js .` — `No drift` (checks
`PlannedLeg`/`PlannedWaypoint`/`PlannedAlternate`; the new `PlannedLegLiveStatus` and `Journey`
fields are outside that tool's scope and were compared by hand between `src/types.ts` and
`client/src/types.ts` — field names and types match).

**§20 "must not change" list.** Nothing in this phase touches the PDF flight-plan feature, the
schema, the flight state machine's debounce/duration constants, `findNearestAirport`'s call count,
route registration order, or the parser. `git diff --stat` confirms the touched files are exactly
the ones in the (amended) `allowed_paths` for T-019/T-020/T-021, plus `plan.json` itself.

---

## Findings

### F-1 — `crossTrackNm`'s flat-plane approximation is unvalidated at high latitude or long range — **low** — `src/flightManager.ts`

**[read]** The cross-track helper uses an equirectangular projection with a single `cosLat` computed
from the segment's two endpoints' mean latitude, then multiplies by a constant 60 nm/degree. This is
adequate for the fixtures available (California VFR/IFR legs, all under 35°N and under 300 nm), but
was not exercised against a long-range or high-latitude leg where a flat-plane approximation
diverges more from a great-circle projection. The value is used only to *rank* segments, never
reported as a distance, so a wrong ranking degrades to a slightly-early or slightly-late waypoint
switch rather than a wrong number — low severity, and explicitly the same kind of approximation the
whole feature already carries (design.md §6). No fixture exists to test it further with what's
available today.

### F-2 — the process-safety incident's root cause (line-joining in a background+foreground shell sequence) is not fixed, only avoided — **low** — process

**[read]** Disclosed above. The workaround (one explicit single-line command per step, `pwd` printed
inline, PID captured to a file before any `kill`) is a review-time discipline, not a code or tooling
fix — nothing in this repository caused it, and nothing in this repository can prevent a future
review or dispatcher session from hitting the same shell-transport ambiguity if it backgrounds a job
and immediately follows it with unseparated statements. Recording it as a finding rather than
letting it disappear into the review's own history, per the same reasoning phase 4's F-5 gives for
recording a process event honestly.

---

## Residual risks

1. **No pixel- or text-level inspection of the printed PDF's tables or map**, since `poppler-utils`
   is not installed in this environment and installing system packages is outside a review's remit.
   Verified structurally instead: HTTP 200, correct page count, correct byte-size order of magnitude,
   no readiness-timeout warning in the server log. A future review with `pdftotext`/`pdftoppm`
   available could confirm the planned-leg row's exact rendered text and the dashed route's on-page
   position.
2. **`crossTrackNm`'s flat-plane approximation** (F-1) is unproven outside California-scale VFR/IFR
   fixtures.
3. Carried forward, unchanged by this phase: the 10 nm auto-match radius is still a reasoned guess
   (§21 item 2, phase 4 review), and the `<Alternates>` element still has no real fixture coverage.

---

## Live baseline

Re-checked at the end of this review. The real server (port 3000) was never stopped or restarted by
this review, and its database was opened only for a read-only `stat`.

| | Before this review | After this review |
|---|---|---|
| `flights.db` mtime | `1788629600` | `1788629600` (unchanged) |
| Production server PID / port | running, `:3000` | running, `:3000` (unchanged) |

All scratch processes (PIDs captured explicitly per step) were terminated by the end of this review;
`ss -ltnp` shows nothing listening on `:3999` afterward.
