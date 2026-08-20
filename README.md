# msfslogger

Automatic flight logger for Microsoft Flight Simulator 2020/2024 (and probably other sims that use SimConnect). Records GPS tracks, altitude profiles, and flight stats to a local SQLite database and displays them through a React web interface.

## How it works

The server records one data point per second while airborne, and saves completed flights to `flights.db`. Time spent with the simulation interrupted — **Active Pause**, a regular pause, or sitting in a menu — is not counted toward flight time, and no track points are recorded while paused. The web UI lets you browse flights, view GPS tracks and altitude charts, group flights into trips, edit or delete records, attach a PDF flight plan to each flight (stored in `flight_plans/`), and [export a flight or a whole trip as a PDF](#pdf-export).

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

To back up your data, copy `flights.db` and the `flight_plans/` folder.

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

## MSFS 2020 vs 2024

`node-simconnect` requires the client to declare which SimConnect protocol version it speaks, and MSFS 2020 and 2024 differ. This is set in the `open(...)` call in [`agent/agent.js`](agent/agent.js):

| MSFS version | `Protocol` value |
|---|---|
| MSFS 2020 | `Protocol.KittyHawk` |
| MSFS 2024 | `Protocol.SunRise` |

The agent targets **MSFS 2020** (`Protocol.KittyHawk`) by default. For MSFS 2024, change that line to `Protocol.SunRise`. A mismatched protocol version makes the connection handshake fail.

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
├── Dockerfile
└── docker-compose.yml
```

## Utility scripts

```bash
# Backfill ICAO departure/arrival codes for existing flights
npm run backfill-icao
```
