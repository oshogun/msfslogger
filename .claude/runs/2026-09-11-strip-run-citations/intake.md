# intake.md — run 2026-09-11-strip-run-citations

## Goal, as the user gave it (verbatim)

> Remove any comments referencing AI runs, and add a rule if necessary so future
> agents don't reference temporary development steps

## Restated

Source comments across `src/`, `client/src/` and `agent/` cite
`.claude/runs/<run-id>/design.md` by run-id, `§`-numbered section, or
"Amendment" label (e.g. `// design.md §6.2`, `// Amendment C`, `// Run
2026-09-07-manual-mark-flown, design.md §1`). These files are workflow-internal
— durable per `.claude/runs/README.md`, but not something a reader of `src/`
knows exists or how to open (`ctx.sh`, not `cat`). A citation like this makes a
comment depend on a document the reader may never find, per the Orchestrator's
own observation on `.claude/runs/2026-09-10-security-hardening/design.md`
earlier in this conversation.

Two deliverables:

1. Strip every such citation from application source comments, keeping any
   substantive rationale the comment carries (the *why*), rewritten to stand on
   its own without the external pointer.
2. Add a rule to the agent role docs so future Dispatchers/Designers do not
   reintroduce this pattern.

## Scope check — grep baseline

```
grep -rnE "design\.md|design §|§[0-9]|Amendment|[Rr]un 202[0-9]-[0-9]{2}-[0-9]{2}" src/ client/src/ agent/
```
479 matches across 43 files (counted before this run started). Zero expected
after.

## Tier

**Tier 2** — one seam (comment hygiene), no new contract, no schema/API
change, nothing the user sees functionally. Per `.claude/agents.md` § Cost
discipline rule 6: `intake.md` only, no `plan.json`, no `design.md`.

- **Design step: skipped.** No contract introduced.
- **DevOps: skipped.** No build/packaging/deploy touched.
- **Plan step: skipped** (tier 2 exemption). The Orchestrator decomposed the
  sweep directly into 5 Dispatcher tasks below, grouped by disjoint
  `allowed_paths` so they can run in parallel (`.claude/agents.md` § Cost
  discipline rule 2).

## Policy given to every Dispatcher (verbatim in each envelope)

- Remove: `.claude/runs/` paths, `design.md`, `§`-numbered sections, the
  "Amendment" label, and literal run-id folder names
  (`YYYY-MM-DD-short-slug`), wherever they appear in a comment.
- A comment that is *only* a citation (adds nothing beyond pointing at the
  doc) — delete the line.
- A comment that mixes real rationale with a citation — keep the rationale,
  drop only the citation, reword minimally so it still reads as a complete
  sentence.
- Do not touch code, only comments. No behaviour change.
- Verify after: the grep above returns zero matches in the assigned files,
  and `npx tsc` / `npm run build` passes clean.

## Task breakdown (5 Dispatchers, disjoint `allowed_paths`, run in parallel)

| # | allowed_paths | Files | Match count |
|---|---|---|---|
| D1 | `src/db.ts`, `src/server.ts`, `src/config.ts`, `src/index.ts`, `src/pdfExport.ts`, `src/journey.ts` | server core | 128 |
| D2 | `src/inspect-manual-mark.ts`, `src/inspect-traffic.ts`, `src/inspect-legmatch.ts`, `src/inspect-kml.ts`, `src/kmlExport.ts`, `src/lnmpln.ts` | inspectors + KML/route parsing | 120 |
| D3 | `src/ingest.ts`, `src/flightManager.ts`, `src/plannedLegClose.ts`, `src/legMatcher.ts`, `src/trafficStore.ts`, `src/geo.ts`, `src/types.ts`, `src/auth/**`, `src/setPassword.ts` | domain logic + auth | 114 |
| D4 | `client/src/**` | client | 90 |
| D5 | `agent/**` | agent | 27 |

## Scope expansion, discovered after D1–D5 reported done

Two gaps, found by a full-repo sweep after the first 5 Dispatchers finished:

1. **`tests/` was never in the original file list.** 14 files, high citation
   density (test titles and file headers cite `design.md §N` directly).
2. **A second citation species slipped past the first grep pattern**: `T-NNN`
   task-ID references, `plan.json` mentions, `phase3.md`/`reviews/phase-N.md`
   citations — the same problem (a pointer into a workflow-internal document)
   in a different shape. Several D1–D4 dispatchers flagged leftover instances
   of exactly this in their `risks` list.

Broader grep, used from here on:
```
grep -rnE "\.claude/runs|design\.md|design §|§[0-9]|Amendment|[Rr]un 202[0-9]-[0-9]{2}-[0-9]{2}|plan\.json|\bT-[0-9]{3}\b|phase[0-9-]*\.md|reviews/|ctx\.sh" <paths>
```

Three more Dispatchers, disjoint paths, run in parallel:

| # | allowed_paths | Notes |
|---|---|---|
| D6 | `tests/flightManager.duration.test.ts`, `tests/flightManager.test.ts`, `tests/flightManager.state.test.ts`, `tests/legMatcher.test.ts`, `tests/helpers.test.ts`, `tests/helpers/index.ts` | tests/, group 1 (flightManager/legMatcher domain) |
| D7 | `tests/kmlExport.test.ts`, `tests/lnmpln.test.ts`, `tests/plannedLegClose.test.ts`, `tests/loginThrottle.test.ts`, `tests/airports.test.ts`, `tests/password.test.ts`, `tests/config.test.ts`, `tests/flightPlans.test.ts` | tests/, group 2 |
| D8 | `src/inspect-legmatch.ts`, `src/auth/routes.ts`, `src/inspect-kml.ts`, `src/inspect-manual-mark.ts`, `src/lnmpln.ts`, `src/legMatcher.ts`, `src/types.ts`, `src/db.ts`, `src/auth/middleware.ts`, `client/src/index.css`, `client/src/utils/geo.ts`, `client/src/pages/TripDetail.tsx` | fixup pass on the second citation species in files D1–D4 already swept once |

## Review

One Reviewer pass over the combined diff of all 8 Dispatchers, since this is a
single seam split only for parallelism/context-budget, not eight separate
phases. Checks: broader grep is clean repo-wide, `tsc`/`npm test`/`npm run
build` clean, no code-token changes (comments only), and spot checks that
stripped/reworded comments still make sense in place.

## Rule addition (tier 1, done directly by the Orchestrator, no Dispatcher)

Added to `.claude/agents/dispatcher.md`, `.claude/agents/designer.md`,
`.claude/agents/reviewer.md` — see conversation / commit for the exact wording.
