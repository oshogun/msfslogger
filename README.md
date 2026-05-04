# msfslogger

Automatic flight logger for Microsoft Flight Simulator 2024 (and probably other sims that use simconnect). Records GPS tracks, altitude profiles, and flight stats to a local SQLite database and displays them through a React web interface.

## How it works

The server connects to MSFS via SimConnect, records one data point per second while airborne, and saves completed flights to `flights.db`. The web UI lets you browse flights, view GPS tracks and altitude charts, group flights into trips, and edit or delete records.

SimConnect in `node-simconnect` v4 communicates over **TCP**, so the server can run on a different machine (or Docker container) from the one running MSFS — as long as it can reach SimConnect's port on the Windows host.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the HTTP server listens on |
| `SIMCONNECT_HOST` | *(local)* | IP or hostname of the machine running MSFS. When unset, `node-simconnect` attempts a local connection. |
| `SIMCONNECT_PORT` | `5111` | TCP port SimConnect listens on.  |

---

## Running locally (development)

### Prerequisites

- Node.js 20+
- Microsoft Flight Simulator 2024 running on Windows (the same machine or network-reachable)

### 1. Install dependencies

```bash
# Root (server)
npm install

# React client
cd client && npm install && cd ..
```

### 2. Configure SimConnect (if MSFS is on a different machine)

Create a `.env` file or export variables before starting:

```bash
export SIMCONNECT_HOST=192.168.1.10   # IP of the Windows machine running MSFS
export SIMCONNECT_PORT=500            # usually the default
export PORT=3000                      # optional, defaults to 3000
```

If MSFS is on the **same machine** as the server, leave `SIMCONNECT_HOST` unset.

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

Copy the example below into a `.env` file next to `docker-compose.yml`:

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

## SimConnect TCP setup

For the server to reach SimConnect when running remotely or in Docker, SimConnect must be configured to accept TCP connections.

1. Locate (or create) `SimConnect.xml` on the Windows machine. It is typically at:
   ```
   C:\Users\<YourName>\AppData\Roaming\Microsoft Flight Simulator\SimConnect.xml
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
3. Restart MSFS for the change to take effect.
4. Allow port `500` through Windows Firewall if the server is on a different machine.

---

## Project structure

```
msfslogger/
├── src/                  # Express server (TypeScript)
│   ├── index.ts          # Entry point, starts server + SimConnect
│   ├── server.ts         # REST API routes
│   ├── db.ts             # SQLite queries
│   ├── flightManager.ts  # Flight state machine
│   ├── simconnect.ts     # SimConnect integration
│   └── airports.ts       # ICAO airport lookup
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
