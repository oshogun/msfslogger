# Review — 2026-09-11-strip-run-citations (combined, D1-D8)

## Verdict: APPROVE

All 5 mechanical acceptance criteria verified independently by running the
commands myself (not from the dispatch report). Spot-checked ~17 files across
src/, client/src/, agent/, tests/ in depth for rationale preservation, scope,
and residual workflow narration. No blocking findings.

## Criteria verified

1. **Grep for citation patterns** — zero matches, verified myself:
   `grep -rnE "\.claude/runs|design\.md|design §|§[0-9]|Amendment|[Rr]un 202[0-9]-[0-9]{2}-[0-9]{2}|plan\.json|\bT-[0-9]{3}\b|phase[0-9-]*\.md|reviews/|ctx\.sh" src/ client/src/ agent/ tests/`
   → exit 1 (no match).

2. **`npx tsc --noEmit`** (Node 20.20.2) → clean, no output.

3. **`npm test`** → `Test Files 14 passed (14)`, `Tests 266 passed (266)` —
   exact match to the criterion's expected count.

4. **`npm run build`** → client `tsc && vite build` and server `tsc` both
   clean; `dist/assets/index-BwNIdROr.css`, `index-DSgS-Bj2.js` built, no
   errors.

5. **Diff is comments/titles-only** — checked programmatically: every `+`/`-`
   line in the full `src/client/src/agent/tests` diff is either a comment
   (`//`, `/*`, `*`, SQL `-- `), a `describe`/`it` title string, or a
   `note:`/`console.log`/`failures.push` diagnostic string. Confirmed by hand
   that `note` fields in `src/inspect-legmatch.ts`, `src/inspect-manual-mark.ts`
   and `tests/legMatcher.test.ts` are print-only (`if (s.note) console.log(...)`,
   never read for control flow) and that `GATE_TABLE`'s actual row data
   (`linkSource`/`ended`/`legStatus`/`expFlown`/`expPlanned`) is untouched —
   only the surrounding comments changed. `expect(...)` assertion values in
   `tests/kmlExport.test.ts` and `tests/plannedLegClose.test.ts` are byte-for-byte
   unchanged (`'fffaa560'`, `0.2`, `0.1`); only trailing `//` comments moved.
   `client/src/index.css` diff is the one CSS comment named in the criteria.

6. **Rationale preserved** — spot-checked and confirmed in `src/server.ts`,
   `src/config.ts`, `src/db.ts` (scrypt encoding comment: "frozen in §6.2" →
   "frozen, do not change" — invariant kept, pointer dropped),
   `src/inspect-manual-mark.ts` ("If a row here is ever found to disagree with
   the design's own table" → "...the frozen table it was transcribed from"),
   `agent/traffic.js`, `client/src/types.ts`. None of the ~17 files sampled
   went vague; every stripped citation left the actual engineering reason
   intact.

7. **No lingering workflow narration** — broadened the grep past the literal
   acceptance-criteria regex (`the task\b|this task\b|acceptance criteri|the
   orchestrator\b|dispatch(ed)? (report|task)`) — no hits beyond the
   already-fixed `tests/config.test.ts`. Found two uses of "frozen contract"
   (`src/legMatcher.ts:34`, `tests/helpers/index.ts:4`) but both are generic
   engineering usage — "the contract between the matcher, the FlightManager
   log, the API and the UI" and "defaults... are a frozen contract [for other
   test files]" — neither cites a workflow document, task, or role, so neither
   matches the pattern the criterion is checking for.

## Scope

All 58 changed files under `src/`, `client/src/`, `agent/`, `tests/` — inside
the run's stated scope. Note: `.claude/agents/{designer,dispatcher,reviewer}.md`
are also modified (22 insertions, 0 deletions, additive rule-8/bullet only,
consistent with the review checklist I was given) — per `intake.md` this is
"deliverable 2" of the run, done directly by the Orchestrator (tier-1
config/doc change, no Dispatcher), not part of the 8-Dispatcher comment sweep
this review's acceptance criteria target. Flagging for visibility, not as a
scope violation of the reviewed tasks.

## Database

Not touched — this is a comment-only change; no server started, no db copy
needed. `flights.db` md5 `1009e31d39bad41d6e4c3fd73daa02e3` (untracked in git,
confirmed not in `git status`).

## Non-blocking follow-ups

- `src/inspect-traffic.ts:685-689` and `client/src/types.ts:4` use "this run"
  to mean "this feature's development effort" — a pre-existing idiom in the
  codebase, not introduced by this cleanup and not matching the acceptance
  regex or the workflow-narration examples (no task/dispatch/reviewer/
  orchestrator reference), but arguably still process-flavored language. Not
  worth a fixup round; worth a glance if this pattern gets swept again later.
