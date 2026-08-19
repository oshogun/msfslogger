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
4. Set the server URL (the LAN address of the machine running `msfslogger`) and start the agent:
   ```powershell
   $env:SERVER_URL = "http://192.168.0.30:3000"
   npm start
   ```
5. Launch MSFS. Once you're in a flight (or even just at the main menu), the agent's log should show:
   ```
   [Agent] Connecting to SimConnect...
   [Agent] Connected to SimConnect — ...
   ```
   and the server's `/api/status` / web UI should show `connected: true`.

Leave this running in the background whenever you want flights logged. It reconnects automatically if MSFS restarts, and retries the server if it's briefly unreachable.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SERVER_URL` | Yes | Base URL of the `msfslogger` server, e.g. `http://192.168.0.30:3000` |
| `INGEST_TOKEN` | No | Shared secret. If set, must match the `INGEST_TOKEN` configured on the server — sent as the `x-ingest-token` header on every request. |

## MSFS 2020 vs 2024

The agent targets **MSFS 2020** (`Protocol.KittyHawk`) by default, matching the main server. If you're running MSFS 2024, edit `agent.js` and change `Protocol.KittyHawk` to `Protocol.SunRise`.

## Running at startup (optional)

To avoid starting this manually every time, you can register it as a Scheduled Task that runs at login:

```powershell
schtasks /create /tn "msfslogger-agent" /tr "cmd /c cd /d C:\path\to\agent && npm start" /sc onlogon
```

Adjust the path to wherever you copied the `agent` folder.

## Possible future improvement: packaged executable

Currently the agent requires Node.js installed on the Windows machine and is started via `npm start`. Packaging it as a self-contained `.exe` (e.g. with Electron, or a lighter tool like `pkg`/`nexe`) so it can just be double-clicked with no Node install would be more convenient, and cross-compiling that build from this Linux machine is feasible. Not yet implemented — raised as a follow-up idea but out of scope for the current setup.
