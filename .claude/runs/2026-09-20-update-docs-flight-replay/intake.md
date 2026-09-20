# Intake — docs refresh for flight replay (2026-09-20-update-docs-flight-replay)

Path: `/update-docs` **targeted refresh** (docs/ exists). Orchestrator writes the
pages; Reviewer gates. No Planner/Designer (no contract introduced).
Routing decision recorded per skill: Orchestrator stands in as implementer.

## Goal
Bring docs in sync with the flight replay feature merged to main (cf5c60b,
feature commit 6558286): user-facing replay in usage.md, client structure in
architecture.md.

## Working tree
Fresh clone of main per the clone-only rule (agents.md § Rules); only the
run artifacts under .claude/runs/ are written to the live repo.

## Out of scope
- The Playwright replay spec (5ccb03e) is committed on the run branch of
  2026-09-19-flight-replay but NOT yet in main — development.md's e2e list is
  not updated until it lands.
- Stale `user_stories/` references (dir was renamed to specs/ in 5eb3571) if any
  are found: fixed only if inside a page this refresh touches.

## Note found while writing
The Replay button in FlightDetail.tsx is gated only on `points.length >= 2`,
not on `end_time`, so it also appears for an in-progress flight (design and
2026-09-19 intake assumed completed-only). Docs describe the real behaviour;
flagged to the user as a code/design divergence, not fixed here (docs run).
