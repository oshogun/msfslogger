# Follow-ups — refactor-db-server-split

None of these block the run's acceptance criteria (all five in
`user_stories/refactor.md` are met and reviewed — see `reviews/final.md`).
They're structural/coverage gaps the split surfaced or left behind, worth a
deliberate look in a future run rather than folding into this one.

## 1. `setActiveTrip`/`getActiveTripId` are misplaced

**Where:** `src/db/plannedLegs.ts` (active-trip get/set live here), consumed by
`src/routes/trips.ts:7` (`GET`/`PUT /api/active-trip`).

Conceptually these belong in `src/db/trips.ts` alongside the rest of the trips
domain — they read/write "which trip is active," not planned-leg state. They
ended up in `plannedLegs.ts` because that's where they sat in the original
`db.ts` (adjacent to planned-leg code, not because of a real dependency).
Moving them is a small, mechanical relocation but touches the domain-module
boundary the reviewers checked (no cross-imports between `db/*.ts` files), so
it deserves its own reviewed task rather than a driveby edit.

## 2. The `db/flights.ts` ↔ `db/trips.ts` require cycle is patched, not resolved

**Where:** `src/db/flights.ts` (near the top, `import { clearPlannedLegLink }
from '../db'`) and `src/db/trips.ts` (`import { clearPlannedLegLink,
getPlannedLegsForTrip } from '../db'`).

Both import from the `db.ts` barrel instead of `./plannedLegs` directly, to
avoid a direct domain-module cross-import. This creates a real require cycle
(`db.ts` → `db/flights.ts` → `db.ts` → `db/plannedLegs.ts`) laundered through
the barrel. It's proven safe under CommonJS (the calls are inside function
bodies, never at module load — both phase-1 and final review verified this
empirically, including worst-case load ordering), and it's commented in place
in both files. But it's a workaround, not a real fix: a future change that
moves one of these calls to module scope would break silently. A real
resolution (e.g. a small shared interface, or accepting the direct
`./plannedLegs` import and updating the "no cross-imports" rule to allow it
in this one documented direction) is worth doing once, deliberately.

## 3. `src/geo.ts` is dead code; `haversineNm`/`bearingDeg` are triplicated

**Where:** private copies in `src/db/flights.ts`, `src/airports.ts`, and
`src/flightManager.ts`. `src/geo.ts` exists but nothing imports it.

Pre-existing before this run — the split preserved it faithfully (each copy
moved verbatim with its owning function, per the "modules own functions, not
tables" rule) rather than consolidating, since consolidating would have meant
touching numerically-sensitive code with no behavioral need to. Worth
resolving once, with real distance/bearing regression fixtures backing the
consolidation, not as a byproduct of a structural refactor.

## 4. Two behaviors were verified structurally, not by execution

- **SimBrief import's network-failure branch** (`src/routes/plannedLegs.ts`,
  the `POST /api/trips/:id/planned-legs/simbrief` handler): the
  `SIMBRIEF_FAILURE_STATUS` table and the `SimbriefParseError` → 502 branch
  moved verbatim and were diffed byte-for-byte against the pre-refactor code,
  but no task in this run stood up a SimBrief stub to actually exercise a
  failed fetch, a timeout, or a parse error post-move.
- **PDF export under real network/render conditions**: verified as a verbatim
  move and confirmed to produce byte-identical page counts and headers in the
  differential curl tests, but the puppeteer render path's failure modes
  (crashed render, timeout) weren't separately exercised post-move.

Both are low-risk (pure code motion, not rewrites, and the surrounding logic
is unit-tested), but a future change to either area should treat "moved,
never executed" as the starting coverage, not "fully verified."

## 5. Import style is inconsistent across the new routers

**Where:** `src/routes/settings.ts` and `src/routes/exports.ts` import DB
functions from the `../db` barrel; `src/routes/flights.ts`, `trips.ts`, and
`plannedLegs.ts` import from the concrete `../db/<module>` files. Cosmetic —
no behavioral difference — but worth picking one convention (concrete-module
imports match the spirit of the split better) in a follow-up pass.

## 6. Unit coverage gaps (tracked in `CLAUDE.md`, now pointing at the right files)

`src/trafficStore.ts`, `src/db/` (the whole split, not just the old
`src/db.ts`), and `src/ingest.ts` still have no Vitest coverage. `CLAUDE.md`
was updated in this run to say `src/db/` instead of the now-stale `src/db.ts`.
Still a real gap, not newly introduced — good next candidate per the existing
note in `CLAUDE.md`.
