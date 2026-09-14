# Intake — remove-windows-client

## Goal (user's words)
> The mcdu/tauri client has moved into it's own separate project. Clean up
> this project and reference the mcdu repository in the documentation (keep
> the CLI agent, that should always be there as a fallback)
> https://github.com/oshogun/msfslogger_mcdu

## Tier
**Tier 2** — one implementer + one Reviewer, `intake.md` only (no `plan.json`,
no Design). Single coherent concern (decommission `windows-client/` from this
repo), no schema/API change, no new contract. Spans several files (a
directory deletion, a CI workflow, three docs, one config file), but it's one
seam, not several independent units of work.

## Verified before delegating
- `grep -rl "windows-client" src/ client/src` → empty. Zero code
  cross-references from the live application into `windows-client/`; deletion
  is safe from a dependency standpoint.
- `git ls-files windows-client/` → 62 tracked files. `du -sh windows-client`
  → 76M, almost all of it gitignored build output
  (`sidecar/node_modules`, `sidecar/dist`, `src-tauri/target/`).
- `.github/workflows/windows-client.yml` is the only CI file referencing it;
  `ci.yml` (the main workflow) has no windows-client references.
- `package.json` has no workspaces entry for it — it was never wired into the
  root build.
- `windows-client/README.md` confirms the intended relationship: "A Tauri
  desktop app that replaces `agent/`... `agent/` is unchanged and stays in
  place as the fallback" — matches the user's instruction to keep `agent/`.

## Decisions frozen (verbatim from the user)
- Remove the Tauri/MCDU client from this repo — it now lives at
  `https://github.com/oshogun/msfslogger_mcdu`.
- **Keep `agent/` untouched** — "that should always be there as a fallback."
- Reference the new repo in documentation.

## Scope (Orchestrator's judgment calls, stated so the user can correct them)
- **Delete** `windows-client/` entirely (all 62 tracked files + any
  untracked/gitignored build output under it).
- **Delete** `.github/workflows/windows-client.yml` (exists solely to build
  this directory on a Windows runner).
- **Delete** the `windows-client/src-tauri/target/` block from `.gitignore`
  (dead once the directory is gone).
- **Delete** `user_stories/windows_client.md` and `user_stories/msfs_client.md`
  — both describe only the now-separated project; their content belongs with
  the code that moved, not here. (Recoverable from git history if wrong.)
- **Update** `README.md` and `CLAUDE.md` to point at
  `https://github.com/oshogun/msfslogger_mcdu` instead of describing an
  in-repo Tauri client.
- **Keep** `.claude/runs/2026-09-11-tauri-windows-client/` and
  `.claude/runs/2026-09-13-cdu-abstract-interface/` as-is. Per
  `.claude/runs/README.md`, a run directory is "the durable record of one
  feature" — moving the code doesn't retroactively invalidate the decision
  record of building it. Not deleted, not edited.
- **Keep `agent/` untouched** — no changes of any kind.

## Success criteria
1. `windows-client/` no longer exists in the working tree; `git status`
   shows it removed.
2. `.github/workflows/windows-client.yml` removed.
3. `.gitignore` no longer mentions `windows-client`.
4. `README.md` and `CLAUDE.md` mention `https://github.com/oshogun/msfslogger_mcdu`
   and no longer describe an in-repo Tauri/desktop client under
   `windows-client/`.
5. `user_stories/windows_client.md` and `user_stories/msfs_client.md` removed.
6. `agent/` has zero diff.
7. `npm test`, `npx tsc --noEmit`, `npm run build:server` all still pass —
   proves the deletion didn't silently depend on anything live code needed.
8. No remaining reference to `windows-client` or the Tauri client anywhere
   outside `.claude/runs/2026-09-11-tauri-windows-client/`,
   `.claude/runs/2026-09-13-cdu-abstract-interface/`, and git history.

## Non-negotiables carried into this run
- Never touch the user's running server (port 3000) or live `flights.db`.
- Node 20 via nvm for every node/npm/tsc command.
- Commits are the Orchestrator's alone; the implementer does not commit.
- The implementer's result goes to Reviewer before merge.
