# Intake — Document the MCP server feature

## Goal

The MCP server feature (run `.claude/runs/2026-09-18-mcp-server/`) is fully
implemented and reviewer-approved across all 3 phases (phase-1 approve,
phase-2 approve on round 2, T-010 approve) but sits uncommitted and
undocumented. Bring `docs/` up to date with it via a targeted refresh, per
`/update-docs`.

## Path taken: targeted refresh

`docs/` already exists (13 pages + README). Comparing the docs' last commit
against the last commit touching `src`/`client/src`/`agent` showed no drift
for **committed** history (`c2fe94c` docs refresh is newer than `5953e6d`,
the latest source commit) — the only gap is this uncommitted, unrelated
feature. No research agents spawned: the mcp-server run's own `design.md`
(65KB, frozen and independently re-verified across 3 review rounds) is
higher-confidence ground truth than a fresh Explore pass, so facts are
pulled from there (via `ctx.sh design`) and spot-checked directly against
`git diff`/source where a claim is auth- or contract-relevant.

## Pages in scope and why

- **docs/configuration.md** — new `MCP_TOKEN` env var; Docker Compose
  passthrough now includes it.
- **docs/api.md** — two new routes (`GET /api/flights/stats`,
  `GET /api/flights/search`); new "MCP server" section for the `/mcp`
  endpoint and its 18-tool inventory; auth-model table gains a third
  mechanism; consumers-beyond-the-web-UI section gains MCP clients.
- **docs/security.md** — `MCP_TOKEN` as a third, independent auth mechanism;
  secrets table entry.
- **docs/architecture.md** — external integration points table gains the
  MCP client row.
- **docs/development.md** — repo-layout tree gains `src/mcp/`.
- **docs/glossary.md** — one new term (MCP).

## Pages explicitly out of scope, and why

- **README.md** — mirrors the precedent already set for SayIntentions (an
  optional, default-off integration): not mentioned in the quickstart,
  documented in `docs/` only. MCP is opt-in (unset `MCP_TOKEN` = not
  mounted), so it doesn't belong in the minimal getting-started path.
- **docs/data-model.md** — design §8 is explicit: no schema change, no
  migration, no DDL. Nothing to update.
- **docs/setup.md, docs/usage.md, docs/troubleshooting.md, docs/release.md,
  docs/index.md** — no claim in any of these currently contradicts the new
  feature, and the page set doesn't need a new entry (no new page added).
- **docs/operations.md § Deploy ordering** — considered a `MCP_TOKEN`
  rotation note mirroring "Deploy ordering," but design §2.5/§8 states
  revocation is simply "unset the variable and restart," with no ordering
  dependency on another component (unlike `INGEST_TOKEN`, which the agent
  must also be updated for) — nothing non-obvious to add.

**Amendment (found by Reviewer, round 1):** `docs/operations.md § Docker`
*was* in scope after all — its passthrough-list sentence is a twin
enumeration of `docs/configuration.md`'s Docker Compose list, and read as
exhaustive without `MCP_TOKEN`, implying the container couldn't run MCP at
all. Added `MCP_TOKEN` to that sentence. The rotation-note reasoning above
was correct as far as it went; it just didn't check for a second, duplicate
enumeration of the same list elsewhere in the page.

## Verification plan

Self-verify (link check, `tsc --noEmit`/`test:types`/`npm test` under
whatever Node this checkout currently loads — see the live Node 24 cutover
in progress in the parent conversation) before Reviewer. Reviewer briefed
per the skill's own incident history: auth/permission claims (the
`MCP_SCOPED_ROUTES` table, the auth-model table, the "independent from
`INGEST_TOKEN`" claim) are the highest-risk category and get checked first,
against source directly, not against this intake or the mcp-server run's
own review reports.

## Outcome

**Verdict: approve** (round 2, after one blocking fix).

Round 1 (`request_changes`): 34/34 spot-checked claims verified accurate
against live source (auth mount order, `MCP_TOKEN`/`INGEST_TOKEN`
independence, the 18-tool inventory and read/write split, the two new
routes' registration order and query contracts, all cross-page anchors).
One blocking finding: `docs/operations.md § Docker`'s passthrough-list
sentence is a duplicate enumeration of `configuration.md`'s Docker Compose
list and, left un-updated, implied `MCP_TOKEN` couldn't reach the
container. Fixed by adding `MCP_TOKEN` to that sentence, in the same
position/order as `docker-compose.yml`'s own list.

Round 2: fix re-verified line-for-line against `docker-compose.yml`; no
other content changed; full 14-page link/anchor check re-run, 0 broken.

Non-blocking follow-ups, not acted on:
- **F1 (commit hygiene)** — the working tree also carries an unrelated,
  in-progress Node 20→24 runtime upgrade (`README.md`, `docs/setup.md`,
  `docs/usage.md`, `docs/troubleshooting.md`, one line of
  `docs/development.md`). Stage this run's MCP-docs changes selectively
  rather than `git add docs/ README.md` wholesale, or commit the Node 24
  docs separately first.
- **F2** — `docs/api.md`'s `get_weather` row says it "calls the same cache
  ... before it writes anything"; true, but a cache miss does perform an
  outbound network call. Minor wording gap, not a factual error.
- **F3** — `docs/architecture.md`'s ordered middleware list omits
  `express.json()`'s mount point; pre-existing, not introduced by this run.
- **F4** — one line in `docs/operations.md`'s Docker paragraph now runs
  slightly longer than the page's usual wrap width; cosmetic.

Not committed, per this skill's own instruction — see the report to the
user.
