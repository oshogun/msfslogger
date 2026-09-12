# Phase 2 review — T-005, T-006, T-007, T-008, T-013

**Verdict: request_changes** — one blocking finding (F1), four non-blocking follow-ups.
Everything else in the phase verified clean. No implementer report was read; every
claim below names the command that produced it, run by the reviewer.

Per-task: T-006/T-007/T-008 **approve**. T-013 **approve**. T-005 **request_changes** (F1).

## Criteria verified independently

| # | Check | Result |
|---|---|---|
| 1 | `node windows-client/ui/tools/render-check.mjs` | exit 0, 40 PASS lines, incl. `PASS net.ok: ACARS UPLINK`, `PASS browser errors: none` |
| 1 | `node windows-client/tools/contract-check.mjs` | exit 0, 7 commands + 3 events matched Rust↔bridge |
| 1 | re-break label (`ACARS UPLINK`→`ACARS UPLNK`, `ui/src/status.js:45`) | `FAIL net.ok: net.ok: label`, exit 1 |
| 1 | re-break event (`sidecar:exit`→`sidecar:exited`, `ui/src/bridge.js:27`) | `FAIL sidecar:exit: missing from webview bridge`, exit 1 |
| 1 | revert + re-run | md5 restored (`aea125e4…`, `86904bb5…`), both tools exit 0; `git status --porcelain agent/ client/ src/ tests/` empty |
| 2 | state ids traced across `sidecar/src/status.ts`, `ui/src/status.js`, `src-tauri/src/**` | 24 ids, `diff` of the two tables = identical; labels/severities match §4 row by row; Rust emits only `app.*` + the `sim.idle`/`net.idle` idle forcing §3.7 requires |
| 3 | `python3 -c "import tomllib; …Cargo.toml…"` | `ok 1.88.0 {tauri '=2.11.5', serde '=1.0.229', serde_json '=1.0.151'}` — no wildcard, no `git=`/`path=` deps |
| 3 | `jq .` on `tauri.conf.json`, `capabilities/main.json` | both parse; grep for `signingIdentity\|certificateThumbprint\|pubkey\|privateKey` → none |
| 4 | credential handling (below) | atomic write, frozen path, no logging, UI masks — verified |
| 5 | screenshots opened (`connected`, `config-network`, `config-token-entry`, `config-error`, `app.crashed`) | user AC 3 and 4 met (below) |
| 6 | scope | `git status --porcelain agent/ client/ src/ tests/` and `… package.json package-lock.json tsconfig.json vitest.config.ts` both empty; all phase-2 files under `windows-client/` or the run dir |
| 7 | not verifiable here | listed below |
| — | sidecar typecheck / build / tests | `TSC CLEAN`, `BUILD OK`, `175 passed (175)` under Node 20.20.2 |
| — | Rust core compile + tests | `python3 windows-client/src-tauri/tools/check-core.py` → `9 passed; 0 failed` (real `cargo test` of config/framing/protocol/restart/supervisor without Tauri) |

Extra seam evidence the criteria did not ask for, because no compiler here spans it:

- Real sidecar output (14 lines: 1 `hello`, 6 `status`, 6 `log`, 1 `pong`) fed through the
  shell's own `protocol::decode` in a scratch crate → all decode `Ok`, `decoded:
  {"hello":1,"log":6,"pong":1,"status":6}`. The sidecar's wire shape satisfies the Rust
  validator.
- The shell's exact synthetic payload (`protocol.rs:32 idle_status` + `supervisor.rs:284
  synthetic` field writes) pushed into the real UI in headless Chromium for
  `app.crashed/restarting/stopped/no-config/error-config`: four status lines rendered, none
  blank, correct `data-state`/`data-severity`, `errors: none`; `app.problems[0]` surfaced as
  `CFG serverUrl: serverUrl is required` on `#msg-line`.

## Credential handling (design §2.2/§2.6/§2.8/§2.9), line by line

- Path: `src-tauri/src/config.rs:15-33` — `MSFSLOGGER_CONFIG` then `%APPDATA%\msfslogger\config.json`
  (`USERPROFILE\AppData\Roaming` fallback), XDG on non-Windows. Matches §2.2; the same path is
  passed to the child as `--config` (`supervisor.rs:175`), so both sides read one file.
- Atomic write: `config.rs:124-142` — `create_new` temp **in the same directory**
  (`config.json.tmp`), `write_all` + `sync_all`, `rename` over the target, temp removed on
  failure, `create_dir_all` for the parent, `0o600` on unix. Matches §2.6. Verified by
  `config.rs:159` test (`saves_merge_unknown_keys_and_never_return_the_token`) passing under
  check-core: unknown key `future.kept` survives two saves, a corrupt file makes `save` fail
  and leaves the old bytes intact, no `.tmp` left behind.
- Merge: `config.rs:110-121` shallow-extends the on-disk object; no semantic validation beyond
  "patch is an object" (§2.6).
- Not logged: every shell log goes through `config.rs:70 redact_text` (`supervisor.rs:296`),
  including captured child **stderr** (`supervisor.rs:257`), and decode failures deliberately
  never echo the rejected bytes (`supervisor.rs:269-275`). `config_get` strips `ingestToken`
  and substitutes `tokenSet` (`config.rs:98-108`).
- Not leaked by the sidecar: 20-char scratch token in a scratch config, full start/reload/stop
  cycle → `token occurrences in stdout+stderr: 0`.
- Masked in the UI: `ui/src/pages/index.js:81` renders `••••••••` when set and `□□□□□□□□` when
  not; typed token is masked in the scratchpad too (`config-token-entry.png`); render-check
  asserts `token absent from all captured DOM text and config returns`.
- `grep -rn 'rejectUnauthorized\|NODE_TLS_REJECT_UNAUTHORIZED' windows-client/` → none (§2.7,
  must-not-change 13). No real-looking secret in `windows-client/**`; fixtures use
  `PLACEHOLDER-TOKEN` / `REPLACE-WITH-YOUR-INGEST-TOKEN`.

## T-013 (re-derived black-box, built `dist/`, scratch server on 3199/3198)

- Repeated invalid reloads while running (`{not json`, `sim: 2024`, `serverUrl:"ftp://x"`):
  each produced `app.error-config` with exactly the offending field, while `config.serverUrl`
  stayed `http://127.0.0.1:3199`, `tokenSet:true` and `backend: net.standby` — last valid
  config and live uplink retained across all three.
- STOP after an invalid reload: state stayed `app.error-config` (not `app.stopped`);
  `statuses with app.stopped AND problems: 0` over the whole session.
- STOP with a request in flight (server delayed 1500 ms, STOP 200 ms after START):
  statuses were `app.stopped/net.idle → app.running/net.pending → app.stopped/net.idle`; the
  late completion did not flip the backend axis. Guarded by `runGeneration`
  (`index.ts:280,305-307,353-355`).
- `shutdown` exit code 0; `grep -rn 'process.exit(1)' windows-client/sidecar/src/index.ts` → none.
- Regression coverage exists and passes (`tests/index.test.ts`, 9 tests; 175 total).
- Frozen types/payloads/pause/reconnect unchanged: `status.test.ts` (47) asserts the §4 table
  and the 5s→60s ladder; `traffic.test.ts` (19) the filter rules; `uplink.test.ts` (14) the HTTP
  shape. `agent/**` untouched (`git status --porcelain agent/` empty).

## Findings

**F1 — blocking. `src-tauri/src/supervisor.rs:30-38, 52, 122-127` — the shell invents the
`app` state instead of the sidecar, and gets it wrong for an invalid config.**
The sidecar is spawned only when `autoUplink` is true or the user presses START, so before the
first START the `app` line comes from the shell's own read of `config.json`: missing → `app.no-config`,
unparseable → `app.error-config`, **anything that parses → `app.stopped`**. A file that parses
but fails §2.4 (bad scheme, empty token, `sim:"2019"`, unreadable `certPath`) therefore shows
`UPLINK STOPPED` with no `problems[]`, where §4.2 defines `app.stopped` as "config valid, uplink
not running" and §2.5 requires `app.error-config` with one problem per field. It also puts a
second, divergent copy of config interpretation in Rust, which §2.6 forbits by name ("no third
copy of §2.4's rules to drift"), and makes START a process operation, the mirror of §3.6's "STOP
is not a process operation".
Reproduction (scratch crate over the real modules, `cargo test`):
`ConfigStore::save({"serverUrl":"ftp://nope","ingestToken":"","sim":"2019","autoUplink":false})`
then `Supervisor::new(...)` →
`initial app.state with an invalid-but-parseable config = "app.stopped"`.
Suggested fix: spawn the sidecar at launch unconditionally and let it report (`autoUplink` then
only decides whether a `start` control line follows), which is what §2.5/§3.6/§4.2 assume;
keep the synthetic `app.crashed`/`app.restarting` path as it is.

**F2 — non-blocking. `windows-client/ui/index.html:8, 185-229` — the T-006/T-007 seam (§5.3) was
not kept.** `index.html` (a T-006 file) links `css/pages.css` and carries the three CFG page
`<template>`s, while §5.3 froze "no `<link>` to `css/pages.css`" in `index.html` and made
`src/pages/index.js` inject its own stylesheet. No functional harm — `render-check.mjs` reports
no console error and the lazy `import('./pages/index.js')` + `PAGE UNAVAILABLE` fallback
(`app.js:133,150`) is intact — and one implementer owned both tasks, so the parallel-landing
rationale is spent. Recommend amending §5.3 to match the code rather than moving markup.

**F3 — non-blocking. `src-tauri/src/main.rs:18` / `config.rs:107` — `config_get` returns a fourth
key, `raw`, beyond §6.3's `{exists, path, config}`.** It is additive and the UI depends on it
(render-check `invalid-object-repair: current raw preferred to stale config`), and it is how the
panel stays useful while the sidecar's effective config is null. Worth writing into §6.3 so the
frozen signature and the code agree.

**F4 — non-blocking. `src-tauri/src/protocol.rs:38` — `idle_status` sets `pause.label:"SIM RUNNING"`.**
The sidecar fills that field from `describePause()` (`off`/`full`/`active`/`unknown(n)`, §4.5).
Display is unaffected (the UI derives labels from ids, §4.6), but the two sides disagree on a
forwarded field's vocabulary.

**F5 — non-blocking. `windows-client/ui/tools/render-check.mjs:12` — a shipped tool defaults its
output to `.claude/runs/2026-09-11-tauri-windows-client/prototypes`.** A `windows-client/` file
referencing a run directory outlives the run; T-010's CI job should pass an explicit path and the
default should be a neutral directory.

Observation, not a finding: untracked `AGENTS.md` and `.codex/` sit outside `windows-client/` and
the run dir. They are the shared-workflow config named in this task's envelope, not phase-2
deliverables — the Orchestrator should confirm they are intended before any commit.

## Not verifiable on this machine — deferred to phase 3

`cargo build` / `cargo tauri build` of the full graph (`cargo 1.75.0` vs `rust-version =
"1.88.0"`; real failure: "feature `edition2024` is required" while resolving `idna_adapter
1.2.2` — expected per amendment #2, and T-005 **did** record the floor in `Cargo.toml:6`),
MSI/NSIS bundling, WebView2 rendering fidelity, `CREATE_NO_WINDOW`, `resolve_resource` in a
bundled install, `TerminateProcess` kill path on Windows, and any live SimConnect session
(connect, `Pause_EX1`, traffic sweeps). All belong to T-010's windows-latest job and T-011's
manual test plan; the plan should add a step launching the app with a **parseable but invalid**
config and `autoUplink:false` (F1).

## User acceptance criteria 3 and 4, judged from the screenshots

**AC3 — met.** `connected.png` shows the four axes with `ACARS UPLINK` in green on `#status-net`;
`net.*` screenshots show the axis really changing (`ACARS STANDBY`, `ACARS CONNECTING`,
`ACARS READY`, `ACARS REJECT 401`, `ACARS FAULT 503`, `ACARS CERT FAULT`, `ACARS NO COMM`), and
severity colour never carries information the label lacks.
**AC4 — met.** `connected.png`/`config-network.png` show a bevelled bezel, an inset vignetted
screen, six LSKs a side physically aligned with their rows, a full key grid with `MENU/PREV/NEXT/
DEL/CLR/EXEC`, the scratchpad with a block cursor, title + `1/3` page counter, small-label-over-
value pairs, `<INDEX` / `SAVE>` / `START>` prompt arrows, `••••••••` for the stored token and
`□□□□□□□□`/`--------` for empty required/optional fields (`pages/index.js:81-84`). All 13 §6.6
palette tokens are present in `css/fmc.css`; `grep -n 'http' css/fmc.css` → none (no CDN font).

## Safety

Live `flights.db` never opened by this review — no `better-sqlite3`, no write, no request to port
3000 beyond one read-only `curl` that did not complete (TLS). Its md5 moved three times during the
review (`b98765305402bd539df386395e60c8e0` → `9dfeebe5bb9e12cf5d96b1fb393d7509` →
`15405755b08eb93373e49fa44b871674`) with the user's own server (pid 265218) checkpointing its WAL
throughout (`flights.db-wal` mtime advancing while nothing of mine ran). Scratch servers used
ports 3196–3199 and a random puppeteer port; all children exited (`pgrep` clean, no listener left).
The two files edited for the re-break test were restored byte-identically (md5 above).
