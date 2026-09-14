# Intake — acars-dispatch-loadsheet

## Source

`user_stories/acars_dispatch_loadsheet.md`, verbatim goal:

> Turn the existing SimBrief import ([[simbrief_integration]]) into a
> dispatch-release downlink message, and add a lightweight generated load sheet
> as a second message, both filed in the ACARS message center
> ([[acars_message_center]]).

(The story's own heading calls it a "downlink message" but its functional
requirements call it an "uplink" message — see Frozen decisions below, which
resolves this the same way.)

## Restated goal

1. On a **successful** SimBrief import (an actual new `planned_legs` row —
   not the `status: 'duplicate'` short-circuit in
   `POST /trips/:id/planned-legs/simbrief`), automatically file one
   `category: 'dispatch'` message into that leg's ACARS thread, summarizing
   route, cruise altitude, planned fuel, alternates, and estimated time
   enroute — all sourced from the same SimBrief response already fetched for
   the import, not a second fetch and not a locally-estimated figure.
2. Add a load-sheet request/reply feature, scoped to a planned leg: a pilot
   action produces block fuel, a placeholder/estimated payload figure, and a
   ZFW, derived from that leg's SimBrief data — not from a fresh SimBrief
   fetch — formatted as ACARS-style fixed fields, filed as a request/reply
   pair in the same thread.
3. A leg with no imported plan (or a planned leg whose import did not carry a
   dispatch record) rejects the load-sheet request with
   `NO DISPATCH DATA ON FILE`, no server error.

## Frozen decisions (from this conversation)

- **Message direction convention**, resolved by the user after I flagged that
  `acars_weather_request.md` (the story this one is told to imitate) states
  the request as `uplink` and the reply as `downlink` — backwards from both
  this codebase's own documented rule (`src/acars.ts`: "direction (uplink
  from 'dispatch' / downlink from 'cockpit')", `CLIENT_DIRECTION =
  'downlink'`) and real ACARS terminology. **Decision: the pilot's request is
  `downlink`, the generated reply is `uplink`.** This run sets the precedent;
  apply the same convention to the dispatch-release message (uplink — it
  originates from "dispatch", matching the existing `dispatch` category's
  intent) and to the load-sheet pair. Treat the weather story's wording as a
  documentation slip, not intentional.
- **SimBrief data is not re-fetched.** The existing route
  (`src/routes/plannedLegs.ts` `POST /trips/:id/planned-legs/simbrief`) calls
  `parseSimbriefPlan(await fetchSimbriefPlan(userId))` in one line, discarding
  the intermediate decoded body. `ParsedSimbriefPlan`
  (`src/simbrief.ts`) currently carries no fuel or time-enroute fields — the
  parser was written for planned-leg import only. Fuel/ETE must come from the
  same fetched-and-parsed response, which means either the parser gains new
  fields (a contract change — `ParsedSimbriefPlan` is a shared type consumed
  by `src/db.ts`'s `CreatePlannedLegPlan`-shaped input) or the route retains
  the raw decoded body alongside `plan` and reads the extra fields itself.
  **This is a Design-step decision, not decided here.**
- **No schema migration is expected.** `acars_messages` already has
  `payload_json`, `dedup_key`, `correlation_id`, and is explicitly scoped by
  `planned_leg_id` for exactly this "before a `flights` row exists" case (see
  the header comment in `src/db/acarsMessages.ts`). The load sheet's later
  request needs the fuel/ZFW source figures that were only available at
  import time; the natural place to carry them forward is the dispatch
  message's own `payload_json`, read back by the load-sheet route — but
  confirm this against `insertAcarsMessageOnce`'s dedup semantics in Design
  rather than assuming.
- **Frontend scope**: the Tauri/MCDU client the user stories describe now
  lives in `oshogun/msfslogger_mcdu`, not this repo (see root `CLAUDE.md`).
  This run implements the backend contract plus the equivalent action in the
  repo's own web client (`client/src/pages/AcarsMessages.tsx`, which already
  renders the thread and a "Send" canned-message row). Wiring the MCDU repo's
  datalink page is out of scope and not tracked as a follow-up here — that
  repo is not part of this workspace.

## Non-functional constraints carried over from the story

- Payload/ZFW figures are illustrative, not a real performance calculation —
  the load sheet must not be presented as authoritative.
- No new external integration; `simbriefClient.ts` is the only source.

## Steps this run uses

Tier-3 (full loop) — this touches a shared type (`ParsedSimbriefPlan`), adds
at least one new endpoint (load-sheet request), and changes behavior the user
sees (automatic dispatch message + new MCDU/web action). Per
`.claude/agents.md` § Cost discipline rule 6, that's the full loop, not tier 2.

- Intake — this file.
- Plan — delegate to `planner`.
- Design — **required**: this run introduces a contract change
  (`ParsedSimbriefPlan` fields, and/or a `payload_json` shape for the dispatch
  message that the load-sheet route depends on) and a new endpoint. Freeze
  before implementation.
- Implement — backend (`src/**`) for dispatch emission + load-sheet endpoint;
  frontend (`client/**`) for the web AcarsMessages page action.
- Review — every task, per policy.
- Ship — skipped. No build/packaging/deploy/CI file is touched by this run;
  say so in the final report.
- Report.

## Known code surfaces (for the Planner, so it doesn't have to rediscover them)

- `src/routes/plannedLegs.ts:201-288` — the SimBrief import route. Single
  write path (`createPlannedLeg`), duplicate short-circuit returns before any
  write. Dispatch-message emission must sit after `createPlannedLeg` succeeds,
  must not turn a successful import into a failed response if message-writing
  throws, and must not fire on the duplicate path.
- `src/simbrief.ts` — pure parser, `ParsedSimbriefPlan` is the shared type.
  SimBrief's raw JSON has a `fuel` node and a `times` node (est_time_enroute
  etc.) that the parser does not currently read — confirmed by inspecting the
  interface, not yet confirmed against a live sample; Design step should check
  `src/inspect-simbrief.ts` / a real captured OFP for exact field names before
  freezing.
- `src/acars.ts` — category list already includes `dispatch`; `pdc`/`wx` exist
  as known categories but their generation logic doesn't exist yet (only
  canned freetext stand-ins). No change needed here unless a new canned-style
  concept is introduced (unlikely — dispatch/loadsheet are server-generated,
  not client-picked, like the not-yet-built PDC/weather flows).
- `src/db/acarsMessages.ts` — `insertAcarsMessage` (plain insert) and
  `insertAcarsMessageOnce` (dedup-keyed insert-or-return, used for
  the "re-request returns the same thing" idempotency PDC will need and this
  story's AC1 — "exactly one dispatch-release message" — also implies).
  `listAcarsMessagesForPlannedLeg` already exists for a leg-scoped read before
  a flight exists.
- `client/src/pages/AcarsMessages.tsx` — keyed by flight id
  (`/api/flights/:id/acars-messages`), reads `thread.planned_leg_id` from the
  response already. Has a "Send" row for canned messages and a chronological
  thread render (newest-first display, oldest-first fetch). A load-sheet
  action here is a new, non-canned request — the existing
  `POST /flights/:id/acars-messages` route only accepts canned messages
  (`findCannedMessage`/`findCannedMessageByBody`), so it needs its own
  endpoint, not a new `CANNED_MESSAGES` entry.
- No `planned_legs` column stores fuel/payload/ZFW today (checked
  `src/db/schema.ts`) — confirms the "carry it via the dispatch message"
  question above is real, not hypothetical.

## Explicitly out of scope

- Real PDC and weather-request features (separate, not-yet-built stories).
- Wiring `oshogun/msfslogger_mcdu`.
- Any real performance/weight-and-balance calculation.

---

## Follow-up: unit tests (tier 2, added after the phase-1 approve)

Requested by the user after the phase-1 report, closing the residual risk the
Reviewer and T-002 both named: `tests/` was outside T-002's `allowed_paths`, so
the ~20 new pure functions in `src/acars.ts` and the new `dispatch` node in
`src/simbrief.ts` shipped with scratch-server evidence but no Vitest coverage.

Tier 2 per `.claude/agents.md` § Cost discipline rule 6 — one implementer plus
one Reviewer, no Planner and no Designer. The contract is already frozen in this
run's `design.md`; this task writes tests against it and introduces no new
contract of its own.

- **T-005** `backend_sr`, `allowed_paths: ["tests/**"]`. Extends the existing
  `tests/acars.test.ts` and `tests/simbrief.test.ts` suites. Explicitly may NOT
  edit `src/**`: a test that fails against shipped behaviour is a finding to
  report, not a licence to change the production code that Review already
  approved.
- **T-006** `reviewer`. Re-runs the suite, and checks the tests assert the
  frozen contract rather than restating the implementation.
