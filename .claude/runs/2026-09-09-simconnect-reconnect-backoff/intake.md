# Intake — SimConnect reconnect backoff

## Goal

`agent/agent.js` already reconnects after SimConnect drops (MSFS restart,
crash, or a heavy scenery-load stall) via `tryConnect()`, but every retry — the
initial connect failure and both the `quit`/`close` handlers — uses the same
fixed `RECONNECT_DELAY_MS = 5000`. Replace the fixed delay with a capped
exponential backoff, and make the `error` handler (currently log-only)
participate in reconnection too, so the agent recovers from any disconnect
without hammering SimConnect every 5s indefinitely and without requiring the
user to restart the agent process by hand.

## Success criteria

- Reconnect delay starts at 5s and doubles on each consecutive failure, capped
  at 60s (5s, 10s, 20s, 40s, 60s, 60s, …).
- A successful connect (`recvOpen` received) resets the attempt counter back
  to the base delay for the next disconnect.
- The `error` event on the handle triggers a guarded reconnect instead of only
  logging, without double-scheduling when `error` fires alongside `close`/
  `quit` for the same disconnect (no overlapping timers).
- No new npm dependency; no change to env vars, CLI flags (`--sim`/`-s`), pause
  handling, or the AI traffic sweep.
- `agent/README.md`'s description of reconnect behaviour (Setup step 5, "It
  reconnects automatically if MSFS restarts…") stays accurate given the new
  backoff.

## Decisions frozen

- Scope is `agent/agent.js` (+ `agent/README.md` doc line) only —
  `agent/traffic.js` and the server (`src/`) are untouched.
- No jitter: this is a single agent instance talking to a local SimConnect, not
  a fleet of clients that could thunder-herd a shared server, so deterministic
  exponential-with-cap is enough.

## Tier

Tier 2 per `.claude/agents.md` § Cost discipline rule 6 — a change with one
seam (one module, no new contract). One Dispatcher + one Reviewer. Design and
DevOps steps are skipped: no schema/API/contract change, and nothing here
touches build, packaging, or deploy.
