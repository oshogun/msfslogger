# Troubleshooting

## Server won't start

**`[Config] ...` printed, process exits immediately.**
Configuration failed validation before the database or listener were
touched. The message names the exact variable and problem — cross-reference
[configuration.md](configuration.md). Common cases: only one of
`TLS_CERT_FILE`/`TLS_KEY_FILE` set; a non-loopback `BIND_HOST` with no TLS
and no `ALLOW_PLAINTEXT_HTTP=1`; `INGEST_TOKEN` unset and
`ALLOW_UNAUTHENTICATED_INGEST` not set either; `SESSION_SECRET` set but
shorter than 16 characters.

**`[Auth] Refusing to start: no operator account exists.`**
Run `npm run set-password`. There is no HTTP-based first-run setup flow —
the account must exist before the server will listen at all.

**`better-sqlite3` throws on require, or the process fails with a native
module / ABI error.**
Wrong Node version. This project pins Node 20 (`.nvmrc`) because
`better-sqlite3` is a native addon with no prebuilt binary for newer Node
ABIs. Run `nvm use` (or `nvm install` first) before any `node`/`npm`/`npx`
command. This is not a dependency bug and rebuilding/upgrading
`better-sqlite3` is not the fix.

## Docker

**`flights.db` ends up as a directory instead of a file.**
Docker creates the bind-mount target if it doesn't exist, and creates a
directory when the source path doesn't already exist as a file. Always
`touch flights.db` (and `mkdir -p flight_plans`) before the first `docker
compose up`.

## Agent / connectivity

**Web UI shows `connected: false`, agent log shows a reconnect loop.**
Check, in order: `SERVER_URL` on the agent is reachable and correct;
`INGEST_TOKEN` matches exactly on both sides (the server rejects a mismatch
with `401` on every ingest request, it doesn't fail differently for "wrong"
vs "missing"); if the server runs HTTPS with a self-signed certificate, the
agent needs `NODE_EXTRA_CA_CERTS` pointing at that certificate file, or
Node's `fetch` rejects the connection outright
(`DEPTH_ZERO_SELF_SIGNED_CERT`). See [`agent/README.md`](../agent/README.md#https).

**Agent and server were both reconfigured and it still doesn't work.**
Check *both* sides were actually restarted after the change — a running
process doesn't pick up new environment variables. See
[operations.md § Deploy ordering](operations.md#deploy-ordering-server--agent).

**`401 Invalid or missing ingest token` from something other than the
agent.**
The ingest token only authorizes an explicit allow-list of routes without a
session — see [api.md § Auth model](api.md#auth-model-in-one-table). A token
that's valid but hitting a non-allow-listed route still gets a generic `401`
with `X-Ingest-Token-Scope: accepted` on the response, which distinguishes
"right token, wrong route" from "wrong token" if you're debugging
programmatically.

## Web UI / auth

**`429` on login.**
10 failed attempts within 15 minutes from the same IP locks out further
attempts (`Retry-After` header gives the remaining seconds). This is
in-memory and per-process — it clears on server restart, not just after the
window elapses, if you truly need to bypass it during development.

**Logged out unexpectedly mid-session.**
Sessions expire after 30 days of inactivity (rolling — each request
extends it) or on server restart if `SESSION_SECRET` isn't set *and* the
generated secret somehow changed (it shouldn't — it's persisted in the
database, not regenerated per boot). A `401` on any `/api` call while the UI
is open bounces the client to `/login` automatically.

## Data

**A flight looks split into two entries with a gap.**
The agent likely lost its connection to the server mid-flight (network
blip, server restart) or MSFS itself paused/hung in a way the agent
recorded as a disconnect. Use "Combine flights" from the All Flights page,
then run `npm run backfill-icao` if the merged flight is missing
departure/arrival airport codes (combining doesn't re-resolve them).

**A flight's logged duration looks too short.**
Expected if the flight was paused, in the pause menu, or the agent
reconnected after a drop — none of that time is counted (see
[architecture.md § Flight state machine](architecture.md#flight-state-machine)).
If the flight predates this behavior, `npm run backfill-durations` (dry-run
first) recomputes it.

**Takeoff didn't auto-link to the planned leg you expected.**
Leg matching requires: an active trip, a planned leg for that trip whose
departure is within 10nm of the actual takeoff position, that leg not
already flown/skipped/linked, and no other equally-close eligible leg (an
ambiguous match is never auto-resolved). Link it by hand from the flight
detail page if the automatic match didn't fire, or wasn't what you wanted.

**Load sheet / PDC generation returns `409`.**
`NO_DISPATCH_DATA` / `NO_FLIGHT_PLAN` means no SimBrief OFP has been
imported for that leg yet — those two ACARS features are generated from
on-file dispatch data, not invented from nothing.

## Where else to look

- [configuration.md](configuration.md) — every environment variable.
- [api.md](api.md) — exact auth requirement and error shape per route.
- [security.md](security.md) — the auth/CSRF/token model, for anything that
  looks like an authorization bug rather than a config mistake.
