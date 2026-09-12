# T-005 round 2 — evidence (F1 blocking, F4 non-blocking)

All commands were run from the repo root on this Linux box. `cargo 1.75.0` /
`rustc 1.75.0` are installed but too old for the full Tauri dependency graph, so
every Rust check here uses the scratch-crate technique the phase already ships:
`windows-client/src-tauri/tools/check-core.py` compiles the five real shell
modules (`config`, `framing`, `protocol`, `restart`, `supervisor`) into a
temporary crate with only `serde_json` and runs their `#[cfg(test)]` suites.

## What changed

- `windows-client/src-tauri/src/supervisor.rs`
  - `Supervisor::new` no longer derives an `app` state from the config file. It
    reads `autoUplink` only (the shell's own decision) and seeds the snapshot
    with `app.starting`, which is what the panel shows until the sidecar's first
    real `status` arrives.
  - The worker spawns the sidecar unconditionally at launch; `autoUplink`
    decides only whether a `start` control line follows the spawn.
  - `spawn()` no longer sends a `stop` line to a fresh child (it is already
    idle and says so itself); it sends `start` only when the uplink is wanted.
  - `Start` prefers the live child; the spawn fallback survives for the case
    where the child is gone and no restart is pending.
  - `Stop`/`Reload` with no live child no longer synthesise `app.stopped` —
    "stopped" claims a valid config nobody checked. They report `app.crashed`,
    and `Reload` leaves a pending respawn's `app.restarting` alone.
  - Tests: two new, one tightened (below).
- `windows-client/src-tauri/src/protocol.rs` — F4: `idle_status`'s
  `pause.label` is now `"off"`, the value `describePause(0)` produces, instead
  of the display string `"SIM RUNNING"`.
- `windows-client/src-tauri/tests/fake-sidecar.py` — the fixture now tolerates a
  missing config file, reports `app.no-config` / `app.error-config` (with
  `problems[]`) / `app.stopped` for itself, and refuses `start` while its config
  is unusable, mirroring the sidecar. Its config now carries a valid
  `serverUrl`.
- `.claude/runs/2026-09-11-tauri-windows-client/prototypes/app-state-repro.py` —
  new; the F1 reproduction, same scratch-crate technique plus a small binary that
  drives a real `Supervisor` and prints the launch-time state.

## 1. F1 reproduced, then fixed

Before (a copy of `src-tauri` with the launch-time
`if auto_uplink { worker.spawn(); }` and the config-derived initial status
restored; `MSFSLOGGER_SHELL` points the script at it):

    $ MSFSLOGGER_SHELL=<scratch>/prefix python3 .claude/runs/2026-09-11-tauri-windows-client/prototypes/app-state-repro.py
    at launch, invalid config: app = "app.stopped"  problems = null  controls sent = ""
    after user presses START : app = "app.error-config"  problems = [{"field":"serverUrl","message":"serverUrl must be an http(s) URL"}]  controls sent = "start\n"
    sidecar processes started = 1

The config is `{"serverUrl":"ftp://nope","ingestToken":"","sim":"2019","autoUplink":false}` —
exactly the reviewer's repro. `UPLINK STOPPED`, no problems, until the user
presses START.

After:

    $ python3 .claude/runs/2026-09-11-tauri-windows-client/prototypes/app-state-repro.py
    at launch, invalid config: app = "app.error-config"  problems = [{"field":"serverUrl","message":"serverUrl must be an http(s) URL"}]  controls sent = ""
    after user presses START : app = "app.error-config"  problems = [{"field":"serverUrl","message":"serverUrl must be an http(s) URL"}]  controls sent = "start\n"
    sidecar processes started = 1

The same bug also fails the new unit test against the pre-fix code:

    test supervisor::tests::a_config_that_parses_but_is_invalid_reports_the_sidecar_state_and_its_problems ... FAILED
      panicked at src/supervisor.rs:376: Timed out waiting for fixture state   # state stayed "app.stopped"
    test supervisor::tests::manual_start_stop_redaction_and_graceful_close ... FAILED
      assertion `left == right` failed: left: 0  right: 1                      # no sidecar spawned at launch
    test supervisor::tests::auto_uplink_is_the_only_thing_that_starts_the_uplink_at_launch ... FAILED
      assertion `left == right` failed: left: 0  right: 1
    test result: FAILED. 8 passed; 3 failed

## 2. `start` is still sent only when `autoUplink` is true

`auto_uplink_is_the_only_thing_that_starts_the_uplink_at_launch` asserts the
distinction directly — the fixture appends every control line it receives to a
`controls` file:

- `autoUplink: true`  → state `app.running`, `controls == "start\n"`
- `autoUplink: false` → state `app.stopped`, `controls == ""`, `starts == 1`

`manual_start_stop_redaction_and_graceful_close` asserts the same at the other
end: spawned (`starts == 1`) with `controls == ""`, then a user START produces
`controls == "start\n"` and `app.running`. The repro script's
`controls sent = ""` at launch is the same fact outside the test harness.

## 3. `app.no-config`, `app.crashed`, `app.restarting`

- Missing file (`app-state-repro.py missing`): no config file at all, so the
  shell has no `nodePath` and runs `node` off `PATH` exactly as it would on a
  first run — the script puts a `node` shim there pointing at the fixture.
  Result: `app = "app.no-config"  controls sent = ""`, one process started, and
  the process stays alive (no crash loop). Pre-fix this state was the shell's
  own guess; now it is the sidecar's report.
- `crash_loop_stops_after_five_restarts_and_manual_restart_resets_budget`
  unchanged and green: 6 starts, `app.crashed`, `restartsRemaining: 4` seen,
  START refused while latched, RESTART clears the budget → 7th start,
  `app.running`.
- `stalled_child_is_killed_at_shutdown_deadline` unchanged and green.

## 4. F4 — pause label vocabulary

    $ grep -n "return 'off'\|parts.join" windows-client/sidecar/src/status.ts
    164:  if (flags === PAUSE_FLAG_OFF) return 'off';
    170:  return parts.join('+') || `unknown(${flags})`;
    $ grep -n '"label"' windows-client/src-tauri/src/protocol.rs
    41:        "pause": {"state":"pause.off", "flags":0, "label":"off", "usingPauseEx1":false},

`grep -rn "SIM RUNNING"` over the repo (excluding `node_modules`/`target`) now
returns only the review file that raised the finding. Display is unaffected
either way: `ui/src/status.js` derives every label from the state id through
`describeState`/`formatStateLabel` and never renders the wire `label`.

## 5. Full local verification run

    $ python3 windows-client/src-tauri/tools/check-core.py
    running 11 tests
    test config::tests::short_credentials_do_not_change_public_protocol_identifiers ... ok
    test restart::tests::sixth_restart_is_blocked_until_rolling_window_expires ... ok
    test protocol::tests::malformed_messages_are_errors_not_panics ... ok
    test framing::tests::accepts_exact_limit_and_recovers_after_invalid_utf8 ... ok
    test framing::tests::oversized_line_is_dropped_and_next_line_survives ... ok
    test config::tests::saves_merge_unknown_keys_and_never_return_the_token ... ok
    test supervisor::tests::manual_start_stop_redaction_and_graceful_close ... ok
    test supervisor::tests::a_config_that_parses_but_is_invalid_reports_the_sidecar_state_and_its_problems ... ok
    test supervisor::tests::auto_uplink_is_the_only_thing_that_starts_the_uplink_at_launch ... ok
    test supervisor::tests::stalled_child_is_killed_at_shutdown_deadline ... ok
    test supervisor::tests::crash_loop_stops_after_five_restarts_and_manual_restart_resets_budget ... ok
    test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.80s

Compiles warning-free (`cargo test` output filtered for `warning:` → nothing).

    $ node windows-client/tools/contract-check.mjs   # node 20
    PASS config_get … PASS status_get, PASS sidecar:status, PASS sidecar:log, PASS sidecar:exit   (exit 0)

    $ npx tsc --noEmit -p tsconfig.json              # node 20, server tree untouched
    exit 0

### Not verifiable here

- A real `cargo build` / `cargo tauri build` of the shell: rustc 1.75.0 cannot
  build the Rust-2024-edition dependency graph (design §0 amendment #2). The
  five shell modules do compile, and their tests run, via the scratch crate.
- Anything WebView2 or Windows-specific: `CREATE_NO_WINDOW`, the bundled
  `resolve_resource` entry path, and launching the real Node sidecar on Windows.
  The Linux runs use `/usr/bin/python3` as the child (a `nodePath` override or a
  PATH shim), which exercises the supervisor's process logic but not Node.
- The real sidecar's own state machine is not re-exercised here; the fixture is
  a stand-in for it. Its behaviour is T-002's evidence.

## 6. Scope

`windows-client/` has never been committed, so `git status --porcelain` reports
the whole tree as one untracked directory and cannot show per-file changes. The
files this round touched, by mtime within the last 25 minutes:

    $ find agent client src tests windows-client .claude -newer <25-min stamp> -type f \
        -not -path '*/node_modules/*' -not -path '*/target/*' | sort
    .claude/runs/2026-09-11-tauri-windows-client/prototypes/app-state-repro.py
    windows-client/src-tauri/src/protocol.rs
    windows-client/src-tauri/src/supervisor.rs
    windows-client/src-tauri/tests/fake-sidecar.py

Nothing under `agent/`, `client/`, `src/`, `tests/`, `windows-client/sidecar/`
or `windows-client/ui/`. No commits, no pushes, no branch changes.
