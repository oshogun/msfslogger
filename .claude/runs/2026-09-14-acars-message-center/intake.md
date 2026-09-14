# Intake — ACARS Message Center (Inbox/Outbox)

Source: `user_stories/acars_message_center.md`

## Goal (restated)

Introduce a shared, generic `acars_messages` store — server table + read/write
API — that becomes the substrate for datalink-style messages tied to a flight:
uplink ("dispatch") and downlink ("cockpit") entries across categories (`pdc`,
`wx`, `freetext`, `position-report`, `dispatch`). Ship a client page that
shows the thread for a flight, newest-first, and can post a canned outgoing
free-text message. This story lands before/alongside the sibling stories in
`user_stories/` (`acars_pdc_request.md`, `acars_weather_request.md`,
`acars_position_reports.md`, `acars_dispatch_loadsheet.md`) — none of those are
in scope here; this run only has to leave a schema and API those stories can
write into without a migration.

## Success criteria (from the story's Acceptance Criteria, verbatim)

1. Messages persist across server restarts and are scoped to the correct
   flight/leg.
2. The thread renders in chronological order with direction and category
   visibly distinguishable.
3. Sending a canned message creates a downlink entry visible without a page
   reload.
4. The data model is generic enough that the PDC and weather-request stories
   in this directory can write into it without a schema change.

## Scope decisions frozen for this run

- **Web client only, not MCDU.** The story says "MCDU client and/or web
  client." The Tauri/MCDU desktop client no longer lives in this repo — it
  moved to `oshogun/msfslogger_mcdu` (see root `CLAUDE.md`). This run ships
  the thread page in `client/` (the React web app) only. Wiring an MCDU ACARS
  page against this API is explicitly out of scope and left as a follow-up in
  the other repo; the API contract this run freezes is generic enough for
  that client to consume later, but no MCDU code is touched here.
- **"Flight/leg id" resolves to `flights.id`.** The app's operational unit
  while a message thread would be read or written is a flight row
  (`src/db/flights.ts`, `flights` table), tracked as
  `flightManager.appState.currentFlightId` during an active flight
  (`src/flightManager.ts`). `planned_legs` (pre-flight, from `.lnmpln` import)
  is a different table for a different concept (a route before it's flown)
  and is not the scoping key here. Design should confirm this and define the
  FK (`flight_id INTEGER NOT NULL REFERENCES flights(id)`), including whether
  a message can be posted before a flight row exists (e.g. dispatch messages
  ahead of departure) — if so, the FK/UX for "no active flight yet" needs a
  decision, not a guess.
- **Canned messages are a fixed, hardcoded list for this run** — "WX
  REQUEST", "GATE REQUEST", "REQUEST PUSHBACK" per the story. No admin UI to
  edit the set.
- **Full free-typing is out of scope**, per the story.

## Workflow tier

Full loop (tier 3, per `.claude/agents.md` § Cost discipline rule 6): this
run adds a new table (schema change), a new API contract (list + post
endpoints), and a client page the user will see. Design step is **not**
skipped — the schema and endpoint contract must be frozen before
implementation so the sibling ACARS stories can build on it without a
migration (success criterion 4 above is exactly a design-freeze concern).

## Steps planned

1. Intake — this file.
2. Plan — delegate to `planner`.
3. Design — delegate to `designer`: freeze `acars_messages` schema, list/post
   endpoint contracts, and the canned-message payload shape.
4. Implement — backend (schema + db module + routes) and frontend (thread
   page) tasks, batched per domain.
5. Review — every implementer result reviewed before merge.
6. Ship — skip DevOps unless a task ends up touching build/packaging/deploy;
   this looks like an ordinary schema+route+page change with no new infra.
7. Report back to user.
