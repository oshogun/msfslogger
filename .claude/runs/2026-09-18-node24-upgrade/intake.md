# Intake — Upgrade runtime baseline to Node.js 24 LTS

Source: `specs/node_upgrade.md` (user-provided spec, quoted verbatim where it
freezes a decision).

## Goal

Move the project's required/supported Node runtime from 20 to **Node.js 24
LTS**, removing whatever blocks that upgrade — chiefly the native
`better-sqlite3` dependency — while preserving all current DB behavior and
application behavior. Update tooling (`.nvmrc`, `package.json` engines), CI,
and docs to match.

## Frozen decisions (quoted from `specs/node_upgrade.md`)

- "Set **Node.js 24 LTS** as the supported and required runtime."
- "If `better-sqlite3` is replaced, a compatible alternative must be selected
  and integrated (examples include `sqlite3`, `node:sqlite` when stable and
  suitable, or another maintained option)."
- "`package.json` must declare Node 24 support via `engines`."
- Non-goals: "Major feature additions unrelated to runtime upgrade,"
  "Database schema redesign not required by migration," "Broad refactor
  beyond what is necessary to replace incompatible dependencies."
- Out of scope: "Multi-database support expansion," "Performance tuning
  unrelated to regression fixes."
- Acceptance bar: CI passes on Node 24 for build/lint/test; app runs
  end-to-end with no functional regressions in DB workflows; README/dev docs
  state the Node 24 requirement.

## Success criteria (this run)

1. `.nvmrc` and `package.json engines` require Node 24.
2. `better-sqlite3` either upgraded to a version with confirmed Node 24
   native-binary support, or replaced by a maintained alternative behind an
   adapter boundary — decision made on evidence (release notes / prebuilt
   binary matrix / a scratch install-and-load smoke test), not assumption.
3. All current DB call sites (`src/kmlExport.ts`, `src/backup.ts`,
   `src/db/connection.ts`, `src/db/schema.ts`, `src/auth/password.ts` — found
   via `grep -rl better-sqlite3 src/`) keep equivalent behavior.
4. `npm test`, `npm run test:types`, `npx tsc` / `npm run build` all pass
   under Node 24, verified in a **scratch clone**, never the live checkout
   (`ci.yml`'s `build-and-test` and client jobs reproduced locally).
5. `.github/workflows/ci.yml` runs on Node 24 (it already reads
   `node-version-file: .nvmrc`, so step 1 covers this, but the DevOps task
   confirms rather than assumes).
6. README / dev docs state the Node 24 requirement and any changed setup
   steps.

## Known standing constraint (`.claude/ENVIRONMENT.md`)

This machine's default `node` is v26 and the checkout is currently pinned to
Node 20 via `.nvmrc` specifically because `better-sqlite3` has no prebuilt
binary for the default node's ABI. `ENVIRONMENT.md` calls this "not a new
problem and not something to 'fix' by rebuilding or upgrading the
dependency" — that line describes the day-to-day workaround for driving
*this* machine, not a prohibition on this run's actual goal. It does mean the
Planner/implementers must verify Node 24 compatibility with evidence (a real
`npm install`/`require` smoke test under a Node-24 nvm alias in scratch)
rather than trusting the spec's optimistic framing, and every command in this
run still prefixes the correct `nvm use` for whichever Node version is under
test — never the machine default.

## Steps this run will take / skip

- **Intake** — this file.
- **Plan** — delegate to `planner`. Planner is asked to research
  `better-sqlite3` Node 24 support (release notes, prebuilt binary
  availability) and `node:sqlite` maturity as part of building the task
  list, and to flag explicitly whether the chosen path introduces a new
  contract (adapter interface) or is a same-contract version bump.
- **Design** — *contingent, not pre-decided*: required if the Planner's
  audit concludes `better-sqlite3` must be replaced (a new persistence
  adapter boundary is a shared-interface contract per
  `.claude/agents.md`). Skipped if the audit concludes an in-place
  `better-sqlite3` version upgrade is sufficient (no new contract, same
  call sites). This run does not skip Design silently — the Orchestrator
  will record which branch applied once the plan comes back.
- **Implement** — `backend_sr` (cross-cutting: touches 5+ modules and
  possibly a schema-adjacent library swap), scoped to `src/**`, `tests/**`.
  `agent/**` (the Windows SimConnect agent) is a separate Node process —
  checked for its own Node/`better-sqlite3` exposure during planning, not
  assumed out of scope.
- **Ship** — `devops`, since this run touches `.github/workflows/ci.yml`,
  `.nvmrc`, and `package.json engines`.
- **Docs** — per `CLAUDE.md`, README/docs updates beyond a one-line typo are
  routed through the `/update-docs` skill, *not* through planner/designer/
  implementer roles. Run as a targeted refresh after implementation lands,
  gated by Reviewer like any other change.
- **Report** — final summary to the user.

## Non-negotiables carried into every delegated task

- Never touch the user's running server or live `flights.db` (port 3000).
  All Node-version and dependency verification happens in a scratch clone.
- No agent commits, pushes, or switches branches — that stays with the
  Orchestrator.
