# API reference

All application routes are mounted under `/api`. There is no API versioning
(no `/v1` prefix) and no OpenAPI/Swagger spec — this document is the source
of truth, generated from `src/server.ts` and `src/routes/*.ts`.

## Auth model, in one table

| Auth type | How | Used by |
|---|---|---|
| **Session** | `msfslogger.sid` cookie, set by `POST /api/auth/login` | The web UI |
| **Ingest token** | `x-ingest-token` header, compared to `INGEST_TOKEN` | The Windows agent (`/api/ingest/*` only) and a small allow-listed set of other routes (below), e.g. the MCDU app |
| **Public** | none | `/api/auth/*`, the served client, and the SPA catch-all |

Every route below is one of exactly three values: **session** (cookie
only), **session or token** (either credential works), or **public** (no
auth at all). "Session or token" is not a default for `/api` — it applies
*only* to the 13 method+path pairs in the explicit allow-list
`INGEST_SCOPED_ROUTES` (`src/auth/ingestScope.ts`). Everything else under
`/api` is session-only: an otherwise-valid ingest token is never read for an
off-list route, let alone accepted. Full mechanism (CSRF, throttling, token
scoping) is in [security.md](security.md); this page only documents *which*
routes accept which credential.

## `GET /api/status`

Live application state, polled by the client (1s while flying, else 3s).

Session or token — allow-listed.

Response: `connected`, `flightState`, `currentFlightId`, `paused`,
`pauseFlags`, `simRunning`, `onGround`, `aircraft`, `frame` (`lat`, `lon`,
`altitudeFt`, `airspeedKnots`, `groundSpeedKnots`, `headingDeg`,
`verticalSpeedFpm`, `onGround`), plus conditionally: `plannedLeg` (only while
`flightState === 'FLYING'` with a frame present), `groundSession` (only
while `flightState === 'GROUND'`), `traffic` (only when non-empty).

## Flights — `src/routes/flights.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/flights` | session | List all flights |
| POST | `/api/flights/combine` | session | Merge two flights (`{id1, id2}`) → `201 {id}` |
| GET | `/api/flights/:id` | session | Single flight |
| PATCH | `/api/flights/:id` | session | Edit `aircraft` and/or `notes` |
| DELETE | `/api/flights/:id` | session | Delete a flight → `{deleted:true}` |
| POST | `/api/flights/:id/flight-plan` | session | Upload attached PDF (multipart, field `file`, ≤20MB, PDF only) |
| GET | `/api/flights/:id/flight-plan` | session | Stream the attached PDF inline |
| DELETE | `/api/flights/:id/flight-plan` | session | Remove the attached PDF |

None of this router's routes are ingest-token-scoped — note this is a
different router than the flight-scoped ACARS routes below, which share the
`/api/flights/:id/...` prefix but are allow-listed.

## Trips — `src/routes/trips.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/trips` | session | Create a trip (`{name, notes?}`) → `201 {id}` |
| GET | `/api/trips` | session | List trips |
| GET | `/api/trips/:id` | session | Single trip, fully populated |
| PATCH | `/api/trips/:id` | session | Edit `name`/`notes` |
| DELETE | `/api/trips/:id` | session | Delete a trip → `{deleted:true}` |
| POST | `/api/trips/:id/flights` | session | Assign a flight to the trip (`{flightId}`) |
| DELETE | `/api/trips/:id/flights/:flightId` | session | Remove a flight from the trip |
| GET | `/api/active-trip` | session | Currently active trip |
| PUT | `/api/active-trip` | session | Set active trip (`{tripId: number\|null}`) |
| GET | `/api/trips/:id/journey` | session | Journey/atlas summary (`buildJourney`) |

## Planned legs — `src/routes/plannedLegs.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/trips/:id/planned-legs` | session | Bulk `.lnmpln` import into a trip (multipart, field `lnmpln`, ≤25 files, ≤512KB each) |
| POST | `/api/planned-legs` | session | Same, as loose legs (no trip) |
| POST | `/api/trips/:id/planned-legs/simbrief` | session | Import a SimBrief OFP into the trip using the saved pilot ID |
| POST | `/api/planned-legs/simbrief` | session or token — allow-listed | Same, as a loose leg |
| GET | `/api/trips/:id/planned-legs` | session | Legs for a trip |
| GET | `/api/planned-legs` | session | All planned legs |
| PATCH | `/api/trips/:id/planned-legs/order` | session | Reorder legs (`{legIds: number[]}`, must be an exact permutation) |
| GET | `/api/planned-legs/:legId` | session | Single leg |
| DELETE | `/api/planned-legs/:legId` | session | Delete a leg |
| PATCH | `/api/planned-legs/:legId` | session | Set status to `'planned'` or `'skipped'` only — `409` if a flight is linked |
| PUT | `/api/flights/:id/planned-leg` | session | Manually link/unlink a flight and a leg (`{plannedLegId: number\|null}`) |
| PUT | `/api/flights/:id/planned-leg-status` | session | Hand-close/reopen a manually-linked leg (`{status:'flown'\|'planned'}`) |

Note the asymmetry: importing a SimBrief OFP into a *trip* requires a
session, but the *loose-leg* variant (`/api/planned-legs/simbrief`) is
allow-listed for a token too — a client with only an ingest token can
prefile a loose leg but not attach it to a trip in the same call.

## Exports — `src/routes/exports.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/flights/:id/export.pdf` | session | Headless-rendered PDF; query `plans=0` skips attached flight-plan PDFs, `tz`/`locale` control formatting |
| GET | `/api/trips/:id/export.pdf` | session | Same, for a whole trip |
| GET | `/api/flights/:id/export.kml` | session | KML track for one flight |
| GET | `/api/trips/:id/export.kml` | session | KML for all flights in a trip |
| POST | `/api/flights/export.kml` | session | KML for an arbitrary flight set (`{ids: number[]}`, capped at 100) |

## ACARS — `src/routes/acars.ts`

Every route in this router is allow-listed — a token-only client (the
Windows agent, or the MCDU app) can read and post ACARS messages without a
session.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/acars/canned-messages` | session or token | List canned downlink message templates |
| GET | `/api/flights/:id/acars-messages` | session or token | Thread for a flight |
| POST | `/api/flights/:id/acars-messages` | session or token | Send a canned downlink message (`canned_id` or matching `body`) |
| POST | `/api/flights/:id/acars-messages/wx` | session or token | Request/receive METAR/TAF for an arbitrary ICAO |
| GET | `/api/planned-legs/:legId/acars-messages` | session or token | Leg-scoped thread (pre-flight) |
| POST | `/api/planned-legs/:legId/acars-messages` | session or token | Leg-scoped canned downlink |
| POST | `/api/planned-legs/:legId/acars-messages/wx` | session or token | Leg-scoped weather request |
| POST | `/api/planned-legs/:legId/acars-messages/loadsheet` | session or token | Generate load sheet from on-file dispatch data — `409 NO_DISPATCH_DATA` if none |
| POST | `/api/planned-legs/:legId/acars-messages/clearance` | session or token | Generate PDC from on-file dispatch data — `409 NO_FLIGHT_PLAN` if none |

## Ground sessions — `src/routes/groundSessions.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/ground-sessions` | session | Manually create/refine the open ground session |
| GET | `/api/ground-sessions/current` | session or token — allow-listed | Currently open ground session, or `{session: null}` |
| DELETE | `/api/ground-sessions/current` | session | Close the open ground session — `404 NO_OPEN_GROUND_SESSION` if none |

## Settings — `src/routes/settings.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/settings/simbrief` | session or token — allow-listed | `{simbrief_user_id}` — null if unset |
| PUT | `/api/settings/simbrief` | session | Set the SimBrief pilot ID — note only the GET is allow-listed, not this write |

## Auth — `src/auth/routes.ts`

Mounted at `/api/auth`, always public (never behind the `requireAuth` gate).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `200 {user}` or `401`. Rate-limited: 10 failures / 15 min / IP → `429` with `Retry-After`. |
| POST | `/api/auth/logout` | Destroys the session. Always `204`. |
| GET | `/api/auth/session` | `{authenticated, user}`. Always `200`, never `401` — used for client-side auth-state polling. |

## Ingest — `src/ingest.ts`

Mounted at `/api/ingest`, authenticated independently by ingest token (not
session-gated, not behind `requireAuth`). This is the path the Windows agent
(and no other client) is expected to use.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/ingest/frame` | ingest token | One `SimFrame` sample — the sole path into the flight state machine |
| POST | `/api/ingest/event` | ingest token | A discrete event: `pause` (`{flags}`), `connected`, `disconnected`, `paused`, `unpaused`, `crashed` |
| POST | `/api/ingest/traffic` | ingest token | A batch of nearby AI/multiplayer aircraft (≤200 objects); in-memory only, never persisted |

`/api/ingest/*` also has its own narrow CORS handling for `Origin:
coui://html_ui` (the in-sim MCDU browser) — no other route in the server sets
CORS headers.

## Errors

Errors are JSON: `{"error": "<message>"}`, sometimes with a `code` field for
programmatic handling (e.g. `INVALID_INGEST_TOKEN`, `NOT_A_CANNED_MESSAGE`,
`NO_DISPATCH_DATA`, `NO_OPEN_GROUND_SESSION`). A malformed JSON body on a
handful of write endpoints (`/api/settings/*`, `*/acars-messages`,
`*/acars-messages/wx`, `/api/ground-sessions*`) is normalized to `400
{"error":"Invalid request body","code":"INVALID_BODY"}`; other invalid-JSON
routes fall through to Express's default error response.

## Consumers beyond the web UI

The ingest-scoped routes above (status, ACARS, ground-session-current,
SimBrief settings) exist so a non-browser client authenticated only by
ingest token — the Windows agent, and the separate MCDU/Tauri desktop client
(`oshogun/msfslogger_mcdu`) — can read status and exchange ACARS messages
without a session login. See [architecture.md](architecture.md) for how
these pieces fit together.
