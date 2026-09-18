# Intake — MCP server integration

Run id: 2026-09-18-mcp-server
Orchestrator: Claude (msfslogger session)

## Goal (restated)

Expose msfslogger's logbook — flights, trips, planned legs, ACARS comms, live
status — to Claude via an MCP server, so a user can ask Claude questions about
their flying history and, for a narrow set of low-risk actions, make edits
through natural language instead of the web UI.

## Success criteria

1. A remote Claude client (Desktop or Code, running on a machine other than
   the msfslogger host) can connect to an MCP endpoint served by msfslogger
   and call tools against the real logbook.
2. Read tools cover: flight list/detail, trip list/detail/journey, planned-leg
   list/detail, ACARS thread read, live status, current ground session.
3. Write tools are limited to additive/reversible actions: flight notes edit,
   trip creation, flight↔trip assignment, SimBrief loose-leg import. No
   deletes, no combines, no SayIntentions link/clearance/send, no password or
   credential writes are reachable through MCP.
4. The credential that authorizes MCP access is distinct from `INGEST_TOKEN`
   (the Windows agent's credential) — revoking one must not affect the other.
5. Nothing about the existing web UI, ingest path, or Windows-agent auth
   changes behaviour.

## Decisions already frozen by the user

- **Remote access is a hard requirement**, stated verbatim: "Add remote claude
  as a requirement. Running on the same machine as the server is an unlikely
  use case as the server is meant to run headless in a homelab scenario." This
  rules out a stdio-transport MCP server entirely — the client cannot spawn a
  local subprocess on a box it isn't running on.

## Orchestrator's proposed architecture (directional, not yet frozen — Designer's job to validate, refine, or override)

Presented to the user across the prior two turns of this conversation; no
objection was raised before "Begin design process," but nothing below should
be treated as immutable the way the frozen decision above is. Flag any of it
in `design.md` if the evidence says otherwise.

1. **Transport**: MCP Streamable HTTP, not stdio — required by the frozen
   remote-access decision above.
2. **Placement**: mount the MCP endpoint inside the existing `src/server.ts`
   Express app (e.g. `/mcp`) rather than a standalone `mcp-server/`
   package/process. Reuses the TLS setup already mandatory for non-loopback
   bind (see `docs/security.md` / README) and avoids exposing a second port
   from the homelab.
3. **Auth**: a new env var/credential (working name `MCP_TOKEN`) and a new
   allow-list (working name `MCP_SCOPED_ROUTES`), modeled on
   `src/auth/ingestScope.ts` / `INGEST_SCOPED_ROUTES` but covering the
   broader read surface MCP tools need (`/api/flights`, `/api/trips`,
   `/api/planned-legs` GETs are not in the existing ingest allow-list) plus
   the narrow write set in success criterion 3. Kept separate from
   `INGEST_TOKEN` per success criterion 4.
4. **Auth mechanism**: static bearer token (same shape as `INGEST_TOKEN`),
   not OAuth 2.1. Proportionate for a single-operator homelab and consistent
   with the only precedent this codebase has; Designer should record this as
   a deliberate scope-down, not an oversight, in case a future run needs to
   revisit it.
5. **Two server-side gaps surfaced during ideation, not covered by any
   existing route** — either build them or drop the tools that need them:
   - `get_flight_stats` (aggregates: total hours, distance, most-flown
     aircraft/routes)
   - `search_flights` (free-text over notes/airports)

## Open question — not blocking, but Designer should record the default taken

How the homelab actually exposes this externally (reverse proxy, VPN/
Tailscale, direct port-forward) was raised but not answered. Proceeding on
the assumption that the security model is TLS + bearer-token secrecy only,
matching the existing `INGEST_TOKEN` posture — no IP allow-listing in v1.
Revisit with the user if the Designer finds this insufficient for a
publicly-reachable homelab port.

## Tool inventory from ideation (input to Planner/Designer, not frozen)

**Read tools** — `list_flights`, `get_flight`, `search_flights` (new),
`get_flight_stats` (new), `list_trips`, `get_trip`, `get_journey`,
`list_planned_legs`, `get_planned_leg`, `get_acars_thread`, `get_weather`,
`list_canned_messages`, `get_status`, `get_ground_session`.

**Write tools** — `update_flight_notes` (notes field only, never `aircraft`),
`create_trip`, `assign_flight_to_trip`, `import_simbrief_leg`.

**Explicitly excluded from v1** — any `DELETE`, `combine_flights`, PDF
upload/attach, all SayIntentions link/import/clearance/send routes, all
settings/credential writes.

## Codebase facts (for Planner/Designer — verified this session)

- Full existing route surface: `docs/api.md` (routes, auth type per route,
  the `INGEST_SCOPED_ROUTES` allow-list mechanism in
  `src/auth/ingestScope.ts`).
- Full schema: `docs/data-model.md` (`src/db/schema.ts`, one file per table
  under `src/db/`).
- Server entrypoint / route mounting: `src/server.ts`.
- No existing MCP dependency or reference anywhere in the repo (`grep -ril
  mcp` returns only unrelated matches in `airports.json` /
  `package-lock.json`) — this is a greenfield integration, no prior art to
  reconcile with.
- TLS-on-non-loopback enforcement already exists server-side; see README
  Quickstart and `docs/security.md`.

## Steps skipped and why

None yet — this is tier-3 (new server component, new auth scope, new API
routes, a new external-facing contract). Full loop applies: Plan → Design →
Implement → Review → Ship. DevOps involvement at Ship is likely (new env var,
possibly Docker/compose port or reverse-proxy documentation) but the actual
call is deferred to after Design, once the scope of deployment changes is
concrete.
