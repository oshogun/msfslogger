# Intake — Atlas countries + planned-route-progress fix

Tier: **one implementer + one Reviewer** (single seam: `src/journey.ts`, no new
contract — `Journey`'s field shapes are unchanged, only two computations inside
`buildJourney()` are corrected).

## Goal

User reported two bugs in the trip Atlas tab, from a real trip ("Circumnavegação",
52 legs):

1. Their most recent logged landing, Yelizhovo (UHPP, Petropavlovsk-Kamchatsky,
   Russia), does not make Russia appear in the "COUNTRIES" list, even though
   countries with fewer visited airports do appear.
2. "PLANNED ROUTE PROGRESS" reads 100.0% while the user says several planned
   legs are still unflown.

## Root causes (confirmed by investigation, not to be re-derived)

**Countries (`src/journey.ts:9-82`).** `countryForIcao()` looks up a hardcoded
2-letter ICAO-prefix table `ICAO_COUNTRIES` (`journey.ts:9-69`), falling back to
a 1-letter table `SINGLE_LETTER_COUNTRIES` (`journey.ts:71-75`, only `K`/`C`/`Y`).
Neither table has any entry for the Russia/CIS `U*` block, so `countryForIcao('UHPP')`
returns `null`, and the `if (!c) continue;` guard at `journey.ts:208` silently
drops that airport from `byCountry` — the airport still shows up fine in
`journey.airports`, which doesn't filter by country; only the countries rollup
loses it.

**Planned route progress (`journey.ts:238-241`).**
```
const totalPlannedDistanceNm = plannedLegs.reduce((s, l) => s + l.approx_distance_nm, 0);
const plannedRouteProgressPct = totalPlannedDistanceNm > 0
  ? Math.min(100, Math.round((totalDistanceNm / totalPlannedDistanceNm) * 1000) / 10)
  : undefined;
```
`totalDistanceNm` (`journey.ts:178`) is the sum of `distance_nm` over **every
flight in the trip**, not distance attributable to completed planned legs.
`plannedLegs` is unfiltered by status (`src/db.ts:478-507`, `getPlannedLegsForTrip`).
So the ratio is "all flying ever logged on this trip" ÷ "all planned-leg distance,
flown or not" — once total flown mileage crosses the planned total (extra/
unplanned flights, repositioning, sightseeing hops, or just a long trip), it
reads 100% via the `Math.min(100, …)` clamp regardless of which specific legs
are still `status: 'planned'`. `src/legMatcher.ts` / `src/plannedLegClose.ts`
are not involved in this computation at all — they only decide match/close
outcomes at flight time and set `PlannedLeg.status`, they don't feed the Atlas
number.

This progress field was previously designed and reviewed in
`.claude/runs/2026-09-04-lnmpln-trip-planner` (`reviews/phase5.md` T-020) as
"flown / total-planned, clamped" — a reasonable approximation at the time, but
it does not hold up once a trip accumulates flights beyond its planned legs.
This run **amends that design in place** (per `.claude/runs/README.md`
conventions: amend, don't silently overwrite, and record why).

## Frozen decision for this run

Use the status semantics the codebase already establishes elsewhere —
`src/legMatcher.ts:126` and `src/inspect-legmatch.ts` ("diverted counts as
flown") — rather than inventing new semantics:

- **Countries fix**: extend `ICAO_COUNTRIES` with the Russia/CIS `U*` block:
  `UA` Kazakhstan, `UB` Azerbaijan, `UC` Kyrgyzstan, `UD` Armenia, `UE` Russia,
  `UG` Georgia, `UH` Russia, `UI` Russia, `UK` Ukraine, `UL` Russia, `UM`
  Belarus, `UN` Russia, `UO` Russia, `UR` Russia, `US` Russia, `UT` Uzbekistan,
  `UU` Russia, `UW` Russia. This is a heuristic prefix table, same spirit as
  the existing Brazil (`SB/SD/SI/SJ/SN/SS/SW`) entries — it will mislabel
  Kaliningrad (`UMKK`, a Russian exclave under the shared `UM` prefix) as
  Belarus. That's an acceptable, pre-existing class of limitation for this
  table (same shape as the Brazil-dominated `S` block); do not attempt
  per-airport overrides to fix it — out of scope.
- **Progress fix**: replace the numerator. Instead of `totalDistanceNm` (all
  flights), sum `approx_distance_nm` only over planned legs whose
  `status` is `'flown'` or `'diverted'` — i.e. legs no longer outstanding.
  Denominator (`totalPlannedDistanceNm`, sum over *all* planned legs
  regardless of status) is unchanged, so a trip with a `'skipped'` leg never
  reaches 100%, which is correct (a skipped leg was never flown). Keep the
  `Math.min(100, …)` clamp and the `totalPlannedDistanceNm > 0` presence guard
  exactly as they are — only the numerator's source changes.
- Update the doc comment at `journey.ts:119-138` in place (amend, don't
  delete — same convention the block itself already follows from the prior
  run) to describe the corrected numerator: sum of completed (`flown` +
  `diverted`) planned legs' `approx_distance_nm`, not raw trip distance.
- Add an amendment note to `.claude/runs/2026-09-04-lnmpln-trip-planner/reviews/phase5.md`
  under T-020 pointing at this run, per the append-mostly convention in
  `.claude/runs/README.md` — do not edit that file's existing verdict text.

No schema change, no new endpoint, no change to `Journey`'s field shapes —
Design step is skipped; this is wiring an existing contract to correct data,
recorded here per the tier-1/2 rule in `.claude/agents.md`.

## Success criteria

1. `GET /api/trips/:id/journey` (or `buildJourney()` directly) for a trip
   containing a flight to/from a `UH*`/`UU*`/etc. Russian airport includes
   `{ name: 'Russia', flag: '🇷🇺', airports: N }` in `countries`.
2. A trip with planned legs in a mix of `flown`, `diverted`, `planned`, and
   `skipped` status reports `plannedRouteProgressPct` reflecting only the
   `flown`+`diverted` legs' `approx_distance_nm` share of the total — not 100%
   just because total flown mileage happens to exceed the plan total.
3. A trip with **zero** planned legs still gets no `plannedRouteProgressPct`
   key at all (unchanged behavior — do not regress the "absent, not zero"
   contract from T-020).
4. Existing Vitest suite (`npm test`) stays green; the fix is unit-testable
   without a live server or `flights.db` per `tests/helpers/index.ts` mocks —
   add coverage for both fixes there.
5. `npm run build` and `npm run test:types` clean.

## Allowed paths

`src/journey.ts`, `tests/**` (new/updated unit tests for `buildJourney`),
`.claude/runs/2026-09-04-lnmpln-trip-planner/reviews/phase5.md` (amendment
note only, append — do not touch existing content).

## Non-negotiables

- Never touch the running server or live `flights.db` — this is a pure
  unit-level fix, verify via `npm test` / `ts-node` inspectors against fixtures,
  not the live app.
- Both fixes land in one implementer task (same file, `journey.ts`) per the
  "two tasks touching the same file are one implementer agent, always" rule.
