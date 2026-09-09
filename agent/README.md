# msfslogger agent

A small standalone script that runs **on the Windows machine with MSFS**. It connects to SimConnect locally — the same way any other local MSFS addon does, no TCP/firewall configuration required — and forwards flight data to a `msfslogger` server running elsewhere on the network over plain HTTP.

This is the supported way to connect a remote server to MSFS. The alternative — having the server dial SimConnect's TCP port directly — required editing `SimConnect.xml` and opening a Windows Firewall port, both easy to get subtly wrong (wrong file path for Store/Xbox installs, Notepad silently appending `.txt`, UWP apps not fully restarting), and it never worked reliably. The agent sidesteps all of it: it talks to MSFS exactly as a local addon does, and only needs outbound HTTP to reach the server.

**Status:** confirmed working — verified end-to-end with a Microsoft Store/Xbox install of MSFS 2020, logging a real flight (SSCN → SBFL, 172.4 nm) to a `msfslogger` server on a separate Linux machine over the LAN.

## Setup

1. Install [Node.js 20 LTS](https://nodejs.org/) on the Windows machine, if not already installed.
2. Copy this `agent/` folder to the Windows machine (or clone the whole repo there).
3. Open a terminal (PowerShell or cmd) in the `agent` folder and install dependencies:
   ```powershell
   npm install
   ```
4. Set the server URL (the LAN address of the machine running `msfslogger`) and start the agent. By default it targets MSFS 2020 — see [MSFS 2020 vs 2024 vs FSX](#msfs-2020-vs-2024-vs-fsx) below to point it at MSFS 2024 or FSX instead:
   ```powershell
   $env:SERVER_URL = "http://192.168.0.30:3000"
   npm start
   ```
   To pass the `--sim` flag through `npm start`, add an extra `--` before it (npm forwards everything after it to `node agent.js`), or just run `node agent.js` directly:
   ```powershell
   npm start -- --sim 2024
   # or
   node agent.js --sim 2024
   ```
5. Launch MSFS. Once you're in a flight (or even just at the main menu), the agent's log should show:
   ```
   [Agent] Connecting to SimConnect...
   [Agent] Connected to SimConnect — ...
   ```
   and the server's `/api/status` / web UI should show `connected: true`.

Leave this running in the background whenever you want flights logged. It reconnects automatically if MSFS restarts, and retries the server if it's briefly unreachable.

## Pause handling

The agent subscribes to SimConnect's `Pause_EX1` event, which reports a bitmask distinguishing a full pause (1), **Active Pause** (4), and a sim pause such as a menu (8). This matters because the older `Paused`/`Unpaused` events **do not fire for Active Pause at all** — they are kept only as a fallback and are ignored once `Pause_EX1` is seen working.

Any non-zero flag stops the flight clock on the server and suspends track recording, so no form of interruption inflates a flight's logged duration.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SERVER_URL` | Yes | Base URL of the `msfslogger` server, e.g. `http://192.168.0.30:3000` |
| `INGEST_TOKEN` | No | Shared secret. If set, must match the `INGEST_TOKEN` configured on the server — sent as the `x-ingest-token` header on every request. |
| `TRAFFIC_ENABLED` | No | Opt-out for [AI traffic gathering](#ai-traffic). Set to `0`, `false`, `off` or `no` to disable; anything else (including unset or empty) leaves it enabled. The server has its own, independently-read copy of the same variable, documented in the main [`README.md`](../README.md#environment-variables) — setting one does not imply the other. |
| `TRAFFIC_RADIUS_M` | No | Sweep radius in metres for AI traffic. Default `40000` (~21.6 NM), clamped to `[1000, 200000]`. An unparseable value falls back to the default and logs a warning. |

## AI traffic

Alongside the once-a-second flight data, the agent also sweeps SimConnect
every **2 seconds** for other aircraft (AI or multiplayer traffic MSFS itself
reports) within `TRAFFIC_RADIUS_M` metres of the user, and pushes them to the
server as a batch over the same HTTP channel (`POST /api/ingest/traffic`).
This is a second, independent SimConnect request — it shares no data
definition or request id with the flight-data path, and a failure to reach the
server on this path never affects the flight-data path or the reconnect
logic. The server holds the received aircraft in memory only, keyed by
SimConnect object id, and the live map draws one marker per aircraft; the
whole set is discarded if it goes 10 seconds without a fresh batch, and none
of it is ever written to `flights.db` or otherwise persisted.

A busy airport can have dozens of aircraft in range at once. Parked or
gate-held aircraft (on the ground, under 1 kt) are filtered out before they
ever leave this machine; taxiing, lining-up and airborne aircraft are sent.

Set `TRAFFIC_ENABLED=0` to turn gathering off entirely — no data definition is
registered, no SimConnect request is made, and nothing is posted.

## MSFS 2020 vs 2024 vs FSX

The agent picks which SimConnect protocol revision to open with via a `--sim`/`-s` command-line flag. Accepted values (case-insensitive): `2020`, `2024`, `fsx`. Omitting the flag defaults to **MSFS 2020** (`Protocol.KittyHawk`), matching the main server's default.

```powershell
node agent.js --sim 2024   # MSFS 2024 (Protocol.SunRise)
node agent.js --sim fsx    # FSX / FSX: Steam Edition (Protocol.FSX_SP2)
```

Both `--sim 2024` and `--sim=2024` are accepted, as is the short form `-s 2024`. An unrecognized value prints an error listing the accepted values and exits without attempting to connect.

## Running at startup (optional)

To avoid starting this manually every time, you can register it as a Scheduled Task that runs at login:

```powershell
schtasks /create /tn "msfslogger-agent" /tr "cmd /c cd /d C:\path\to\agent && npm start" /sc onlogon
```

Adjust the path to wherever you copied the `agent` folder.

## Possible future improvement: packaged executable

Currently the agent requires Node.js installed on the Windows machine and is started via `npm start`. Packaging it as a self-contained `.exe` (e.g. with Electron, or a lighter tool like `pkg`/`nexe`) so it can just be double-clicked with no Node install would be more convenient, and cross-compiling that build from this Linux machine is feasible. Not yet implemented — raised as a follow-up idea but out of scope for the current setup.
