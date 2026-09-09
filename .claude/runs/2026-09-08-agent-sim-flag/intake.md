# Intake — agent-sim-flag

## Goal

Replace the agent's current sim-version selection (editing `agent.js` source —
changing `Protocol.KittyHawk` to `Protocol.SunRise`) with a `--sim`/`-s`
command-line flag accepted by `agent/agent.js` at launch, selecting between
MSFS 2020, MSFS 2024, or FSX.

## Success criteria

- `node agent.js --sim 2024` (and `-s 2024`) connects using `Protocol.SunRise`.
- `node agent.js --sim 2020` / `-s 2020` connects using `Protocol.KittyHawk`.
- `node agent.js --sim fsx` / `-s fsx` connects using an FSX protocol constant
  from `node-simconnect`'s `Protocol` enum.
- Omitting the flag keeps today's default behavior (MSFS 2020 /
  `Protocol.KittyHawk`), so existing setups (README's Scheduled Task example,
  `npm start` with no args) keep working unchanged.
- An unrecognized `--sim` value fails fast with a clear error listing the
  accepted values, rather than silently falling back.
- `agent/README.md` §"MSFS 2020 vs 2024" is rewritten to document the flag
  instead of "edit agent.js and change Protocol.KittyHawk to Protocol.SunRise".

## Frozen decisions (from investigation, before delegating)

- There is no JSON config today — the user described it as "configuring a
  json" but the actual current mechanism (read from `agent/agent.js`) is
  editing the `Protocol.KittyHawk` literal directly, documented in
  `agent/README.md` §"MSFS 2020 vs 2024". No JSON file exists to remove.
- Confirmed via `node-simconnect@4.1.1`'s shipped `Protocol` enum
  (`dist/enums/Protocol.d.ts`, fetched via unpkg):
  `FSX_RTM=2, FSX_SP1=3, FSX_SP2=4, KittyHawk=5, SunRise=6`. FSX has three
  sub-versions; `FSX_SP2` (SP2/Acceleration) is the most current/complete and
  is the one to use for the `fsx` flag value — no separate flag needed per FSX
  service pack unless the user asks later.
- Accepted `--sim` values (case-insensitive): `2020`, `2024`, `fsx`.

## Tier

**Tier 2 — one Dispatcher + one Reviewer.** Single seam: `agent/agent.js`'s
connection setup (`tryConnect`, the `open(..., Protocol.KittyHawk)` call) plus
its paired doc section in `agent/README.md`. No schema change, no new
endpoint, no shared type — CLI arg parsing feeding an existing `Protocol`
parameter. Design step skipped per `.claude/agents.md` rule 3 (no contract
introduced); recorded here rather than silently. Ship/DevOps step skipped —
run touches neither build, packaging, nor deploy (the agent is a
manually-copied script on the Windows box, not part of the server's build).

## Constraints

- No new runtime dependency (Node's built-in `process.argv` is enough for a
  two-flag parser; no `yargs`/`commander`).
- Do not touch `src/`, `client/`, or anything server-side — this is agent-only.
- Preserve all existing behavior: traffic sweep, pause handling, reconnect
  logic, env vars (`SERVER_URL`, `INGEST_TOKEN`, `TRAFFIC_ENABLED`,
  `TRAFFIC_RADIUS_M`) are untouched.
- This agent is deployed to a separate Windows machine and needs to be
  manually redeployed + restarted there before it takes effect — not
  verifiable end-to-end from this machine. Verification here is limited to
  `node --check` / a syntax-level smoke run of the arg parser, per
  `.claude/ENVIRONMENT.md`.
