# msfslogger

Automatic flight logger for Microsoft Flight Simulator 2020/2024 (and probably other sims that use SimConnect). Records GPS tracks, altitude profiles, and flight stats to a local SQLite database and displays them through a React web interface.

## How it works

The server records one data point per second while airborne, and saves completed flights to `flights.db`. Flight time is measured from the recorded track rather than the wall clock, so any interruption — **Active Pause**, a regular pause, a menu, slew mode, a frozen sim, even the agent dropping out — is excluded automatically. The web UI lets you browse flights, view GPS tracks and altitude charts, group flights into trips, edit or delete records, attach a PDF flight plan to each flight (stored in `flight_plans/`), and [export a flight or a whole trip as a PDF](#pdf-export).

Each trip can be viewed two ways. **Overview** is the working view — stats, notes, the combined route map and an editable legs table. **Atlas** (`/trip/:id?view=atlas`) is the analytical one: every leg drawn on a single map tinted from the trip's first flight to its last, plus airports, aircraft breakdown, countries visited (derived from ICAO prefixes), the longest unbroken chain of legs, and — for a trip with an [imported route](#trip-plans-little-navmap-import) — progress flown against that route's approximate total distance. Sections that say nothing about a given trip hide themselves, so a one-leg hop stays uncluttered.

A trip can also carry an [**imported route**](#trip-plans-little-navmap-import) from Little Navmap, ahead of flying it: while airborne on one of its legs, the live panel names the destination, the next waypoint, and the approximate distance remaining.

When MSFS and the server are on different machines, flight data gets across via the **agent**: a small script ([`agent/`](agent/)) that runs on the Windows machine, connects to SimConnect **locally** — exactly like any other local addon, with no TCP or firewall configuration — and pushes data to the server over plain HTTP. See [`agent/README.md`](agent/README.md) to set it up.

This is the only supported connection method. Remote SimConnect over TCP (pointing the server at `SimConnect.xml` + an open firewall port) is not supported: it is fragile in practice and, on a Microsoft Store install, never produced a working connection at all despite a correct, verified XML file.

If the server runs on the **same machine** as MSFS, you don't need the agent — `node-simconnect` connects locally automatically.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the HTTP server listens on |
| `INGEST_TOKEN` | *(none)* | Optional shared secret for the agent ingest endpoints (`/api/ingest/*`). If set, the agent must send it back as the `x-ingest-token` header. If unset, the endpoints are unauthenticated — fine on a trusted home LAN, not recommended otherwise. |
| `EXPORT_BASE_URL` | `http://127.0.0.1:$PORT` | Where the [PDF export](#pdf-export) loads pages from. Only needs setting in dev, to point at the Vite server (`http://127.0.0.1:5173`) instead of the last built `client/dist`. |

---

## Running locally (development)

### Prerequisites

- Node.js 20+ (see note below — newer Node versions can break the build)
- Microsoft Flight Simulator 2020 or 2024 running on Windows (the same machine or network-reachable)

**Node version note:** `better-sqlite3` is a native addon and only ships prebuilt binaries for supported Node ABI versions. Very new/unreleased Node versions (e.g. Node 26) may have no prebuilt binary available, and compiling it from source can fail against a too-new V8 API. Use a current LTS release (Node 20 or 22) to avoid this. This repo pins `20` in `.nvmrc` — run `nvm use` (after `nvm install` if needed) before installing dependencies.

### 1. Install dependencies

```bash
# Root (server)
npm install

# React client
cd client && npm install && cd ..
```

### 2. Connect MSFS (if it's on a different machine)

Set up the [agent](agent/) on the Windows machine running MSFS — see [`agent/README.md`](agent/README.md) for full instructions. In short:

```powershell
cd agent
npm install
$env:SERVER_URL = "http://<this-machine-ip>:3000"
npm start
```

Nothing needs configuring on the server side — it just listens for the agent's data on `/api/ingest`.

If MSFS is on the **same machine** as the server, you don't need the agent or any of this — `node-simconnect` connects locally automatically.

### 3. Start

```bash
npm run dev
```

This starts both the Express server (port `3000`) and the Vite dev server (port `5173`) concurrently. Open **http://localhost:5173** during development — Vite proxies all `/api` calls to Express.

---

## Running in production (built)

```bash
npm run build    # compiles client → client/dist, server → dist
npm start        # serves everything on PORT (default 3000)
```

Open **http://localhost:3000**.

---

## Running with Docker

### Prerequisites

- Docker and Docker Compose
- The [agent](agent/) running on the Windows machine with MSFS, with its `SERVER_URL` pointed at this machine's IP and port `3000`

### 1. Build and start

```bash
docker compose up --build
```

Open **http://localhost:3000**.

### 2. Persistent data

`flights.db` and `flight_plans/` (attached PDF flight plans) are mounted as bind mounts from the project root, so your data survives container rebuilds:

```yaml
volumes:
  - ./flights.db:/app/flights.db
  - ./flight_plans:/app/flight_plans
```

See [Backups](#backups) below — copying `flights.db` by hand is not reliable while the server is running.

**WAL note for Docker:** SQLite runs in WAL mode, so it also writes `flights.db-wal` and `flights.db-shm` next to the database. Those are *not* bind-mounted by the compose file above, so they live only inside the container. The server checkpoints the WAL back into `flights.db` when it shuts down cleanly, which `docker compose stop`/`down` does — but a `docker kill`, an OOM, or a crashed container can strand recently recorded flights. Prefer stopping the container gracefully, and take real backups with `npm run backup`.

### Rebuilding after code changes

```bash
docker compose up --build
```

---

## PDF export

The **Export PDF** button on any flight or trip page produces a print-ready document: stats, notes, the GPS track map and the altitude profile, with any attached flight plans appended as extra pages. A trip export gets an overview page (combined route map + legs table) followed by one detail page per leg.

| Endpoint | Produces |
|---|---|
| `GET /api/flights/:id/export.pdf` | One page for the flight, plus its attached plan |
| `GET /api/trips/:id/export.pdf` | Overview page, one page per leg, plus every leg's attached plan |

### Query parameters

| Param | Default | Effect |
|---|---|---|
| `plans` | `1` | Set `0` (or `false`) to omit attached flight plans |
| `tz` | server timezone | IANA timezone for timestamps, e.g. `America/Sao_Paulo` |
| `locale` | server locale | BCP 47 locale for dates, e.g. `pt-BR` |

The web UI sends `tz`/`locale` from the browser automatically — without them, timestamps render in the **server's** timezone, which is rarely what you want.

**Attached plans dominate the page count**, so there's an *Include flight plans* checkbox next to the Export button (shown only when something is actually attached). For a 5-leg trip whose legs each have a plan:

| | Pages | Size |
|---|---|---|
| With plans | 120 | 3.2 MB |
| `?plans=0` | 6 | 1.1 MB |

### How it works

The server renders a hidden, print-styled route in its own React app (`/print/flight/:id`, `/print/trip/:id`) using headless Chromium via Puppeteer, then merges in the attached plans with `pdf-lib`. Reusing the real map and chart components keeps the PDF visually in step with the web UI instead of drifting from a separate template.

Some consequences worth knowing:

- **The client must be built.** The export loads the page from `client/dist`, so run `npm run build` first. Under `npm run dev` (Vite on :5173), set `EXPORT_BASE_URL=http://127.0.0.1:5173` to render live client code instead of the last build.
- **It needs network access to OpenStreetMap**, since the map tiles are fetched at render time. Without it the export still succeeds, but the maps come out blank.
- **Chromium is downloaded on install** (~300 MB) as part of the `puppeteer` dependency.
- Exports are generated one at a time; a shared browser instance is reused and shuts down after 5 minutes idle.

### Docker caveat

**PDF export does not work in the provided Docker image as-is.** The production stage is `node:20-alpine`, and Puppeteer's bundled Chromium is a glibc build that cannot run on Alpine's musl — the image also ships no fonts, so text would render as boxes. Everything else in the app works normally; only the export endpoints fail.

To make it work, either switch the production stage to a Debian base (`node:20-slim` + `apt-get install chromium fonts-liberation`), or install Alpine's own build and point Puppeteer at it:

```dockerfile
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

Add `init: true` to the compose service as well — Chromium spawns child processes that PID 1 would otherwise leave as zombies.

---

## Trip plans (Little Navmap import)

A trip can hold an **imported route**: the sequence of legs from one or more `.lnmpln` files exported
by [Little Navmap](https://albar965.github.io/littlenavmap.html). This is a different feature from
the PDF **flight plan** you can attach to a flight (above) — a planned leg is a *route*, imported
*before* you fly it, used to draw the expected path on the trip map and to (optionally) match the
flight that follows it; a flight plan is a *document* attached to a flight *after* it lands. The two
can coexist on the same trip without conflict, but neither substitutes for the other.

Import one or more `.lnmpln` files from a trip's page (**Import Planned Route**). Each file becomes
one planned leg, with its waypoints, cruise altitude, and any SID/STAR/approach names it records.
Uploading several files at once tries to chain them into route order — matching each leg's
destination to the next leg's departure — and falls back to upload order (with a warning shown) when
that doesn't resolve uniquely, which is always true of a round trip.

**Distance is always labelled `approx.`.** The file stores the en-route waypoint chain, not the
SID/STAR/approach procedures flown at each end, so the real route is normally somewhat longer than
the number shown — on an IFR leg with real procedures, sometimes considerably longer. This is a
property of the file format, not a bug in the import.

**Active trip.** Automatic linking only ever considers the one trip marked active (**Set as Active
Trip** on the trip page). Marking a trip active is entirely optional — without it, flights are
recorded exactly as they were before this feature existed.

**Linking a flight to a leg.**

| | How | What it does on landing |
|---|---|---|
| Automatic | Taking off within ~10 nm of an unflown planned leg's departure, on the active trip | Marks the leg *flown* if the arrival matches the plan, or *diverted* (with the distance off) if it doesn't — either way, the flight is kept |
| Manual | Link/unlink a flight to any trip's unflown leg from the trip page, active or not | Same as above |

Manual linking exists as a deliberate escape hatch — for a plan imported after the fact, or to
correct an automatic match — and is not restricted to the active trip.

**Marking a hand-linked leg flown by hand.** A flight linked to its leg manually, after the flight
has already ended, never passes through the landing check above, so its leg stays *planned*
forever. On that flight's own page — not the trip page — once the flight has ended, a control marks
the leg *flown* by hand: it records how far the flight's actual arrival was from the planned
destination, the same way the automatic check does, but the leg is always marked *flown*, never
*diverted*, however far off the arrival was — only the automatic check on landing can mark a leg
diverted. The same control reverses the change, back to *planned* and clearing that distance,
without unlinking the flight.

---

## MSFS 2020 vs 2024

`node-simconnect` requires the client to declare which SimConnect protocol version it speaks, and MSFS 2020 and 2024 differ. This is set in the `open(...)` call in [`agent/agent.js`](agent/agent.js):

| MSFS version | `Protocol` value |
|---|---|
| MSFS 2020 | `Protocol.KittyHawk` |
| MSFS 2024 | `Protocol.SunRise` |

The agent targets **MSFS 2020** (`Protocol.KittyHawk`) by default. For MSFS 2024, change that line to `Protocol.SunRise`. A mismatched protocol version makes the connection handshake fail.

---

## Backups

```bash
npm run backup
```

Writes `backups/<timestamp>/` containing `flights.db` plus a copy of `flight_plans/`, then reopens the result to verify it and print what it holds. It is safe to run while the server is live, and takes an optional destination argument.

**Do not just `cp flights.db`.** The database runs in WAL mode, so recent commits can still live in `flights.db-wal` — a plain copy of the main file alone can silently omit them, or come out unreadable if a checkpoint has not happened yet. `npm run backup` uses SQLite's online backup API, which reads through the WAL and writes one self-consistent file.

A copy taken *after* a clean shutdown is fine, because the server checkpoints the WAL into `flights.db` when it receives SIGINT or SIGTERM. The risk is copying a database that is currently open.

To restore, stop the server and copy `flights.db` and `flight_plans/` from a backup directory back into the project root.

---

## Project structure

```
msfslogger/
├── src/                  # Express server (TypeScript)
│   ├── index.ts          # Entry point, starts the server
│   ├── server.ts         # REST API routes
│   ├── ingest.ts         # Receives data pushed by the Windows agent
│   ├── db.ts             # SQLite queries
│   ├── flightManager.ts  # Flight state machine
│   ├── flightPlans.ts    # PDF flight plan file storage
│   ├── lnmpln.ts         # Little Navmap .lnmpln parser (imported trip plans)
│   ├── legMatcher.ts     # Matches a just-started flight to a planned leg
│   ├── plannedLegClose.ts # Gate + deviation for closing a hand-linked planned leg by hand
│   ├── journey.ts        # Trip atlas + planned-route progress
│   ├── pdfExport.ts      # Headless-Chromium PDF rendering + attachment merging
│   └── airports.ts       # ICAO airport lookup
├── agent/                # Runs on the Windows machine with MSFS — the supported setup
│   ├── agent.js          # Connects to SimConnect locally, pushes data to the server
│   └── README.md
├── client/               # React frontend (Vite + TypeScript)
│   └── src/
│       ├── pages/        # Home, FlightDetail, TripDetail, PrintFlight, PrintTrip
│       ├── components/   # Header, LivePanel, maps, charts
│       ├── hooks/        # useStatus (live sim polling)
│       ├── print.css     # Light theme for the PDF export routes
│       └── utils/        # API fetch, formatters, downsampling, export-ready signal
├── airports.json         # Airport database for ICAO lookup
├── flights.db            # SQLite database (created on first run)
├── flight_plans/         # Attached PDF flight plans, one per flight (created on first run)
├── backups/              # npm run backup output (gitignored)
├── Dockerfile
└── docker-compose.yml
```

## Utility scripts

```bash
# Back up the database and attached flight plans (safe while the server runs)
npm run backup
npm run backup /path/to/somewhere   # optional explicit destination

# Backfill ICAO departure/arrival codes for existing flights
npm run backfill-icao

# Recompute stored durations from recorded tracks. Flights logged before
# duration was track-derived counted interruptions the sim never reported
# (a frozen sim, most of all) as flight time. Dry run by default:
npm run backfill-durations
npm run backfill-durations -- --apply
```
