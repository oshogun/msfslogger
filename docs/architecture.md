# Architecture

## Component map

```
┌─────────────────────┐        SimConnect (local)      ┌──────────────┐
│ MSFS 2020/2024/FSX   │◄───────────────────────────────│  agent/      │
│ (Windows)             │                                 │  Node.js CLI │
└─────────────────────┘                                 └──────┬───────┘
                                                                 │ HTTPS
                                                                 │ POST /api/ingest/{frame,event,traffic}
                                                                 │ x-ingest-token
                                                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  src/  — Express + TypeScript server                                  │
│                                                                        │
│  ingest router ─► FlightManager (state machine) ─► db/ (better-sqlite3)│
│                                                                        │
│  feature routers (flights, trips, planned-legs, exports, acars, …)    │
│  serve client/dist/ (static) + JSON API, session or ingest-token auth │
│                                                                        │
│  outbound: SimBrief, aviationweather.gov, SayIntentions.AI, PDF       │
└───────────────┬────────────────────────────────────────────┬─────────┘
                │ same-origin HTTPS                            │ ingest-scoped
                ▼                                              │ API (token)
┌──────────────────────┐                          ┌────────────────────────┐
│ client/ — React SPA    │                          │ MCDU/Tauri desktop     │
│ (built into            │                          │ client — separate repo │
│  client/dist, served   │                          │ oshogun/msfslogger_mcdu│
│  by the Express app)   │                          └────────────────────────┘
└──────────────────────┘
```

## Components and responsibilities

### `src/` — server

Express + TypeScript, single process, single SQLite database
(`better-sqlite3`, WAL mode). Responsibilities:

- Accept telemetry from the Windows agent (`/api/ingest/*`) and drive the
  in-process flight state machine (`FlightManager`).
- Persist flights, trips, planned legs, ACARS messages, and ground sessions.
- Serve the built React client as static files and answer its JSON API.
- Serve a second, narrower JSON API to non-browser clients authenticated by
  ingest token only (status, ACARS, ground-session-current, SimBrief
  settings) — this is what the MCDU app uses.
- Serve an optional [MCP](https://modelcontextprotocol.io/) endpoint
  (`/mcp`, its own bearer-token credential, off unless `MCP_TOKEN` is set)
  exposing the logbook as 18 tools to a remote MCP client such as Claude
  Desktop/Code. See [api.md § MCP server](api.md#mcp-server--srcmcp).
- Keep a replica of MSFS navigation data pushed by the MCDU client (`src/navdata/`, a separate SQLite file) and answer map queries and route-expansion requests from it. See [navdata.md](navdata.md).
- Generate PDF (via a self-navigated headless Chromium instance) and KML
  exports.
- Integrate with three external HTTP services: SimBrief (OFP import),
  aviationweather.gov (METAR/TAF for ACARS weather replies), and
  optionally SayIntentions.AI (pull its ATC/CPDLC comms into a flight's
  ACARS thread, push an on-file PDC into the pilot's live session — off by
  default, gated on an operator-supplied API key).

See [api.md](api.md) for the full route table and [configuration.md](configuration.md)
for every environment variable.

### `client/` — web UI

React 18 + Vite + `react-router-dom` (browser history routing) +
`react-leaflet`/Leaflet for all maps (tiles from the public OpenStreetMap
tile server). Built to `client/dist/`, which the server serves at the same
origin — the client has **no configurable API base URL**; every request is a
bare relative `/api/...` path and depends on same-origin cookies. In dev,
Vite's own dev server proxies `/api` to the backend on port 3000.

Auth is a `SessionProvider` React context that calls `GET /api/auth/session`
once on load; "live" data (position, status, AI traffic) comes from
`useStatus()` polling `GET /api/status` (1s while flying, 3s otherwise) — not
a WebSocket or SSE connection.

Pages: `Home` (dashboard), `AllFlights`, `Prefiles` (planned legs), `FlightDetail`,
`TripDetail`, `AcarsMessages` (shared by flight- and leg-scoped threads),
`Login`, plus headless `PrintFlight`/`PrintTrip` routes that exist purely as
the render target for server-side PDF export, and two standalone easter-egg
pages (`Device`, `Override`). See [usage.md](usage.md) for what each page is
for.

**Flight replay** is entirely client-side. `FlightDetail` renders a
`ReplayPanel` (its own Leaflet map, separate from `FlightMap`, which the print
routes share and which replay does not touch) from the full track that
`GET /api/flights/:id` already returns. Three pieces, each independently
testable:

- `client/src/utils/replay.ts` — a pure engine (no React or Leaflet):
  `buildTimeline` turns the points into a timeline (recording gaps longer than
  `GAP_THRESHOLD_SEC` = 30 s are collapsed to `COLLAPSED_GAP_SEC` = 2 s of
  virtual time) and `sample` returns the interpolated position, heading (shortest
  arc), altitude and speeds at a virtual time. Longitude is interpolated after
  `unwrapLonChain`, so a track crossing the antimeridian stays continuous.
- `client/src/hooks/useReplayClock.ts` — one `requestAnimationFrame` loop holding
  virtual time in a ref (per-frame advance clamped to 0.25 s), with an injectable
  scheduler for tests.
- `client/src/components/ReplayPanel.tsx` — moves the aircraft marker directly
  with `setLatLng` rather than through React state, and writes the readout and
  scrubber at no more than 10 Hz, so the map does not re-render per frame. It
  uses Leaflet's SVG renderer (`preferCanvas={false}`) rather than canvas.

### `agent/` — Windows SimConnect agent

A small standalone Node.js script that runs on the Windows PC with MSFS. It
connects to SimConnect locally (no firewall/TCP configuration needed — the
same way any local addon does) and pushes flight data to the server over
HTTP(S). This is the only supported way to connect a server running on a
different machine than the simulator; dialing SimConnect's TCP port directly
from the server is not supported. Full detail, including pause handling and
the AI-traffic sweep, in [`agent/README.md`](../agent/README.md) — summarized
in [usage.md](usage.md) and [configuration.md](configuration.md).

### External integration points

| Service | Direction | Used for |
|---|---|---|
| SimConnect (local, Windows only) | agent reads | Live simulator telemetry |
| SimBrief public API | server calls out | Importing a dispatch OFP as planned legs |
| aviationweather.gov | server calls out | METAR/TAF for ACARS weather requests |
| SayIntentions.AI SAPI | server calls out (optional) | Pull ATC/CPDLC comms into a flight's ACARS thread; push an on-file PDC as a real CPDLC message — off by default, needs an operator-supplied API key. See [api.md § SayIntentions](api.md#sayintentions--srcroutessayintentionsts). |
| OpenStreetMap tile server | browser calls out | Map tiles in the web UI |
| MCDU/Tauri desktop client (`oshogun/msfslogger_mcdu`) | calls in, via ingest-scoped API | In-sim datalink UI, including the SayIntentions feature above; separate repository, not documented here |
| MCP client (e.g. Claude Desktop/Code) | calls in, via `/mcp` with its own bearer token | Read/edit the logbook through 18 MCP tools — off by default, needs an operator-supplied `MCP_TOKEN`. See [api.md § MCP server](api.md#mcp-server--srcmcp). |

## Runtime flow

### Startup (`src/index.ts`)

1. `loadConfig()` — any invalid environment variable exits the process here,
   before anything else runs.
2. `initDb()` — opens the SQLite file, applies schema/migrations.
3. Refuse to start if no operator account exists yet (`npm run set-password`
   creates one — there is no HTTP-based setup flow).
4. Sweep expired sessions once, then every 6 hours.
5. Ensure the flight-plans attachment directory exists; start airport-data
   loading in the background (non-blocking).
6. Construct `FlightManager` and the Express app (`createServer`).
7. Listen — HTTP or HTTPS depending on TLS config, on one port. There is no
   second listener redirecting HTTP to HTTPS.

### Request lifecycle (`src/server.ts`)

Middleware order is deliberate and load-bearing:

1. `express.json()` (100KB body limit) and static file serving from
   `client/dist`.
2. `/api/ingest/*` — mounted **before** session middleware, authenticated
   independently by ingest token.
3. `/mcp` — mounted only when `MCP_TOKEN` is set, also **before** session
   middleware and outside `/api` entirely, authenticated independently by
   its own bearer token. See [api.md § MCP server](api.md#mcp-server--srcmcp).
4. Session middleware (cookie `msfslogger.sid`, SQLite-backed store).
5. An ingest-token *scope classifier* (marks eligible requests; doesn't gate
   by itself).
6. `requireSameOrigin` (CSRF defense-in-depth).
7. `/api/auth/*` — public, mounted before the auth gate.
8. `requireAuth` — the single gate for everything else under `/api`: passes
   with a valid session **or** a validly-scoped ingest token.
9. Feature routers (flights, trips, settings, planned legs, exports, acars,
   ground sessions).
10. SPA catch-all (`GET *` → `client/dist/index.html`) for client-side
    routing.
11. A final error handler normalizing upload and malformed-JSON errors.

### Shutdown

`SIGINT`/`SIGTERM` closes the HTTP(S) listener, then the database (which
checkpoints WAL back into the main file, so a hard kill without this step
can strand recent writes in `flights.db-wal`), with a 3-second fallback timer
in case a lingering connection blocks the graceful close.

## Flight state machine

The core of the domain logic (`src/flightManager.ts`) — driven entirely by
telemetry frames arriving over ingest, not by any client request.

**States:** `IDLE` → `GROUND` → `FLYING` → back to `IDLE`.

- **IDLE → GROUND**: 5 consecutive "parked" frames (on ground, groundspeed
  &lt;1kt, engines off or parking brake set). Resolves the nearest airport and
  attempts a non-consuming planned-leg match; opens a `ground_sessions` row.
- **IDLE/GROUND → FLYING**: 3 consecutive airborne frames (not in slew, not
  on ground, airspeed &gt;30kt). Inserts a `flights` row, closes any open
  ground session, attempts to auto-link a planned leg (see leg matching,
  below), and files OUT/OFF ACARS messages.
- **GROUND exit without flying**: slew, or moving more than 10nm from the
  ground-session's anchor position, closes the session back to IDLE. A crash
  or sim disconnect while grounded closes only an auto-created session,
  leaving a manually-created one open for the operator.
- **FLYING → IDLE (landing)**: 10 consecutive landed frames (on ground,
  groundspeed &lt;5kt), or immediately on crash/sim-disconnect. Writes final
  flight stats, records the leg outcome (below), files ON/IN ACARS messages.

**Pause handling**: the agent forwards SimConnect's `Pause_EX1` bitmask,
distinguishing a full pause, an "active pause," and a menu pause — all three
stop the flight clock and suspend track recording, unlike the legacy
`Paused`/`Unpaused` events (kept only as a fallback) which miss active pause
entirely.

**Duration**: not wall-clock time. It's the sum of gaps *between recorded
points*, only counted when the gap is ≤60s and the flight wasn't interrupted
(paused/slewed) since the previous point — so a pause, pause menu, frozen
sim, or dropped agent connection is excluded from the logged duration rather
than inflating it.

## Leg matching and closing

`src/legMatcher.ts` (`matchPlannedLeg`) is a pure, deterministic function run
at takeoff (and non-consumingly at ground-session entry): it finds planned
legs for the active trip within 10nm of the takeoff position, filters out
ones that are already flown/skipped/linked or lack a departure airport, and
either returns exactly one match, or a specific reason it couldn't (no active
trip, no legs, none in radius, none eligible, or more than one equally
eligible candidate — it never guesses on an ambiguous match).

At landing, a linked leg is marked `'flown'` if the arrival is within 10nm of
the leg's destination, or `'diverted'` otherwise — the link is kept either
way. A leg linked **manually** (not by this auto-match) can instead be
hand-closed by the operator via the API, gated by `src/plannedLegClose.ts`'s
rules (flight must have ended, leg must be in the expected status for the
requested transition); a manual hand-close never produces `'diverted'`.

## Where to go next

- [api.md](api.md) — every route, request/response shape, and its auth requirement.
- [data-model.md](data-model.md) — full schema.
- [usage.md](usage.md) — what an operator actually does with all this.
- [security.md](security.md) — the auth/CSRF/token model in detail.
