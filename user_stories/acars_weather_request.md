# User Story: Datalink Weather Request (METAR/TAF)

## Story
As a user, I want to request METAR/TAF for an airport via a simulated ACARS
"WX REQUEST" instead of alt-tabbing to a browser, so that checking weather
stays inside the flight/MCDU workflow.

## Goal
Add a server-side weather lookup (METAR/TAF by ICAO) surfaced as a request/
reply pair in the ACARS message center ([[acars_message_center]]).

## Functional Requirements
- Server endpoint accepting an ICAO code, returning current METAR and, where
  available, TAF text from a public aviation weather source.
- Requesting weather writes an uplink request entry and, on success, a
  downlink reply entry (the weather text) into the flight's ACARS thread —
  matching the request/reply shape real ACARS WX requests have.
- Invalid/unknown ICAO or upstream fetch failure returns a clear rejection
  message in the thread ("WX DATA UNAVAILABLE FOR <ICAO>") rather than a
  silent failure.
- Client: a "REQUEST WX" action taking an ICAO (default-suggest departure/
  destination ICAO from the active planned leg) from the MCDU datalink page.
- Cache responses briefly (e.g. a few minutes) per ICAO to avoid hammering
  the upstream weather source on repeated requests.

## User Flow
1. User opens the datalink page during a flight.
2. Selects "REQUEST WX," optionally overriding the suggested ICAO.
3. Sees the request appear immediately, followed shortly by the METAR/TAF
   reply once the server responds.
4. Can re-request another airport (e.g. alternate) without leaving the page.

## Acceptance Criteria
1. A valid ICAO with available weather returns METAR text in the thread
   within a reasonable time.
2. An invalid/unknown ICAO returns a clear rejection message, not an
   unhandled error.
3. Requesting the same ICAO twice within the cache window does not issue a
   second upstream fetch (verifiable via request count/logging).
4. The departure/destination ICAO is pre-filled from the active leg when one
   exists.

## Non-Functional Notes
- Requires choosing and documenting an upstream weather data source and its
  usage limits; this story does not prescribe which one.
- Treat upstream unavailability as expected/handled, not exceptional — flight
  logging must not depend on it.
