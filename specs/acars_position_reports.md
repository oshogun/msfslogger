# User Story: Automatic Position / Progress Reports

## Story
As a user, I want the system to automatically generate ACARS-style progress
reports (OOOI events and periodic position reports) from the live flight
track, so that my logbook reads like a real dispatch record instead of just a
start/end summary.

## Goal
Derive OOOI (Out/Off/On/In) events and periodic enroute position reports from
existing flight-state and track data, and file them as downlink messages in
the ACARS message center ([[acars_message_center]]).

## Functional Requirements
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

## User Flow
1. User starts a flight as usual (server already tracks state via the agent).
2. As the flight progresses through OOOI states, corresponding messages
   appear in the ACARS thread automatically, no user action required.
3. If a route is attached, periodic position reports appear between OFF and
   ON.
4. After the flight, the full report sequence is visible in the flight's
   message history alongside the logbook entry.

## Acceptance Criteria
1. Each OOOI transition produces exactly one message, timestamped to the
   existing state-transition event (no duplicate or missing events across a
   normal flight).
2. A flight with an attached route produces at least one position report
   between OFF and ON, on the configured interval.
3. A flight without an attached route produces OOOI messages only, with no
   errors from the missing route.
4. Reports are visible in the same per-flight thread as other ACARS messages.

## Non-Functional Notes
- Should not add new position-polling logic — piggyback on the track
  ingestion path that already exists for the live map/traffic feature.
- Keep report volume bounded on long-haul flights; an interval-based or
  waypoint-based cadence, not per-tick.
