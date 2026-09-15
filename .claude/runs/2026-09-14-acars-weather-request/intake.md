# Intake — 2026-09-14-acars-weather-request

## Source

`user_stories/acars_weather_request.md`, quoted where it freezes a decision:

> Add a server-side weather lookup (METAR/TAF by ICAO) surfaced as a request/
> reply pair in the ACARS message center ([[acars_message_center]]).

> Server endpoint accepting an ICAO code, returning current METAR and, where
> available, TAF text from a public aviation weather source.

> Requesting weather writes an uplink request entry and, on success, a
> downlink reply entry (the weather text) into the flight's ACARS thread —
> matching the request/reply shape real ACARS WX requests have.

> Invalid/unknown ICAO or upstream fetch failure returns a clear rejection
> message in the thread ("WX DATA UNAVAILABLE FOR <ICAO>") rather than a
> silent failure.

> Client: a "REQUEST WX" action taking an ICAO (default-suggest departure/
> destination ICAO from the active planned leg) from the MCDU datalink page.

> Cache responses briefly (e.g. a few minutes) per ICAO to avoid hammering
> the upstream weather source on repeated requests.

## Correction to the story: direction is reversed

The story's own wording ("an uplink request entry... a downlink reply entry")
is backwards against the substrate this run builds on. `acars_message_center`
design §3.2 already resolved this exact conflict and froze: **a
crew-initiated request is `downlink`, the ground's answer is `uplink`** (real
ACARS: downlink travels aircraft → ground). §3.1's row table already gives the
wx shapes under that reading:

| Message | `flight_id` | `planned_leg_id` | `direction` | `category` | `label` | `body` | `payload_json` | `correlation_id` | `dedup_key` |
|---|---|---|---|---|---|---|---|---|---|
| WX REQUEST `<ICAO>` | `{flight}` | `NULL` | `downlink` | `wx` | `WX REQUEST EGLL` | `"WX REQUEST EGLL"` | `{"icao"}` | `NULL` | `NULL` |
| METAR/TAF reply | `{flight}` | `NULL` | `uplink` | `wx` | `METAR EGLL` | METAR + TAF text | `{"icao","metar","taf","fetched_at"}` | request id | `NULL` |
| unavailable | `{flight}` | `NULL` | `uplink` | `wx` | `WX UNAVAILABLE` | `"WX DATA UNAVAILABLE FOR ZZZZ"` | `{"icao","reason"}` | request id | `NULL` |

This run implements that reading, not the story's prose. Flight-scoped (not
leg-scoped): weather isn't tied to a specific leg's dispatch data, and a crew
can request weather for any ICAO (e.g. an alternate) that isn't necessarily
the leg's departure/destination.

## Goal

Add a "REQUEST WX" datalink feature: a new endpoint that looks up METAR/TAF
for an ICAO from a public weather source, files the downlink request +
uplink reply (or rejection) into the flight's `acars_messages` thread using
the already-frozen substrate (`src/db/acarsMessages.ts`,
`acars_message_center` schema — no migration), and a "REQUEST WX" action in
the web ACARS page (`client/src/pages/AcarsMessages.tsx`) that defaults the
ICAO to the active leg's departure/destination and updates the thread without
a reload. The MCDU client is out of scope — it lives in
`oshogun/msfslogger_mcdu`.

## Why this needs a Design step

This is not "wire up an existing contract" — it introduces two new contracts
neither frozen by `acars_message_center` nor by any prior run:

1. **An upstream weather client** — which public METAR/TAF source, its URL
   shape, auth (expect none, matching `src/simbriefClient.ts`'s stance on
   SimBrief), timeout/error taxonomy, and how a raw METAR/TAF body maps to
   the frozen `{icao, metar, taf, fetched_at}` / `{icao, reason}`
   `payload_json` shapes.
2. **A TTL cache keyed by ICAO** — in-process only (no schema change is in
   scope; `acars_message_center` design says a new column is a defect to be
   raised there, not added here, and a cache doesn't need persistence). Needs
   a frozen TTL, a frozen definition of "hit" for AC3, and confirmation two
   requests for the same ICAO within the window still each write a new
   `downlink` request row (§3.1 gives `wx` rows no `dedup_key` — every
   request is logged, only the *upstream fetch* is deduped) while sharing
   one cached reply body.
3. **Endpoint + rejection contract** — route (flight-scoped, so
   `POST /api/flights/:id/acars-messages/...`, sibling to the existing
   `POST /api/flights/:id/acars-messages` and
   `POST /api/planned-legs/:legId/acars-messages/loadsheet` in
   `src/routes/acars.ts`), request body (`{icao}`), response envelope,
   ICAO validation (reuse `src/airports.ts`'s ICAO parsing if it already
   validates the shape — Designer confirms), and exact rejection wording/HTTP
   status for an invalid ICAO vs. an upstream failure.
4. **Client contract** — the "REQUEST WX" control's default-ICAO source. The
   web `AcarsMessages.tsx` page currently exposes only `plannedLegId` (a
   number), not departure/destination ICAO strings — Designer must specify
   what new field the page fetches (and from where) to pre-fill the
   suggestion, per AC4.

Precedent: `2026-09-14-acars-dispatch-loadsheet` needed the same kind of
Design step for its load-sheet endpoint even though it also built on the
message-center substrate, for the same reason — new endpoint + new
domain-specific derivation logic not covered by the frozen schema alone.

## Success criteria (= story's acceptance criteria, verbatim)

1. A valid ICAO with available weather returns METAR text in the thread
   within a reasonable time.
2. An invalid/unknown ICAO returns a clear rejection message, not an
   unhandled error.
3. Requesting the same ICAO twice within the cache window does not issue a
   second upstream fetch (verifiable via request count/logging).
4. The departure/destination ICAO is pre-filled from the active leg when one
   exists.

## Steps this run takes, and what it skips

- **Plan** — yes, `planner`.
- **Design** — yes, `designer` (opus). See "Why this needs a Design step"
  above. Must read `acars_message_center` design §§1–6 (schema, db module,
  API conventions) and `acars_dispatch_loadsheet` design as the closest
  sibling precedent for a request/reply endpoint built on this substrate, via
  `ctx.sh design <run> <n>` slices, not the whole file.
- **Implement** — `backend_sr` (new endpoint is contract-adjacent: new
  external client module + cache + route) and `frontend_sr` (new page
  action + a new data dependency for the default-ICAO suggestion, not a
  single self-contained component).
- **Review** — every implementer result, per the standing rule.
- **Ship (DevOps)** — skipped. No build, packaging, deploy, CI or secrets
  change: the upstream weather API is expected to need no credential
  (matching the SimBrief precedent), so nothing to configure. If the Designer
  picks a source that needs an API key, this decision is revisited before
  Implement.

## Non-functional notes carried from the story

- Designer documents the chosen upstream source and its usage limits in the
  design doc (story requirement, not optional).
- Upstream unavailability is expected/handled: flight logging must not
  depend on the weather feature, and a failed fetch must degrade to the
  frozen rejection row, never an unhandled 500 or a broken thread.
