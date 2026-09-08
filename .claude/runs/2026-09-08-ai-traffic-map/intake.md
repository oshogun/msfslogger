# Intake — 2026-09-08-ai-traffic-map

## Goal

Gather AI traffic (other aircraft SimConnect knows about — not the user's own)
from SimConnect via the Windows agent, and render them as markers on the live
map alongside the user's own aircraft.

User's request, verbatim: "gather the AI traffic information from simconnect
and display it on the live map."

## Success criteria

1. `agent/agent.js` requests AI traffic objects from SimConnect (in addition to
   its existing single `OBJECT_USER` request) and pushes them to the server.
2. The server ingests traffic into in-memory state keyed by SimConnect object
   id, and prunes aircraft that go stale or leave range — it does not persist
   traffic to `flights.db` (this is a live-only, ephemeral display feature, not
   a logging feature).
3. The client's live map renders each in-range traffic aircraft as its own
   marker, distinguishable from the user's own aircraft, added/updated/removed
   as aircraft enter, move, and leave range, on the existing poll cadence.
4. Zero regression to the existing single-aircraft flight-logging pipeline
   (`SimFrame` → `flightManager` state machine → `flights.db`). Traffic is
   additive, on a separate data definition/request id.
5. Feature stays within the existing agent → HTTP ingest → REST-poll
   architecture unless the Designer finds a concrete reason (data volume,
   latency) to deviate — see open question below.

## Context established (research, not to be re-derived)

Current single-aircraft pipeline, confirmed by direct file inspection:

- **`agent/agent.js`**: connects once via `open('msfslogger-agent',
  Protocol.KittyHawk)` (or `SunRise` for 2024). One data definition
  (`DEF_FLIGHT_DATA=0`, lat/lon/alt/speed/heading/etc.) requested via
  `requestDataOnSimObject(REQ, DEF, OBJECT_USER, SimConnectPeriod.SECOND)`.
  `simObjectData` handler decodes the buffer and POSTs to
  `/api/ingest/frame` roughly once/sec. No AI-traffic API (`SimObjectType`,
  `requestDataOnSimObjectType`, `simObjectDataByType`) is imported or used
  today.
- **`src/ingest.ts`**: `POST /api/ingest/frame` validates and calls
  `flightManager.onFrame(frame)` — pure pass-through into in-memory state, no
  DB write on the ingest path itself. A 5s watchdog marks `disconnected` if no
  frame arrives within 10s. Optional `x-ingest-token` auth.
- **`src/flightManager.ts`**: single `AppState` object (`lastFrame`, etc.),
  not keyed by any object id — the whole model is single-aircraft.
- **`GET /api/status`** (`src/server.ts`): the only "live" endpoint; client
  polls it, no WebSocket/SSE anywhere in the app.
- **`client/src/hooks/useStatus.ts`**: polls `/api/status` every 1000ms while
  `flightState === 'FLYING'`, else 3000ms.
- **`client/src/components/LiveMap.tsx`**: react-leaflet. `LiveMapController`
  holds one `markerRef`, updates it in an effect keyed to every `status` poll,
  via `makeAircraftIcon(headingDeg)` (an `L.divIcon` rotated by
  `headingDeg - 90`, the fix from the last commit). Structurally this
  extends cleanly to a second `Map<objectId, L.Marker>` for traffic, reusing
  `makeAircraftIcon` parameterized for a distinct look.
- **node-simconnect (`^4.1.1`, agent-only dependency)** exposes exactly the
  API needed: `SimObjectType` enum (`AIRCRAFT`, `HELICOPTER`, `BOAT`, `ALL`,
  ...), `requestDataOnSimObjectType(reqId, defId, radiusMeters, type)` →
  fires the `simObjectDataByType` event once per in-range object, each
  carrying its own `objectID`. This is the whole surface — no higher-level
  "traffic list" helper exists.
- **No server-side SimConnect connection exists** despite the README's claim
  that same-machine setups skip the agent — grepped `src/` and root
  `package.json`: no `node-simconnect` import anywhere outside `agent/`. The
  agent is the only real gathering point today, so this feature targets the
  agent exclusively; the README claim is a pre-existing doc/reality gap, out
  of scope for this run.

## Decisions frozen so far (by Orchestrator, pending Designer confirmation)

- **No persistence.** Traffic is not written to `flights.db`. It's live-view
  only, matching "display... on the live map," not "log."
- **Follow the existing agent-only architecture.** No new server-side
  SimConnect connection; same-machine mode is not addressed by this run (it
  doesn't exist today for the user's own aircraft either).
- **Reuse the poll/REST model** as the default; the Designer evaluates
  whether traffic volume/churn justifies a separate polling endpoint
  (`/api/traffic`) vs. folding into `/api/status`, and whether the existing
  1s/3s cadence is adequate or traffic needs its own (probably coarser)
  interval given dozens of objects can be in range at once.

## Open questions for the Designer to resolve and freeze

- Data definition for traffic: which SimConnect variables to pull per AI
  aircraft (lat/lon/alt/heading at minimum; title/tail number optional for a
  future tooltip — not required for "display... on the map").
- Range: what radius to pass to `requestDataOnSimObjectType`, and whether
  that's a fixed constant or configurable.
- Object identity and staleness: how long an object can go unseen before its
  marker is removed (aircraft leaving radius, sim unloading them, etc.).
- Ingest payload shape and endpoint name for the traffic batch.
- Marker visual distinction from the user's own aircraft (color/size/icon).
- Whether ground traffic / parked aircraft should be filtered out or shown.

## Workflow tier and skipped steps

**Tier 3 — full loop.** This introduces a new data contract (traffic payload
shape, new ingest endpoint or extended status shape) that flows through four
components (agent, ingest, in-memory state, client map), so Planner and
Designer both run.

- **Ship (DevOps) step**: skipped unless the Designer's chosen approach
  requires a build/packaging/env change beyond normal code changes (unlikely
  — no new dependency is needed on the server or client; `node-simconnect`
  additions are agent-side, already a dependency).
