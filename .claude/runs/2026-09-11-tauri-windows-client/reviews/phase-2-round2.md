# Phase 2 review — round 2 (T-005 re-review after F1/F4 fixes)

**Verdict: approve.** T-005 **approve**; T-006/T-007/T-008/T-013 unchanged since round 1
(no files touched) and stay approved. Round-1 F1 (blocking) and F4 are fixed and verified.
Two non-blocking follow-ups (R1, R2). No implementer report or evidence file was read; every
claim below names the command that produced it, run by the reviewer.

## What changed since round 1, and how I know

Round-1 review written `2026-09-12 19:28`. Only three files in `windows-client/` are newer
(`find windows-client -newermt '2026-09-11 00:00' -printf '%T@ %TY-%Tm-%Td %TH:%TM %p\n' | sort -rn`):

    19:50 src-tauri/src/protocol.rs   19:49 src-tauri/src/supervisor.rs   19:45 src-tauri/tests/fake-sidecar.py

`sidecar/**` (19:14 and earlier) and `ui/**` (19:06) predate the round-1 verdict, so the
"whole-directory untracked noise" caveat checks out: nothing outside `src-tauri/` was edited
in this round. `git status --porcelain agent/ client/ src/ tests/ package.json` → empty.
Scope holds (**item 6 satisfied**).

## Independent verification

Method, as in round 1: a scratch crate that `#[path]`-mounts the **real** modules
(`config`, `framing`, `protocol`, `restart`, `supervisor`) and runs `cargo test` — except this
round the child process is the **real node sidecar** (`sidecar/dist/index.js` under Node
20.20.2 via `nodePath`), not the repo's python fixture, so no test double can flatter the result.
Harness: scratchpad `rev2/{harness.py,review_tests.rs}` (throwaway, outside the repo).

| # | Check | Command / result |
|---|---|---|
| 1 | **F1 fixed** — invalid-but-parseable config, no START pressed | real sidecar, `{"serverUrl":"ftp://nope","ingestToken":"","sim":"2019","autoUplink":false}` → `state=app.error-config problems=[{serverUrl, "must use http:// or https:// (got \"ftp://\")"},{ingestToken,"is required"},{sim,"must be one of 2020, 2024, fsx (got \"2019\")"}]`; still `app.error-config` 600 ms later; the string `app.stopped` never appears in the whole event stream |
| 2 | **no-config** (round-1 approved path) | file absent → `app.no-config`, `config:null`, sidecar alive (`hello` present) |
| 3 | **Manual START is the baseline** (§3.6, intake) | valid config + `autoUplink:false` → spawned, `app.stopped` and **stays** stopped for 800 ms; after `Operation::Start` → `app.running` |
| 4 | spawned-idle vs spawned-started distinguishable | idle `backend=net.idle, sim=sim.idle` vs started `backend=net.pending, sim=sim.connecting`; shell sends `start` only when `desired_running` (`supervisor.rs:203`) |
| 5 | idle really is silent on the wire | scratch HTTP server on **:3197** logging every hit: `0` requests during the 3 s idle window; first hit `GET /api/status` lands at the instant START is issued, then `POST /api/ingest/event` (the disconnect) at shutdown — 2 hits total |
| 6 | `autoUplink:true` still starts at launch | → `app.running`, `backend=net.pending` |
| 7 | crash-loop budget / restart-rate / RESTART reset | `python3 windows-client/src-tauri/tools/check-core.py` → **11 passed; 0 failed** (was 9 in round 1), incl. `crash_loop_stops_after_five_restarts_and_manual_restart_resets_budget` (6 spawns, `restartsRemaining:4` seen, `app.crashed` latched, RESTART clears it) and `stalled_child_is_killed_at_shutdown_deadline` |
| 8 | shutdown kill path, real sidecar | `/proc/<pid>` exists while running, gone after `supervisor.shutdown()` |
| 9 | **F4 fixed** | `protocol.rs:41` `"label":"off"`; `sidecar/src/status.ts:163 describePause()` returns `off` for flags 0 and `full/with-sound/active/sim/unknown(n)` otherwise — the two vocabularies now agree, and the comment at `protocol.rs:38-40` lists exactly that set |
| 10 | frozen IPC names still match | `node windows-client/tools/contract-check.mjs` → 7 commands + 3 events `PASS`, exit 0 |
| 11 | no run citations in new/edited comments | `grep -rn '\.claude/runs\|design\.md\|plan\.json\|T-0[0-9][0-9]\|§\|Amendment\|phase-\?[0-9]' src-tauri/src/{supervisor,protocol}.rs src-tauri/tests/fake-sidecar.py` → no match |

Total across both harnesses: **17 tests, 17 passed** (11 repo + 6 mine against the real sidecar).

## Item 5 — the judgment call on "STOP / RELOAD with no live child"

I agree with `app.crashed`, on the design's own terms, and verified the reasoning rather than
assuming it:

- §4.2 defines `app.stopped` as "**config valid**, uplink not running" and marks it *sidecar-emitted*.
  With no child, the shell has no basis for the "config valid" half — that is precisely the
  invention F1 blocked, so synthesising `app.stopped` here would reintroduce it in a second place.
- `app.crashed` is not a new claim in any reachable path: every route to `child == None`
  (`supervisor.rs:135,150`) already sits on `app.crashed` or `app.restarting` — spawn failure
  (`:160-166`, `:205-209`, latches `crash_latched`) or unexpected exit (`:307-319`). Verified:
  with `nodePath:"/nonexistent/node-binary"`, state was `app.crashed` **before** the STOP and
  `app.crashed` after; RELOAD likewise; a subsequent START logs `Sidecar stopped after failure;
  use RESTART` and spawns nothing. A STOP can never turn a healthy state into a fault reading.
- The frozen state set has no "stopped cleanly, child dead" id, and inventing one would be a
  design change, not a fix. `app.crashed`/`SIDECAR FAULT` with a live RESTART prompt is the
  least-wrong member of the frozen set.

One real wrinkle falls out of it — R1 below.

## Findings

**R1 — non-blocking. `src-tauri/src/supervisor.rs:131` — STOP cancels a *pending* crash-respawn
and parks on `SIDECAR FAULT`, which reads as a process operation.** §3.6 says "STOP is not a
process operation … that distinction is what lets the panel keep showing status after the user
stops the uplink". `Operation::Stop` sets `restart_at = None`, so a STOP pressed during the 2000 ms
restart delay kills a respawn that was within budget; the respawned child would have come up
**idle** anyway (`desired_running` is false by then, `:203`), reported `app.stopped` itself, and
kept the panel informative. `Operation::Reload` already takes the opposite, better line — it
defers to a pending respawn (`:145-151`). Reproduction (scratch crate, real `Supervisor`, a child
that exits 9 at once): wait for `app.restarting`, request `Stop`, sleep 3000 ms >
`RESTART_DELAY` → `state=app.crashed`, `Sidecar process started` log count `1 -> 1` (no respawn).
Recoverable — START spawns again because `crash_latched` is false — so this is a follow-up, not a
blocker. Suggested: leave `restart_at` alone in `Stop`, exactly as `Reload` does.

**R2 — non-blocking. `src-tauri/tests/fake-sidecar.py:27-37` carries a crude copy of two §2.4
rules** (`serverUrl` scheme, `ingestToken` non-empty) to decide its idle state. It is a test
double and the file says so, but it is the same class of duplication §2.6 warns about; if §2.4
moves, this fixture will keep passing on stale rules. My real-sidecar run is what makes the
round-2 evidence independent of it; worth a line in T-010's CI job to also exercise the real
sidecar, or a comment pinning the fixture's scope.

Carried over, unchanged: round-1 F5 (`ui/tools/render-check.mjs:12` default output path under
`.claude/runs/`) is still open, deferred to T-010 by the Orchestrator. F2/F3 were closed by design
amendment and were not re-checked, per the envelope.

## Still not verifiable on this machine

Unchanged from round 1 and unaffected by this fix: `cargo build`/`cargo tauri build` of the full
graph (cargo 1.75.0 vs `rust-version = "1.88.0"`), MSI/NSIS bundling, WebView2 rendering,
`CREATE_NO_WINDOW`, `resolve_resource` in a bundled install, `TerminateProcess`, live SimConnect.
T-011's manual plan should now include: launch with a **parseable-but-invalid** config and
`autoUplink:false` (expect `CONFIG INVALID` + one line per field, not `UPLINK STOPPED`), and
launch with a valid config and `autoUplink:false` (expect `UPLINK STOPPED`, no traffic to the
server until START).

## Safety

Live `flights.db` never opened: md5 `2554fd51f2fd0499ac4452ec9d6094c6` before and after this
review (`md5sum flights.db`), no `better-sqlite3`, no write, no request to port 3000. Scratch
work used port **3197** only and temp dirs under `/tmp/rev2-*`; all removed (`ls -d /tmp/rev2-*`
→ none) and no child processes left (`pgrep -af 'listener.js|dist/index.js --config /tmp'` →
none). No repo file was edited by this review; this file is the only artifact written.
