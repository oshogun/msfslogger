# Intake — flight replay (2026-09-19-flight-replay)

## Goal (user, verbatim)
"Begin designing and planning the development of a flight replay feature."

Scope of THIS turn: Intake → Plan → Design (freeze). No implementation yet.

## Interpreted goal
Let the operator replay a completed flight from the logbook: an animated aircraft
marker moves along the recorded track with play/pause, speed control and a
scrubber, with a live instrument readout (alt, IAS, GS, heading, VS, on-ground).

## Facts established from the tree
- `flight_points`: ts, lat, lon, altitude_ft, airspeed_kts, ground_speed_kts,
  heading_deg, vertical_speed_fpm, on_ground. Recorded every 5 s
  (`RECORD_INTERVAL_MS`, src/flightManager.ts:20); gaps >> 5 s are recording
  interruptions/pauses.
- `GET /api/flights/:id` already returns the full ordered point list
  (src/db/flights.ts:116). FlightMap gets it today; MAP_MAX_POINTS=2000 downsample
  is for drawing only.
- ACARS messages (`sent_at`, category oooi/position-report/atc/...) exist per flight.
- Reuse: FlightMap (antimeridian `unwrapLonChain`, planned-route overlay),
  AltitudeChart, LiveMap (live aircraft marker), FlightDetail page.
- Client-only replay is plausible with zero new endpoints; Designer to confirm.

## Frozen decisions from the user
None yet beyond the goal sentence.

## Assumptions (Orchestrator's defaults — user may override)
1. Replay is for *completed* flights, opened from FlightDetail (no new top-level nav).
2. Playback runs on real timestamps compressed by a speed multiplier (1x…max),
   with long recording gaps collapsed so a pause doesn't stall playback.
3. Read-only: no schema change, no writes, no new agent/ingest behaviour.
4. PDF/print pages (PrintFlight/PrintTrip) and KML export must remain untouched.

## Open questions for the user (do not block planning)
- Camera: fixed overview vs. follow-aircraft (default: toggle, follow on).
- Overlay ACARS/OOOI events on the timeline? (default: yes if cheap, else follow-up)
- Trip-level replay (chain legs)? (default: out of scope, follow-up)
- Also replay in-progress flights? (default: no; LiveMap covers live)

## Tier / steps
Tier 3 (user-visible, several files). Plan: yes. Design: Designer decides whether
any contract exists (frontend playback-engine module API, possibly a slim
`/points` endpoint if payload size is a problem) — skip only if recorded here with
reason. DevOps/Ship: skipped unless design adds a build/deploy change.
Verification constraint: builds only in a scratch copy of the tree (ENVIRONMENT.md).
