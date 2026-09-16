# Intake — acars-position-reports

Run id: `2026-09-16-acars-position-reports`
Source: `user_stories/acars_position_reports.md` (verbatim story, not paraphrased below).

## Goal

Derive OOOI (Out/Off/On/In) events and periodic enroute position reports from
existing flight-state and track data, and file them as downlink ACARS messages
in the existing `acars_messages` substrate ([[acars_message_center]], already
shipped — see `src/db/acarsMessages.ts`, `src/acars.ts`). No new
position-polling logic: piggyback on the frame path that already runs on every
agent post (`flightManager.onFrame`, called from `src/ingest.ts:201`).

## Functional requirements (verbatim from the story)

- OOOI events: reuse the existing flight state machine (`flightManager.ts`)
  transitions — pushback/taxi-out as OUT, takeoff as OFF, landing as ON,
  arrival at gate/parking as IN — to emit one message per event with a
  timestamp, rather than adding new state detection logic.
- Enroute position reports: at a configurable interval (e.g. every N minutes
  or every leg waypoint crossed, reusing `legMatcher.ts`'s notion of progress
  along the route), emit a downlink message with current position, altitude,
  and ETA to next fix/destination if a route is attached.
- No attached route → OOOI-only reporting; skip position reports rather than
  failing.
- Reports write into the shared ACARS message table as downlink, category
  `position-report` / `oooi`.
- Reporting interval is configurable (env var or setting), with a sane
  default, since track density already varies by sim/agent polling rate.

## Acceptance criteria (verbatim from the story)

1. Each OOOI transition produces exactly one message, timestamped to the
   existing state-transition event (no duplicate or missing events across a
   normal flight).
2. A flight with an attached route produces at least one position report
   between OFF and ON, on the configured interval.
3. A flight without an attached route produces OOOI messages only, with no
   errors from the missing route.
4. Reports are visible in the same per-flight thread as other ACARS messages.

## Non-functional notes (verbatim)

- Should not add new position-polling logic — piggyback on the track
  ingestion path that already exists for the live map/traffic feature.
- Keep report volume bounded on long-haul flights; an interval-based or
  waypoint-based cadence, not per-tick.

## What the Orchestrator already confirmed by reading the code

- `acars_messages` substrate exists and already anticipates this story:
  `KNOWN_ACARS_CATEGORIES` in `src/acars.ts` already lists `'oooi'` and
  `'position-report'`. `insertAcarsMessageOnce(... dedup_key)` exists and is
  the pattern the dispatch-release/loadsheet features already use for
  exactly-once server-generated messages (`src/acars.ts`
  `dispatchDedupKey`/`loadsheetRequestDedupKey`/`loadsheetReplyDedupKey`,
  wired from `src/routes/plannedLegs.ts`). OOOI events should follow the same
  dedup-key pattern — this is the natural way to satisfy acceptance criterion
  1 ("no duplicate ... events").
- `FlightManager`'s state machine is `IDLE -> GROUND -> FLYING -> IDLE`.
  `GROUND` is "parked" (entered via a parked-frames debounce,
  `enterGround()`), not "taxiing" — there is no distinct pushback/taxi-out
  detection today. `startFlight()` (IDLE|GROUND -> FLYING, on the airborne
  debounce) is the only existing transition that corresponds to leaving the
  ground, and `endFlight()` (FLYING -> IDLE, on the landed debounce) is the
  only existing transition that corresponds to touching down. A ground
  session's `enterGround()`/close calls bracket every parked period, both
  before departure and after arrival.
- The story's OUT/OFF/ON/IN mapping onto this two-state-transition machine is
  **not fully determined by the existing code** — in particular OUT
  (pushback/taxi-out) and OFF (takeoff) are not separately instrumented today,
  nor are ON (touchdown) and IN (arrival at gate). This is a real design
  decision, not implementation detail: it decides where each of 4 messages is
  emitted from, and whether OUT/IN reuse ground-session lifecycle events or
  approximate onto the same instant as OFF/ON. **This run needs the Design
  step** for exactly this reason — it is the contract this run introduces,
  on top of the already-frozen `acars_messages` schema.
- Track ingestion path to piggyback on for position reports:
  `src/ingest.ts:201` (`flightManager.onFrame(req.body)`), which in the
  `FLYING` state calls `recordPoint()` -> throttled `writePoint()`
  (`RECORD_INTERVAL_MS = 5000`, `src/flightManager.ts`). Route progress data
  (next waypoint, remaining distance) is already computed by
  `getPlannedLegStatus()` using `plannedLegCache`, built by
  `autoLinkPlannedLeg()`/`refreshPlannedLegForFlight()`. ETA needs a
  groundspeed-based derivation not currently exposed by that method — a
  design decision.
- `src/config.ts` is the only module reading `process.env` for
  security-relevant settings per its own header comment; non-security config
  (`PORT`, `TRAFFIC_ENABLED`) is read directly where used. A new
  `POSITION_REPORT_INTERVAL_*` env var is not security-relevant, so it can
  follow the `TRAFFIC_ENABLED` precedent (read directly in
  `flightManager.ts` or wherever it's consumed) rather than being added to
  `AppConfig`/`ENV_VARS` — Designer to confirm.

## Tier and step decisions

- **Tier 3, full loop.** Spans `flightManager.ts` (state-machine-adjacent
  logic), `legMatcher.ts`-derived progress data, `acars.ts` (new message
  builders), `db/acarsMessages.ts` (only if a new query is needed), a new
  config knob, and is user-visible in the ACARS thread. Not a single-seam
  change.
- **Design: included.** The OOOI-to-existing-transition mapping and the
  position-report cadence/ETA contract are undetermined by existing code (see
  above) and need to be frozen before implementation, the same way the
  `acars_message_center` schema was frozen before PDC/WX were built on it.
- **Ship: skipped.** No build, packaging, deploy, CI, or env-var-secrets
  surface is touched (a plain interval config, not a secret) — recorded here
  per the rule that a skip is a decision, not a silent omission.

## Constraints for every downstream agent

- Never touch the user's live server or `flights.db` — scratch copies, other
  ports, per `.claude/ENVIRONMENT.md`.
- No new position-polling logic; reuse `flightManager.onFrame`'s existing
  call path.
- Reuse `insertAcarsMessageOnce` + a dedup key per OOOI event/report tick,
  matching the existing dispatch/loadsheet pattern, so re-delivery or a
  duplicate frame can never double-file a message.
- `KNOWN_ACARS_CATEGORIES` already has `'oooi'` and `'position-report'` — use
  them as-is, no new category, no schema migration expected.
