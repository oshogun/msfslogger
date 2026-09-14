# Phase 1 gate — DB layer split (T-001, T-002, T-003)

**Verdict: approve.** No blocking findings.

Reports were not used as evidence. Every claim below was re-run. 23 acceptance
criteria across the three tasks: **21 reproduced independently, 2 could not be
satisfied as written** (both are environment artefacts, detailed under
Findings — neither indicates a defect).

Live DB integrity: `md5sum flights.db` moved `d6d5896b…` → `9331bb79…` **during
this review**, with zero writes from me. Cause is the user's own server
(`pid 626442`, `node dist/index.js`, started 00:11:20, holds the file in WAL
mode). Positive proof no task or review artefact reached it is under Findings 2.

---

## Per-task verdicts

| Task | Verdict | Criteria reproduced |
|---|---|---|
| T-001 route-table inspector + baselines | approve | 5/5 (1 with a documented command amendment) |
| T-002 connection/schema/flights/trips | approve | 8/9 (md5 criterion unsatisfiable) |
| T-003 plannedLegs/settings + barrel | approve | 8/9 (md5 criterion unsatisfiable) |

## Criteria verified

**Structure.** `wc -l src/db.ts` → `11` (limit 40). `grep -c 'prepare(' src/db.ts`
→ `0`. All six modules present: `connection.ts` (43), `schema.ts` (298),
`flights.ts` (270), `trips.ts` (173), `plannedLegs.ts` (669), `settings.ts` (110).

**No domain cross-imports.** `grep -n "from './flights'|'./trips'|'./plannedLegs'|'./settings'" src/db/*.ts`
→ only `connection.ts:9: import { applySchema } from './schema'`.

**No handle or statement captured at load.** `grep -n "^[^ \t].*getDb()" src/db/*.ts`
→ only `connection.ts:41`, the definition. `grep "^const .*getDb()\|^const .*\.prepare("`
→ empty. Every `getDb()` call site is inside a function body.

**Export surface.** `tsc --outDir <scratch>` then
`diff baselines/db-exports.before.txt <(node -e "Object.keys(require(...db)).sort()")`
→ empty, 51 names both sides. Error classes are values:
`PlannedLegAlreadyLinkedError function`, `…HandCloseConflictError function`,
`…HasLinkedFlightError function`.

**It is a move, not a rewrite.** Two independent checks.
1. Per-function, against `git show HEAD:src/db.ts`, normalising only `db.` → `getDb().`:
   `combineFlights` (122 lines), `deleteTrip` (25), `createPlannedLeg` (74),
   `getOrCreateAppSecret` (10), plus `deleteFlight`, `insertFlight`, `closeFlight`,
   `createTrip`, `assignFlightToTrip`, `getPlannedLegsForTrip`, `reorderPlannedLegs`,
   `linkFlightToPlannedLeg`, `clearPlannedLegLink`, `setPlannedLegHandOutcome`,
   `recordPlannedLegArrival`, `deletePlannedLeg`,
   `getPlannedLegCandidatesForActiveTrip`, `sessionSweep`, `setAuthUser`,
   `getSetting`, `sessionSet` — **all 21 byte-identical**, same line counts.
2. Whole-file multiset diff of every non-comment, non-import code line in
   `HEAD:src/db.ts` vs. the concatenation of all six new modules. Residue is
   **6 lines total**: two `import`-continuation lines (`} from './types'` →
   `} from '../types'`, and the split type-import list), and the three lines of
   the new `applySchema` wrapper (`export function applySchema(db: …): void {`,
   `applySchema(db);`, `}`). Nothing else moved, reordered or changed.

**Differential behaviour vs. a pristine `HEAD` tree** (`git archive HEAD` into
scratch, compiled separately; identical `flights.db` copies per run, cwd in scratch):
- `combineFlights(80, 81)` on real data — result flight row + all
  **3223** points (`ts, lat, lon, altitude_ft, heading_deg, airspeed_kts,
  ground_speed_kts, vertical_speed_fpm, on_ground`), including the interpolated
  fillers: `diff` **empty**, 3226 lines each side.
- Planned-leg + settings lifecycle from two real `samples/lnmpln` fixtures:
  create ×2, `getPlannedLegsForTrip`, `findPlannedLegBySource`,
  `reorderPlannedLegs`, `linkFlightToPlannedLeg`, `setActiveTrip`,
  `getPlannedLegCandidatesForActiveTrip`, `recordPlannedLegArrival`, unlink,
  delete, `deleteTrip`, plus `getOrCreateAppSecret`/`getSetting`/session
  set-get-destroy-sweep: `diff` **empty**.
  Both error classes thrown with the original class name, message and payload,
  and `e instanceof db.PlannedLegAlreadyLinkedError` → `true` through the barrel
  (`PlannedLegHandCloseConflictError` likewise).
- Flight/trip CRUD: `insertFlight`, `insertPoint` ×3, `getFlightPointCount`,
  `closeFlight`, `updateFlight`, `setFlightPlanName`/`clearFlightPlanName`,
  `assignFlightToTrip`, `getTripName`, `updateTrip`, `removeFlightFromTrip`,
  `deleteFlight`, `deleteTrip`: `diff` **empty**, row-count delta back to `0 0`.

**Failure paths** (all identical to `HEAD`): `getFlightById/getTripById/
getPlannedLegById(999999)` → `null`; `combineFlights(999998, 999999)` → `null`;
`deleteTrip/updateFlight/updateTrip/removeFlightFromTrip/setPlannedLegStatus(999999)`
→ `false`; `getFlightPointCount(999999)` → `0`; `getSetting/sessionGet` on a
missing key → `null`.

**Route table.** Inspector re-run twice from a scratch cwd:
`diff run1 run2` empty (deterministic); `diff baselines/routes.before.txt run1`
**empty**, 42 lines each — `server.ts` is untouched and the contract baseline
still describes the live app.

**Build and test.** `npx tsc --noEmit` exit 0, no output. `npm test` →
`Test Files 17 passed (17) / Tests 327 passed (327)`. `npm run test:types` exit 0,
no output. Base tree compiles clean too, so the comparison is like-for-like.

**Scope.** `git diff --stat HEAD -- src tests package.json package-lock.json client`
→ `src/db.ts | 1550 +---…, 1 file changed, 10 insertions(+), 1540 deletions(-)`.
`git status --porcelain` in code paths → `M src/db.ts`, `?? src/db/`,
`?? src/inspect-routes.ts` — all three inside T-001/T-002/T-003 `allowed_paths`.
`src/flightManager.ts`, `src/server.ts`, `package.json`, `package-lock.json` and
`client/**` are byte-unchanged. No dependency added.

**Comment hygiene.** `grep -rniE "\.claude/runs|run-id|design\.md|plan\.json|T-0[0-9][0-9]|Amendment|phase[- ]?[0-9]|reviews/|§"`
over `src/db.ts`, `src/db/`, `src/inspect-routes.ts` → no matches. No stray
`TODO`/`console.log`/`debugger`. Section banners match the house
`// ── Name ──` style.

---

## Findings

**1. The deliberate require cycle is safe — verified, not assumed.** (non-blocking)

`src/db/flights.ts:3` and `src/db/trips.ts:2` import `clearPlannedLegLink` /
`getPlannedLegsForTrip` from `'../db'`, the barrel that re-exports them. Emit is
`const db_1 = require("../db")` at module scope with every use as
`(0, db_1.clearPlannedLegLink)(…)` — a lazy property read inside a function body,
never at load time. I also entered the cycle from the leaf, the worst ordering:

    node -e "require('<dist>/db/flights'); const b = require('<dist>/db');
             console.log(typeof b.combineFlights, typeof b.clearPlannedLegLink)"
    → function function ;  b.initDb(); f.deleteFlight(999999) → false

The barrel is fully populated even then, because `__exportStar`/`__createBinding`
install live getters over TypeScript's hoisted `exports.x = void 0` names. Nothing
in `src/` or `client/src/` imports a `db/` subpath directly (`grep` for
`from './db/`, `from '../db/'` → only `src/db.ts`'s five re-export lines), so the
production entry is always the barrel anyway.

Follow-up, not a blocker: the edge `trips → plannedLegs` still exists, laundered
through the barrel, so the "no cross-imports" rule passes as a grep but not as a
dependency statement. And a reader at `src/db/trips.ts:2` has no way to tell why
it is not `from './plannedLegs'`. Worth a one-line comment (no run citation) and
worth resolving properly in phase 2/3.

**2. `md5sum flights.db` before == after is unsatisfiable while the server runs.**
(non-blocking; T-002 AC 8, T-003 AC 9)

Sequence observed by me: `d6d5896b…` (02:24) → `9331bb79…` (02:30) → `9331bb79…`
(02:34). I ran no write against it. So T-003's report of `581e2e96… → d6d5896b…`
is credible, and its attribution to the user's server checkpointing is correct.
The check that actually means something is that no task artefact reached the live
file, and it passes (read-only query):

    flights with aircraft like 'REV%'  → []          trips like 'rev-%' → []
    flight id 84 (my scratch combine result) → []    max(flights.id) = 83
    max(planned_legs.id) = 29  (my scratch runs created 30, 31)
    flights 80, 81 intact: point_count 2183 / 1032   (combineFlights deletes both)

Mechanically this cannot happen from these tasks: `src/db/connection.ts:11` sets
`DB_PATH = path.join(process.cwd(), 'flights.db')`, and every write script ran
with cwd in a scratch dir. Suggest restating the criterion for phase 2 as "no
task artefact appears in the live db", which is checkable.

**3. `T-001`'s inspector command needed amending to run.** (non-blocking, already
disclosed in that report's risks) A bare `mktemp -d` cwd cannot resolve
`ts-node/register` or find `tsconfig.json`. I reproduced the criterion with
`NODE_PATH`, `TS_NODE_PROJECT` and `TS_NODE_FILES=true` added; cwd stayed in the
scratch dir, so the property the criterion cares about (`DB_PATH` resolves to the
copy) held — `md5sum flights.db` was unchanged across the inspector run.

---

## Non-blocking follow-ups

1. Comment the barrel-routed import at `src/db/trips.ts:2` and
   `src/db/flights.ts:3`, and consider collapsing the cycle in a later phase.
2. `T-002.md` and `T-003.md` have no risks section. Both had real risks — the
   cycle and the md5 change — which reached me only via the Orchestrator's
   envelope. Ask for the section in phase 2.
3. The repo's `dist/` was rebuilt at 02:05 by T-003 and now holds uncommitted
   refactor output. The running server loaded the old `dist/` at 00:11 and is
   unaffected, and the tree is shippable (tsc clean, 327 tests green,
   differentially identical), so this is within `ENVIRONMENT.md`'s allowance —
   but the user's next restart runs unmerged code. Worth flagging at ship time.
4. `sessionSweep()` leaves an expired row readable by `sessionGet` in *both*
   trees. Pre-existing, identical before and after; noted only so phase 3 does
   not mistake it for refactor fallout.

## Teardown

No server started (no port bound by me). Scratch trees, DB copies and the
`git archive` base tree lived under the session scratchpad and are removed; no
`git worktree` was created, so `.git` is unmodified. Repo `dist/` untouched by
this review (mtime 02:05, predates it) — all review builds used `--outDir` into
scratch. Live `flights.db` never opened for write: `9331bb79caac73ecc5bdeccfb44a5906`
at close.
