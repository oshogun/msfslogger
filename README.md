# msfslogger

Automatic flight logger for Microsoft Flight Simulator 2020/2024 (and probably other sims that use SimConnect). Records GPS tracks, altitude profiles, and flight stats to a local SQLite database and displays them through a React web interface.

## How it works

The server records one data point per second while airborne, and saves completed flights to `flights.db`. The web UI lets you browse flights, view GPS tracks and altitude charts, group flights into trips, and edit or delete records.

There are two ways to get flight data from MSFS to the server when they're on different machines:

- **Agent (recommended, confirmed working):** a small script ([`agent/`](agent/)) runs on the Windows machine with MSFS, connects to SimConnect **locally** (exactly like any other local addon — no TCP/firewall config needed), and pushes data to the server over plain HTTP. See [`agent/README.md`](agent/README.md). This is the setup actually in use — verified end-to-end with a real logged flight (SSCN → SBFL, 172.4 nm).
- **Direct remote connection (alternative, not recommended):** the server itself connects out to SimConnect's TCP port on the Windows host. `node-simconnect` v4 supports this natively, but it requires editing `SimConnect.xml` on the Windows machine and opening a firewall port — see [SimConnect TCP setup](#simconnect-tcp-setup-direct-remote-connection) below. In practice this proved fragile and never got a connection working (wrong `SimConnect.xml` path for the Store/Xbox install, Windows Store apps not fully restarting to pick up config changes, `ETIMEDOUT` even with a correct, verified XML file) — kept documented for reference, but use the agent instead.

If the server runs on the **same machine** as MSFS, neither is needed — `node-simconnect` connects locally automatically.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the HTTP server listens on |
| `INGEST_TOKEN` | *(none)* | Optional shared secret for the agent ingest endpoints (`/api/ingest/*`). If set, the agent must send it back as the `x-ingest-token` header. If unset, the endpoints are unauthenticated — fine on a trusted home LAN, not recommended otherwise. |
| `SIMCONNECT_HOST` | *(unset)* | Only used for the **direct remote connection** alternative (not needed with the agent). IP or hostname of the machine running MSFS. When unset, the server does not attempt any direct SimConnect connection at all and just waits for agent data. |
| `SIMCONNECT_PORT` | *(unset)* | TCP port SimConnect listens on. Only used when `SIMCONNECT_HOST` is also set — both must be set together for a remote connection. `500` is the conventional port used in the setup instructions below. |

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

Leave `SIMCONNECT_HOST`/`SIMCONNECT_PORT` unset on the server in this case — the server just listens for the agent's data on `/api/ingest`.

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
- MSFS running on a Windows host reachable from the container

### 1. Configure

If using the [agent](agent/) (recommended), no `SIMCONNECT_HOST`/`SIMCONNECT_PORT` configuration is needed — just point the agent's `SERVER_URL` at this machine's IP and port `3000`.

For the direct remote connection alternative instead, copy the example below into a `.env` file next to `docker-compose.yml`:

```bash
# .env
SIMCONNECT_HOST=host.docker.internal  # on Docker Desktop for Windows this resolves to the host
SIMCONNECT_PORT=500
PORT=3000
```

`host.docker.internal` is the standard hostname Docker Desktop provides to reach the Windows host from inside a container. If you are on a different network topology, set `SIMCONNECT_HOST` to the explicit IP address of the Windows machine.

### 2. Build and start

```bash
docker compose up --build
```

Open **http://localhost:3000**.

### 3. Persistent data

`flights.db` is mounted as a bind mount from the project root, so your flight data survives container rebuilds:

```yaml
volumes:
  - ./flights.db:/app/flights.db
```

To back up your data, just copy `flights.db`.

### Rebuilding after code changes

```bash
docker compose up --build
```

---

## SimConnect TCP setup (direct remote connection)

This section only applies if you're using the **direct remote connection** alternative instead of the [agent](agent/) (see [How it works](#how-it-works)). For the server to reach SimConnect directly, SimConnect must be configured to accept TCP connections.

### MSFS 2020 vs 2024 protocol version

`node-simconnect` requires the client to declare which SimConnect protocol version to speak, and MSFS 2020 and 2024 use different ones. This is set in [`src/simconnect.ts`](src/simconnect.ts) in the `open(...)` call:

| MSFS version | `Protocol` value |
|---|---|
| MSFS 2020 | `Protocol.KittyHawk` |
| MSFS 2024 | `Protocol.SunRise` |

The repo currently targets **MSFS 2020** (`Protocol.KittyHawk`). If you're connecting to MSFS 2024 instead, change that line to `Protocol.SunRise` and rebuild (`npm run build:server`). A mismatched protocol version will cause the connection handshake to fail even if the TCP port itself is reachable.

1. Locate (or create) `SimConnect.xml` on the Windows machine. The path depends on how MSFS was installed:
   - **Steam / boxed version:**
     ```
     C:\Users\<YourName>\AppData\Roaming\Microsoft Flight Simulator\SimConnect.xml
     ```
   - **Microsoft Store / Xbox app version:**
     ```
     C:\Users\<YourName>\AppData\Local\Packages\Microsoft.FlightSimulator_8wekyb3d8bbwe\LocalCache\SimConnect.xml
     ```
2. Add a `<SimConnect.Comm>` entry for TCP:
   ```xml
   <?xml version="1.0" encoding="Windows-1252"?>
   <SimBase.Document Type="SimConnect" version="1,0">
     <Filename>SimConnect.xml</Filename>
     <SimConnect.Comm>
       <Disabled>False</Disabled>
       <Protocol>TCP</Protocol>
       <Scope>global</Scope>
       <Port>500</Port>
       <MaxClients>64</MaxClients>
       <MaxRecvSize>41088</MaxRecvSize>
     </SimConnect.Comm>
   </SimBase.Document>
   ```
3. Restart MSFS fully (not just reload a flight) for the change to take effect — the SimConnect listener only picks up XML changes on launch.
4. Allow port `500` through Windows Firewall if the server is on a different machine:
   ```powershell
   New-NetFirewallRule -DisplayName "SimConnect TCP" -Direction Inbound -Protocol TCP -LocalPort 500 -Action Allow
   ```

### Example: server on a separate Linux machine on the same LAN

This is the topology when running the server on a remote Linux box (e.g. over SSH) while MSFS runs on a Windows gaming PC on the same network — no Docker involved.

```bash
export SIMCONNECT_HOST=192.168.0.132   # LAN IP of the Windows machine running MSFS
export SIMCONNECT_PORT=500
export PORT=3000
npm start
```

The web UI is then reachable from any machine on the LAN (including the Windows machine) at `http://<linux-machine-ip>:3000`. The server retries the SimConnect connection every 5 seconds and logs `[SimConnect] Connected — ...` once MSFS is up and the TCP listener + firewall rule above are in place.

---

## Project structure

```
msfslogger/
├── src/                  # Express server (TypeScript)
│   ├── index.ts          # Entry point, starts server (+ optional direct SimConnect)
│   ├── server.ts         # REST API routes
│   ├── ingest.ts         # Receives data pushed by the Windows agent
│   ├── db.ts             # SQLite queries
│   ├── flightManager.ts  # Flight state machine
│   ├── simconnect.ts     # Direct remote SimConnect connection (alternative to the agent)
│   └── airports.ts       # ICAO airport lookup
├── agent/                # Runs on the Windows machine with MSFS (recommended setup)
│   ├── agent.js          # Connects to SimConnect locally, pushes data to the server
│   └── README.md
├── client/               # React frontend (Vite + TypeScript)
│   └── src/
│       ├── pages/        # Home, FlightDetail, TripDetail
│       ├── components/   # Header, LivePanel, maps, charts
│       ├── hooks/        # useStatus (live sim polling)
│       └── utils/        # API fetch, formatters
├── airports.json         # Airport database for ICAO lookup
├── flights.db            # SQLite database (created on first run)
├── Dockerfile
└── docker-compose.yml
```

## Utility scripts

```bash
# Backfill ICAO departure/arrival codes for existing flights
npm run backfill-icao
```
