# Usage

## Logging a flight

1. Start msfslogger (`npm start`, or your process manager of choice — see
   [operations.md](operations.md)).
2. On the Windows PC running MSFS, start the [agent](../agent/README.md).
3. Launch MSFS and load into a flight (or even just the main menu). The
   agent's console shows `Connected to SimConnect`, and the web UI's status
   dot / `GET /api/status` reports `connected: true`.
4. Nothing else is required — the server detects parking, taxi, takeoff, and
   landing automatically from telemetry (see
   [architecture.md § Flight state machine](architecture.md#flight-state-machine)).
   No "start recording" action exists or is needed.
5. Pausing the sim (including the pause menu) stops the clock without ending
   the flight; a crash or MSFS exit ends it.

## Planning a trip

Two ways to pre-load a route before flying it:

- **Import `.lnmpln` files** exported from Little Navmap, either into a
  specific trip or as loose (unassigned) planned legs, from the Prefiles
  page or a trip's detail page. Multiple files in one upload are
  chain-ordered automatically (destination of one matched to departure of
  the next) when possible.
- **Import a SimBrief OFP** by pilot ID (set once under Settings) — pulls
  route, cruise altitude, and dispatch data directly from SimBrief.

Mark one trip **active** to enable automatic leg matching: when you take off
within 10nm of an active trip's planned departure, the flight links itself
to that leg (see [architecture.md § Leg matching](architecture.md#leg-matching-and-closing)).
You can also link/unlink a flight to a leg by hand from the flight detail
page.

## Reviewing flights and trips

- **Home** — dashboard: live in-flight panel (map, speed/altitude/heading),
  current ground position if parked, aggregate stats, recent flights.
- **All Flights** — full log, grouped by trip, with combine/export/new-trip
  actions.
- **Prefiles** — every planned leg (trip-linked or loose), filterable by
  status/trip/search, with import actions.
- **Flight detail** — map, altitude chart, stats, notes, attached flight-plan
  PDF, planned-leg link, PDF/KML export, edit/delete.
- **Trip detail** — combined map ("Atlas" view), paginated leg table,
  imports, active-trip toggle, flight↔leg linking, PDF/KML export.

## Combining flights

If a dropped agent connection or a sim crash splits one real flight into two
log entries, combine them from the All Flights page (or `POST
/api/flights/combine`). This merges points and durations; it does not
re-resolve ICAO codes on the result — run `npm run backfill-icao` afterward
if you combine many flights (see [operations.md](operations.md)).

## Exporting

- **PDF** — one flight or a whole trip, rendered headlessly from the app's
  own print pages (so it looks like the web UI), with attached flight-plan
  PDFs appended unless `?plans=0`.
- **KML** — one flight, a whole trip, or an arbitrary set of flight IDs, for
  opening in Google Earth or similar.

Both are available from the relevant page's export button, or directly via
the [API](api.md#exports--srcroutesexportsts).

## ACARS (datalink)

A simulated ACARS inbox/outbox per flight and per planned leg:

- Canned downlink messages (a fixed template list).
- Weather requests — fetches live METAR/TAF for any ICAO.
- Load sheet and PDC (pre-departure clearance) generation, from dispatch data
  already on file for the leg (import a SimBrief OFP first — without
  dispatch data these return `409`).
- Automatic OOOI (Out/Off/On/In) messages and periodic position reports are
  filed by the flight state machine itself, no action needed.
- **Optional**: link a [SayIntentions.AI](https://www.sayintentions.ai/) pilot
  API key under Prefiles to enable link/import (flight scope) and send
  (flight and planned-leg scope) controls on the ACARS page — importing
  SayIntentions' own AI-ATC/CPDLC transcript into this same thread, and
  sending an on-file PDC into the pilot's live SayIntentions session as a
  real CPDLC message. Off by default: with no key set, the ACARS page still
  shows a disabled SayIntentions section explaining why, rather than nothing
  at all. See [api.md § SayIntentions](api.md#sayintentions--srcroutessayintentionsts).

## Run, debug, test

| Task | Command |
|---|---|
| Dev server (server + client, hot reload) | `npm run dev` |
| Production build | `npm run build` |
| Start (after build) | `npm start` |
| Type-check the app | `npx tsc --noEmit` |
| Type-check the app + tests | `npm run test:types` |
| Run the backend test suite once | `npm test` |
| Run the backend test suite in watch mode | `npm run test:watch` |
| Run the frontend component tests | `cd client && npm test` |
| Run the end-to-end (Playwright) tests | `cd client && npm run test:e2e` |

All `node`/`npm`/`npx` commands assume Node 20 is active (`nvm use`). See
[development.md](development.md) for the test suite's conventions.

## Logs

The server logs to stdout/stderr with bracketed component prefixes — among
others, `[Config]`, `[DB]`, `[Auth]`, `[HTTP]`, `[Ingest]`, `[FlightManager]`,
`[ACARS]`, `[PDF]`, `[KML]`, `[Shutdown]`, `[Airports]` — no structured log
file or log level configuration exists. Redirect stdout
yourself if you want a log file (e.g. `npm start >> server.log 2>&1 &`, or
your process manager's own log capture — see [operations.md](operations.md)).

## Common operational failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Server exits immediately, `[Config] ...` on stderr | Missing/invalid env var | Read the printed message — it names the exact variable; see [configuration.md](configuration.md) |
| Server exits, `[Auth] Refusing to start: no operator account exists.` | Never ran `set-password` | `npm run set-password` |
| `better-sqlite3` fails to load / server won't start at all | Wrong Node version | `nvm use` (must be Node 20) |
| Agent log shows reconnect loop, web UI shows `connected: false` | Wrong `SERVER_URL`/`INGEST_TOKEN`, or agent doesn't trust the server's TLS cert | Check both sides' `INGEST_TOKEN` match exactly; set `NODE_EXTRA_CA_CERTS` on the agent — see [`agent/README.md`](../agent/README.md#https) |
| `401 Invalid or missing ingest token` from a non-agent client | Token missing/mismatched, or that route isn't ingest-scoped | See the allow-list in [api.md](api.md#auth-model-in-one-table) |
| `429` on login | Login throttle (10 failures / 15 min / IP) | Wait out the window (resets on server restart — the throttle is in-memory) |
| Docker Compose created a `flights.db/` directory | Bind-mount target didn't exist before `up` | `touch flights.db` before first `docker compose up` |

More diagnostics in [troubleshooting.md](troubleshooting.md).
