# Intake — 2026-09-17-docs-overhaul

## Source

`user_stories/update.docs.md` — "Repository Documentation Overhaul" spec.

## Goal

Restated: the current docs are split between a short `README.md` and an
external GitHub wiki (`oshogun/msfslogger/wiki`) that isn't in this
repository and can't be audited or kept in sync from here. Replace that with
a comprehensive, in-repo `docs/` tree that describes the system as it
actually behaves today, and cut `README.md` down to a quickstart that links
into `docs/`.

## Success criteria (from the spec's Acceptance Criteria, §7, verbatim)

1. `README.md` is concise and contains only essential onboarding content and
   links to `docs/`.
2. `docs/index.md` exists and links to all documentation pages.
3. Documentation set covers architecture, setup, configuration, usage,
   development, and troubleshooting at minimum.
4. All commands and examples were verified against the current repository
   behavior.
5. All internal Markdown links resolve correctly.
6. A new contributor can set up and run the system using only `README.md` +
   `docs/setup.md`.

## Scope decisions frozen for this run

- Required `docs/` files per spec §3.2: `index.md`, `architecture.md`,
  `setup.md`, `configuration.md`, `usage.md`, `api.md`, `data-model.md`,
  `operations.md`, `troubleshooting.md`, `development.md`, `release.md`,
  `security.md`, `glossary.md`. None of the "if applicable" files are being
  omitted — this project has endpoints (api.md), a schema (data-model.md),
  and a running service (operations.md), so all three apply. `release.md`
  applies narrowly (no version/release process beyond git tags in this repo)
  and will say so rather than being omitted.
- The Tauri/MCDU desktop client lives in a separate repo
  (`oshogun/msfslogger_mcdu`) per `CLAUDE.md` — docs mention it as an
  integration point (it uses the ingest/status API) but do not document its
  internals.
- `agent/README.md` (the Windows SimConnect agent's own README) stays the
  source of truth for agent operational detail; `docs/` summarizes it and
  links out rather than forking a second copy that can drift.
- The `.claude/` agentic workflow itself, `AGENTS.md`, and `user_stories/`
  are process/meta files, not system documentation — out of scope for
  `docs/development.md`, which covers the human dev workflow (branching,
  testing, repo layout) instead.

## Workflow tier and routing decision

This is documentation-only work spanning many files
(`docs/*.md`, `README.md`), which is "several files ... something the user
sees" per `.claude/agents.md`'s tier table — but none of the specialized
implementer roles apply: `backend_jr/sr` own `src/**`/`tests/**`/`agent/**`
and `frontend_jr/sr` own `client/**`; neither role's `allowed_paths` cover
`docs/**` or `README.md`, and this run introduces no schema/API/type
contract, so Designer is skipped too. Planner is also skipped: the task list
is a fixed, enumerable set of files from the spec, not a fuzzy goal needing
decomposition.

Decision: Orchestrator performs the audit (via parallel read-only Explore
agents, to protect context) and writes the docs directly, then sends the
diff to **Reviewer** for an accuracy/consistency/broken-link pass before
calling the run done — matching the tier-2 shape (one effective
implementation pass + one Reviewer pass), with the Orchestrator standing in
as implementer since no implementer role owns this path. No `plan.json`, no
`design.md`.

## Non-negotiables carried from CLAUDE.md / ENVIRONMENT.md

- Read-only against the live server/`flights.db` throughout — this run only
  reads code to document it, never runs `npm run build`, restarts the
  server, or writes to `flights.db`.
- Node 20 via nvm for any verification command (e.g. `npm run test:types`
  if a docs command needs checking).

## Outcome

Done. `docs/` (13 files) written and `README.md` trimmed (156 → 147 lines
after review fixes). Verification: `npx tsc --noEmit`, `npm run test:types`,
`npm test` (850/850) all clean; own link checker 0 broken links; spot-checks
of `src/config.ts` and `src/db/schema.ts` against `configuration.md`/
`data-model.md` matched exactly.

Reviewer round 1: `request_changes` — one blocking finding (`docs/api.md`'s
Auth column over-marked 35 of 42 routes as accepting an ingest token when
only 13 exact routes are in `INGEST_SCOPED_ROUTES`) plus 5 non-blocking
findings (stale test-coverage claims in `development.md`, an incomplete log
prefix list in `usage.md`, a wrong anchor in `glossary.md`, and duplicated
Docker/backup command blocks in `README.md`). All fixed and re-verified
against source directly (not just by re-reading the doc).

Reviewer round 2: `approve`. Full findings and re-verification evidence in
`reviews/docs-overhaul.md`.

Residual risks (Reviewer's, carried forward, not blocking):
- `docs/api.md`'s route/auth table is hand-maintained against
  `src/auth/ingestScope.ts` with nothing enforcing they stay in sync — a
  future change to `INGEST_SCOPED_ROUTES` could silently make the doc wrong
  again. Worth a small test asserting the two agree, as a follow-up.
- `src/db/groundSessions.ts` has no dedicated test file (now honestly
  documented in `development.md` rather than fixed — out of scope for a
  docs run).

Not committed — this run's diff (`docs/`, `README.md`) is otherwise
unrelated to two pre-existing uncommitted files in the working tree
(`client/src/index.css`, `client/src/pages/Home.tsx`, dated 2026-09-16,
presumably in-progress user work); a commit here must not sweep those in.
