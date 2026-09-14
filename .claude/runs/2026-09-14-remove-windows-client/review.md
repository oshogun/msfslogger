# Review — remove-windows-client

**Verdict: approve.** 10 of 10 acceptance criteria verified independently
(commands re-run by the Reviewer, not read from the implementer's report).
Zero blocking findings. Three non-blocking follow-ups below.

**Live-data safety**: no server started, no scratch DB, no writes.
`md5sum flights.db` = `9dae3d4fa0511afcf1f7b87569f4463e` before and after this
review. Port 3000 still held by the user's original process (`pid=732594`,
unchanged, untouched). No scratch directory to remove.

## Per-criterion verification

| # | Criterion | Command | Result |
|---|---|---|---|
| 1 | `windows-client/` gone from disk (62 tracked + build output) | `ls -d windows-client` / `find . -maxdepth 2 -name 'windows-client*'` / `git status --porcelain -- windows-client/ \| grep -c '^ D'` | `No such file or directory`; `0` paths on disk; `62` deletions, matching `git ls-files windows-client/ \| wc -l` = `62` — **pass** |
| 2 | `.github/workflows/windows-client.yml` deleted | `ls -la .github/workflows/` | only `ci.yml` remains; status shows `D .github/workflows/windows-client.yml` — **pass** |
| 3 | `.gitignore` `windows-client/src-tauri/target/` block gone | `git diff -- .gitignore` | removes exactly the 3-line comment + the rule, nothing else — **pass** |
| 4 | README: no in-repo Tauri bullet, points at `msfslogger_mcdu`, `agent/` is the supported default | `git diff -- README.md` | bullet removed (list ends at the `agent/` bullet); closing line now reads "The Node.js agent in `agent/` remains the supported, default way… A separate, optional Tauri/MCDU-style desktop client is developed independently at [oshogun/msfslogger_mcdu](…)" — **pass** |
| 5 | CLAUDE.md opening paragraph notes the move | `git diff -- CLAUDE.md` | para 1 now states the client "has moved to its own repo, https://github.com/oshogun/msfslogger_mcdu" — **pass** |
| 6 | Both user stories deleted | `ls user_stories/` | `cors_handoff.md refactor.md simbrief_integration.md` only; status shows both `D` — **pass** |
| 7 | `agent/` zero diff | `git status --porcelain -- agent/ \| wc -l` → `0`; `git diff --stat HEAD -- agent/ \| wc -l` → `0` | **pass** |
| 8 | `npm test`, `npx tsc --noEmit`, `npm run build:server` | Node 20.20.2 via nvm | `Test Files 17 passed (17) / Tests 327 passed (327)`; `tsc --noEmit` exit 0, no output; `build:server` exit 0 — **pass** |
| 9 | No stray `windows-client` / `Tauri` refs outside the two protected run dirs | `git grep -n -i -E 'windows-client\|tauri'` + whole-tree `grep -rn` (untracked included) with corrected, unanchored exclusions | 4 residual lines; see finding NB-1 — **pass with a wording caveat** |
| 10 | `git status --porcelain` limited to allowed_paths | `git status --porcelain` | 65 `D` + 3 `M` inside allowed_paths; all other dirty entries predate the run (see NB-2) — **pass** |

### Extra checks beyond the criteria

- No config or CI file still references the deleted tree:
  `grep -n -i -E 'windows-client|tauri' .github/workflows/ci.yml package.json Dockerfile* docker-compose*`
  → no output.
- No dangling link to the deleted user stories:
  `grep -rn -E 'windows_client\.md|msfs_client\.md'` (excluding the three run
  dirs that legitimately name them) → no output.
- No broken relative link left in README after removing
  `[build and test guide](windows-client/README.md)`:
  `grep -n -oE '\]\([^)h][^)]*\)' README.md` → no output (all remaining links
  are absolute wiki URLs).
- Comment-citation rule: the only edited comment is the `.gitignore` block,
  which was **deleted**; no new comment in `src/`, `client/src/` or `tests/`
  was added, so no run-id / `design.md` / `T-NNN` citation can have been
  introduced. `git diff -- src/ client/ tests/` → empty.

### On the two items the envelope flagged

**(1) The stray-reference grep.** Verified by hand rather than accepted. The
literal command in the criteria fails because `grep -r … .` emits paths with no
leading `./`, so a `grep -v '/.claude/runs/…'` exclusion never matches. Re-run
with corrected patterns, the genuine residue is 4 lines in **4 files**:

```
CLAUDE.md:5     — intentional (criterion 5 requires it)
README.md:175   — intentional (criterion 4 requires it)
.claude/runs/2026-09-13-refactor-db-server-split/reports/acceptance.md:197
.claude/runs/2026-09-13-refactor-db-server-split/reports/T-002.md:156
(plus intake.md:100 and reports/T-007.md:203 in that same run dir, which only
 cite the protected 2026-09-11 prototypes path)
```

The implementer's account is **accurate and complete** — it names
`2026-09-13-refactor-db-server-split` explicitly as a third run directory with
hits, and my independent grep reproduces exactly its file set. (The envelope's
paraphrase — "all 31 hits are intentional or inside the two protected dirs" —
under-reports what the report actually says; the report itself is correct.)

**(2) Transcription fidelity.** Every factual claim in the Orchestrator-captured
`report.md` was re-derived from scratch and each one holds: the `62` count, the
`Test Files 17 passed / Tests 327 passed` line, `tsc --noEmit` exit 0,
`build:server` exit 0, `agent/` zero diff, the md5 `9dae3d4…` before/after, the
verbatim README and CLAUDE.md replacement text, and the `ci.yml`/`package.json`
grep returning nothing. No claim in the transcription is unsupported, and none
of my own results contradicts it. The transcription is faithful.

## Findings

**Blocking: none.**

### NB-1 (non-blocking) — criterion 9's exemption list is one directory short
`.claude/runs/2026-09-13-refactor-db-server-split/reports/acceptance.md:197` and
`reports/T-002.md:156` still contain the strings `windows-client/.claude/` and
`tauri-prototype .png`. Reproduction:
`git grep -n -i -E 'windows-client|tauri' -- . | grep -v '2026-09-11-tauri-windows-client/' | grep -v '2026-09-13-cdu-abstract-interface/'`.
Not a defect: these are permanent decision records of an unrelated run, they are
outside this task's `allowed_paths`, and editing them would falsify history —
the same rationale that exempts the two named directories. The criterion's
exemption list should have included it. No action needed on the code; record the
carve-out if the criterion is ever re-run.

### NB-2 (non-blocking) — pre-existing dirty tree, confirmed untouched
`git status` also shows 34 modified PNGs under
`.claude/runs/2026-09-11-tauri-windows-client/prototypes/`, four untracked run
dirs, and untracked `user_stories/cors_handoff.md`. Verified these predate the
task rather than taking the report's word for it: their mtimes are
`2026-09-14 00:27`, while every file this task touched is `12:42` and the run
directory itself was created at `12:40`. Left exactly as found.

### NB-3 (non-blocking) — stray empty directory in the run artifacts
`.claude/runs/2026-09-14-remove-windows-client/reports/` exists and is empty
(created 12:44, presumably the blocked report Write). It is outside the task's
stated allowed path (`…/report.md`) and serves no purpose. Cosmetic; the
Orchestrator can `rmdir` it before committing.

## Follow-ups worth tracking

1. `npm run build:server` (run by both implementer and Reviewer) overwrote
   `dist/`, which the live server has already loaded. Safe per
   `ENVIRONMENT.md`, and the tree is shippable (`tsc` exit 0), but the user's
   next restart picks up the rebuilt output.
2. The wiki (`github.com/oshogun/msfslogger/wiki`) is outside this repo and was
   not in scope; if any wiki page documents the in-repo `windows-client/`, it is
   now stale and needs the same pointer to `msfslogger_mcdu`.
3. `rmdir` the empty `reports/` directory (NB-3) before the commit.
