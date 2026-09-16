# msfslogger

Self-hosted flight logging for Microsoft Flight Simulator 2020/2024 and FSX.
msfslogger records flight tracks and statistics in a local SQLite database and
presents them in a React web application.

The project consists of:

- an Express and TypeScript server in `src/`;
- a React and Vite web client in `client/`;
- a supported Node.js SimConnect agent in `agent/` for a separate Windows PC.

Full usage and administration documentation is in the
[msfslogger wiki](https://github.com/oshogun/msfslogger/wiki).

## Requirements

- Node.js 20 (pinned by `.nvmrc`)
- npm
- Microsoft Flight Simulator 2020/2024 or FSX on Windows
- Docker and Docker Compose, if using the container installation

Use Node 20 before installing. `better-sqlite3` is a native dependency and may
not install or run on unsupported, newer Node ABIs.

```bash
nvm install
nvm use
```

## Install from source

Clone the repository and install both dependency sets:

```bash
git clone git@github.com:oshogun/msfslogger.git
cd msfslogger
npm install
cd client
npm install
cd ..
```

Build the web client and server:

```bash
npm run build
```

Create the operator account:

```bash
npm run set-password
```

Set a shared ingest token. The same value must be configured on the Windows
agent, and is also what a datalink client (the MCDU app) uses to reach the
status and ACARS endpoints:

```bash
export INGEST_TOKEN="$(openssl rand -hex 24)"
```

For a LAN-accessible installation, configure HTTPS:

```bash
export TLS_CERT_FILE=/path/to/cert.pem
export TLS_KEY_FILE=/path/to/key.pem
npm start
```

The server listens on port `3000` by default. See
[Configuration and security](https://github.com/oshogun/msfslogger/wiki/Configuration-and-Security)
for TLS setup and all environment variables.

### Development

Loopback development does not require TLS:

```bash
export BIND_HOST=127.0.0.1
export INGEST_TOKEN=devtoken1234567890
npm run dev
```

Open `http://localhost:5173`. Vite proxies API requests to the server on port
`3000`.

### Production

```bash
npm run build
npm start
```

Re-run `npm run build` after pulling application changes.

## Connect the simulator

If msfslogger runs on the same Windows machine as the simulator, the server
connects to SimConnect locally.

If the server and simulator are on different machines, run the supported agent
on the Windows simulator PC:

```powershell
cd agent
npm install
$env:SERVER_URL = "https://<server-address>:3000"
$env:INGEST_TOKEN = "<the server's token>"
npm start -- --sim 2024
```

Use `2020`, `2024`, or `fsx` for `--sim`. See the
[Windows agent guide](https://github.com/oshogun/msfslogger/wiki/Windows-Agent)
for HTTPS trust, traffic settings, and startup automation. Remote SimConnect
over TCP is not supported.

## Docker install

Create the bind-mount targets before starting Compose. Otherwise Docker may
create a directory named `flights.db`.

```bash
touch flights.db
mkdir -p flight_plans
export INGEST_TOKEN="$(openssl rand -hex 24)"
export ALLOW_PLAINTEXT_HTTP=1 # trusted LAN only; prefer TLS
docker compose build
```

Create the operator account in the container:

```bash
printf '%s\n' '<password>' | \
  docker compose run --rm -T msfslogger node dist/setPassword.js
docker compose up -d
```

See the [Docker guide](https://github.com/oshogun/msfslogger/wiki/Docker)
before using this in production, particularly for TLS and SQLite WAL handling.

## Test and verify

```bash
npm run build
npm run test:types
npm test
```

CI runs these checks on pushes and pull requests.

## Data and backups

Runtime data is stored in `flights.db`; attached PDF flight plans are stored in
`flight_plans/`. Back up a running installation with:

```bash
npm run backup
```

Do not copy an open `flights.db` by itself: SQLite WAL data may not yet be in
the main file. See [Operations and backups](https://github.com/oshogun/msfslogger/wiki/Operations-and-Backups).

## Documentation

- [Installation](https://github.com/oshogun/msfslogger/wiki/Installation)
- [Configuration and security](https://github.com/oshogun/msfslogger/wiki/Configuration-and-Security)
- [Windows agent](https://github.com/oshogun/msfslogger/wiki/Windows-Agent)
- [Features and workflow](https://github.com/oshogun/msfslogger/wiki/Features-and-Workflow)
- [Exports](https://github.com/oshogun/msfslogger/wiki/Exports)
- [Operations and backups](https://github.com/oshogun/msfslogger/wiki/Operations-and-Backups)
- [Development](https://github.com/oshogun/msfslogger/wiki/Development)

The Node.js agent in `agent/` remains the supported, default way to connect a
simulator on a separate Windows PC. A separate, optional Tauri/MCDU-style
desktop client is developed independently at
[oshogun/msfslogger_mcdu](https://github.com/oshogun/msfslogger_mcdu).
