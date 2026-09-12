# Phase 1 review — T-002, T-003

**Verdict: approve** (2 non-blocking follow-ups)

Per-task: **T-002 approve**, **T-003 approve**.

Evidence re-run independently from the diff and `agent/agent.js`; the implementer
report was not read (only its `risks` list, supplied in the envelope). Node 20.20.2
throughout. Scratch ports 3100/3101/3102/3199 only.

`flights.db` md5 **824dbcf1f73f839a5cc614e7da51ff03** before and after — unchanged.
Port 3000 still held by the user's original server (pid 98338), never contacted.
All scratch servers and sidecars killed; scratch files confined to the session
scratchpad.

## Criteria verified independently

23 of 24 verified by re-running. 1 not verifiable under review doctrine (noted).

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Typecheck | `npx tsc --noEmit -p windows-client/sidecar/tsconfig.json` | `TSC_EXIT=0` |
| 2 | Tests | `npx vitest run --config windows-client/sidecar/vitest.config.ts` | `Test Files 5 passed (5) / Tests 166 passed (166)`, exit 0 (≥25 and ≥15 added: met) |
| 3 | inspect-config good | `node dist/inspect-config.js samples/config/good.json` | exit 0, prints effective config |
| 4 | Token never in inspector output | same, `\| grep -c PLACEHOLDER-TOKEN` | `0` |
| 5 | Bad fixtures reject | loop over `samples/config/bad-*.json` | **9/9 exit 1**, one human line each naming the field, no stack trace |
| 6 | Backoff ladder | `nextReconnectDelayMs` 0..8 asserted in `tests/status.test.ts`; observed live | `5s → 10s → 20s` in the 30 s run |
| 7 | Protocol decode failures | `decodeSidecarMessage` on 8 crafted lines | `oversize / not-json / not-object / bad-version / unknown-type / bad-shape` all typed results, none threw; `MAX_LINE_BYTES 65536` |
| 8 | node-simconnect loads on Linux | `npm ls node-simconnect --prefix …`; `node -e "require('node-simconnect')"` | `node-simconnect@4.2.0`; `LOADS OK` |
| 9 | traffic.ts reads no env | `grep -n 'process.env' src/traffic.ts` | empty |
| 10 | Uplink vs scratch server 3100 | `node dist/inspect-uplink.js --config …` | 3 POSTs captured, each `x-ingest-token: SCRATCH-REVIEW-TOKEN`, `content-type: application/json` |
| 11 | Frame fields match agent.js | captured body | `lat, lon, altitudeFt, airspeedKnots, groundSpeedKnots, headingDeg, verticalSpeedFpm, onGround, simRunning, aircraft` — exact match, same order |
| 12 | 500 handling | inspector vs port 3101 | `state=net.http-error label="ACARS FAULT 500"`, no throw |
| 13 | Refused connection | inspector vs closed 3199 | `state=net.unreachable label="ACARS NO COMM"`, no throw |
| 14 | 30 s entrypoint run | `node -e "setTimeout(…,40000)" \| timeout 30 node dist/index.js --config …` | `TIMEOUT_EXIT=124`, ECONNREFUSED 127.0.0.1:2048, ladder 5s/10s/20s, 5/5 stdout lines decode via `protocol.js` |
| 15 | Invalid config stays alive | same with `bad-sim-value.json` | `TIMEOUT_EXIT=124`, `app.error-config` + `problems[]`, no spawn/exit cycle |
| 16 | No `process.exit(1)` | `grep -n 'process.exit' src/index.ts` | only `process.exitCode = 0` (line 444) |
| 17 | Missing config | `--config <nonexistent>` | `app.no-config`, path echoed in `hello.configPath`, stays alive |
| 18 | stdin `stop` | `echo '{"v":1,"type":"stop"}' \| …` | `EXIT=0 elapsed_ms=249` (<2 s) |
| 19 | stdin `config` reload | `start → config(path) → ping → shutdown` | in-place: `sim changed to 2020 — reconnecting`, `cfg.url=https://127.0.0.1:3102 cfg.sim=2020 cfg.cert=set`, `pong id=rev1`, exit 0 |
| 20 | TLS custom CA | throwaway self-signed cert in scratchpad, HTTPS on 3102 | with `certPath`: 4× `http=200`; without: `net.tls-error` / `DEPTH_ZERO_SELF_SIGNED_CERT`. Real TLS preserved; `grep rejectUnauthorized` → zero hits |
| 21 | Token never printed | 30 s run stdout+stderr, control run, inspector runs | `grep -c` → **0** in every case |
| 22 | Scope | `git status --porcelain agent/ client/ src/ tests/` | empty. Root `package.json`, `tsconfig.json`, `vitest.config.ts`, `package-lock.json` unmodified. Only `windows-client/` + `.claude/runs/…` |
| 23 | No run citations in comments | `grep -rnE '\.claude/runs\|design\.md\|plan\.json\|T-0[0-9]{2}\|phase[0-9]\|Amendment\|§' src/ tests/` | empty |
| 24 | Parity table checked item-by-item *as written in the report* | — | **Not verified as a document.** Reading the report is barred by review doctrine, so parity was re-derived directly from `agent/agent.js` against the port (stronger check; results below) |

## Parity re-derived from `agent/agent.js` (not from the report's table)

| Behaviour | `agent.js` | Port | Verdict |
|---|---|---|---|
| 1 Hz `requestDataOnSimObject` | 215–220 | `simconnect.ts:314` `SimConnectPeriod.SECOND` | match |
| 10 flight-data fields, registration order | 192–201 | `simconnect.ts:292–301` | match, name-for-name and unit-for-unit |
| Read order matches registration | 236–245 | `simconnect.ts:328–337` | match |
| `simRunning` 3 if slew else 2 | 256 | `simconnect.ts:348` | match |
| `Pause_EX1` preferred once seen | 231, 291, 299, 302 | `simconnect.ts:116, 398, 408, 414` | match (agent scopes the flag per-connect; port resets it in `resetPause()` on disconnect/stop — equivalent) |
| `describePause` decoding | 106–114 | `status.ts:163–171` | match, string-for-string incl. `unknown(<n>)` |
| `crashed` posted, `flightLoaded` log-only | 304–310 | `simconnect.ts:419–425` | match (neither posts an event for flightLoaded) |
| `connected` / `disconnected` → `/api/ingest/event` | 189, 315 | `simconnect.ts:279, 435` | match |
| Traffic sweep every 2000 ms, only when enabled | 268–272 | `simconnect.ts:357–366` | match |
| Traffic definition registered only when enabled | 206–213 | `simconnect.ts:305–312` | match |
| `simObjectDataByType` assembly (`outOf===0`, `entryNumber<=1` reset, flush at `>=outOf`) | 276–285 | `simconnect.ts:370–392` | match |
| Backoff + single-pending guard | 156–172 | `simconnect.ts:226–244` | match |
| `buildTrafficBatch` 7 steps | `traffic.js:51–102` | `traffic.ts:39–98` | line-for-line identical logic; env reads removed as specified |
| `postJson` swallows non-2xx and transport errors | 116–132 | `uplink.ts:133–162` | match, now returning a result instead of only warning |

**Deliberate differences found, both defensible:**
- `agent.js` posts `disconnected` twice when SimConnect fires `error` *and* `close`
  for one drop (321–328 + 319–320, each calling `sendEvent`). The port dedupes via
  the `this.handle !== handle` guard (`simconnect.ts:430`). Strictly better; no
  criterion requires preserving the duplicate.
- `agent.js` exits on missing `SERVER_URL` (21) and bad `--sim` (50). The port
  reports `app.no-config` / `app.error-config` and stays alive — mandated by
  design §2.5, verified at criteria 15–17.

## Design conformance

- **§2.4** — every rule exercised against the built `validateConfig`:
  `999→1000`, `1000→1000`, `1500.6→1501`, `200001→200000`, `'abc'→40000` with the
  exact documented warning; `trafficEnabled` false for `OFF`, true for `''`/`1`;
  `' 2024 '→2024`, `'FSX'→fsx`; `certPath:''→null`; trailing `/` stripped from
  `serverUrl`. All match.
- **§3.3/3.4** — all 6 sidecar types and all 5 control types present in
  `protocol.ts` (`hello, status, log, pong, frame, traffic` / `start, stop, config,
  shutdown, ping`). `frame`/`traffic` correctly **not emitted** (RESERVED).
- **§3.2** — decode never throws; unknown type ignored silently (no warn emitted),
  the rest logged at warn. Garbage + oversize + wrong-version on stdin did not kill
  the process: a following `ping` still answered `pong id=survived`.
- **§3.4** — `start` under `app.error-config` → `log[warn] START ignored — the
  config is missing or invalid` and a repeated `status`, state unchanged. Correct.
- **§3.5 rule 2** — `config` pointing at an invalid file while running emits
  `app.error-config` + `problems[]` and keeps the previous good config
  (`cfg=http://127.0.0.1:3100` retained). Correct.
- **§4.2/4.3/4.4/4.5** — `status.ts` table matches the design tables row for row;
  every state id is reachable. `net.ok`'s label is exactly `ACARS UPLINK`
  (acceptance criterion 3), and it appears on no other row.
- **§4.4 probe** — 3 `GET /api/status` in a 40 s run ≈ 15 s cadence; probe yields
  `net.standby` only, never `net.ok`/`net.unauthorized`/`net.http-error`. This
  closes the implementer's "cadence not asserted" risk.
- **Heartbeat** — status `at` values 5 s apart to the millisecond
  (…180329, 185328, 190328, 195333, 200339, 205344). Closes the same risk.

## Credential handling (verified independently)

- Committed samples contain `PLACEHOLDER-TOKEN` only — no real-looking secret
  anywhere in `windows-client/` (entropy grep over non-lockfile content: no hits).
- `ingestToken` appears in exactly three places in `src/`: the type, the validator,
  and `uplink.ts:128` where it becomes the `x-ingest-token` header. Nowhere else.
- `redact()` (`config.ts:376–379`) strips it by destructuring and substitutes
  `tokenSet: boolean`; the IPC `status.config` carried
  `[…,"nodePath","tokenSet"]` with no token field in every run observed.
- `grep -c <token>` over stdout+stderr of the 30 s run, the control run and every
  inspector run: **0** each time.
- No `rejectUnauthorized` / `NODE_TLS_REJECT_UNAUTHORIZED` anywhere.

## Findings

None blocking.

## Non-blocking follow-ups

1. **`trafficRadiusM: null` diverges from the literal §2.4 rule.**
   `windows-client/sidecar/src/config.ts` treats `null` as absent → `40000`, no
   warning (`node -e "validateConfig({serverUrl,ingestToken,trafficRadiusM:null})"`
   → `radius=40000 warn=[]`). A strict reading of §2.4 — "`Number(value)`; if not
   finite, fall back" — gives `Number(null)===0`, finite, clamped to `1000`. The
   implemented behaviour is the better one and `null` is outside the type §2.1
   declares (`number | string`), so this is not a defect; but design and code now
   read differently. Ask the Designer for a one-line amendment to §2.4 saying
   `null` is treated as absent, so T-006's UI does not re-derive the strict rule.

2. **`app.stopped` can carry a stale `app.problems[]`.**
   In the `start → config(invalid) → shutdown` run the final line was
   `status app=app.stopped … problems=[{"field":"sim",…}]`. §4.2 defines
   `app.stopped` as "config valid, uplink not running", so a populated
   `problems[]` on that state is contradictory and would let the UI show
   `UPLINK STOPPED` beside a stale config error. Cosmetic at shutdown, but worth
   clearing `problems` on the transition out of `app.error-config`.

## Note on criterion 24

The task asked me to check "the parity table from T-003" item by item. The report
containing that table is barred by review doctrine, so I re-derived the parity
mapping from `agent/agent.js` to the port myself. That verifies the underlying
claim (behaviour is matched) but not the report's prose. If the Orchestrator needs
the report's table audited as a document, that is a separate, non-Reviewer task.
