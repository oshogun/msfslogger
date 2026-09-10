# msfslogger

Automatic flight logger for Microsoft Flight Simulator 2020/2024 and FSX. Records GPS tracks, altitude profiles, and flight stats to a local SQLite database and displays them through a React web interface.

## How it works

The server records one data point per second while airborne, and saves completed flights to `flights.db`. Flight time is measured from the recorded track rather than the wall clock, so any interruption — **Active Pause**, a regular pause, a menu, slew mode, a frozen sim, even the agent dropping out — is excluded automatically. The web UI's sidebar is the primary navigation — every trip (expandable to its legs) and every standalone flight, plus links to the Home landing page and the full All Flights browser. **Home** is a summary landing page (live status, totals, recent flights); **All Flights** (`/flights`) is the browser — every flight and trip in one table, with multi-select for grouping flights into trips, [combining](#combining-flights) them, and KML export. A flight's or trip's own page is where you view GPS tracks and altitude charts, edit or delete records, attach a PDF flight plan (stored in `flight_plans/`), and [export as a PDF](#pdf-export).

Each trip can be viewed two ways. **Overview** is the working view — stats, notes, the combined route map and an editable legs table. **Atlas** (`/trip/:id?view=atlas`) is the analytical one: every leg drawn on a single map tinted from the trip's first flight to its last, plus airports, aircraft breakdown, countries visited (derived from ICAO prefixes), the longest unbroken chain of legs, and — for a trip with an [imported route](#trip-plans-little-navmap-import) — progress flown against that route's approximate total distance. Sections that say nothing about a given trip hide themselves, so a one-leg hop stays uncluttered.

A trip can also carry an [**imported route**](#trip-plans-little-navmap-import) from Little Navmap, ahead of flying it: while airborne on one of its legs, the live panel names the destination, the next waypoint, and the approximate distance remaining.

When MSFS and the server are on different machines, flight data gets across via the **agent**: a small script ([`agent/`](agent/)) that runs on the Windows machine, connects to SimConnect **locally** — exactly like any other local addon, with no TCP or firewall configuration — and pushes data to the server over plain HTTP. See [`agent/README.md`](agent/README.md) to set it up.

This is the only supported connection method. Remote SimConnect over TCP (pointing the server at `SimConnect.xml` + an open firewall port) is not supported: it is fragile in practice and, on a Microsoft Store install, never produced a working connection at all despite a correct, verified XML file.

If the server runs on the **same machine** as MSFS, you don't need the agent — `node-simconnect` connects locally automatically.

---

## Environment variables

The server validates its security-relevant variables at startup and refuses to
start on the first problem it finds — see [First run](#first-run) and
[HTTPS](#https) below for what that looks like and how to get past it.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port the server listens on — HTTPS or HTTP, never both (see [HTTPS](#https)) |
| `BIND_HOST` | No | `0.0.0.0` | Interface to bind. `0.0.0.0` is today's behaviour. `127.0.0.1` (or `::1`/`localhost`) is the loopback-only dev mode that needs no TLS or opt-out — see [Running locally](#running-locally-development) |
| `INGEST_TOKEN` | **Yes**, unless `ALLOW_UNAUTHENTICATED_INGEST` is set | *(none)* | Shared secret for the agent ingest endpoints (`/api/ingest/*`), compared timing-safely against the `x-ingest-token` header the agent sends. Must match the value configured on the agent — see [`agent/README.md`](agent/README.md). Without it, and without the opt-out below, the server will not start |
| `ALLOW_UNAUTHENTICATED_INGEST` | No | off | Insecure, trusted-LAN-only opt-out that runs `/api/ingest/*` with no token check at all — see [Insecure modes](#insecure-modes) |
| `TLS_CERT_FILE` | No, but see [HTTPS](#https) | *(none)* | PEM certificate (a chain is fine). Must be set together with `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | No | *(none)* | PEM private key |
| `TLS_KEY_PASSPHRASE` | No | *(none)* | Passphrase for an encrypted `TLS_KEY_FILE` |
| `ALLOW_PLAINTEXT_HTTP` | No | off | Insecure, trusted-LAN-only opt-out that allows plaintext HTTP on a non-loopback `BIND_HOST` — see [Insecure modes](#insecure-modes) |
| `SESSION_SECRET` | No | auto-generated and stored in `flights.db` | Must be ≥ 16 characters if set. Overriding it logs out every existing session |
| `EXPORT_BASE_URL` | No | `http://127.0.0.1:$PORT` | Where the [PDF export](#pdf-export) loads pages from. Only needs setting in dev, to point at the Vite server (`http://127.0.0.1:5173`) instead of the last built `client/dist`. |
| `TRAFFIC_ENABLED` | No | enabled | Server-side kill switch for [AI traffic on the live map](#ai-traffic-on-the-live-map). Set to `0`, `false`, `off` or `no` to make `/api/ingest/traffic` discard every batch it receives (`204`, no validation, nothing stored). The agent has its own, independently-read copy of the same variable — see [`agent/README.md`](agent/README.md). |

---

## First run

There is no HTTP setup flow — the server refuses to start until an operator
account exists, and (unless you opt out, see [Insecure modes](#insecure-modes))
until `INGEST_TOKEN` is set. Create the account once, before the first start,
after `npm run build` (the script lives in `dist/`, so it works the same way
in a plain checkout and in Docker, which has no dev dependencies):

```bash
npm run build
npm run set-password    # prompts for a username (default "operator") and a password
```

Run it again at any time to change the password — it upserts the one operator
row rather than requiring a delete first. Existing browser sessions are **not**
invalidated by a password change; they simply expire on their own schedule.

**Non-interactive / Docker.** `docker compose run` gives the command no TTY, so
when stdin is not a terminal the script reads the password from the first line
of stdin instead of prompting, and skips the confirmation step:

```bash
printf '%s\n' "$PW" | docker compose run --rm -T msfslogger node dist/setPassword.js
```

**Forgot the password?** Re-run the same command with a new password — that
*is* the reset. To also force every currently logged-in session to re-login
(a password change alone doesn't do this), delete the session rows:

```bash
node -e "new (require('better-sqlite3'))('flights.db').prepare('DELETE FROM auth_session').run()"
```

---

## HTTPS

Set `TLS_CERT_FILE` and `TLS_KEY_FILE` (PEM, required together) to serve
HTTPS instead of plaintext HTTP; add `TLS_KEY_PASSPHRASE` if the key is
encrypted. Both files are read once at startup and held in memory for the
life of the process, so **rotating a certificate needs a restart** — there is
no hot-reload.

Generate a self-signed certificate (verified with OpenSSL 3.0.13 on this
machine):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout msfslogger-key.pem -out msfslogger-cert.pem \
  -subj "/CN=msfslogger" \
  -addext "subjectAltName=IP:<server-lan-ip>,DNS:<server-hostname>"
```

Browsers show a one-time warning for a self-signed certificate, which you
accept once per browser. The agent needs the same certificate file trusted
separately — see [`agent/README.md`](agent/README.md).

**One port, one protocol.** `PORT` serves either HTTPS or HTTP, never both —
there is no listener that redirects `http://` to `https://`. If you turn TLS
on, update any bookmark or shortcut from `http://host:3000` to
`https://host:3000`; the old `http://` URL will fail to connect, not redirect.

### Insecure modes

Two environment variables intentionally weaken security, each printing a
warning on every start it's active for. Never set either on a host reachable
from the internet — both are insecure, trusted-LAN-only opt-outs.

- **`ALLOW_UNAUTHENTICATED_INGEST`** — runs `/api/ingest/*` with no token
  check. If you set neither this nor `INGEST_TOKEN`, the server's own refusal
  message ends with:
  > ...or set ALLOW_UNAUTHENTICATED_INGEST=1 to run ingest unauthenticated (insecure - LAN only).
- **`ALLOW_PLAINTEXT_HTTP`** — allows the server to bind a non-loopback
  address (see `BIND_HOST` above) without TLS. Its startup warning:
  > WARNING: serving plaintext HTTP on \<host\>:\<port\> because ALLOW_PLAINTEXT_HTTP is set. The session cookie and the ingest token cross the network unencrypted. Configure TLS_CERT_FILE and TLS_KEY_FILE (README § HTTPS).

---

## Running locally (development)

### Prerequisites

- Node.js 20+ (see note below — newer Node versions can break the build)
- Microsoft Flight Simulator 2020, 2024, or FSX running on Windows (the same machine or network-reachable)

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

`npm run dev` enforces the same startup checks as any other environment — it
still needs `INGEST_TOKEN` set and an operator account created (see
[First run](#first-run)) before it will run. The one thing dev doesn't need is
TLS: export `BIND_HOST=127.0.0.1` and the server binds loopback-only, prints
`No TLS configured — serving plaintext HTTP on loopback only.`, and needs no
`ALLOW_PLAINTEXT_HTTP` opt-out, because nothing leaves the machine:

```bash
export BIND_HOST=127.0.0.1
export INGEST_TOKEN=devtoken1234567890
npm run dev
```

This starts both the Express server (port `3000`) and the Vite dev server (port `5173`) concurrently. Open **http://localhost:5173** during development — Vite proxies all `/api` calls to Express.

`client/vite.config.ts`'s `/api` proxy must keep `changeOrigin` unset
(defaults to `false`): that's what makes the browser's `Origin:
http://localhost:5173` match the `Host` header the Express server sees, which
the same-origin check on every state-changing request depends on. Turning it
on makes those requests start failing with `403`.

---

## Running in production (built)

```bash
npm run build    # compiles client → client/dist, server → dist
npm start        # serves everything on PORT (default 3000)
```

Open **http://localhost:3000**.

### Running the tests

```bash
npm test          # runs the whole suite once, non-interactively
npm run test:watch # re-runs affected tests on save, for local development
npm run test:types # typechecks tests/ (npx tsc / npm run build does not)
```

Tests live under `tests/` (Vitest) and cover the server-side logic in `src/` —
they are not exercised through the UI. There is no coverage tooling, but
[CI](.github/workflows/ci.yml) runs build, `test:types` and `npm test` on
every push and pull request; `npm test` is what a change should pass before it
ships.

---

## Running with Docker

### Prerequisites

- Docker and Docker Compose
- The [agent](agent/) running on the Windows machine with MSFS, with its `SERVER_URL` pointed at this machine's IP and port `3000`

### 1. Build and start

The `flights.db` bind mount needs the file to already exist — if it doesn't,
Compose silently creates a *directory* there instead of failing, and the
server then fails to open it as a database:

```bash
touch flights.db
mkdir -p flight_plans
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

## Upgrading from an earlier version

This is a deliberate breaking change: an existing deployment that pulls this
build and takes no other action will not start. Verified against a completely
empty environment (nothing exported at all — `BIND_HOST` defaults to
`0.0.0.0`, which is not loopback): the server refuses to start with the
plaintext/TLS message first, *then*, once that's resolved, with the missing
`INGEST_TOKEN` message, and only then, once both are resolved, with the
missing-operator-account message — three sequential refusals as each is fixed
in turn, not one. `INGEST_TOKEN` is checked before the database is opened
either way, so nothing is written and nothing is lost at any step.

Minimum sequence to a working deployment:

```
npm run build
node dist/setPassword.js                 # or: npm run set-password
export INGEST_TOKEN=$(openssl rand -hex 24)
# EITHER supply a certificate:
export TLS_CERT_FILE=/etc/msfslogger/cert.pem TLS_KEY_FILE=/etc/msfslogger/key.pem
# OR accept plaintext on the LAN, knowingly:
export ALLOW_PLAINTEXT_HTTP=1
npm start
```

Afterwards: browsing to the app redirects to `/login` until you sign in with
the account from [First run](#first-run); with TLS on, the URL becomes
`https://…` and a self-signed certificate produces a one-time browser warning;
the agent stops delivering data until its environment has the same
`INGEST_TOKEN` and, if TLS is on, a trusted certificate (see
[`agent/README.md`](agent/README.md)) — flights in progress aren't corrupted,
the server just marks the agent disconnected after the existing 10s stale
timeout; PDF and KML export keep working exactly as before, from inside a
logged-in session.

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

PDF export works in the provided Docker image. The production stage is
`node:20-alpine`; Puppeteer's own bundled Chromium is a glibc build that
cannot run on Alpine's musl, and the base image ships no fonts, so the
Dockerfile skips Puppeteer's download, installs Alpine's native Chromium
build instead, and points Puppeteer at it:

```dockerfile
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

`docker-compose.yml` also sets `init: true` — Chromium spawns child processes
that PID 1 would otherwise leave as zombies.

---

## KML export

The **Export KML** button — on a flight page, a trip page, and in the All
Flights page's (`/flights`) multi-select toolbar — produces a data export of
the flown track(s) for opening in Google Earth or another GIS tool, rather
than a rendered document like the PDF export above.

| Endpoint | Produces |
|---|---|
| `GET /api/flights/:id/export.kml` | One flight's track |
| `GET /api/trips/:id/export.kml` | Every flight in the trip, one folder per flight, in `start_time` order |
| `POST /api/flights/export.kml` | An arbitrary set of flights (used by the All Flights page's multi-select toolbar) |

The third endpoint is a `POST` because the flight set is chosen in the browser
and doesn't fit in a URL the way a single id does; it takes the ids in a JSON
body instead of a query string:

```bash
curl -si -X POST localhost:3000/api/flights/export.kml \
  -H 'Content-Type: application/json' \
  -d '{"ids":[63,59,57]}'
```

`ids` is required: 1–100 integers. Duplicates are silently de-duplicated, and
the request order doesn't matter — the output is always sorted by `start_time`
regardless of what order the ids were sent in.

### What you get

Each flight becomes a `Placemark` holding its recorded GPS track as a plain KML
`LineString` (longitude, latitude, altitude in metres, one point per second as
recorded, decimated above 5,000 points so a pathologically long track still
opens). Clicking the placemark shows a table with the aircraft, departure and
arrival ICAO, start and end time (UTC), duration, distance, and max altitude,
plus the number of track points in that export. Notes, attached flight plans,
and planned-leg links aren't included — export a PDF for those.

A single-flight export is one `Placemark` directly in the KML `Document`; a
trip or flight-set export wraps each flight in its own `Folder` first, so a
multi-leg trip gets one show/hide checkbox per leg in Google Earth's layer
tree, with the legs colour-cycled the same way they are on the app's own map.

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

## MSFS 2020 vs 2024 vs FSX

`node-simconnect` requires the client to declare which SimConnect protocol version it speaks, and MSFS 2020, MSFS 2024 and FSX differ. The agent picks this via a `--sim`/`-s` command-line flag, documented in [`agent/README.md`](agent/README.md#msfs-2020-vs-2024-vs-fsx):

| MSFS version | `--sim` value | `Protocol` value |
|---|---|---|
| MSFS 2020 | `2020` (default) | `Protocol.KittyHawk` |
| MSFS 2024 | `2024` | `Protocol.SunRise` |
| FSX | `fsx` | `Protocol.FSX_SP2` |

```powershell
node agent.js --sim 2024
```

Omitting the flag defaults to MSFS 2020. A mismatched protocol version makes the connection handshake fail.

---

## AI traffic on the live map

While the agent is connected, it also sweeps SimConnect every **2 seconds**
for other aircraft (AI or multiplayer traffic MSFS itself reports) within
**40 km (~21.6 NM)** of the user, and pushes them to the server alongside the
regular flight-data frames. The live map draws one small marker per aircraft —
amber if it's airborne, grey if it's on the ground — next to the user's own,
larger marker. Parked/gate-held aircraft are filtered out on the agent side;
taxiing and rolling ones are shown. A busy terminal area can easily have
dozens of aircraft in range at once; the server keeps at most the 100 closest
to the user and drops the rest.

**None of this is written to `flights.db`.** Traffic lives in memory on the
server only, for as long as it keeps arriving — a set that goes 10 seconds
without a fresh batch is cleared, and a server restart loses it entirely. It
never appears in a flight's log, track, or PDF export.

To turn it off, set `TRAFFIC_ENABLED=0` (also accepts `false`, `off`, `no`) on
the **agent** (skips gathering entirely) and/or the **server** (drops any
batch it receives) — see [`agent/README.md`](agent/README.md) for the full
list of agent-side traffic environment variables, including the sweep radius
override.

---

## Combining flights

A pause long enough for MSFS or the agent to drop out mid-flight gets logged
as two separate flights instead of one. From the **All Flights** page
(`/flights`), check exactly two flights and click **Combine Selected** to
merge them into one: the two legs are ordered by start time regardless of
which order you selected them in, their recorded durations are summed (so
the gap between them is never counted as flown time), and a short synthetic
track is interpolated between the last point of the first leg and the first
point of the second so the map and altitude chart don't show a jump. Both
original flights are deleted once the merge succeeds — this cannot be
undone. A flight with no recorded points can't be selected for combining.

The same checkboxes also drive **New Trip** and **Add to Trip**, for grouping
selected flights into a trip.

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
│   ├── airports.ts       # ICAO airport lookup
│   ├── trafficStore.ts   # In-memory AI-traffic store (never written to flights.db)
│   └── inspect-traffic.ts # CLI: transcribed truth-table check of the traffic store/ingest path
├── agent/                # Runs on the Windows machine with MSFS — the supported setup
│   ├── agent.js          # Connects to SimConnect locally, pushes data to the server
│   ├── traffic.js        # Pure AI-traffic batch assembly, no SimConnect dependency
│   ├── inspect-traffic.js # CLI: transcribed truth-table check of agent/traffic.js
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
