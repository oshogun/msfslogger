# User Story: ACARS Message Center (Inbox/Outbox)

## Story
As a user, I want a persistent inbox/outbox of datalink-style messages tied to
each flight, so that dispatch messages, clearances, weather requests, and
position reports live in one place instead of being separate one-off
features, the way a real ACARS message log does.

## Goal
Introduce a shared `acars_messages` concept that other datalink features
(PDC, weather requests, position reports, free text) write into and read
from, plus a client page to browse it per flight.

## Functional Requirements
- New table storing messages with: flight/leg id, direction (uplink from
  "dispatch" / downlink from "cockpit"), category (`pdc`, `wx`, `freetext`,
  `position-report`, `dispatch`), body text, and timestamp.
- Server endpoints to list messages for a flight (chronological) and to post
  a new outgoing free-text message.
- A minimal canned-message set for outgoing free text (e.g. "WX REQUEST",
  "GATE REQUEST", "REQUEST PUSHBACK") — full free-typing is out of scope for
  this story.
- Client page (MCDU client and/or web client) rendering the thread per
  flight, newest at top per convention of the target UI, with unread-count
  affordance if the MCDU host supports it.
- This is the substrate other ACARS stories in this directory should write
  into, rather than each inventing its own storage.

## User Flow
1. User opens the datalink/ACARS page for the active flight.
2. Sees prior messages for that flight (clearance received, any dispatch
   notes) newest-first.
3. Sends a canned outgoing message; it appears immediately in the thread.
4. Later, other features (weather request, position report) add their own
   entries to the same thread automatically.

## Acceptance Criteria
1. Messages persist across server restarts and are scoped to the correct
   flight/leg.
2. The thread renders in chronological order with direction and category
   visibly distinguishable.
3. Sending a canned message creates a downlink entry visible without a page
   reload.
4. The data model is generic enough that the PDC and weather-request stories
   in this directory can write into it without a schema change.

## Non-Functional Notes
- This story should land before or alongside the PDC and weather-request
  stories, since they depend on it for storage rather than each rolling
  their own message table.
