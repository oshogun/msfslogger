# Intake — Tauri Windows UI Client

Run id: `2026-09-11-tauri-windows-client`
Source: `user_stories/windows_client.md`

## Goal (restated)

Replace the current CLI Node.js Windows agent (`agent/agent.js`, run via
`npm start` with env vars) with a **Tauri-based desktop application** that:

1. Connects to the `msfslogger` backend the same way the current agent does
   (SimConnect locally, flight + traffic data pushed to the server over
   HTTP/HTTPS).
2. Exposes a **graphical configuration UI** for every setting currently set
   via CLI flag or env var, so no CLI/env var is required.
3. Shows connection status using **FMC-like terminology**, with the connected
   state labeled **"ACARS UPLINK"**.
4. Wraps the whole thing in a **skeuomorphic, aircraft-FMC-inspired** visual
   style.

## Frozen decisions — quoted verbatim from `user_stories/windows_client.md`

> 1. Build the Windows client using **Tauri**.
> 2. Provide a **graphical configuration UI** for all connection settings
>    currently passed via flags/env vars.
> 3. Display connection state using FMC-like terminology, including
>    **"ACARS UPLINK"** when connected.
> 4. Apply a **skeuomorphic aircraft FMC-inspired interface** to improve
>    immersion.

Acceptance criteria (verbatim):

> - [ ] A Tauri-based Windows desktop client can connect to the backend server.
> - [ ] Users can configure connection settings entirely through the UI (no
>       required CLI/env vars).
> - [ ] Connection status visibly changes in the UI, with connected state
>       labeled **ACARS UPLINK**.
> - [ ] UI style and labels reflect an FMC-inspired, aviation-themed
>       interaction model.
> - [ ] Existing CLI agent functionality is functionally matched for
>       connection/configuration behavior.

## Settings surface to be replicated graphically (from `agent/README.md`, `agent/agent.js`)

| Current mechanism | Setting | Notes |
|---|---|---|
| `SERVER_URL` env var | Backend base URL | required |
| `INGEST_TOKEN` env var | Shared ingest secret | required, sent as `x-ingest-token` |
| `NODE_EXTRA_CA_CERTS` env var | Path to server's self-signed cert | required whenever server runs HTTPS (the norm) |
| `TRAFFIC_ENABLED` env var | AI traffic gathering on/off | optional, default on |
| `TRAFFIC_RADIUS_M` env var | AI traffic sweep radius (m) | optional, default 40000, clamped [1000, 200000] |
| `--sim`/`-s` CLI flag | SimConnect protocol: `2020` (default) / `2024` / `fsx` | required to be graphical per AC2 |

Pause-handling (`Pause_EX1`), reconnect backoff (5s→60s cap), and the
traffic-batch endpoint (`POST /api/ingest/traffic`) are existing backend
protocol/behavior this client must keep speaking, not settings — no new
server-side contract is implied by this run.

## Decisions made at intake (engineering judgment, not user-specified — flagged so the user can redirect)

1. **SimConnect integration stays in Node, wrapped by Tauri as a sidecar.**
   `node-simconnect` is mature and already proven end-to-end (per
   `agent/README.md`'s "Status: confirmed working"). Porting SimConnect
   access to a Rust crate is materially riskier and out of proportion to what
   this story asks for. Tauri's Rust shell owns: process lifecycle for the
   sidecar, the native window/menu, and reading/writing the config file
   the sidecar also reads. This is the single biggest architecture call in
   the run — Design will freeze the exact IPC shape (sidecar → Tauri: status
   + flight/traffic passthrough; Tauri → sidecar: config changes needing a
   restart).
2. **New code lives under a new top-level `windows-client/`,** not inside
   `agent/**`. It's a different build system (Cargo + Tauri CLI, plus a web
   frontend for the FMC UI) and doesn't belong under the existing npm-script
   Node project. `agent/**` is retained as-is until this client is proven out
   — this run does not delete it.
3. **Design step is NOT skipped.** This run introduces real contracts: the
   Tauri↔sidecar IPC protocol, the on-disk config schema, the FMC-terminology
   status vocabulary, and the module boundaries of a brand-new codebase.
   Freeze all four before implementation.
4. **Verification limitation — flagged explicitly.** This machine has no
   `cargo`/`rustc` (checked: both `command not found`) and no Windows/webview
   runtime, so nothing in this run can be built or run end-to-end here — the
   same situation the existing `agent/**` code has always been in (per
   `.claude/ENVIRONMENT.md` conventions and prior operating history: agent
   code is verified on the user's Windows box, not this Linux dev machine).
   Implementer verification for the Rust/Tauri side is therefore: structural
   review, `npx tsc`-equivalent linting for any TS/JS kept in the sidecar,
   and a written manual test plan for the user to run on Windows. The Ship
   step should evaluate whether a CI job (GitHub Actions `windows-latest`
   runner) can do real `cargo build`/`tauri build` verification — that's a
   DevOps decision, not blocked on today.
5. **Scope boundary:** this run builds the client and its config/status
   contract only. Signing/notarizing a Windows installer needs a code-signing
   certificate (credentials) — out of scope, escalate to the user if it comes
   up rather than guessing.

## Amendment — Planner's open questions, resolved (post plan.json)

The Planner (T-plan) flagged four open questions in its `needs_input` report.
Resolved before Design starts:

1. **Sidecar delivery — asked the user.** Answer: **requires Node 20
   installed** on the Windows box, matching today's `agent/README.md`
   prerequisite exactly. Tauri's Rust shell spawns `node dist/index.js`
   directly; no Node SEA/pkg bundling, no extra CI packaging step. T-005 and
   T-010 proceed on this basis.
2. **FMC page scope** — status + config pages only, per the five acceptance
   criteria. Decided (not asked): Design should leave the IPC message set
   extensible for an additive future live-data CDU page, but this run does
   not build one.
3. **Start behaviour** — decided (not asked): the app does not auto-connect
   at launch. A manual START control drives the uplink (`autoUplink`
   defaults to false) — consistent with the skeuomorphic-FMC brief itself
   (a real FMC/CDU requires explicit crew action, not silent background
   activity) and gives the user an obvious, deliberate moment to verify the
   "ACARS UPLINK" status change for AC3.
4. **Run end state** — not a real open question: sub-agents never commit,
   push, or run CI (`.claude/agents.md` non-negotiables) — the Orchestrator
   pushes and the user watches the `windows-latest` CI run and does the
   final manual sign-off on the real Windows box themselves. This is already
   how every prior run in this repo ends.

## Steps this run takes

Full loop (Intake → Plan → Design → Implement → Review → Ship → Report) per
`.claude/agents.md` § Cost discipline rule 6: several new files, a new
architecture/contract, and something the user directly sees and uses.
Nothing is skipped, but Ship is scoped to CI/packaging config only (§ item 5
above).

## Resume — Codex, 2026-09-11

Phase 1 has an independent approval in `reviews/phase-1.md`. The existing UI
files are partial T-006 work; phase 2 resumes with T-005 and T-006–T-008
in parallel on disjoint paths. The three dependent UI tasks share a senior
implementer. T-013 resolves the phase-1 stale-problems follow-up and related
config-recovery/stopped-status defects found while reading the handoff; its
changes are included in the independent phase-2 review. Existing frozen user
decisions remain in force, including an installed Node 20 requirement.

Environment correction: `cargo --version` reports 1.75.0 and `rustc --version`
reports 1.75.0; neither rustfmt, gh nor actionlint was found. Earlier assertions
that Rust binaries are absent are historical. The installed compiler may be
too old for the frozen Tauri dependencies; report actual validation evidence,
without installing another toolchain. Windows/WebView2/SimConnect checks still
require Windows. Shell sandbox startup fails with `bwrap: loopback: Failed
RTM_NEWADDR: Operation not permitted`, so necessary commands use the configured
escalation review. No verification may touch the live database or server.

Shipping scope remains local CI/packaging configuration and documentation.
Preserve all unrelated untracked files present at resume. Independent review
is required before considering either implementation or DevOps work complete.

Config recovery clarification at integration: semantic-invalid JSON objects are
repairable using the existing UI/merge command. A malformed JSON, non-object,
or unreadable existing config is reported and preserved; the writer refuses
to overwrite it. Adding a destructive reset would be a new contract, outside
this run. Documentation must explain file recovery for that case.

## Resume after interruption — 2026-09-12

The prior session stopped on a usage limit during T-005/T-006–T-008 and
independent T-013 review. The user instructed “go”; the same implementers and
Reviewer resumed their existing ownership and files. No phase was marked
approved based on the interruption. Cargo 1.75 cannot parse the resolved
dependency graph's Rust 2024 edition manifests. The graph reports a maximum
minimum Rust version of 1.88.0; T-005 aligns the application manifest and
Windows build instructions with that requirement. Portable core verification
is additional evidence, not a substitute for a complete Windows/Tauri build.
