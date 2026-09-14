# Report — remove-windows-client

(Captured by the Orchestrator: the implementer's Write tool was blocked from
creating this file directly by a tool-level restriction on subagents writing
report files; content below is the implementer's findings verbatim.)

**Live DB safety**: no server started, no writes performed. `md5sum
flights.db` before = after = `9dae3d4fa0511afcf1f7b87569f4463e`.

**Deletion**: `rm -rf windows-client`, `rm -f
.github/workflows/windows-client.yml`, `rm -f user_stories/windows_client.md
user_stories/msfs_client.md`. All confirmed gone from disk (each subsequent
`ls` errored). `git status --porcelain -- windows-client/ | grep -c "^ D"` →
**62**, matching the acceptance criteria's tracked-file count. `rm -rf` also
removed the untracked `windows-client/.claude/` and any gitignored
`sidecar/node_modules`/`dist`/`src-tauri/target`.

**.gitignore**: removed the 3-line comment + `windows-client/src-tauri/target/`
rule; nothing else changed.

**README.md** — old bullet ("an in-development Tauri desktop replacement in
`windows-client/`.") removed, list now ends at the `agent/` bullet. Closing
line replaced:
```
The Node.js agent in `agent/` remains the supported, default way to connect a
simulator on a separate Windows PC. A separate, optional Tauri/MCDU-style
desktop client is developed independently at
[oshogun/msfslogger_mcdu](https://github.com/oshogun/msfslogger_mcdu).
```

**CLAUDE.md** opening paragraph, updated:
```
MSFS 2024 flight logger. Express + TypeScript + better-sqlite3 server (`src/`),
React + Vite client (`client/`), a Windows-side SimConnect agent (`agent/`). A
Tauri/MCDU desktop client used to live here at `windows-client/`; it has moved
to its own repo, https://github.com/oshogun/msfslogger_mcdu — do not look for
it in this tree.
`README.md` is the user-facing description and is kept accurate — read it before
```

**agent/**: `git diff --stat -- agent/` → empty. Zero diff confirmed.

**Verification** (Node 20.20.2 via nvm):
- `npm test` → `Test Files 17 passed (17)` / `Tests 327 passed (327)`.
- `npx tsc --noEmit` → exit 0, no output.
- `npm run build:server` → exit 0, `dist/index.js` rebuilt (safe overwrite of
  the live server's already-loaded dist per ENVIRONMENT.md; does not touch
  the running process).

**Stray-reference grep**, run exactly as specified in acceptance criteria, is
**not empty** (31 lines), but every hit is expected, not a stray leftover:
- `CLAUDE.md`, `README.md` — deliberately mention `windows-client`/Tauri to
  explain the move (required by criteria 3 & 4).
- `.claude/runs/2026-09-14-remove-windows-client/intake.md` and
  `.claude/runs/2026-09-13-refactor-db-server-split/{intake.md,reports/acceptance.md,reports/T-002.md,reports/T-007.md}`
  — historical run records outside this task's `allowed_paths`, correctly
  untouched.
- The remaining ~24 hits are all under
  `.claude/runs/2026-09-11-tauri-windows-client/` and
  `.claude/runs/2026-09-13-cdu-abstract-interface/`, which the task
  explicitly protects as permanent decision records. They show up because
  `grep -rli … .` here emits paths with **no leading `./`**, so the specified
  `grep -v '/.claude/runs/…/'` pattern (leading slash) never matches them — a
  quirk of the exact command given, not a real leftover. Re-running with
  anchored patterns and excluding `README.md`/`CLAUDE.md` returns nothing
  beyond the two out-of-scope historical run directories already noted.
- `grep -n 'windows-client\|tauri' .github/workflows/ci.yml package.json` →
  no output.

**git status**, scoped to allowed_paths, shows only: `D
.github/workflows/windows-client.yml`, `M .gitignore`, `M CLAUDE.md`, `M
README.md`, `D user_stories/msfs_client.md`, `D user_stories/windows_client.md`,
and 62 deletions under `windows-client/`. All other pre-existing dirty
entries (prototype PNGs under `2026-09-11-tauri-windows-client/`, untracked
run dirs for `2026-09-07-gpx-import`/`2026-09-08-docker-pdf-export`/
`2026-09-10-ci-docker-cleanup`, `user_stories/cors_handoff.md`) predate this
task and were left untouched. Nothing in `src/`, `client/`, `agent/`, or any
other `.claude/runs/` dir was touched. No `git add`/`git commit` was run.

## Envelope

```json
{
  "task_id": "remove-windows-client",
  "status": "done",
  "artifacts": [
    "/home/guilherme/msfslogger/README.md",
    "/home/guilherme/msfslogger/CLAUDE.md",
    "/home/guilherme/msfslogger/.gitignore"
  ],
  "summary": "windows-client/ (62 tracked files + gitignored build output) and .github/workflows/windows-client.yml deleted; user_stories/windows_client.md and msfs_client.md deleted; .gitignore's windows-client/src-tauri/target/ block removed; README.md and CLAUDE.md updated to point at https://github.com/oshogun/msfslogger_mcdu while keeping agent/ as the supported fallback. agent/ has zero diff. npm test (327/327 passed), npx tsc --noEmit (exit 0), and npm run build:server (exit 0, dist/index.js rebuilt) all pass. Live flights.db md5 unchanged (9dae3d4fa0511afcf1f7b87569f4463e before and after) — no server touched.",
  "risks": [
    "The stray-reference grep command specified in acceptance criteria has an unrelated pre-existing bug (its exclusion patterns assume a leading '/' that grep's actual output doesn't have), so it does not literally return empty; verified by hand that all 31 hits are either the two intentionally-updated files or files outside this task's allowed_paths.",
    "npm run build:server overwrote dist/ that the live server has already loaded into memory; this is safe per ENVIRONMENT.md (does not touch the running process) but the user's next restart will pick up the rebuilt tree.",
    "Pre-existing uncommitted changes elsewhere in the repo (prototype PNGs, unrelated untracked run dirs, user_stories/cors_handoff.md) were left exactly as found and are not part of this task's diff."
  ],
  "next_suggested_role": "reviewer"
}
```
