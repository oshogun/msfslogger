# T-006 / T-007 / T-008 implementation evidence

Completed the existing FMC shell; added three configuration pages and two independent verification tools. All changes are in the assigned UI/tools and run evidence paths. Batched ownership explicitly permits shell/page edits together.

## Executed verification

Every Node invocation used `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20` (v20.20.2).
`node windows-client/ui/tools/render-check.mjs` exited 0. The tool owns an ephemeral localhost HTTP server, launches root Puppeteer with `--no-sandbox`, and writes PNGs. Full output:
```text
Scratch server 127.0.0.1:45481 (never port 3000)
PASS app.starting: SIDECAR STARTING
PASS app.no-config: NO CONFIG
PASS app.error-config: CONFIG INVALID
PASS app.stopped: UPLINK STOPPED
PASS app.running: UPLINK ACTIVE
PASS app.crashed: SIDECAR FAULT
PASS app.restarting: SIDECAR RESTART
PASS sim.idle: SIM LINK STANDBY
PASS sim.connecting: SIM LINK CONNECTING
PASS sim.connected: SIM LINK ONLINE
PASS sim.retry: SIM LINK RETRY 05S
PASS net.idle: ACARS STANDBY
PASS net.pending: ACARS CONNECTING
PASS net.ok: ACARS UPLINK
PASS net.standby: ACARS READY
PASS net.unauthorized: ACARS REJECT 401
PASS net.http-error: ACARS FAULT 503
PASS net.tls-error: ACARS CERT FAULT
PASS net.unreachable: ACARS NO COMM
PASS pause.off: PAUSE OFF
PASS pause.full: SIM PAUSED
PASS pause.active: ACTIVE PAUSE
PASS pause.menu: SIM MENU
PASS pause.unknown: PAUSE 16
PASS connected: SIM LINK ONLINE | ACARS UPLINK
PASS sim-down: SIM LINK RETRY 10S | ACARS READY
PASS backend-down: SIM LINK ONLINE | ACARS NO COMM
PASS retry-ladder: 05,10,20,40,60,60,60,60,60; local tick 60 -> 59
PASS unknown: ?? sim.future
PASS config-network: serverUrl, ingestToken, certPath
PASS config-sim: sim, autoUplink
PASS config-traffic: trafficEnabled, trafficRadiusM
PASS reject serverUrl: INVALID ENTRY; no save
PASS reject serverUrl empty: INVALID ENTRY; no save
PASS reject ingestToken empty: INVALID ENTRY; no save
PASS reject sim: INVALID ENTRY; no save
PASS reject autoUplink: INVALID ENTRY; no save
PASS reject trafficRadiusM: ENTRY OUT OF RANGE; no save
PASS reject trafficRadiusM: ENTRY OUT OF RANGE; no save
PASS SAVE: full canonical config; untouched token omitted; token absent from all captured DOM text and config returns
PASS save failure: SAVE FAILED
PASS navigation: CFG wrap; unfinished secret cleared
PASS first-run: required boxes; missing config blocks save; GUI creates full config
PASS invalid-object-repair: current raw preferred to stale config; repair, defaults, token preserved
PASS window-minimum: panel fits 420x680
PASS browser errors: none (pageerror and console error both fatal)
Cleanup: browser closed; scratch server closed
```
`node windows-client/tools/contract-check.mjs` exited 0. Full output:
```text
PASS config_get: Rust src-tauri/src/main.rs:16 | webview ui/src/bridge.js:14
PASS config_set: Rust src-tauri/src/main.rs:24 | webview ui/src/bridge.js:15
PASS config_path: Rust src-tauri/src/main.rs:39 | webview ui/src/bridge.js:16
PASS uplink_start: Rust src-tauri/src/main.rs:45 | webview ui/src/bridge.js:17
PASS uplink_stop: Rust src-tauri/src/main.rs:48 | webview ui/src/bridge.js:18
PASS sidecar_restart: Rust src-tauri/src/main.rs:51 | webview ui/src/bridge.js:19
PASS status_get: Rust src-tauri/src/main.rs:54 | webview ui/src/bridge.js:20
PASS sidecar:status: Rust src-tauri/src/main.rs:63 | webview ui/src/bridge.js:25
PASS sidecar:log: Rust src-tauri/src/main.rs:64 | webview ui/src/bridge.js:26
PASS sidecar:exit: Rust src-tauri/src/main.rs:65 | webview ui/src/bridge.js:27
```
`node --check windows-client/ui/tools/render-check.mjs` and `node --check windows-client/tools/contract-check.mjs`: exit 0.

## Failure proofs and cleanup

`prototypes/label-mutation.log` contains the full temporarily edited label run: `ACARS UPLINK` → `ACARS BROKEN`; `node windows-client/ui/tools/render-check.mjs` exited 1 with `FAIL net.ok: net.ok: label`, actual `ACARS BROKEN`, expected `ACARS UPLINK`.
`prototypes/event-mutation.log` contains the full one-sided event rename run: `sidecar:status` → `sidecar:renamed` in bridge.js; `node windows-client/tools/contract-check.mjs` exited 1 with `FAIL sidecar:status: missing from webview bridge`.
Both logs show `restored byte-for-byte sha256: True` and `git diff --stat` with empty output after restoration. The files are untracked in this worktree, so byte-for-byte comparison additionally proves restoration. The subsequent passing runs are pasted above.
The render failure and successful runs both print `Cleanup: browser closed; scratch server closed`. Cleanup is in `finally`: `await browser.close()`, then nested `finally` calls `server.closeAllConnections()` and awaits `server.close(done)`. Port selection uses `server.listen(0, '127.0.0.1')` and asserts the chosen port is not 3000.
The contract tool only reads files (`readFile`, `readdir`); `rg -n 'writeFile|appendFile|createWriteStream|writeSync|open\(' windows-client/tools/contract-check.mjs` returns no hits. Neither tool reads workflow artifacts as input or adds dependencies.

## Configuration acceptance

| Editable field | Page / LSK | Replaces |
|---|---|---|
| serverUrl | NETWORK L1 | SERVER_URL |
| ingestToken | NETWORK L2 | INGEST_TOKEN |
| certPath | NETWORK L3 | NODE_EXTRA_CA_CERTS (agent HTTPS section) |
| sim | SIM L1 | --sim / -s |
| autoUplink | SIM L2 | New GUI setting |
| trafficEnabled | TRAFFIC L1 | TRAFFIC_ENABLED |
| trafficRadiusM | TRAFFIC L2 | TRAFFIC_RADIUS_M |

`enterField()` in `ui/src/pages/index.js` inserts scratchpad content on LSK selection; empty LSK copies text or cycles enums/booleans. `handleKey()` in app.js serves drawn and physical keys; physical input/paste preserves case and punctuation. CLR removes characters; held CLR clears the entry. The internal buffer accommodates long URLs, tokens and certificate paths; visible text uses the last 22 characters. NETWORK entries are always masked because the destination LSK is selected after typing; its page explains this. Navigation clears unfinished entries.
`validate()` rejects missing/empty URL/token, non-http(s) URLs, invalid sim and autoUplink. UI radius rejects out-of-range with ENTRY OUT OF RANGE (the explicit UI exception to loader clamping); rounding and nonfinite fallback/warning are exercised. Rejected fields block SAVE until corrected. Field names accompany messages in the feedback row.
SAVE call sites (`rg -n 'setConfig\(|host.invoke\(COMMANDS.configSet' windows-client/ui/src`) are pasted in `prototypes/save-call-sites.txt`: `await fmc.bridge.setConfig(patch)` and `host.invoke(COMMANDS.configSet, { patch })`. The harness asserts the entire canonical seven-field object plus version. Unchanged ingestToken is omitted so the native shallow merge preserves it, and advanced/unknown fields remain the writer's responsibility.
Token assertions before entry, after LSK, after SAVE and after navigation use `document.documentElement.textContent.includes(token) === false`; field text equals `••••••••`. The placeholder test value is never printed. The stub's config returns remain redacted. `config-token-entry.png` shows masked scratchpad entry.
First setup creates a full config from missing raw/config. Semantic-invalid raw objects are repairable; raw takes precedence over a stale validated snapshot, and status events cannot overwrite persisted config hydration.

## DOM, style and visual evidence

`grep -nE '(id=|data-)' windows-client/ui/index.html` is pasted in full in `prototypes/dom-hooks.txt`: every frozen structure/status id, page/status/message/stub attribute, all 12 LSKs, all character/function keys and all seven field/value hooks (in templates) are present as named.
`grep -rn '__TAURI__' windows-client/ui/src/` returns only `bridge.js:44`; `grep -n 'http' windows-client/ui/css/fmc.css` returns nothing. `grep -n '^  --fmc-' windows-client/ui/css/fmc.css` is pasted in `prototypes/palette.txt`, including all 13 uppercase frozen palette hex values and the local-only font stack.
`ls .claude/runs/2026-09-11-tauri-windows-client/prototypes/*.png` is pasted in `prototypes/png-list.txt`: 34 PNGs, covering all 24 states, three worked scenarios, unknown fallback, all three CFG pages, rejected/masked entries and minimum window size.
Connected label assertion uses `page.$eval(selector, el => el.textContent)` through the harness `text()` helper and strict equality with the independent expected table; the asserted value is exactly `ACARS UPLINK`. Sim-down instead shows `SIM LINK RETRY 10S | ACARS READY`; backend-down shows `SIM LINK ONLINE | ACARS NO COMM`.
Visually inspected connected, sim-down, backend-down, config-network, config-rejected and window-minimum PNGs. Raised bezel, inset 24-column screen, six aligned LSKs per side, separate readable status axes, local monochrome text, arrows and scratchpad are present. The whole panel fits the native minimum 420×680 viewport. Viewer sandbox failed, so PNGs were read through escalated `base64 -w0` and displayed using the image output tool.
`git status --porcelain client/ agent/ src/ package.json package-lock.json`: empty. `git diff --name-only`: empty (owned files are currently untracked). No root dependencies, live database or port-3000 server were changed.

## Limitations

Headless Chromium is not WebView2. Screenshots prove structure, labels and layout, not Windows rendering fidelity; the user's manual Windows test remains required.
Certificate readability is checked by the sidecar after SAVE, since the frozen bridge has no filesystem-validation command. UI syntax feedback cannot claim a file exists on Windows. Malformed/non-object JSON remains a clear native write failure requiring manual repair, per the Orchestrator's preserve-original-file decision; semantically invalid JSON objects are editable and tested.
This plain HTML/CSS/JS UI has no build step. Root npm build was not run by this scoped agent because it writes unrelated application outputs; no runtime shell/SimConnect or Rust compilation claim is made here.
