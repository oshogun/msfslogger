# Design freeze — Tauri Windows client

Run: `2026-09-11-tauri-windows-client` · Task: T-001 · Status: frozen

Read this in slices, never whole:
`.claude/tools/ctx.sh design 2026-09-11-tauri-windows-client 2 3` and so on.
Every section stands on its own and cross-references the others by number.

Section numbers are an interface. `ctx.sh design` slices on the headings and
every downstream envelope cites them, so §1–§7 keep their numbers and titles
for the life of this run. §0 and §8–§10 are additive (amendment log,
must-not-change, alternatives, risks) and are also sliceable by name:
`ctx.sh design 2026-09-11-tauri-windows-client must-not-change`.

None of this numbering ever appears in source. A comment in
`windows-client/**` states its reasoning; it never cites a section, a run id,
a task id or this file.

## 0. Amendments

When reality contradicts a frozen section, edit that section in
place, keep its number, and add a row here with the evidence that forced it.

| # | Date | Section | Change | Evidence |
|---|---|---|---|---|
| 4 | 2026-09-12 | §7.1 | Step 7's expected observation said the server's web UI shows raw `connected: true`; the real header renders `Connected · Idle` / `Recording · <aircraft>`, never that JSON field. Corrected here and in `windows-client/README.md`'s copy of the same step. | T-012 close-out review (F2, non-blocking), verified against `client/src/components/Header.tsx`. |
| 3 | 2026-09-11 | §5.3, §6.3 | Two non-blocking drifts from T-009's phase-2 review, documented rather than reverted since neither caused functional harm: (a) `index.html` carries the CFG page templates and links `css/pages.css` directly instead of the frozen lazy-injection-from-`src/pages/index.js` scheme; (b) `config_get` returns an extra `raw` field (unredacted on-disk config, needed by the CFG pages to prefill editable fields) beyond the frozen `{exists, path, config}` shape. | T-009 review findings F2 and F3 (`.claude/runs/2026-09-11-tauri-windows-client/reviews/phase-2.md`): no dangling reference, no console error, T-006/T-007 never touched the same file concurrently; `raw` is additive and already relied on by the shipped UI. |
| 2 | 2026-09-11 | §7.2, §10.1 | Resume found Rust/Cargo 1.75.0 installed; the prior no-Rust assumption is obsolete. Compilation evidence must report actual toolchain/dependency limits, with Windows CI still required for the target platform. | `cargo --version`: cargo 1.75.0; `rustc --version`: rustc 1.75.0. No rustfmt was found. |
| 1 | 2026-09-11 | §2.4 | `trafficRadiusM: null`/absent now explicitly resolves to `40000` with no warning, instead of the literal `Number(null)===0` reading that would clamp to `1000`. | T-002/T-003 implemented it this way (env vars can never be `null`, so there was no prior behaviour to transcribe); T-004's review confirmed the implemented behaviour is the better reading and flagged the doc/code mismatch. Code (already reviewed and approved) was not changed; the doc was aligned to it. |

## 1. Scope and non-goals

### 1.1 What this run builds

A Windows desktop application under a new top-level `windows-client/`
directory that replaces the way the CLI agent is *operated*, not the way it
talks to anything:

- a **Node sidecar** (`windows-client/sidecar/`) — TypeScript, Node 20, a port
  of `agent/agent.js` + `agent/traffic.js` with the environment variables and
  the `--sim` flag replaced by one on-disk JSON config file (§2) and machine
  readable status lines on stdout (§3);
- a **Tauri v2 Rust shell** (`windows-client/src-tauri/`) that owns the native
  window, the sidecar's process lifecycle, the config file on disk, and the
  forwarding of sidecar messages into the webview (§3);
- a **skeuomorphic FMC webview** (`windows-client/ui/`) — plain HTML/CSS/JS, no
  framework, no build step, no network fonts — with a status page whose
  connected label is exactly `ACARS UPLINK` and LSK-driven config pages for
  every former environment variable (§4, §6);
- **verification tooling** (`windows-client/ui/tools/`, `windows-client/tools/`)
  that makes the GUI falsifiable on a machine with no GUI (§5.5).

### 1.2 Non-goals

- No Rust rewrite of SimConnect. The sidecar keeps `node-simconnect` (frozen
  decision).
- No Node bundling (SEA/pkg). Node 20 on the Windows box is a prerequisite,
  exactly as `agent/README.md` already requires (frozen decision).
- No code signing or notarization. Out of scope; it needs a credential.
- No live-data CDU page. The message set is left extensible for one (§3.8) but
  this run does not build it.
- No auto-connect at launch. `autoUplink` defaults to `false` and the user
  presses START (frozen decision, §2.4, §6.1).
- No change to `agent/**`. It stays in place, unmodified, as the fallback.

### 1.3 The server contract is untouched

The sidecar speaks exactly what `agent/agent.js` speaks today. No server-side
change is implied or permitted by this run:

| Request | Body | Sent when |
|---|---|---|
| `POST {serverUrl}/api/ingest/frame` | `{ lat, lon, altitudeFt, airspeedKnots, groundSpeedKnots, headingDeg, verticalSpeedFpm, onGround, simRunning, aircraft }` | once per second, per `simObjectData` tick |
| `POST {serverUrl}/api/ingest/event` | `{ type: 'connected' \| 'disconnected' \| 'crashed' \| 'paused' \| 'unpaused' }` or `{ type: 'pause', flags: number }` | on the matching SimConnect event |
| `POST {serverUrl}/api/ingest/traffic` | `{ objects: TrafficObject[] }`, at most 200 objects | every 2000 ms when traffic is enabled |

Every request carries `Content-Type: application/json` and
`x-ingest-token: <config.ingestToken>`. Field names, types and ordering are
those of `agent/agent.js`; `src/ingest.ts` validates them and will `400` on
drift, which is the cheapest possible test of this claim (§7.2).

No file under `src/**`, `tests/**`, `agent/**` or `client/**` is modified by
this run. The only files outside `windows-client/` that any task may touch are
`.github/workflows/windows-client.yml`, the root `.gitignore` and the root
`README.md` (T-010, T-011).

### 1.4 Evidence this design was built on

Everything load-bearing was run against the real thing on this Linux machine
before being frozen. Probes live in
`.claude/runs/2026-09-11-tauri-windows-client/prototypes/`.

| Assumption | Probe | Result |
|---|---|---|
| `node-simconnect` installs and loads off-Windows, and `open()` rejects rather than hanging | `prototypes/probe-simconnect-open.js` | `KittyHawk: rejected after 19 ms — connect ECONNREFUSED 127.0.0.1:2048`, same for `SunRise` and `FSX_SP2`. Protocol enum confirmed: `FSX_SP2=4`, `KittyHawk=5`, `SunRise=6` (node-simconnect 4.2.0) |
| A custom CA can be applied per-request, so `NODE_EXTRA_CA_CERTS` (process-start only) is not needed (§2.7) | `prototypes/probe-tls-dispatcher.mjs` | `A no-CA: FAILED — DEPTH_ZERO_SELF_SIGNED_CERT`; `B CA dispatcher: HTTP 204`; `C CA + wrong host: FAILED — ERR_TLS_CERT_ALTNAME_INVALID`. Real TLS, not a `rejectUnauthorized:false` in disguise |
| `undici` is `require()`-able from CommonJS under Node 20 | `node -e "const {Agent}=require('undici')"` in a scratch install | `cjs require ok function`, undici 7.29.1 |
| Bundle icons can be produced with no ImageMagick, no PIL and no sharp (none are installed) | `prototypes/probe-icon-gen.mjs` | `file(1)`: valid 32/128/256/512 PNGs and `MS Windows icon resource - 3 icons`; Chromium decodes the 256 PNG at 256×256 |
| Tauri and its crates have current pinnable versions | crates.io API | `tauri 2.11.5`, `tauri-build 2.6.3`, `serde 1.0.229`, `serde_json 1.0.151` |
| Toolchain versions available at the repo root | `require('<pkg>/package.json').version` | typescript 5.9.3, vitest 4.1.11, @types/node 20.19.39, puppeteer 24.43.1, Node 20.20.2 via nvm |

Contract stubs distilled from all of the above are in
`.claude/runs/2026-09-11-tauri-windows-client/contracts/`: `config.d.ts`,
`config.schema.json`, `protocol.d.ts`, `status-table.json`, `ipc-names.json`,
`ui-contract.json`, `sample-config.json`, `sample-status.jsonl`. They are
reference artifacts — nothing imports them.

## 2. Config file

One JSON file replaces `SERVER_URL`, `INGEST_TOKEN`, `NODE_EXTRA_CA_CERTS`,
`TRAFFIC_ENABLED`, `TRAFFIC_RADIUS_M` and the `--sim`/`-s` flag. **No
environment variable and no command-line flag is required for normal
operation of either the app or the standalone sidecar** — that sentence is
acceptance criterion 2 and this section is what makes it true.

Reference stubs: `contracts/config.d.ts`, `contracts/config.schema.json`,
`contracts/sample-config.json`.

### 2.1 What replaces what

| Today | JSON key | JSON type | Default | Validation rule |
|---|---|---|---|---|
| `SERVER_URL` env var | `serverUrl` | string | *(none — required)* | Required and non-empty. Must parse as a URL whose protocol is `http:` or `https:`. Trailing `/` stripped on load. Anything else: rejected (§2.5) |
| `INGEST_TOKEN` env var | `ingestToken` | string | *(none — required)* | Required and non-empty after trim. Sent as `x-ingest-token`. Stored plaintext (§2.8), never emitted (§2.9) |
| `NODE_EXTRA_CA_CERTS` env var | `certPath` | string \| null | `null` | Optional. When non-null and non-empty it must be a readable file; unreadable is a rejection naming `certPath`. `null`/absent means system trust only (§2.7) |
| `TRAFFIC_ENABLED` env var | `trafficEnabled` | boolean \| string \| number | `true` | `false` **only** when `String(value).trim().toLowerCase()` is one of `0`, `false`, `off`, `no`. Anything else — including absent, empty string, `yes`, `1` — is `true` |
| `TRAFFIC_RADIUS_M` env var | `trafficRadiusM` | number \| string | `40000` | `Number(value)`; if not finite, fall back to `40000` **and record a warning**. Otherwise `Math.round`, then clamp to `[1000, 200000]` |
| `--sim` / `-s` CLI flag | `sim` | string | `"2020"` | Must be a **string** (a number is rejected on type). Trim, lowercase, then accept only `2020` → `Protocol.KittyHawk`, `2024` → `Protocol.SunRise`, `fsx` → `Protocol.FSX_SP2`. Anything else: rejected (§2.5) |
| *(new)* | `autoUplink` | boolean | `false` | Optional. Non-boolean is rejected. `true` starts the uplink at app launch; the default keeps the app idle until the user presses START |
| *(new, advanced)* | `nodePath` | string \| null | `null` | Read **only by the Rust shell** (§3.6) and never shown in the FMC pages: absolute path to `node.exe` when it is not on `PATH` |
| *(new, internal)* | `version` | number | `1` | Absent is read as `1`. A value other than `1` is rejected, so a future format cannot be silently half-read |

Nothing from `agent/README.md`'s environment-variable table is missing: that
table has four rows (`SERVER_URL`, `INGEST_TOKEN`, `TRAFFIC_ENABLED`,
`TRAFFIC_RADIUS_M`), plus `NODE_EXTRA_CA_CERTS` documented under its HTTPS
section and `--sim`/`-s` under its sim-version section. All six appear above.

### 2.2 Where the file lives, and how it is found

Resolution order, first hit wins:

1. `--config <path>` on the sidecar's argv — **testing and the Tauri shell
   only**. It is how every verification command in §5.5 points the sidecar at a
   scratch config, and how Tauri passes the path it owns (§3.6). Also accepted
   as `--config=<path>`, matching the `--sim=` form the old agent accepted.
2. `MSFSLOGGER_CONFIG` environment variable — an escape hatch for CI and for a
   Windows service wrapper. Not required, not documented in the UI.
3. Platform default:
   - Windows: `%APPDATA%\msfslogger\config.json`
     (typically `C:\Users\<user>\AppData\Roaming\msfslogger\config.json`)
   - Linux/macOS: `$XDG_CONFIG_HOME/msfslogger/config.json`, falling back to
     `$HOME/.config/msfslogger/config.json`

The Windows path is the user's roaming profile, **not** a directory beside the
executable, so the config survives reinstalls and app updates, and so a
non-elevated user can write it. It is a fixed, human-typable path rather than
Tauri's identifier-derived app-config dir
(`%APPDATA%\com.msfslogger.windows-client\`) precisely because the sidecar has
to find the same file when it runs standalone with no Tauri around — phase 1
ships exactly that. Both sides compute it from the `APPDATA` environment
variable; Rust does not need the `dirs` crate for it.

`resolveConfigPath()` is pure apart from reading `process.env`, and returns the
path even when the file does not exist (§2.5 needs the path to display).

### 2.3 File shape

`contracts/sample-config.json`:

```json
{
  "version": 1,
  "serverUrl": "https://192.168.0.30:3000",
  "ingestToken": "REPLACE-WITH-YOUR-INGEST-TOKEN",
  "certPath": "C:\\msfslogger\\msfslogger-cert.pem",
  "trafficEnabled": true,
  "trafficRadiusM": 40000,
  "sim": "2020",
  "autoUplink": false,
  "nodePath": null
}
```

Rules:

- **Unknown keys are ignored by the sidecar and preserved by the writer**
  (§2.6). A key this version does not know is not an error — forward
  compatibility costs nothing here and a stripped key costs a user their
  setting.
- The file is UTF-8, LF or CRLF, and may have a BOM (strip it before
  `JSON.parse`; Notepad adds one and `agent/README.md`'s audience uses
  Notepad).
- Values are stored in canonical form by the UI (`sim` lowercase,
  `trafficEnabled` a real boolean, `trafficRadiusM` a real number) but the
  loader still accepts the loose forms in the table above, because a
  hand-edited file is a supported way to configure this.

### 2.4 Validation, transcribed from today's behaviour

`validateConfig(raw)` is pure, returns a result, and **never throws and never
exits**. It produces `EffectiveConfig` plus a list of warnings, or a list of
problems. One problem per offending field, each a single human-readable line
naming the field, with no stack trace.

- `sim`: must be a string — a non-string (including the number `2024`) is
  rejected with `sim must be a string`, because the CLI flag it replaces could
  only ever produce a string and a JSON number here means a hand-edit went
  wrong. Then `value.trim().toLowerCase()` must be exactly `2020`, `2024` or
  `fsx`: `2020` → `Protocol.KittyHawk`, `2024` → `Protocol.SunRise`,
  `fsx` → `Protocol.FSX_SP2`, the same three-entry map `agent/agent.js`
  carries. `2019`, `msfs` and `''` are rejected with
  `sim must be one of 2020, 2024, fsx (got "<value>")`. Absent → `2020`.
  `'FSX'` and `' 2024 '` are accepted and stored canonically lowercase and
  trimmed.
- `trafficRadiusM`: `null` or absent → `40000`, **no warning** — there is no
  prior env-var behaviour to transcribe for "the value is absent" (an env var
  can never be `null`), and treating an explicit `null` as a validation
  failure would clamp it to `1000`, which is a worse reading of "not set"
  than the default. Otherwise `Number(value)`; non-finite → `40000` **plus a
  warning** `Invalid trafficRadiusM (<value>) — using default 40000`,
  mirroring `agent/traffic.js`'s `console.warn`. Otherwise `Math.round(n)`
  then `Math.min(200000, Math.max(1000, rounded))`. So `999 → 1000`,
  `1000 → 1000`, `1500.6 → 1501`, `40000 → 40000`, `200001 → 200000`,
  `'abc' → 40000 + warning`. Out-of-range is a **clamp, not a rejection** —
  that is what the agent does today and a config file must not become
  stricter than the environment variable it replaces.
- `trafficEnabled`: false **iff** `String(value).trim().toLowerCase()` is in
  `['0', 'false', 'off', 'no']`; otherwise true. Absent → true. `''` → true.
  Identical to `agent/traffic.js` and to the server's own
  `parseTrafficEnabled` in `src/ingest.ts`.
- `serverUrl`: required. Rejected when absent, not a string, empty after trim,
  unparseable as a URL, or of a protocol other than `http:`/`https:`.
- `ingestToken`: required. Rejected when absent, not a string, or empty after
  trim. The server `401`s every ingest request without a matching one
  (`src/ingest.ts` `checkAuth`), so a missing token is a broken config, not a
  degraded mode.
- `certPath`: optional. `null`, absent or `''` → `null`. A non-empty string
  must name a readable file; otherwise rejected with
  `certPath is not readable: <path>` (§2.7).
- `autoUplink`: optional, must be a boolean if present.
- `version`: absent → 1; must be `1` if present.

Where today's agent would print an error and `process.exit(1)`, the sidecar
records a problem and reports it (§2.5). That is the only intentional
divergence in validation, and it is behavioural, not semantic: the same inputs
are accepted and the same inputs are rejected.

### 2.5 Missing or invalid config under a GUI supervisor

`agent/agent.js` calls `process.exit(1)` on a missing `SERVER_URL` (line 21)
and on an unrecognized `--sim` value (line 50). Under a GUI supervisor that is
the worst possible behaviour: the shell spawns the child, the child exits
immediately, the shell restarts it, and the user sees a window that flickers
and explains nothing. **The sidecar never exit-loops.**

| Situation | State id (§4.2) | Behaviour |
|---|---|---|
| Config file does not exist at the resolved path | `app.no-config` | Emit `hello`, then a `status` with `app.no-config` and the resolved path in `config: null` + the path from `hello.configPath`. Stay alive. Do not attempt SimConnect or any HTTP. |
| File exists but is not valid JSON, or fails any rule in §2.4 | `app.error-config` | Emit a `status` with `app.error-config` and `app.problems[]` — one entry per offending field, each with `field` and a one-line `message`. Stay alive, idle, and wait. |
| A `config` control message arrives (§3.5) | re-evaluate | Re-read the file and re-validate. On success move to `app.stopped` (or `app.running` if the uplink was running); on failure emit the new problems. |

`grep -rn 'process.exit(1)' windows-client/sidecar/src/index.ts` returns
nothing. The only permitted non-zero exit is an unhandled failure Node itself
terminates on, and even there the supervisor's restart budget (§3.6) bounds
the damage.

The CLI inspectors are the exception and the reason the rule is phrased about
`index.ts` alone: `inspect-config.ts` and `inspect-uplink.ts` are one-shot
tools run by a human at a shell, and they **do** exit `1` on a bad config after
printing one human line. That is what T-002's bad-fixture evidence asserts.

### 2.6 Who writes the file

The Rust shell writes; the sidecar only reads. One writer avoids a torn file.

- `config_set` (§3.7) shallow-merges the patch from the UI over the object
  currently on disk, so unknown/advanced keys (`nodePath`, anything a future
  version adds) survive a save from an older UI.
- The write is atomic: serialise to `config.json.tmp` in the **same directory**,
  `fsync`, then `rename` over `config.json`. A crash mid-write leaves the
  previous file intact. Never write in place; never write to a temp directory
  on another volume, where `rename` is not atomic.
- The parent directory is created if missing (`%APPDATA%\msfslogger\`).
- After a successful write the shell sends the `config` control line (§3.5).
  The sidecar is the authority on validity: the Rust side performs **no**
  semantic validation beyond "the patch is a JSON object", so there is no
  third copy of §2.4's rules to drift. The UI's own validation (§6.5) is a
  convenience for immediate feedback, not a gate the sidecar trusts.

### 2.7 TLS and the server's self-signed certificate

The server normally runs HTTPS with a self-signed certificate, and today the
operator points `NODE_EXTRA_CA_CERTS` at the PEM. Node reads that variable
**once, at process start**, so it cannot express "the user just changed
`certPath` in the UI".

**Decision: option (c) — a per-request `undici` `Agent` with a custom CA,
passed as `fetch`'s `dispatcher`.** Rejected alternatives are in §9.1.

- `windows-client/sidecar/src/uplink.ts` (T-003) owns this. When
  `config.certPath` is non-null it reads the PEM once per config load and
  constructs `new Agent({ connect: { ca: pem } })`; every `fetch` in the
  sidecar passes that dispatcher. When `certPath` is null, no dispatcher is
  passed and Node's default trust store applies.
- A config reload (§3.5) rebuilds the dispatcher. No restart, no environment
  variable, no re-exec.
- **It is still real TLS.** The probe in §1.4 shows a certificate whose SAN
  does not cover the host still fails with `ERR_TLS_CERT_ALTNAME_INVALID`.
  There is no `rejectUnauthorized: false` in this codebase and none is
  permitted — `agent/README.md` says so about the agent and it stays true of
  its replacement. A reviewer greps for `rejectUnauthorized` and expects zero
  hits.
- **Fallback when it fails.** An unreadable `certPath` is a config rejection
  (§2.4) — `app.error-config`, nothing is posted, the user is told which
  field. A readable file that does not actually validate the server surfaces
  as `net.tls-error` / `ACARS CERT FAULT` (§4.4), which is a different and
  more useful message than a generic network failure.
- **Standalone parity.** Because the dispatcher is built inside the sidecar
  from `config.certPath`, the standalone `node dist/index.js --config …` run
  that phase 1 ships behaves identically to the run Tauri supervises. Tauri
  passes no TLS-related environment variable.
- **Back-compatibility.** If `NODE_EXTRA_CA_CERTS` happens to be set in the
  environment, Node applies it as it always has; the dispatcher is additive,
  not exclusive. An operator migrating from `agent/` can therefore keep their
  old environment and still work, but nothing requires it.

`undici` is pinned as a sidecar dependency (7.29.1, verified `require()`-able
from CommonJS under Node 20). Node's global `fetch` is undici internally, so
this adds a version of code the runtime already contains rather than a new
transport.

### 2.8 The token on disk

`ingestToken` is stored **in plaintext**, in a plain JSON file in the user's
roaming profile. This is stated deliberately and is exactly the exposure the
system has today, where the same secret is typed into a PowerShell environment
variable (and lands in shell history and in any Scheduled Task command line
the user registers per `agent/README.md`). Moving it to a file in
`%APPDATA%` is, if anything, a small improvement: it is protected by the
Windows file ACL on the user's profile and it is no longer echoed on a command
line visible to other processes.

No OS keychain, no DPAPI, no encryption at rest in this run. Any of those
would be a real feature with its own failure modes (a keychain entry the
sidecar cannot read when the app is not the caller, a DPAPI blob that does not
survive a profile move), and the threat model here — a single-user home flight
sim PC on a LAN — does not justify it. Recorded as a follow-up in §10.4, not
as a silent omission.

### 2.9 Redaction — where the token may and may not appear

| Place | Token allowed? |
|---|---|
| `config.json` on disk | **Yes** — this is the only place it exists |
| The `x-ingest-token` request header to the server | **Yes** — that is its purpose |
| Sidecar stdout JSON lines (`status`, `log`, `hello`, …) | **No** |
| Sidecar stderr | **No** |
| Tauri event payloads and command return values | **No** |
| Rust logs, `println!`, panic messages | **No** |
| Anything rendered in the webview, including the config page | **No** — masked (§6.5) |
| Screenshots in `prototypes/`, reports, reviews | **No** |
| Committed sample configs | **No** — placeholder strings only |

Mechanics that make it checkable rather than aspirational:

- `EffectiveConfig` is never serialised. The only serialisable form is
  `RedactedConfig`, produced by `redact()`, which drops `ingestToken` and adds
  `tokenSet: boolean`. `protocol.ts` types the `status.config` field as
  `RedactedConfig | null`, so putting the token there is a type error.
- The UI renders the token field as `••••••••` when `tokenSet` is true and
  `□□□□□□□□` (FMC required-entry boxes) when it is false. The real value is
  never sent to the webview at all, so it cannot appear in a DOM dump or a
  screenshot — `config_get` returns `RedactedConfig`.
- Error messages quote the field name, never the value:
  `ingestToken is required` and never `ingestToken "abc" is …`.
- Grep checks anyone can run, and the Reviewer will:
  `timeout 15 node windows-client/sidecar/dist/index.js --config <scratch> 2>&1 | grep -c '<token>'` → `0`;
  `node windows-client/sidecar/dist/inspect-config.js <config> | grep -c '<token>'` → `0`;
  `grep -rn 'ingestToken' windows-client/src-tauri/src/` → only the struct
  field and the merge/write path, never a log macro.
- Committed fixtures use `REPLACE-WITH-YOUR-INGEST-TOKEN` or
  `PLACEHOLDER-TOKEN`. Any string in `windows-client/**` that looks like a real
  secret is a review finding.

## 3. Tauri ↔ sidecar IPC protocol

Reference stub with exact field names and types:
`contracts/protocol.d.ts`. Example traffic: `contracts/sample-status.jsonl`.
Frozen command/event names: `contracts/ipc-names.json`.

### 3.1 Framing and transport

- **sidecar → shell**: one JSON object per line on **stdout**, UTF-8,
  `\n`-terminated, no embedded newlines (the encoder guarantees this;
  `JSON.stringify` escapes them). Nothing else is ever written to stdout — a
  stray `console.log` breaks the stream and is a review finding.
- **shell → sidecar**: one JSON object per line on **stdin**, same framing.
- **stderr** is reserved for human-readable, unstructured text (Node warnings,
  an unhandled stack trace). The shell captures it into a log buffer and
  surfaces it as `sidecar:log` lines at level `error`, and never tries to
  parse it.
- Every message carries `v: 1` (`PROTOCOL_VERSION`) and a `type`. Every
  sidecar message also carries `at`, epoch milliseconds, from the emitter's
  clock.
- No length prefix, no framing escape, no request/response correlation except
  `ping`/`pong`'s `id`. Line-delimited JSON is chosen because it is
  debuggable with `head`, testable with a string, and is what a human reads
  when the sidecar is run standalone — which is exactly how phase 1 is
  verified (§5.5).

### 3.2 Decoding rules

`decodeSidecarMessage(line)` and `decodeControlMessage(line)` **never throw**.
They return `{ ok: true, message }` or a typed error:

| Condition | Result | Receiver's duty |
|---|---|---|
| Line longer than `MAX_LINE_BYTES` (65536) | `{ ok:false, error:'oversize', bytes }` | Drop the line, log once at `warn`, keep reading. Never buffer an unbounded line. |
| Not valid JSON | `{ ok:false, error:'not-json', detail }` | Drop, log at `warn`. |
| Valid JSON but not an object, or an array | `{ ok:false, error:'not-object' }` | Drop, log at `warn`. |
| `v` missing or not `1` | `{ ok:false, error:'bad-version', v }` | Drop, log at `error` once — this is a deployment mismatch between shell and sidecar. |
| `type` not a known string | `{ ok:false, error:'unknown-type', messageType }` | **Ignore silently at debug level. Not fatal.** This is what makes the message set additively extensible (§3.8). |
| Known type, wrong shape | `{ ok:false, error:'bad-shape', messageType, detail }` | Drop, log at `warn`. |

No decode failure of any kind may terminate a process, panic the Rust shell,
kill the child, or blank the webview. A blank panel on a machine the developer
cannot reach is the worst outcome in this system, so the failure mode
everywhere is "keep the last good state and say so".

Empty lines and lines that are only whitespace are skipped before decoding and
are not errors.

### 3.3 sidecar → shell messages

Full field lists are in `contracts/protocol.d.ts`; the summary:

| `type` | Purpose | Cadence |
|---|---|---|
| `hello` | `{ pid, sidecarVersion, nodeVersion, configPath }`. Announces the process and, critically, which config file it actually read. | Once, first line ever written |
| `status` | The complete observable state: `app`, `sim`, `backend`, `pause`, `traffic`, `config` (redacted). **Always a full snapshot, never a patch** — a receiver that misses a line is still correct after the next one. | On any change, coalesced to at most one per 250 ms, plus a heartbeat every 5000 ms |
| `log` | `{ level: 'debug'\|'info'\|'warn'\|'error', message }`. The lines `agent/agent.js` printed to the console, now addressed. | As they occur |
| `pong` | `{ id }`, echoing a `ping`. | On demand |
| `frame` | RESERVED (§3.8). Not emitted in this run. | – |
| `traffic` | RESERVED (§3.8). Not emitted in this run. | – |

The `status` message is the contract the UI is written against. Notable
fields, with the section that defines their meaning:

- `app.state` — §4.2, plus `app.problems[]` when the config is bad (§2.5).
- `sim.state`, `sim.attempt`, `sim.nextRetryAt`, `sim.retryDelayMs` — §4.3.
  The UI computes the retry countdown from `nextRetryAt` locally, so the
  countdown ticks at 1 Hz on screen without 1 Hz IPC traffic.
- `backend.state`, `backend.httpStatus`, `backend.lastOkAt` — §4.4.
- `pause.state`, `pause.flags`, `pause.label`, `pause.usingPauseEx1` — §4.5.
- `traffic.enabled/radiusM/lastSweepAt/lastBatchSize/lastError` — advisory
  counters; they never drive the backend axis (§4.4).
- `config` — `RedactedConfig | null`. `null` while `app.no-config` or
  `app.error-config`.

### 3.4 shell → sidecar control messages

| `type` | Effect | Idempotent? |
|---|---|---|
| `start` | Begin the uplink: connect SimConnect, start posting, start the reachability probe. Moves `app` to `app.running`. | Yes — a `start` while running is a no-op |
| `stop` | End the uplink: close the SimConnect handle, cancel timers, best-effort `POST /api/ingest/event {type:'disconnected'}`, stop probing. Moves `app` to `app.stopped`. **The process stays alive.** | Yes |
| `config` | Optional `path`. Re-read and re-validate the config, apply in place (§3.5). | Yes |
| `shutdown` | Stop as above, flush stdout, exit code 0 within `CONTROL_SHUTDOWN_GRACE_MS` (2000 ms). | Yes |
| `ping` | `{ id }`. Reply `pong` with the same id. | Yes |

Two rules that matter for the way this gets tested:

- **Rejected while the config is bad.** `start` in `app.no-config` /
  `app.error-config` is answered with a `log` at `warn` and a repeat of the
  current `status`. It is not an error and it does not change state.
- **stdin EOF is a shutdown.** When stdin closes, the sidecar performs a
  `shutdown`. This is the orphan guard (§3.6) *and* the reason
  `echo '{"v":1,"type":"stop"}' | node dist/index.js --config …` exits 0
  promptly: the pipe closes right behind the message.

### 3.5 Config change: in-place reload, not a restart

`config` is applied **in place**. A process restart was the alternative (§9.2);
in-place reload is possible only because §2.7 removed the last thing that had
to be set before Node started.

On `config`:

1. Re-run §2.2 resolution (honouring an explicit `path` if the message carries
   one) and §2.4 validation.
2. If invalid: emit `app.error-config` with the problems, **keep running on the
   previous good config** if the uplink is running. A typo in the UI must not
   silently stop a flight being logged mid-air.
3. If valid, apply field by field:

| Field changed | Effect |
|---|---|
| `serverUrl`, `ingestToken` | Applied to the next request. No reconnect. Backend axis moves to `net.pending` until the next response. |
| `certPath` | TLS dispatcher rebuilt (§2.7). Applied to the next request. |
| `trafficEnabled` | Off → on and on → off both take effect at the **next SimConnect connect**, because the traffic data definition is registered at connect time (`agent/agent.js` lines 206–213). If the link is up, the sidecar closes and reconnects it so the change is not silently deferred, and emits a `log` saying so. |
| `trafficRadiusM` | Applied at the next sweep — it is a parameter of `requestDataOnSimObjectType`. |
| `sim` | Closes the SimConnect handle and reconnects with the new protocol; `attempt` resets to 0 so the new protocol gets a fresh 5 s backoff ladder. |
| `autoUplink`, `nodePath`, `version` | Stored; no runtime effect in the sidecar. |

Every reload emits at least one `status` line, so "the config took effect" is
an observable event and not a matter of faith.

### 3.6 Process lifecycle

**Spawn.** The Rust supervisor spawns:

- program: `config.nodePath` if set, else `node` resolved from `PATH`;
- argv: `["<sidecar entry>", "--config", "<resolved config path>"]`;
- cwd: the sidecar directory (the directory containing `dist/`), so
  `node_modules` resolution is unambiguous;
- env: the shell's own environment, unmodified, plus nothing. No
  `NODE_EXTRA_CA_CERTS`, no `SERVER_URL`, no `INGEST_TOKEN` — the config file
  is the only channel, which is the whole point of acceptance criterion 2;
- stdio: `stdout` piped, `stdin` piped, `stderr` piped;
- Windows only: `CREATE_NO_WINDOW` (`0x08000000`) creation flag, so launching
  the app does not flash a console window.

Sidecar entry resolution, in order: (1) in a bundled install,
`resolve_resource("sidecar/dist/index.js")`; (2) in `cargo tauri dev`,
`<CARGO_MANIFEST_DIR>/../sidecar/dist/index.js`. If neither exists, the shell
emits a synthetic `status` with `app.crashed` and a `sidecar:log` naming both
paths it tried — never a silent dead window.

**Unexpected exit.** Any child exit that was not preceded by a `shutdown` the
shell sent is unexpected. The shell:

1. emits `sidecar:exit` `{ code, signal, restarting, restartsRemaining }`;
2. emits a synthetic `status` carrying `app.crashed` (§4.2) — synthesised
   because the child is gone and cannot report on itself;
3. restarts if the budget allows: **at most 5 restarts in a rolling 60-second
   window**, with a fixed 2000 ms delay between them. While restarting it
   emits `app.restarting`. When the budget is exhausted it stops trying,
   stays on `app.crashed`, and the UI's `RESTART` prompt (LSK on the STATUS
   page) is the way back — a human decision, which is correct for a fault
   that has already repeated five times.

The budget is the guard against the exact failure `process.exit(1)` on a bad
config would otherwise produce (§2.5): a spin loop the user cannot see into.

**User STOP.** `uplink_stop` sends the `stop` line. The child stays alive.
STOP is not a process operation — that distinction is what lets the panel keep
showing status after the user stops the uplink.

**Clean shutdown.** On window-close / app-exit the shell sends `shutdown`,
then waits **2000 ms** for the child to exit, then kills it. On Windows the
kill is `TerminateProcess` via `Child::kill()`. Belt and braces, in this
order:

1. `shutdown` control line;
2. closing the child's stdin — the sidecar treats EOF as `shutdown` (§3.4), so
   even a shell that dies without sending anything takes the sidecar with it;
3. `kill()` after the grace period.

**The guarantee**: when the window closes, no process keeps posting to the
user's server. Rule 2 is what makes it hold even if the shell is killed
abruptly, and it is the one worth testing on Windows (§7.1 step 11).

### 3.7 Forwarding into the webview

The shell does not reinterpret sidecar messages; it forwards them.

| Sidecar message | Tauri event | Payload |
|---|---|---|
| `status` | `sidecar:status` | The `StatusMessage`, verbatim |
| `log` | `sidecar:log` | The `LogMessage`, verbatim |
| `hello`, `pong` | *(not forwarded)* | Kept in supervisor state; `hello.configPath` feeds `config_path` |
| *(child exit)* | `sidecar:exit` | `{ code, signal, restarting, restartsRemaining }` |
| *(child exit / spawn failure)* | `sidecar:status` | A **synthetic** status with `app.crashed` or `app.restarting`, the other axes carried over from the last real status with `sim`/`backend` forced to their idle states |

Commands the webview may invoke — exact strings, frozen, cross-checked by
`windows-client/tools/contract-check.mjs`: `config_get`, `config_set`,
`config_path`, `uplink_start`, `uplink_stop`, `sidecar_restart`, `status_get`.
Their signatures are in `contracts/ipc-names.json` and §6.3.

`status_get` exists so a reloaded webview paints immediately from the last
known status instead of waiting up to 5 s for the next heartbeat.

### 3.8 Extensibility

`frame` and `traffic` are **named and shaped now, emitted never** in this run.
A future live-data CDU page is then purely additive: the sidecar starts
emitting them, the shell forwards them under `sidecar:frame` /
`sidecar:traffic`, and every older component ignores them because §3.2 makes
an unknown `type` a silent no-op. Nothing about this run has to be renegotiated
to get there, and nothing about this run builds any of it.

New fields inside an existing message are likewise additive: consumers read
the fields they know and ignore the rest. `v` is bumped only for a **breaking**
change — a removed field, a changed type, a changed meaning.

## 4. FMC status vocabulary

Machine-readable copy of this section: `contracts/status-table.json`.
It is implemented **twice** — `windows-client/sidecar/src/status.ts` (T-002)
and `windows-client/ui/src/status.js` (T-006) — and the two are kept honest by
T-008's `render-check.mjs` and by the row-by-row test in
`tests/status.test.ts`.

### 4.1 Four axes, all visible at once

SimConnect being down and the server being unreachable are **different
problems with different fixes** (`agent/README.md` treats the traffic path,
the flight path and the SimConnect link as independent failure domains, and so
does `src/ingest.ts`, where traffic never touches the connected flag). A single
"status" line would have to pick one to show and would therefore hide the
other.

So the status page renders **four fixed lines, always present, never
collapsed**:

| Line | Axis | DOM hook | Answers |
|---|---|---|---|
| 1 | `app` — control | `#status-app` | Is the sidecar alive and is the uplink meant to be running? |
| 2 | `sim` — SimConnect link | `#status-sim` | Can we see the simulator? |
| 3 | `backend` — server reachability | `#status-net` | Can we see the msfslogger server? |
| 4 | `pause` — sim pause state | `#status-pause` | Is the sim actually running? |

Each line carries `data-state="<state id>"` and
`data-severity="ok|caution|fault|idle"`. One axis never overwrites another,
and no axis is ever blank: every axis has an idle state.

A fifth, advisory line (`#status-traffic`) shows the traffic sweep counters. It
is not an axis and never changes another line's state.

### 4.2 Axis `app` — control and process

| State id | Label | Emitted by | Entered when |
|---|---|---|---|
| `app.starting` | `SIDECAR STARTING` | sidecar | Process start, before the config file has been read |
| `app.no-config` | `NO CONFIG` | sidecar | No config file at the resolved path — first run (§2.5) |
| `app.error-config` | `CONFIG INVALID` | sidecar | File present but unparseable or failing §2.4. `problems[]` carries one line per field. Process stays alive |
| `app.stopped` | `UPLINK STOPPED` | sidecar | Config valid, uplink not running: never started (`autoUplink` false) or stopped by the user |
| `app.running` | `UPLINK ACTIVE` | sidecar | A `start` was accepted and no `stop` has followed |
| `app.crashed` | `SIDECAR FAULT` | **shell** | The child exited without a `shutdown` (§3.6). Synthetic — the sidecar cannot report its own death |
| `app.restarting` | `SIDECAR RESTART` | **shell** | Within the restart budget, respawning |

### 4.3 Axis `sim` — the SimConnect link

| State id | Label | Entered when |
|---|---|---|
| `sim.idle` | `SIM LINK STANDBY` | The uplink is not running, so nothing is attempted |
| `sim.connecting` | `SIM LINK CONNECTING` | `open()` called, neither resolved nor rejected |
| `sim.connected` | `SIM LINK ONLINE` | `recvOpen` received. `attempt` resets to 0. `appName`/`appVersion` filled from `recvOpen` |
| `sim.retry` | `SIM LINK RETRY {ss}S` | A connect attempt failed, or an established link dropped (`quit`, `close` or `error`), and the next attempt is scheduled |

**The backoff is `agent/agent.js`'s, unchanged**:
`delay = Math.min(5000 * 2 ** attempt, 60000)`, `attempt` incremented per
consecutive failure and reset to 0 on `recvOpen`. Attempts 0–8 therefore give
`5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000, 60000` ms — the exact
sequence T-002 asserts. The single-pending-reconnect guard
(`reconnectScheduled`) is ported too: SimConnect commonly fires `error`
alongside `quit`/`close` for one drop, and without the guard the ladder would
double twice for a single event.

`{ss}` in the label is whole seconds remaining until `nextRetryAt`, computed in
the UI, zero-padded to two digits and capped at `99`: `SIM LINK RETRY 05S`,
`SIM LINK RETRY 60S`. Showing the countdown is what stops the user from
concluding the app is dead during a 60-second wait.

### 4.4 Axis `backend` — the server

| State id | Label | Entered when |
|---|---|---|
| `net.idle` | `ACARS STANDBY` | Uplink not running: nothing posted, nothing probed |
| `net.pending` | `ACARS CONNECTING` | Uplink started, no request has completed yet |
| `net.ok` | `ACARS UPLINK` | The most recent frame or event POST returned 2xx |
| `net.standby` | `ACARS READY` | No ingest POST in the last 15 s (the sim link is down, so there are no frames) but the reachability probe got an HTTP response |
| `net.unauthorized` | `ACARS REJECT 401` | An ingest POST returned 401 — the token does not match the server's |
| `net.http-error` | `ACARS FAULT {status}` | An ingest POST returned a non-2xx other than 401 |
| `net.tls-error` | `ACARS CERT FAULT` | The request failed with `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID` or `CERT_HAS_EXPIRED` |
| `net.unreachable` | `ACARS NO COMM` | Transport failure: `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EHOSTUNREACH`, abort |

`ACARS UPLINK` is the frozen acceptance-criterion string. It is exactly that —
uppercase, one space, no punctuation, no decoration — and it appears in
`net.ok` and nowhere else. T-008's harness asserts the rendered text
character-for-character and fails the run if it changes.

Two rules give this axis its meaning:

- **Only frame and event POSTs set it.** Traffic POSTs update
  `traffic.lastError` and nothing else, because `agent/README.md` guarantees a
  traffic failure "never affects the flight-data path", and a traffic-only
  `400` must not light up a fault the user cannot act on.
- **The reachability probe** exists because when the sim link is down there
  are no frames, and an axis with no evidence would freeze on a stale value.
  While the uplink is running and no ingest request has completed in the last
  15000 ms, the sidecar issues `GET {serverUrl}/api/status` every 15000 ms.
  That endpoint sits behind `requireAuth` in `src/server.ts` and answers `401`
  to an unauthenticated caller — which is a perfectly good reachability
  answer. **Any** HTTP response, including 401 and 404, means reachable →
  `net.standby`. A transport or TLS failure maps as in the table. The probe
  never produces `net.ok`, `net.unauthorized` or `net.http-error`: those three
  are claims about *ingest*, and only an ingest response may make them. The
  probe is a `GET`, changes no server state, and is the only request this
  design adds to the server's existing surface.

### 4.5 Axis `pause` — decoding `Pause_EX1`

`agent/agent.js` reads the MSFS `Pause_EX1` bitmask: bit 1 full pause, bit 2
with-sound (legacy), bit 4 Active Pause, bit 8 sim frozen (menu). The legacy
`Paused`/`Unpaused` events do not fire for Active Pause at all, which is why
they are ignored once a `Pause_EX1` has been seen (`usingPauseEx1`). Both
behaviours are ported unchanged, and `describePause()`'s string (`full`,
`active`, `full+active`, `unknown(<n>)`) is carried in `pause.label` for the
log line.

Four bits, four display states, resolved by **precedence** so a combined
bitmask never produces a blank or an ambiguous label:

| Order | State id | Label | Condition |
|---|---|---|---|
| 1 | `pause.active` | `ACTIVE PAUSE` | bit 4 set — always wins; it is the one the legacy events miss |
| 2 | `pause.menu` | `SIM MENU` | bit 8 set, bit 4 clear |
| 3 | `pause.full` | `SIM PAUSED` | bit 1 or bit 2 set, bits 4 and 8 clear; also the legacy `Paused` event before any `Pause_EX1` |
| 4 | `pause.unknown` | `PAUSE {flags}` | flags non-zero with no known bit — a future SDK bit, shown raw rather than swallowed |
| 5 | `pause.off` | `PAUSE OFF` | flags `0`, or legacy `Unpaused` before any `Pause_EX1` |

Three display states for four bits is deliberate: `full` and `with-sound` are
the same thing to a user, and the server already treats *any* non-zero flag
identically (it stops the flight clock). What the user needs to tell apart is
"I paused it", "I active-paused it" and "the sim is in a menu", because those
have different causes.

`pause` resets to `pause.off` whenever the SimConnect link drops — a stale
`ACTIVE PAUSE` on a dead link is a lie.

### 4.6 Rendering rules

- `severity` drives colour only (§6.6): `ok` green, `caution` amber, `fault`
  red, `idle` dim grey. Colour never carries information the label does not:
  the panel must be readable in a screenshot, in monochrome, by a
  colour-blind user.
- Labels are uppercase ASCII, ≤ 20 characters, and fit the 24-column screen
  grid with their axis title.
- An **unknown state id** renders as `?? <id>` at severity `caution` and never
  blanks the line or throws. A sidecar newer than the UI must degrade to
  ugly-but-informative.
- The UI recomputes labels locally from the state id. It never displays a
  label string sent over the wire — the wire carries ids, the UI owns
  presentation. That is what makes the two implementations comparable and the
  contract check meaningful.

### 4.7 Worked scenarios

The point of four axes, in the four cases that actually happen:

| Situation | `#status-app` | `#status-sim` | `#status-net` | `#status-pause` |
|---|---|---|---|---|
| Everything working | `UPLINK ACTIVE` | `SIM LINK ONLINE` | `ACARS UPLINK` | `PAUSE OFF` |
| MSFS not started yet, server fine | `UPLINK ACTIVE` | `SIM LINK RETRY 10S` | `ACARS READY` | `PAUSE OFF` |
| Flying, server box rebooted | `UPLINK ACTIVE` | `SIM LINK ONLINE` | `ACARS NO COMM` | `PAUSE OFF` |
| Certificate not trusted | `UPLINK ACTIVE` | `SIM LINK ONLINE` | `ACARS CERT FAULT` | `PAUSE OFF` |
| Token wrong | `UPLINK ACTIVE` | `SIM LINK ONLINE` | `ACARS REJECT 401` | `PAUSE OFF` |
| First run, nothing configured | `NO CONFIG` | `SIM LINK STANDBY` | `ACARS STANDBY` | `PAUSE OFF` |

Row 2 versus row 3 is the whole argument: each has exactly one thing wrong,
they are different things, and the panel says which.

## 5. Directory and module boundaries

### 5.1 The tree

```text
windows-client/
├── .gitignore                  node_modules/, dist/, target/          [T-002]
├── README.md                   build, config, FMC vocabulary, test plan [T-011]
├── sidecar/                    Node 20 + TypeScript, no Tauri, no DOM
│   ├── package.json            deps: node-simconnect, undici          [T-002]
│   ├── package-lock.json                                              [T-002]
│   ├── tsconfig.json           strict, CommonJS, outDir dist/         [T-002]
│   ├── vitest.config.ts        root: __dirname                        [T-002]
│   ├── samples/config/         good.json + bad-*.json fixtures        [T-002]
│   ├── src/
│   │   ├── config.ts           §2 loader/validator            pure*   [T-002]
│   │   ├── status.ts           §4 state table + backoff       pure    [T-002]
│   │   ├── protocol.ts         §3 codec                       pure    [T-002]
│   │   ├── inspect-config.ts   CLI inspector                          [T-002]
│   │   ├── uplink.ts           HTTP + x-ingest-token + TLS (§2.7)     [T-003]
│   │   ├── traffic.ts          port of agent/traffic.js       pure    [T-003]
│   │   ├── simconnect.ts       port of agent/agent.js's SimConnect    [T-003]
│   │   ├── index.ts            entrypoint, stdin control, status      [T-003]
│   │   └── inspect-uplink.ts   CLI inspector                          [T-003]
│   └── tests/
│       ├── config.test.ts  status.test.ts  protocol.test.ts           [T-002]
│       └── traffic.test.ts uplink.test.ts                             [T-003]
├── src-tauri/                  Rust; cannot be compiled on this machine
│   ├── Cargo.toml              pinned versions, no git deps           [T-005]
│   ├── build.rs                                                       [T-005]
│   ├── tauri.conf.json         frontendDist ../ui, msi+nsis           [T-005]
│   ├── capabilities/default.json                                      [T-005]
│   ├── icons/                  generated byte-wise (§5.6)             [T-005]
│   └── src/
│       ├── main.rs             window, command registration           [T-005]
│       ├── supervisor.rs       spawn, stdout reader, restart (§3.6)   [T-005]
│       ├── protocol.rs         serde mirror of §3                     [T-005]
│       └── config.rs           read + atomic merge-write (§2.6)       [T-005]
├── ui/                         plain HTML/CSS/JS, no build step
│   ├── index.html                                                     [T-006]
│   ├── css/fmc.css             bezel, screen, LSKs, scratchpad        [T-006]
│   ├── css/pages.css           config-page styling                    [T-007]
│   ├── src/bridge.js           the ONLY window.__TAURI__ reference    [T-006]
│   ├── src/status.js           §4 table rendered                      [T-006]
│   ├── src/app.js              shell, routing, scratchpad, LSKs       [T-006]
│   ├── src/pages/index.js      page registry, lazily imported         [T-007]
│   ├── src/pages/*.js          NETWORK / SIM / TRAFFIC pages          [T-007]
│   └── tools/render-check.mjs  headless screenshots of every state    [T-008]
└── tools/contract-check.mjs    Rust↔webview name check                [T-008]
```

`pure*`: `config.ts` is pure apart from one `readFileSync` in `loadConfig`;
`validateConfig` itself takes a parsed object and touches nothing.

### 5.2 Purity rules, and what they buy

The deliberate constraint carried over from `agent/traffic.js` — which is
dependency-free precisely so it can run where `node-simconnect` cannot:

- `config.ts`, `status.ts`, `protocol.ts` and `traffic.ts` **must not import
  `node-simconnect`, must not import `undici`, and must not open a socket**.
  `grep -n 'node-simconnect' windows-client/sidecar/src/{config,status,protocol,traffic}.ts`
  returns nothing. This is what makes 40+ unit tests possible on a Linux box
  with no simulator.
- `traffic.ts` additionally reads **no environment variable**:
  `grep -n 'process.env' windows-client/sidecar/src/traffic.ts` returns
  nothing. The radius arrives as a parameter from the config (§2.1).
- `simconnect.ts` is the only file that imports `node-simconnect`.
  `uplink.ts` is the only file that performs HTTP or touches TLS.
  `index.ts` is the only file that reads stdin or writes stdout.
- `status.ts` owns the backoff function (`nextReconnectDelayMs`), not
  `simconnect.ts` — the ladder is decision logic and belongs where it can be
  asserted (§4.3).
- In the UI, `bridge.js` is the **only** file that mentions `window.__TAURI__`:
  `grep -rn '__TAURI__' windows-client/ui/src/` has hits in `bridge.js` only.
  Everything else talks to the bridge object, which is why the whole panel
  runs in headless Chromium (§6.4).

### 5.3 The T-006 / T-007 seam

T-006 owns `index.html`, `fmc.css`, `bridge.js`, `status.js`, `app.js`.
T-007 owns `src/pages/**` and `css/pages.css`, and **must not edit any T-006
file**. So the shell has to work before the pages exist, and gain them without
being touched:

- `index.html` loads exactly one module, `src/app.js`. **Amended 2026-09-11**
  (see §0 amendment #3): the implemented shell also carries the CFG page
  templates inline in `index.html` and links `css/pages.css` directly,
  rather than injecting them lazily from `src/pages/index.js` as first
  frozen below. T-009's review found no functional harm — `src/pages/**`
  still owns the page *logic* that registers against those templates, T-006
  and T-007 never touched the same file concurrently in practice, and no
  dangling reference or console error resulted. The lazy-injection rule
  below is retained as the originally frozen intent for reference, but is
  not what shipped.
- `app.js` exposes `window.FMC = { registerPage, showPage, setScratchpad,
  getScratchpad, getConfigCache, bridge }` and loads pages **lazily**:
  `await import('./pages/index.js')` inside a `try`/`catch`, triggered only by
  navigation to a config page (LSK on the MENU page), never at startup. Before
  T-007 lands, that navigation shows `PAGE UNAVAILABLE` in the scratchpad
  instead of throwing; after it lands, the pages register themselves.
- `src/pages/index.js` injects its own stylesheet
  (`<link rel="stylesheet" href="css/pages.css">` appended to `document.head`)
  and calls `window.FMC.registerPage(...)` once per page. That keeps the
  stylesheet reference inside the directory its owner controls.

### 5.4 What is testable here, and what is not

| Area | Runs on this Linux machine? |
|---|---|
| `sidecar/src/{config,status,protocol,traffic}.ts` | Fully — pure functions, unit-tested |
| `sidecar/src/uplink.ts` | Fully — scratch HTTP/HTTPS server on port ≥ 3100 |
| `sidecar/src/simconnect.ts` | Partly — connect failure, backoff, retry and status emission are real here (`ECONNREFUSED 127.0.0.1:2048`); a successful session is not |
| `sidecar/src/index.ts` | Fully for lifecycle, control messages and status emission; the sim half is stuck in retry |
| `ui/**` | Structure, labels, DOM and interaction, via headless Chromium. **Not** WebView2 rendering fidelity |
| `src-tauri/**` | **Not at all** — no `cargo`, no `rustc`, no WebView2. Structural review, `tomllib`/`jq` parse checks and the contract check are the entire local story |

### 5.5 Verification commands

Every command is run from the repo root, under Node 20:
`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20`.

| Area | Command |
|---|---|
| Sidecar typecheck | `npx tsc --noEmit -p windows-client/sidecar/tsconfig.json` |
| Sidecar build | `npx tsc -p windows-client/sidecar/tsconfig.json` |
| Sidecar tests | `npx vitest run --config windows-client/sidecar/vitest.config.ts` |
| Config inspector, good | `node windows-client/sidecar/dist/inspect-config.js windows-client/sidecar/samples/config/good.json` |
| Config inspector, bad | `for f in windows-client/sidecar/samples/config/bad-*.json; do node windows-client/sidecar/dist/inspect-config.js "$f" >/dev/null 2>&1; echo "$f -> $?"; done` |
| Uplink inspector | `node windows-client/sidecar/dist/inspect-uplink.js --config <scratch config on port 3100+>` |
| Entrypoint smoke | `timeout 30 node windows-client/sidecar/dist/index.js --config <scratch config>` |
| Token leak check | `timeout 15 node windows-client/sidecar/dist/index.js --config <scratch> 2>&1 \| grep -c '<token>'` → `0` |
| Cargo manifest parses | `python3 -c "import tomllib; tomllib.load(open('windows-client/src-tauri/Cargo.toml','rb')); print('ok')"` |
| Tauri config parses | `jq . windows-client/src-tauri/tauri.conf.json` |
| Panel renders, every §4 state | `node windows-client/ui/tools/render-check.mjs` |
| Rust ↔ webview names agree | `node windows-client/tools/contract-check.mjs` |
| Scope | `git status --porcelain agent/ client/ src/ tests/` → empty |
| Root files untouched | `git status --porcelain package.json package-lock.json tsconfig.json vitest.config.ts` → empty |

Rules these commands encode:

- The sidecar has **its own** `tsconfig.json` and `vitest.config.ts` under
  `windows-client/sidecar/`. `vitest.config.ts` sets `root: __dirname` so the
  root `vitest.config.ts` is neither read nor needed (the Planner verified
  this invocation against the root vitest 4.1.11 install).
- **Neither the root `tsconfig.json`, nor the root `vitest.config.ts`, nor the
  root `package.json`/`package-lock.json` is modified by this run.** The
  sidecar is not added to `npm test`, `npm run build` or the root `include`.
- Scratch servers bind port 3100 or above. Never 3000. Nothing in this run
  opens `flights.db`, in any mode.
- Headless Chromium comes from the repo's existing `puppeteer` dependency and
  launches with `--no-sandbox`. Module scripts are blocked over `file://`, so
  `render-check.mjs` serves `windows-client/ui` over `http://127.0.0.1:<free
  port>` and navigates there.
- `contract-check.mjs` only reads. It opens no file for writing.

### 5.6 Build and packaging specifics

**Sidecar `tsconfig.json`**: `target ES2022`, `module commonjs`,
`strict: true`, `outDir ./dist`, `rootDir ./src`, `esModuleInterop`,
`skipLibCheck`, `include: ["src/**/*"]` — the root tsconfig's settings, so a
reader of one understands the other. CommonJS because `node-simconnect` 4.2.0
and `undici` 7.29.1 are both `require()`-able and `node dist/index.js` then
needs no ESM flags. `tests/**` is excluded from the build tsconfig and covered
by vitest's own transform.

**Sidecar `package.json`**: `"private": true`, `"main": "dist/index.js"`,
scripts `build` (`tsc -p tsconfig.json`), `test`
(`vitest run --config vitest.config.ts`), `typecheck` (`tsc --noEmit -p
tsconfig.json`). Dependencies pinned exactly: `node-simconnect` `4.2.0`,
`undici` `7.29.1`. Dev dependencies pinned to the versions the root already
has installed, so the two toolchains cannot disagree: `typescript` `5.9.3`,
`vitest` `4.1.11`, `@types/node` `20.19.39`. **T-002 declares the complete
dependency set**, including `undici`, so T-003 never has to touch the lockfile
(see §5.7).

**`tauri.conf.json`** (T-005) fixes: `productName` `msfslogger`, `identifier`
`com.msfslogger.windows-client`, `build.frontendDist` `"../ui"`,
`build.beforeBuildCommand` building the sidecar, `app.withGlobalTauri: true`
— **load-bearing**: the UI has no bundler, so `window.__TAURI__` must exist as
a global or `bridge.js` cannot reach the shell at all. `app.security.csp` is
set to
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost`
— `ipc:`/`http://ipc.localhost` are what Tauri v2 needs for `invoke` on
Windows, and `'unsafe-inline'` is limited to styles. `bundle.targets`
`["msi", "nsis"]`. `bundle.resources` maps the sidecar into the installer:
`../sidecar/dist` → `sidecar/dist`, `../sidecar/node_modules` →
`sidecar/node_modules`, `../sidecar/package.json` → `sidecar/package.json`.
**No signing keys anywhere in the file.**

**`Cargo.toml`** (T-005): explicit versions, no `*`, no git dependencies.
Verified current on crates.io while writing this: `tauri 2.11.5`,
`tauri-build 2.6.3`, `serde 1.0.229`, `serde_json 1.0.151`. The supervisor
uses `std::process` and `std::thread`, not `tauri-plugin-shell`, so that the
Windows `CREATE_NO_WINDOW` flag and the exact kill/EOF ordering of §3.6 are
visible in our own code rather than delegated.

**Icons**: the Windows bundler needs `icons/icon.ico` plus the usual PNGs, and
this machine has no ImageMagick, no PIL and no sharp. `prototypes/probe-icon-gen.mjs`
proves a dependency-free generator (zlib + CRC32 for PNG chunks, a Vista-style
ICO with PNG payloads) produces files `file(1)` identifies correctly and
Chromium decodes. T-005 commits a generator of that shape plus its output
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`). If the
Windows bundler rejects the hand-built ICO, the documented fallback is one
command on the Windows box or CI runner — `cargo tauri icon icons/icon.png` —
which regenerates every format from the PNG. Recorded as a risk in §10.2.

### 5.7 Cross-check against `plan.json`'s `allowed_paths`

Checked file by file against the tree in §5.1.

| Task | Verdict |
|---|---|
| T-002 | **Matches exactly.** Every path it lists exists in §5.1 with the same name and the same owner: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/{config,status,protocol,inspect-config}.ts`, `samples/config/**`, `tests/{config,status,protocol}.test.ts`, `windows-client/.gitignore` |
| T-003 | **Matches**, with one contingency below. `src/{uplink,traffic,simconnect,index,inspect-uplink}.ts`, `tests/{traffic,uplink}.test.ts`, `package.json` |
| T-005 | **Matches.** `windows-client/src-tauri/**` covers `Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/`, `icons/`, `src/*.rs` |
| T-006 | **Matches.** `index.html`, `css/fmc.css`, `src/{bridge,status,app}.js`, plus the run's `prototypes/**` |
| T-007 | **Matches.** `src/pages/**`, `css/pages.css`, plus `prototypes/**`. §5.3 exists specifically so T-007 needs nothing of T-006's |
| T-008 | **Matches.** `ui/tools/**`, `windows-client/tools/**`, plus `prototypes/**` |

**No amendment is required**, given one thing this design has arranged:
`undici` (§2.7) is declared by **T-002**, not T-003. Had T-003 added the
dependency, it would have had to regenerate
`windows-client/sidecar/package-lock.json`, which is **not** in its
`allowed_paths` — it is T-002's.

*Optional safety valve for the Orchestrator*: adding
`windows-client/sidecar/package-lock.json` to T-003's `allowed_paths` costs
nothing and removes the one way that task can be blocked by a dependency it
did not anticipate. If the Orchestrator prefers not to amend, T-002's brief
must say explicitly: declare `undici@7.29.1` **and** `node-simconnect@4.2.0`
in `package.json` and commit the resulting lockfile.

Two smaller notes, neither an amendment:

- `windows-client/tools/contract-check.mjs` (T-008) embeds its frozen name
  list as a single top-of-file `const`, copied from `contracts/ipc-names.json`.
  It must not read anything under `.claude/` — CI runs it and run artifacts
  are not a build input.
- The root `.gitignore` entry for Rust's `target/` is T-010's
  (`allowed_paths: [".gitignore"]`); `windows-client/.gitignore` is T-002's
  and covers `node_modules/`, `dist/` and `target/` too. The overlap is
  harmless; the belt-and-braces is deliberate, because a committed `target/`
  is hundreds of megabytes.

## 6. UI contract

Machine-readable copy: `contracts/ui-contract.json`. Names crossing the
bridge: `contracts/ipc-names.json`.

### 6.1 Page map

| Page id | Title | Group | n/m | Owner | LSKs |
|---|---|---|---|---|---|
| `STATUS` | `ACARS STATUS` | STATUS | 1/1 | T-006 | L1–L5 display-only status lines; `L6 <INDEX`; `R6` `START>` when stopped, `STOP>` when running; `R5 RESTART>` shown only while `app.crashed` |
| `MENU` | `MSFSLOGGER` | MENU | 1/1 | T-006 | `L1 <STATUS`, `L2 <NETWORK`, `L3 <SIM`, `L4 <TRAFFIC` |
| `NETWORK` | `CFG NETWORK` | CFG | 1/3 | T-007 | `L1` serverUrl, `L2` ingestToken, `L3` certPath, `L6 <INDEX`, `R6 SAVE>` |
| `SIM` | `CFG SIM` | CFG | 2/3 | T-007 | `L1` sim, `L2` autoUplink, `L6 <INDEX`, `R6 SAVE>` |
| `TRAFFIC` | `CFG TRAFFIC` | CFG | 3/3 | T-007 | `L1` trafficEnabled, `L2` trafficRadiusM, `L6 <INDEX`, `R6 SAVE>` |

`STATUS` is the page shown at launch. `PREV`/`NEXT` step through the CFG group
in order and wrap; `MENU` always returns to `MENU`. That covers all seven
settings (§2.1) with three pages of at most three fields each, which is what
keeps each page inside the FMC's six-LSK-per-side idiom instead of becoming a
scrolling form wearing a costume.

### 6.2 Frozen DOM hooks

These strings are a contract between T-006, T-007, T-008 and the Reviewer.
Renaming one silently breaks the render check, and no compiler here will
notice.

Structure: `#fmc-unit` (bezel root), `#fmc-screen` (carries
`data-page="<page id>"`), `#page-title`, `#page-number` (e.g. `1/3`, empty for
single-page groups), `#page-body` (the only container a page module writes
into), `#scratchpad` (carries `data-message-kind="entry|error|advisory"`),
`#msg-line` (dim mirror of the latest sidecar log), `#bridge-mode` (carries
`data-stub="true|false"`).

Status lines, each carrying `data-state` and `data-severity`: `#status-app`,
`#status-sim`, `#status-net`, `#status-pause`, plus `#status-traffic`
(advisory, `data-state` only), `#status-config-path`, and `#uplink-prompt`
(the `START>`/`STOP>` text).

Keys: `[data-lsk]` over `L1…L6`, `R1…R6`; `[data-key]` over `A`–`Z`, `0`–`9`,
`.`, `/`, `+/-`, `SP`, `DEL`, `CLR`, `MENU`, `PREV`, `NEXT`, `EXEC`.

Fields (T-007): `[data-field="<config key>"]` for each of `serverUrl`,
`ingestToken`, `certPath`, `sim`, `autoUplink`, `trafficEnabled`,
`trafficRadiusM`, each containing `[data-field-value="<config key>"]`. The
`ingestToken` field carries `data-masked="true"` and its value element
contains **only** the mask (§2.9).

### 6.3 Bridge API

`windows-client/ui/src/bridge.js` exports one object. Nothing else in the UI
touches Tauri.

| Bridge method | Tauri command / event | Notes |
|---|---|---|
| `getConfig()` | `config_get` | `{ exists, path, config: RedactedConfig\|null, raw }`. Missing file is `exists:false`, not an error. `raw` added 2026-09-11 (§0 amendment #3): the unredacted on-disk JSON, needed by the CFG pages to prefill editable fields (`RedactedConfig` masks the token) — additive, not a breaking change to the frozen shape |
| `setConfig(patch)` | `config_set` | Shallow merge + atomic write + `config` control line (§2.6) |
| `getConfigPath()` | `config_path` | For `#status-config-path` |
| `startUplink()` | `uplink_start` | |
| `stopUplink()` | `uplink_stop` | |
| `restartSidecar()` | `sidecar_restart` | Resets the restart budget (§3.6) |
| `getStatus()` | `status_get` | Last known status, for an immediate first paint |
| `onStatus(fn)` | event `sidecar:status` | Returns an unsubscribe function |
| `onLog(fn)` | event `sidecar:log` | |
| `onExit(fn)` | event `sidecar:exit` | |
| `isStub` | – | `true` when no Tauri was found |

### 6.4 The stub bridge

The seam that makes a Tauri app testable in a plain browser. When
`window.__TAURI__` (and `window.__TAURI_INTERNALS__`) are absent, `bridge.js`
builds a stub with the same method names and publishes
`window.__FMC_STUB__`:

```text
window.__FMC_STUB__ = {
  isStub: true,
  config: { exists, path, config },   // what getConfig() returns; mutable
  status: StatusMessage | null,       // last value handed to emitStatus
  calls: [{ method, args, at }],      // every bridge call, in order
  setConfigResult: { ok: true, path },// overwrite to exercise the failure path
  emitStatus(status),                 // delivers to every onStatus listener
  emitLog(log),
  emitExit(payload),
}
```

`render-check.mjs` (T-008) drives every state in §4 by calling
`window.__FMC_STUB__.emitStatus(...)` with a status object built from
`contracts/sample-status.jsonl`'s shape, screenshots the result, and asserts
the rendered label against §4's table. `calls` is how T-007 proves SAVE hit
`setConfig` with the whole config object, and that an invalid entry never
reached the bridge at all.

The stub is **not** a dev-only branch to be stripped: it is how the panel
behaves when it cannot find a shell, and in that situation showing a working
panel with `data-stub="true"` beats showing nothing.

### 6.5 Interaction model — scratchpad and LSKs

The FMC idiom, and the thing that distinguishes this from a styled web form:

1. Typing on `[data-key]` (or the physical keyboard, which maps to the same
   handler) appends to the **scratchpad** — the bottom line — never directly
   to a field.
2. Pressing the LSK beside a field **inserts** the scratchpad contents into
   that field and clears the scratchpad. Pressing an LSK with an **empty**
   scratchpad copies that field's current value *into* the scratchpad, which
   is how a real CDU lets you edit an existing entry.
3. `CLR` deletes one character; held (or pressed with an empty scratchpad) it
   clears the line and any message.
4. Boolean and enum fields (`trafficEnabled`, `autoUplink`, `sim`) **cycle**
   on LSK press with an empty scratchpad — `ON`/`OFF`, `2020`/`2024`/`FSX` —
   and also accept a typed value.
5. `R6 SAVE>` calls `setConfig` with the whole config object. A page with any
   invalid field never reaches the bridge; it shows the message instead.
6. Validation on entry mirrors §2.4 exactly, so the UI rejects precisely what
   the sidecar would reject, at the point of entry, with the field name in the
   message. The sidecar remains the authority (§2.6) — this is feedback, not a
   second source of truth.

Entry-time messages, in the scratchpad at `data-message-kind="error"`:
`INVALID ENTRY` (unparseable for the field), `ENTRY OUT OF RANGE`
(`trafficRadiusM` outside `[1000, 200000]`), `NOT ALLOWED` (LSK on a
display-only line), `KEY NOT ACTIVE` (LSK with nothing on that line), and
`CONFIG SAVED` as an advisory after a successful save.

Note the one deliberate difference from §2.4: the config **loader** clamps an
out-of-range radius, because the environment variable it replaces clamped.
The **UI** rejects it with `ENTRY OUT OF RANGE` rather than silently clamping,
because a user who just typed a number deserves to be told it was not kept.
Both behaviours are correct for their layer, and a file hand-edited to `999`
still loads as `1000`.

### 6.6 Skeuomorphic rules

Concrete enough to review against a screenshot.

**Palette** — declared as custom properties at the top of `css/fmc.css`, and
these exact hex values are what the Reviewer greps for:

| Token | Hex | Use |
|---|---|---|
| `--fmc-bezel` | `#2E3033` | Unit body |
| `--fmc-bezel-light` | `#45484C` | Top/left bevel highlight |
| `--fmc-bezel-edge` | `#17181A` | Bottom/right bevel shadow |
| `--fmc-screen` | `#0A1410` | CDU screen background |
| `--fmc-screen-glow` | `#10241A` | Radial vignette on the screen |
| `--fmc-green` | `#28E06E` | Normal data, `ok` severity |
| `--fmc-cyan` | `#4FD8F0` | Entered/editable values |
| `--fmc-white` | `#E8EDE9` | Titles and field labels |
| `--fmc-amber` | `#E0A21A` | `caution` severity, advisories |
| `--fmc-red` | `#F0554C` | `fault` severity |
| `--fmc-dim` | `#5A6B60` | `idle` severity, inactive prompts |
| `--fmc-key-face` | `#3A3D41` | Key caps |
| `--fmc-key-text` | `#DDE2DE` | Key legends |

**Font stack**, local only, no CDN, no `@font-face` over the network — the app
is offline by definition:
`"Consolas", "Lucida Console", "DejaVu Sans Mono", "Courier New", monospace`.
`grep -n 'http' windows-client/ui/css/fmc.css` returns nothing.

**Layout**: a bezel (`#fmc-unit`) with a raised bevel drawn from
`--fmc-bezel-light`/`--fmc-bezel-edge`; an inset screen (`#fmc-screen`) with a
subtle vignette and a fixed **24-column × 14-row character grid** sized in
`ch`/`em` so it scales with the window without reflowing; six LSKs down each
side of the screen, physically aligned with their rows; a key grid below the
screen (`MENU`, `PREV`, `NEXT`, alphanumerics, `SP`, `DEL`, `CLR`, `EXEC`).
Keys have a pressed state (bevel inverted, 1px translate). No animation beyond
that and a 1 Hz scratchpad cursor blink — the display must be stable enough
that a screenshot is meaningful evidence.

**Conventions adopted** (more than the required three, each checkable in a
screenshot):

1. **Title line with page counter** — `CFG NETWORK` centred, `1/3`
   right-aligned in `#page-number`.
2. **Small label over large value** — each field is a two-line pair: the label
   in `--fmc-white` at ~0.75em, the value beneath it in `--fmc-green`
   (stored) or `--fmc-cyan` (edited this session).
3. **Prompt arrows** — `<` prefix on left prompts (`<INDEX`), `>` suffix on
   right prompts (`SAVE>`, `START>`).
4. **Boxes and dashes** — `□□□□□□□□` for a required field that is empty
   (`serverUrl`, `ingestToken`), `--------` for an optional empty one
   (`certPath`). Straight from the CDU idiom and it tells the user which
   fields block them.
5. **Scratchpad messages in upper case** — `INVALID ENTRY` and friends
   (§6.5), cleared by `CLR`.
6. **Masked credential** — `••••••••` when set; the token never reaches the
   page (§2.9).

## 7. Windows verification plan, and what cannot be checked here

### 7.1 Manual test plan (the user, on the Windows box)

Prerequisites: Node 20, a Rust toolchain, WebView2 (present on Windows 11 and
on any up-to-date Windows 10), and the msfslogger server running with a known
`INGEST_TOKEN`. Build, from `windows-client/src-tauri`:
`npm --prefix ../sidecar ci`, `npm --prefix ../sidecar run build`, then
`cargo tauri dev` (or `cargo tauri build` for the installer; the
`windows-latest` CI job produces the same artifact without a local toolchain).

| # | Step | Expected observation | Proves |
|---|---|---|---|
| 1 | Launch the app with no config file present | Window opens on the `STATUS` page. `#status-app` reads `NO CONFIG`, `#status-sim` `SIM LINK STANDBY`, `#status-net` `ACARS STANDBY`. No console window flashes. Nothing crashes or loops | §2.5, §3.6, AC1 |
| 2 | `MENU` → `<NETWORK`, type the server URL, press `L1`; type the token, press `L2`; type the certificate path, press `L3`; press `SAVE>` | Each value appears on its line; the token shows as `••••••••`; scratchpad shows `CONFIG SAVED`; `%APPDATA%\msfslogger\config.json` now exists with those values | AC2, §2.2, §2.6, §6.5 |
| 3 | `NEXT` to `CFG SIM`, set `SIM` to `2024`, `NEXT` to `CFG TRAFFIC`, set radius `60000`, `SAVE>` | Values persist across `PREV`/`NEXT`; the file shows `"sim":"2024"`, `"trafficRadiusM":60000` | AC2 |
| 4 | On `CFG TRAFFIC` type `500` and press the radius LSK | Scratchpad shows `ENTRY OUT OF RANGE`; the field does not change; nothing is saved | §6.5 |
| 5 | On `CFG NETWORK` type `ftp://x` and press `L1` | `INVALID ENTRY`; field unchanged | §2.4, §6.5 |
| 6 | With MSFS **not** running, press `START>` on `STATUS` | `#status-app` `UPLINK ACTIVE`; `#status-sim` cycles `SIM LINK CONNECTING` → `SIM LINK RETRY 05S`, then `10S`, `20S`, … capping at `60S`; `#status-net` reads `ACARS READY` (server reachable, nothing to send) | §4.3, §4.4, AC3 |
| 7 | Start MSFS and load a flight | `#status-sim` → `SIM LINK ONLINE`; within a second `#status-net` → **`ACARS UPLINK`**; the server's web UI header shows `Connected · Idle` (then `Recording · <aircraft>` once a flight starts) and the live map starts moving | AC1, AC3, AC5 |
| 8 | Press `ESC` in the sim (full pause), then Active Pause | `#status-pause` → `SIM PAUSED`, then `ACTIVE PAUSE`. The server's flight clock stops in both cases | §4.5, AC5 |
| 9 | With traffic enabled, watch the server's live map at a busy airport | AI aircraft appear and move; parked aircraft do not | §8 item 6, AC5 |
| 10 | Stop the msfslogger server, keep flying | `#status-net` → `ACARS NO COMM` while `#status-sim` stays `SIM LINK ONLINE`. Restart the server: back to `ACARS UPLINK` with no user action | §4.1, §4.7 |
| 11 | Press `STOP>`, then close the window | `#status-app` → `UPLINK STOPPED`, `#status-net` → `ACARS STANDBY`. After closing, Task Manager shows **no** `node.exe` left from this app, and the server marks the agent disconnected | §3.6 |
| 12 | Set a deliberately wrong token in `CFG NETWORK`, `SAVE>`, `START>` with MSFS running | `#status-net` → `ACARS REJECT 401`, `#status-sim` stays `SIM LINK ONLINE` | §4.4 |
| 13 | Clear `certPath` while the server is HTTPS, `SAVE>` | `#status-net` → `ACARS CERT FAULT` — not a generic network error | §2.7, §4.4 |
| 14 | Hand-edit `config.json` to `"sim": "2019"`, then press `RESTART>` (or relaunch) | `#status-app` → `CONFIG INVALID` naming `sim`; the window stays up and usable; fixing it in the UI recovers without a relaunch | §2.5, §3.5 |
| 15 | Set `autoUplink` to `true`, quit, relaunch | The uplink starts by itself; set it back to `false` and it does not | §2.1 |
| 16 | Compare against the old agent: stop the app, run `node agent.js --sim 2024` from `agent/` with the old environment variables, fly for a minute | Identical server-side behaviour — same frames, same events, same traffic | AC5, §8 |

Acceptance-criterion coverage: AC1 steps 1, 7; AC2 steps 2, 3, 15; AC3 steps
6, 7, 10; AC4 steps 2, 4, 5, 8 plus the screenshots from T-006/T-007/T-008;
AC5 steps 7, 8, 9, 16.

### 7.2 What cannot be verified on this Linux machine

Stated plainly so no report claims otherwise:

- **`cargo build` / `cargo tauri build`** — the initial environment had no
  Rust binaries. At resume, Cargo and Rust 1.75.0 are installed, but may not
  meet the pinned Tauri dependencies’ compiler requirements. Record actual
  local checks and failures; Windows compilation and packaging remain pending
  until CI or the user builds them.
- **`tauri.conf.json` semantics** — `jq` proves it is JSON, not that Tauri
  accepts it. A wrong key name fails first on Windows.
- **WebView2 rendering fidelity** — headless Chromium is a different browser
  build with different font availability and different subpixel rendering. The
  screenshots are evidence of **structure, labels and layout**, not of how it
  looks on the user's screen.
- **A real SimConnect session** — `open()` only ever fails here
  (`ECONNREFUSED 127.0.0.1:2048`). Every data-definition read order, the
  `Pause_EX1` decoding against real flags, the traffic sweep against real
  objects and `recvOpen`'s contents are unexercised until step 7 above.
- **A real HTTPS server with the user's self-signed certificate** — §2.7's
  mechanism is proven against a throwaway certificate generated in the
  scratchpad, not against theirs, and not through their network.
- **The installer** — msi/nsis bundling, the icon pipeline, install/uninstall
  and the absence of a console window are all Windows-only observations.
- **Orphan-process behaviour on window close** — §3.6's guarantee rests on
  Windows process semantics this machine cannot exercise. Step 11 is the test.

## 8. Must-not-change list

Behaviour of the existing agent that this design guarantees survives
unchanged. The Reviewer checks these one by one, against `agent/agent.js` and
`agent/traffic.js` line by line, not against a summary.

1. **Reconnect backoff** — `Math.min(5000 * 2 ** attempt, 60000)`, reset to
   attempt 0 on `recvOpen`, with the single-pending-reconnect guard so a
   `quit`+`error` pair for one drop schedules one retry, not two
   (`agent/agent.js` lines 156–172).
2. **Flight data definition** — the same ten variables, the same units, the
   same types, in the same registration order, read back in that exact order
   (`agent/agent.js` lines 192–201, 233–245). A reordering is silent data
   corruption.
3. **`simRunning`** — `3` when `IS SLEW ACTIVE`, else `2`.
4. **1 Hz** — `SimConnectPeriod.SECOND` on the user object for flight data.
5. **`Pause_EX1` precedence** — subscribe to `Paused`, `Unpaused`, `Crashed`,
   `FlightLoaded` and `Pause_EX1`; once a `Pause_EX1` has been seen, the
   legacy events are ignored forever (`usingPauseEx1`). `pause` events post
   the raw numeric `flags`.
6. **Traffic filtering** — every rule in `agent/traffic.js`'s
   `buildTrafficBatch`, in order: drop the user by object id; drop by position
   within `0.0001` degrees of the user in both axes; drop non-integer or
   negative ids; drop non-finite `lat`/`lon`/`altitudeFt`/`headingDeg`; drop
   on-ground aircraft under `1` kt; de-duplicate by id keeping first-occurrence
   order with last-occurrence value; truncate at `200`; emit
   `{ id, lat, lon, altitudeFt, headingDeg, onGround }` with
   `groundSpeedKnots` dropped and **no rounding** (the server rounds).
7. **Traffic sweep cadence** — every `2000` ms, driven off the 1 Hz flight tick
   rather than its own timer, and only when traffic is enabled. When disabled:
   no data definition registered, no request issued, nothing posted.
8. **Traffic independence** — a separate data definition id and request id, a
   separate HTTP path, and a failure there never affects the flight-data path,
   the reconnect logic, or the backend status axis (§4.4).
9. **Traffic radius clamping** — `Math.round` then `[1000, 200000]`,
   non-finite → `40000` with a warning.
10. **`trafficEnabled` parsing** — false only for `0`, `false`, `off`, `no`
    (trimmed, lowercased). The server parses the same set independently and
    neither implies the other.
11. **Sim protocol mapping** — `2020` → `Protocol.KittyHawk`, `2024` →
    `Protocol.SunRise`, `fsx` → `Protocol.FSX_SP2`, case-insensitive, default
    `2020`; anything else is rejected rather than silently defaulted.
12. **HTTP shape** — the three endpoints, the bodies, `x-ingest-token`,
    `Content-Type: application/json` (§1.3), and `postJson`'s swallow-and-warn:
    a failed or non-2xx post never throws back into the SimConnect handler.
13. **No TLS escape hatch** — no `rejectUnauthorized: false`, no
    `NODE_TLS_REJECT_UNAUTHORIZED`, anywhere, ever (§2.7).
14. **`agent/**` itself** — not modified, not deleted, still runnable, still
    the documented fallback. Likewise `src/**`, `tests/**`, `client/**` and
    the server's API.

Two deliberate differences, both listed here so the Reviewer does not have to
guess whether they were accidents:

- **No `process.exit(1)` on bad config** in the supervised sidecar — the
  reason is §2.5, and the CLI inspectors keep the old exit-1 behaviour.
- **`stop` posts `{type:'disconnected'}`** where the old agent, killed with
  Ctrl-C, posted nothing and let the server's 10-second stale timer notice.
  The event type already exists and is already handled by `src/ingest.ts`;
  this only makes a clean stop instant instead of delayed.

## 9. Alternatives considered

### 9.1 Trusting the self-signed certificate (§2.7)

| Option | Why not |
|---|---|
| (a) Tauri passes `NODE_EXTRA_CA_CERTS` to the child from `config.certPath` | Works only when Tauri is the launcher. Phase 1 ships a standalone sidecar with no Tauri at all, so this cannot be the whole answer; and a `certPath` change would need a process restart to take effect |
| (b) The sidecar re-execs itself with the variable set | Works standalone, but on Windows it means two processes: killing the parent does not kill the child, which puts §3.6's no-orphan guarantee at risk for the exact scenario it exists to prevent. `process.execve` is POSIX-only and not in Node 20 |
| **(c) `undici` `Agent` with a custom CA, passed as `fetch`'s dispatcher** | **Chosen.** One process, no environment variable, applied per request so a config reload takes effect immediately, identical in the standalone and supervised runs, and it keeps full certificate validation — proved by `prototypes/probe-tls-dispatcher.mjs`, where a wrong-SAN certificate still fails. Cost: one pinned dependency, which is a package of the same code Node's global `fetch` already is |

### 9.2 Config change: restart vs in-place reload (§3.5)

Restarting the sidecar on every save is simpler to implement and impossible to
get subtly wrong. It was rejected because a restart mid-flight drops the
SimConnect link and the server sees a disconnect, so changing an unrelated
setting (say the traffic radius) would punch a hole in the flight being
logged. In-place reload is only affordable because §2.7 removed the last
setting that had to exist before Node started; the per-field effect table in
§3.5 is what keeps it honest, and the two fields that genuinely need a
reconnect (`sim`, `trafficEnabled`) do exactly that and say so in a log line.

### 9.3 One status string vs multiple axes (§4.1)

A single `connectionStatus` string is what the acceptance criterion's wording
("connection status … labeled ACARS UPLINK") most directly suggests, and it is
what most apps do. Rejected: `agent/README.md` and `src/ingest.ts` both treat
the SimConnect link and the server link as independent failure domains, and
collapsing them means the panel must choose which failure to hide. The user
debugging this is usually alone at a flight sim PC with no logs open; "which
of the two is broken" is the single most valuable thing the screen can say.
`ACARS UPLINK` remains exactly the label of the fully-working backend state,
so the acceptance criterion is met literally.

### 9.4 Sidecar language and transport

A Rust SimConnect rewrite was excluded by a frozen decision, correctly:
`node-simconnect` is proven end-to-end against a real Store install of MSFS
per `agent/README.md`. Within the Node choice, the transport options were
JSON-lines over stdio, a local HTTP port, or a named pipe. Stdio wins on every
axis that matters here: no port to collide with the server's 3000 or to be
firewalled, no authentication problem, the child's lifetime is bound to the
pipe (which §3.6 turns into the orphan guard), and a human can run the sidecar
in a terminal and read the protocol with their eyes — which is precisely how
phase 1 is verified before any Rust exists.

### 9.5 Where the config file lives

Tauri's `app_config_dir()` (`%APPDATA%\com.msfslogger.windows-client\`) is the
idiomatic choice and was rejected for one reason: the sidecar has to find the
same file with no Tauri in the process, and hard-coding a reverse-DNS
identifier into a Node program to mirror a Rust helper is a duplication that
will drift. `%APPDATA%\msfslogger\config.json` is derivable from one
environment variable on both sides, is typable by a human following the
README, and is still inside the roaming profile, so it survives app updates
and needs no elevation. A file beside the executable was rejected outright:
it does not survive a reinstall and may not be writable.

### 9.6 UI framework

React (as in `client/`) would have matched the repo's existing frontend
stack. Rejected because it forces a build step and a `node_modules` into the
Tauri bundle for a five-page, no-data-binding panel, and because a build step
is exactly what stops `render-check.mjs` being able to serve the directory and
screenshot it in one command. Plain HTML/CSS/JS also means `frontendDist` can
point straight at `../ui`. WebView2 is Chromium, so no polyfills and no
transpilation are needed.

## 10. Risks

### 10.1 Nothing Rust is compiled anywhere in this run

`src-tauri/**` targets Windows, which is unavailable here. At resume this
machine has Cargo/Rust 1.75.0 (§7.2), superseding the original no-Rust
assumption. Local checks are limited by that compiler and available platform
libraries. A type error, borrow-checker complaint or wrong Tauri API may remain
unverified until the `windows-latest` CI job (T-010) or the user builds it. **Falsified by**: the first CI run failing to compile.
**Mitigations**: the Rust surface is kept small and boring (`std::process`,
`std::thread`, `serde`, no plugin crates); versions are pinned to
crates.io-verified releases (§5.6); `contract-check.mjs` catches the seam that
a compiler would not check anyway — the string names shared with the webview;
and T-010's job exists specifically to be the first real compile.

### 10.2 The hand-built `.ico`

`prototypes/probe-icon-gen.mjs` produces files `file(1)` and Chromium accept,
but the Windows bundler's `ico` crate is the only opinion that counts and it
has not seen them. **Falsified by**: `cargo tauri build` failing on the icon.
**Mitigation**: `cargo tauri icon icons/icon.png` on the Windows box or the CI
runner regenerates every format from a PNG we know is valid; this is
documented in §5.6 and in the README T-011 writes.

### 10.3 Three implementations of one state table

§4's table exists in `sidecar/src/status.ts`, in `ui/src/status.js` and,
partly, in the Rust supervisor's synthetic states. A row added in one and
missed in another shows up on the user's Windows box as a blank or `?? <id>`
line, where nobody can debug it. **Mitigations**: the unknown-id fallback
(§4.6) makes the failure visible rather than blank; `tests/status.test.ts`
asserts the table row by row; `render-check.mjs` drives every id through the
real UI; T-009's review traces every id across all three. **Residual**: the
Rust side is still only checked by eye.

### 10.4 The token is plaintext on disk

Consistent with today (§2.8) and with the threat model, but it is a real
secret in a readable file in the user's profile. **Falsified by**: the user
wanting the app on a shared machine. **Follow-up, not in this run**: DPAPI
(`CryptProtectData`) on the Windows side, which would also mean the standalone
sidecar could no longer read the config unaided — a genuine design change, not
a tweak.

### 10.5 Node 20 must exist on the Windows box

A frozen decision, and identical to today's requirement, but the failure mode
changes: a CLI user sees `'node' is not recognized`, whereas a GUI user sees a
window that never connects. **Mitigation**: §3.6's spawn-failure path emits
`app.crashed` with a `sidecar:log` naming the program and both entry paths it
tried, and `nodePath` (§2.1) lets a user point at a Node that is installed but
not on `PATH`. The README states the prerequisite first.

### 10.6 The reachability probe is a new request against the user's server

`GET /api/status` every 15 s while the uplink runs and the sim is down (§4.4).
It is a read, it is authenticated-or-401, it changes nothing, and it stops the
moment frames start flowing — but it is traffic the server did not see before.
**Falsified by**: noise in the user's server log. **Mitigation**: the interval
is 15 s, not 1 s, and the probe only runs when there is nothing else to send.

### 10.7 Headless Chromium is not WebView2

Every screenshot in this run is evidence about structure and labels, not about
how the panel looks on Windows (§7.2). Font fallback in particular will differ:
`Consolas` exists on Windows and not here. **Mitigation**: the font stack is
ordered so a monospace face is always found, the grid is sized in `ch` so a
different face changes the look but not the layout, and §7.1's steps are the
only thing that can actually sign off acceptance criterion 4.
