# Intake — docs targeted refresh (2026-09-18)

Run id: 2026-09-18-update-docs
Orchestrator: Claude (msfslogger session)
Source: user request ("run the update-docs skill"), following two shipped
features since `docs/` was last updated.

## Goal

Bring `docs/` back in sync with the codebase. `docs/` already exists
(`docs/index.md` present, built by `2026-09-17-docs-overhaul`) — this is a
**targeted refresh**, not a full rebuild, per the skill's own scope
decision.

## What changed since docs were last touched

`git log -1 --format=%H -- docs README.md` → `8418ff3`. Two commits touched
`src`/`client/src`/`agent` since then:

- `a91e407` — frontend component tests (Vitest+RTL, `client/src/pages/*.test.tsx`)
  and Playwright e2e (`client/e2e/specs/*.spec.ts`), a deterministic seed CLI
  (`src/testSeed.ts`), a scratch-server provisioning script
  (`client/e2e/scratch-server.sh`), and CI wired to run both suites.
- `43953a1` — optional SayIntentions.AI integration: pull (link a flight to
  a SayIntentions session, import its ATC/CPDLC transcript into the
  existing ACARS thread) and push (condense an on-file PDC to fit
  SayIntentions' 128-char cap, send as a real CPDLC message), plus a
  widened ingest-token allow-list (13 → 19 entries) so the MCDU client can
  drive the feature. Full history in
  `.claude/runs/2026-09-17-sayintentions-integration/`.

## Pages affected

Determined by reading the actual diffs/source, not by guessing from commit
titles:

| Page | Why |
|---|---|
| `docs/api.md` | 7 new routes (`GET`/`PUT /api/settings/sayintentions`, `GET`/`POST`/`DELETE /api/flights/:id/sayintentions/link`, `POST /api/flights/:id/sayintentions/import`, `POST /api/planned-legs/:legId/sayintentions/clearance`); ingest-scope allow-list count changed 13 → 19 |
| `docs/data-model.md` | New `sayintentions_links` table; `acars_messages.category` open-set gains `'atc'`; new `src/db/sayIntentionsLinks.ts` CRUD module |
| `docs/architecture.md` | New external integration (SayIntentions.AI SAPI), new outbound HTTP client (`src/sayIntentionsClient.ts`) |
| `docs/configuration.md` | New `SAYINTENTIONS_API_BASE_URL` test/dev seam, same pattern as the existing SimBrief/weather ones |
| `docs/security.md` | New credential type (SayIntentions API key — masked-only, never returned raw) added to the Secrets table |
| `docs/usage.md` | ACARS section gains the two new optional actions |
| `docs/glossary.md` | New term: SayIntentions.AI |
| `docs/development.md` | Testing strategy section is stale — doesn't mention component tests, Playwright e2e, or the seed CLI at all; CI section doesn't mention the e2e job |

Not touched: `docs/setup.md`, `docs/operations.md`, `docs/troubleshooting.md`,
`docs/release.md`, `README.md` — nothing in either commit changes bootstrap
steps, production operation, or the release process. `docs/index.md`'s table
descriptions still hold at the page-summary level (no page's *topic* changed,
only their content).

## Routing decision (per the skill)

No implementer role owns `docs/**`/`README.md` (`backend_*` own
`src/**`/`tests/**`/`agent/**`, `frontend_*` own `client/**`), and neither
change introduces a schema/API *contract* from the docs' own perspective (the
contracts already shipped, reviewed, in the source commits) — so this
doesn't route through Design or the standard Implement step. Per the skill:
Orchestrator researches and writes every page directly (one voice across the
set), then an independent Reviewer pass gates it before anything is called
done. No Planner, no Designer — the same reasoning the skill itself gives.

Research: read directly (both commits are either self-built this session
with full first-hand knowledge, or have their own complete run record
`.claude/runs/2026-09-17-frontend-integration-tests/` to cross-check
against) plus live `grep`/`Read` against current source for every fact that
lands in a page — no Explore agents spawned; the change set is well-bounded
and already well understood, matching the skill's guidance to reserve
research agents for genuinely broad/unfamiliar territory.

## Success criteria

- Every affected page reflects current behavior, verified against source
  directly (not against memory of building the feature).
- No broken internal links.
- `npx tsc --noEmit`, `npm run test:types`, `npm test` all still pass (no
  code changed by this run, but the skill's self-verify step requires
  confirming this regardless).
- Every auth/permission claim (the highest-risk category per the skill's own
  incident record) checked against the actual gating logic
  (`src/auth/ingestScope.ts`), not against a route file's comment.
- Reviewer approves with a docs-accuracy brief, not a code-correctness one.
- Stop short of committing — report to the user and let them decide.

## Outcome

**Round 1: `request_changes`.** 19 claim-groups checked against source
independently; 16 correct, 3 wrong (`reviews/docs-refresh.md`):

- B1 (`api.md`): "every route here requires a saved key" was false for the
  link-status `GET` and `DELETE`, which have no key check — self-contradicted
  the page's own table row.
- B2 (`api.md`): "all six are allow-listed" introduced a 5-row table.
- B3 (`development.md`): "each with a `*.test.tsx` beside it" was false for
  4 of 11 page components (`Device`, `Override`, `PrintFlight`, `PrintTrip`).

All priority-1 auth claims (the category that broke the first run of this
skill) were correct on the first pass: the 19-entry allow-list count, all 6
new routes' auth columns against the real `isIngestScopedRoute` matcher, and
`PUT /api/settings/sayintentions`'s absence from the list. Also fixed while
responding: a CI artifact-upload condition ("always" → the actual
`if: !cancelled()`), and a `usage.md` overstatement about how much of the UI
still renders with no key set.

**Round 2: `approve`.** All three fixes and both nits re-verified against
source independently; nothing else in the diff had moved.

**Residual, non-blocking, left open:**

- `docs/architecture.md`'s component-map ASCII box is ragged by 1-2 columns.
  Confirmed pre-existing (byte-identical to `HEAD`'s columns), not introduced
  by this run — worth a cleanup pass someday, not urgent.
- The working tree carries unrelated uncommitted changes to
  `client/src/index.css` and `client/src/pages/Home.tsx` (a collapsible
  ground-section feature, unrelated to this run or to docs). Not touched by
  this run; flagged so a future commit of this run's docs work stays
  path-scoped to `docs/` and doesn't sweep those in.

Not committed — per the skill, that's the user's call.
