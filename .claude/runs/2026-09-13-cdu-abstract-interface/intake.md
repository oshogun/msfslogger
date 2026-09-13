# Intake — CDU pages depend only on the abstract interface

Run id: `2026-09-13-cdu-abstract-interface`
Source: `user_stories/msfs_client.md`, section "First Step"

## Goal (restated)

`user_stories/msfs_client.md` sets up a longer-term goal: run the existing
MCDU/FMC panel logic (today, Tauri desktop only) inside MSFS 2020 itself, as a
Coherent GT in-sim gauge, talking to the same `msfslogger` server. The two
hosts will differ completely in how they reach the server and the sim (Tauri
IPC to a Node sidecar vs. whatever the in-sim gauge uses), but should run
*the same CDU page logic* unmodified.

This run is only the **first step** named in that story:

> Refactor CDU pages to depend only on the abstract interface.

Scope is the refactor and the interface freeze — **not** building the MSFS
gauge or its bridge implementation. That is explicitly later work the story
does not ask for yet.

## Frozen decisions — quoted verbatim from `user_stories/msfs_client.md`

> As a CDU page developer, I want every CDU page to operate against a small
> abstract interface rather than calling Tauri commands directly, so that the
> same CDU logic can run in both the Windows desktop agent and the MSFS
> in-sim gauge.
>
> ## First Step
> Refactor CDU pages to depend only on the abstract interface.

## Current state (verified by reading the code, not the prior run's design doc)

`windows-client/ui/src/` already has most of the seam this story wants,
built during `2026-09-11-tauri-windows-client` (see that run's `design.md`
§6.3/§6.4/§5.3):

- `bridge.js` is the single place that touches `window.__TAURI__` /
  `window.__TAURI_INTERNALS__`. It exports one object
  (`getConfig/setConfig/getConfigPath/startUplink/stopUplink/restartSidecar/
  getStatus/onStatus/onLog/onExit/isStub`) and falls back to a stub bridge in
  any non-Tauri host (confirmed: `grep -rn "TAURI" windows-client/ui/src`
  matches only inside `bridge.js`).
- `app.js` builds `window.FMC` (`registerPage, showPage, setScratchpad,
  getScratchpad, hasScratchpadError, getConfigCache, getStatus,
  refreshConfig, bridge`) and hands every page a `pageContext()` of
  `{ body, bridge, config, status, fmc }`.
- The lazily-loaded CFG pages (`pages/index.js`: NETWORK/SIM/TRAFFIC) call
  only `fmc.*`, including `fmc.bridge.setConfig(...)` — never `bridge`
  directly, never Tauri.

Two gaps found that break the "every CDU page… only the abstract interface"
property, confirmed by reading `windows-client/ui/src/app.js`:

1. **The built-in STATUS page** (registered inline in `app.js`, lines
   232–263) calls `bridge.restartSidecar()`, `bridge.stopUplink()`,
   `bridge.startUplink()` directly via the closured module-level `bridge`
   import — not through `window.FMC`/`fmc`, unlike every other page. It is a
   real CDU page (same `registerPage` shape, same LSK dispatch) with a
   different dependency path than NETWORK/SIM/TRAFFIC.
2. **`pageContext()` hands every page `ctx.bridge` directly**, in addition to
   `ctx.fmc`. Nothing stops a page (existing or future) from reaching past
   the abstraction, and the interface a page is *supposed* to depend on has
   never been written down as a boundary — only inferred from convention.
3. Not a page itself, but page-adjacent and worth flagging for Design: the
   shell chrome hardcodes `bridge.isStub ? 'STUB BRIDGE' : 'TAURI'`
   (`app.js:492`) for the on-screen bridge-mode label. A third, non-Tauri,
   non-stub host will render a wrong label unless this is generalized or the
   line is explicitly scoped out as shell chrome rather than page code.

## Success criteria / Definition of Done

- Every registered CDU page — the built-ins (`STATUS`, `MENU`) and the lazy
  CFG pages (`NETWORK`, `SIM`, `TRAFFIC`) — reads and writes host state
  (config, status, uplink start/stop, sidecar restart, log/exit events)
  through exactly one interface, with no page-level code calling `bridge`
  directly or touching `window.__TAURI__`/`window.__TAURI_INTERNALS__`.
- That interface's shape and the ownership boundary (what the shell/host
  wiring may touch vs. what a page may touch) is written down as a frozen
  contract a future MSFS/Coherent-GT host implementation can target without
  any page-code changes — this is the "small abstract interface" the user
  story names.
- The STATUS-page-only gap (bridge calls bypassing `fmc`) and the
  `ctx.bridge` pass-through are resolved, not just documented.
- The hardcoded `'TAURI'` label is either generalized behind the interface or
  explicitly frozen as shell-only and out of the page contract, with a
  reason.
- No behavior regression: `windows-client/ui/tools/render-check.mjs` and
  `windows-client/tools/contract-check.mjs` still pass; the panel still boots
  and works against the stub bridge in a plain browser exactly as before.
- Out of scope, explicitly: implementing the MSFS/Coherent GT bridge, any
  HTTP/WS protocol from inside the sim, or touching `src-tauri/**` /
  `sidecar/**` beyond what the interface freeze requires (expected: none).

## Step-skip decisions

- **Design is NOT skipped.** This run defines a new frozen contract — the
  page-facing abstract interface and its ownership boundary — that later
  work (the actual MSFS bridge) depends on. That is exactly the case
  `.claude/agents.md` reserves Design for.
- **DevOps is skipped.** No build, packaging, CI, or deploy surface changes;
  this is a `windows-client/ui/**` source refactor only.
- Tier: full loop (`.claude/agents.md` § Cost discipline rule 6) — the change
  spans multiple files (`app.js`, `pages/index.js`, `bridge.js` ownership
  boundary) and freezes a shared contract other future work depends on, which
  puts it past the one-seam/no-new-contract bar for the two-agent tier.

## Verification available on this machine

`windows-client/ui` has no live SimConnect/Tauri dependency for this check:
`node --experimental-vm-modules` style unit tests aren't set up for the UI
yet, but `windows-client/ui/tools/render-check.mjs` (headless-Chromium,
drives `window.__FMC_STUB__`) and `windows-client/tools/contract-check.mjs`
both run today without a Windows box or a live server — Design/Implement
should keep relying on those rather than inventing new verification.
