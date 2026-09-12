# Phase 3 close — T-010 (CI workflow), T-011 (README), run close

**Verdict: request_changes** — one blocking finding (F1), everything else
non-blocking or a follow-up.

All evidence below was re-derived: the workflow YAML re-parsed, every
Linux-runnable README command re-run, the migration table cross-checked
against `agent/README.md` and `config.ts` by hand, the manual test plan read
against `design.md` §4. No implementer report was read.

## T-010 — `.github/workflows/windows-client.yml`

- `python3 -c "import yaml,sys; yaml.safe_load(...); print('ok')"` → `ok`.
  Full parsed structure inspected key by key: `runs-on: windows-latest` ✓;
  `on.push/pull_request.paths: [windows-client/**, .github/workflows/windows-client.yml]`
  ✓; actions pinned — `actions/checkout@v4`, `actions/setup-node@v4`,
  `actions/upload-artifact@v4` (major-tag), `dtolnay/rust-toolchain@1.88.0`
  (this action's own convention: the ref *is* the toolchain version, matching
  `Cargo.toml`'s `rust-version`) ✓; `grep -n 'secrets\.' ...` → no output,
  exit 1 ✓; `actions/upload-artifact@v4` uploads both `bundle/msi/*.msi` and
  `bundle/nsis/*.exe` with `if-no-files-found: error` ✓.
- `git status --porcelain .github/workflows/ci.yml` → empty; `git diff --stat .github/workflows/ci.yml` → empty. ci.yml untouched, confirmed.
- Steps run in order: `npm ci` → `npm run typecheck` (= `tsc --noEmit -p tsconfig.json`) → `npm test` (= `vitest run --config vitest.config.ts`) → `node windows-client/tools/contract-check.mjs` → `cargo tauri build`. Checked each against `windows-client/sidecar/package.json`'s `scripts` — identical strings.
- render-check.mjs: explicitly omitted, reason stated in a comment (needs root `puppeteer`, no Windows-rendering value over the existing headless-Chromium coverage). Not ambiguous.
- No `sign` / `signing` anywhere in the workflow or `tauri.conf.json` (`grep -ni 'sign' ...` → only the one comment line flagged below, unrelated to signing).

**F1 — blocking. `.github/workflows/windows-client.yml:31`.** The comment
`# per design.md §0 amendment #2` cites the run's frozen design document by
name and section number, inside a file that ships to the repo outside
`.claude/runs/`. This is exactly the class of comment this project's Reviewer
doctrine bans ("must not point at ... design.md, a §-numbered section, an
'Amendment' label ... even if the citation is accurate today") — a future
reader of `.github/workflows/` has no way to know `design.md` exists. Fix: say
what the constraint *is* (Tauri's dependency graph needs Rust 2024-edition
support, so the pin is a real minimum) without naming the document. Grepped
the rest of the diff (`.gitignore`, `README.md`, `windows-client/README.md`)
for the same pattern (`§`, `design.md`, `plan.json`, `Amendment`, `T-0NN`,
`run-id`, `phase[0-9]`, `reviews/`) — no other hits in this phase's files.

Everything else in T-010's file checks out against its acceptance criteria.

## T-011 — `windows-client/README.md`, `README.md`

Every command quoted was either run here or is explicitly marked
Windows-only:

- `rustc --version` / `cargo --version` — ran on this machine, output
  **matches the README verbatim**: `rustc 1.75.0 (82e1608df 2023-12-21)` /
  `cargo 1.75.0`.
- `npm --prefix sidecar ci` and `npm --prefix sidecar run build` — these sit
  inside a block the README marks "(Windows-only, untested here...)", but
  neither actually needs Rust. Ran both from a scratch copy: `ci` → "added 64
  packages ... found 0 vulnerabilities", `run build` → clean, `dist/*.js`
  produced. Not a failure, but the README's own disclaimer ("verified
  separately, see Verification done on this machine") doesn't quite match —
  the verification section runs `npx tsc`/`npx vitest`, not literally these
  two `npm --prefix` commands. Non-blocking; recommend listing `npm --prefix
  sidecar ci`/`build` directly in that section instead of the paraphrase.
- `cargo tauri dev`, `cargo tauri build`, `cargo install tauri-cli ...` —
  correctly marked Windows-only; confirmed on this machine `cargo tauri` is
  not installed (`error: no such command: 'tauri'`) and `rustc` is 1.75.0,
  below the stated 1.88.0 minimum, so the label is accurate, not just cautious.
- The four commands under "Verification done on this machine" — re-ran all
  four from the repo root under Node 20: `npx tsc --noEmit -p windows-client/sidecar/tsconfig.json`
  → clean; `npx vitest run --config windows-client/sidecar/vitest.config.ts`
  → **6 files / 175 tests passed**, matching the README's numbers exactly;
  `inspect-config.js` on `good.json` → exit 0, redacted output as shown; the
  `bad-*.json` loop → all 9 fixtures exit 1; `node windows-client/tools/contract-check.mjs`
  → 10/10 `PASS`, exit 0. All four claims are accurate as stated.

**Migration table** (`windows-client/README.md` "Migrating your current
settings") cross-checked against `agent/README.md` and
`windows-client/sidecar/src/config.ts`: all seven required rows present
(`SERVER_URL`, `INGEST_TOKEN`, `NODE_EXTRA_CA_CERTS`, `TRAFFIC_ENABLED`,
`TRAFFIC_RADIUS_M`, `--sim`/`-s`, `autoUplink`). `config.ts`'s `RawConfig` has
one field the table doesn't cover, `nodePath` — correctly excluded, since it
has no `agent/README.md` counterpart (it's new, Tauri-supervisor-only) and
the T-011 acceptance criteria only required the seven listed. No setting is
missing from any of the three sources.

**FMC vocabulary table**: all 7 `app` states, 4 `sim` states, 8 `backend`
states and 5 `pause` states in the README match `design.md` §4's state-id →
label table character-for-character, including `ACARS UPLINK` appearing only
in the "everything working" row.

**F2 — non-blocking. `windows-client/README.md`, manual-test step 7** (also
present verbatim in `design.md` §7.1 row 7, so this is inherited, not
introduced by T-011). Expected observation reads "the server's web UI shows
`connected: true`". Read `client/src/components/Header.tsx`: the actual
header renders `'Sim not connected'` / `'Connected · Idle'` /
`'Recording · <aircraft>'` / `'Paused · <aircraft>'` — there is no
`connected: true` text anywhere in the rendered UI; that string is the raw
`Status.connected` API field, not what an operator running this step would
see. A user following the plan literally would not find what's described.
Recommend: `the header status badge reads "Connected · Idle" (or "Recording
· <aircraft>" once a flight starts)`.

No other step's expected observation is vague or unobservable — all name a
specific DOM label (`#status-*`), a file path, a process-list check, or a
concrete numeric value, and all match §4's labels.

**Scope**: `git status --porcelain agent/ client/ src/ tests/` → empty.
`git diff README.md` → additions only (`12 ++++++++++++`, `0` deletions),
`git status --porcelain agent/` → empty. Tracked diff for this run is exactly
`.gitignore` (5 lines, scoped to `windows-client/src-tauri/target/`) and
`README.md` (12 lines). Untracked additions are `windows-client/**`,
`.github/workflows/windows-client.yml`, and the run directory — matching the
task's expected file set.

**Observation, not attributed to T-010/T-011**: `git status --porcelain` (unfiltered)
also shows untracked `AGENTS.md` and `.codex/` at repo root. Neither is in
any task's `allowed_paths` in this run's `plan.json`, neither is referenced by
T-010 or T-011's acceptance criteria, and their content (a Codex-workflow
adapter) is unrelated to `windows-client`. Not a finding against this phase,
but the Orchestrator should confirm these are deliberate before any commit
that runs `git add` broadly.

## Five-AC accounting (independent evidence + residual gap)

1. **A Tauri-based Windows client can connect to the backend server.**
   Evidence: `uplink.ts` HTTP path unit/scratch-server tested (phase 1,
   approved); Rust↔webview command names verified to agree
   (`contract-check.mjs`, 10/10 pass, re-run here); `Cargo.toml`/`tauri.conf.json`
   parse cleanly. **Gap: no `cargo tauri build` has ever run anywhere but
   CI/the user's box** — this machine's Rust (1.75.0) is below the pinned
   minimum (1.88.0), confirmed above.
2. **Every setting configurable through the UI, no required env var/flag.**
   Evidence: `resolveConfigPath()` needs no env var by default (read in
   `config.ts`); config validation has 60 passing unit tests; all 7
   env-var/flag equivalents have a UI field (migration table, checked above).
   **Gap: the UI pages have only been exercised in headless Chromium
   (`render-check.mjs`, phase 2), never WebView2** — saving through the real
   Tauri `invoke` bridge on Windows is unverified.
3. **Connection status visibly changes, connected state = `ACARS UPLINK`.**
   Evidence: `status.ts` has 47 passing tests including the exact string
   `ACARS UPLINK` for `net.ok`; the label appears in that state and nowhere
   else, confirmed by reading `design.md` §4.4 and the table in the README.
   **Gap: no real ingest POST has ever succeeded here** — `net.ok` is proven
   by unit test, not by a live successful frame reaching a real server from
   this UI.
4. **FMC-inspired style and labels.** Evidence: skeuomorphic CSS/LSK
   structure and page templates exist (`ui/css/fmc.css`, `ui/index.html`,
   `ui/src/pages/**`), approved at phase 2 with headless-Chromium screenshots
   as structural evidence. **Gap: no WebView2 has ever rendered this** —
   font metrics, colors and layout on the user's actual screen are
   unverified; headless Chromium is a different renderer.
5. **Functional parity with the CLI agent for connection/configuration.**
   Evidence: must-not-change items 1–13 (backoff ladder, traffic filtering,
   pause precedence, HTTP shape, no TLS escape hatch) are unit-tested against
   the ported code (175 tests total, re-run here) and were reviewed line-by-line
   against `agent/agent.js`/`agent/traffic.js` at phase 1 (T-004) and phase 2
   round 2. **Gap: no real SimConnect session has ever opened** — every
   `open()` attempt on this machine fails immediately with `ECONNREFUSED
   127.0.0.1:2048`; test-plan step 16 (side-by-side against the old agent
   with real MSFS traffic) is the only thing that closes this gap, and it can
   only run on the Windows box.

No criterion is marked satisfied on the strength of any report — each line
above names the command or file read that produced it.

## Verification hygiene

`md5sum flights.db` before and after this review: `95318d9c59f766742425bdc3ffc4b6e9`
both times — unchanged. No server was started on port 3000 or otherwise left
running; scratch copy (`/tmp/.../scratchpad/wc-verify`) removed after use.

## Follow-ups carried forward / newly opened

- **R1** (phase 2 round 2, still open): `STOP` cancelling a pending
  crash-respawn reads as a process operation in the design vocabulary; not
  re-litigated here, doesn't block any of the five ACs.
- **R2** (phase 2 round 2, still open): a test fixture duplicates validation
  rules instead of importing them; still open, not a correctness risk.
- **F2** above (README step 7 wording) — fix before the user actually runs
  the sign-off plan, but doesn't block merging the docs/CI as a whole.
- The `npm --prefix sidecar ci`/`build` disclaimer imprecision noted above —
  cosmetic, fold into the same README pass that fixes F2.
- Stray `AGENTS.md`/`.codex/` at repo root, unrelated to this run — the
  Orchestrator should account for these before any broad `git add`.

## Round 2 (Orchestrator-applied fixes) — re-checked

**Verdict: approve.**

- **F1 re-checked**: read the full comment block at
  `.github/workflows/windows-client.yml:29-32` — now reads "(Rust 2024
  edition support, needed by the resolved dependency graph). Pinned to that
  exact version..." with no document reference. Re-grepped the whole file for
  `design.md`, `§`, `.claude/runs`, `amendment`, `plan.json`, `T-0NN` →
  no matches, exit 1. Clean. Nothing else in the file cites a run artifact.
- **F2 re-checked**: `windows-client/README.md` step 7 now reads "the
  server's web UI header shows `Connected · Idle` (then `Recording ·
  <aircraft>` once a flight starts)" — matches `Header.tsx`'s actual rendered
  labels, not the raw API field. `design.md` §7.1 row 7 carries the identical
  wording, and §0 amendment #4 records the change with the evidence
  (`Header.tsx`, this review's F2). Both copies now agree.

Both fixes hold up under independent re-verification. No other findings from
the original review changed. Follow-ups (R1, R2, the `npm --prefix
sidecar`/README-disclaimer wording, and the stray `AGENTS.md`/`.codex/` at
repo root) stand as recorded above — none blocks closing this run.
