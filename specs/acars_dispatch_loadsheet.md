# User Story: Dispatch Release and Load Sheet Delivery

## Story
As a user, I want the SimBrief-imported flight plan delivered as an ACARS
"dispatch release" message, followed by a load sheet before pushback, so that
pre-flight feels like receiving real airline dispatch paperwork rather than
just importing a route.

## Goal
Turn the existing SimBrief import ([[simbrief_integration]]) into a
dispatch-release downlink message, and add a lightweight generated load sheet
as a second message, both filed in the ACARS message center
([[acars_message_center]]).

## Functional Requirements
- On successful SimBrief import (existing flow), also emit a `dispatch`
  category uplink message summarizing: route, cruise altitude, planned fuel,
  alternates, and estimated time enroute — sourced from data SimBrief already
  returns, not re-fetched or re-derived.
- Add a "REQUEST LOADSHEET" action, available once a planned leg has an
  imported plan. Generates a simple simulated load sheet: block fuel (from
  the SimBrief plan), a placeholder/estimated payload figure, and a zero-fuel
  weight, formatted as ACARS-style fixed fields.
- Load sheet is a request/reply pair like the weather story: request written
  as uplink placeholder, generated sheet written as the reply.
- No imported plan on the leg → "REQUEST LOADSHEET" is rejected with
  "NO DISPATCH DATA ON FILE," consistent with the PDC story's rejection
  wording for the same underlying condition.

## User Flow
1. User imports a SimBrief plan onto a planned leg as they already can.
2. A dispatch-release message appears automatically in that leg's ACARS
   thread.
3. Before pushback, user requests the load sheet from the MCDU datalink page.
4. The generated load sheet appears in the thread, available for reference
   alongside the clearance ([[acars_pdc_request]]) and weather
   ([[acars_weather_request]]) messages already there.

## Acceptance Criteria
1. Every successful SimBrief import produces exactly one dispatch-release
   message in the corresponding leg's thread.
2. Load sheet request on a leg with an imported plan returns fuel, payload,
   and ZFW figures derived from that plan's data.
3. Load sheet request on a leg without an imported plan is rejected with the
   specified message, no server error.
4. Both messages appear in the same per-flight thread as PDC and weather
   messages, in chronological order.

## Non-Functional Notes
- Payload/ZFW figures are illustrative, not a real performance calculation;
  do not present them as authoritative loading data.
- Depends on [[acars_message_center]] for storage and on the existing
  SimBrief client (`simbriefClient.ts`) for source data — no new external
  integration needed.
