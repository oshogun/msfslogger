# User Story: Pre-Departure Clearance (PDC) Request

## Story
As a user flying with the MCDU client, I want to request my IFR clearance via
simulated datalink before pushback, so that copying a clearance feels like
part of the ACARS workflow instead of something I read off a paper strip.

## Goal
Generate a PDC-style clearance message from the active planned leg and make it
retrievable as a datalink "message," mirroring how real ACARS/PDC delivers a
clearance to the FMC.

## Functional Requirements
- Add a server endpoint that, given an active/selected planned leg, synthesizes
  a clearance text: departure airport, cleared-to fix/destination, filed
  route (from the SimBrief/`.lnmpln` route already attached to the leg),
  initial altitude, and a squawk code.
- Squawk code is generated deterministically per leg (e.g. derived from the
  leg id) so re-requesting the same leg returns the same clearance rather than
  a new random one.
- Persist issued PDCs so a re-request returns the existing clearance instead
  of reissuing one, matching how real PDC only reissues on amendment.
- Expose a "REQUEST CLEARANCE" action from the MCDU-style client's datalink
  page; requires an active flight bound to a planned leg with a filed route.
- No filed route on the planned leg → request is rejected with a clear reason
  ("NO FLIGHT PLAN ON FILE"), matching real ACARS behavior.

## User Flow
1. User has a planned leg with an imported route (Little Navmap or SimBrief).
2. User selects the leg as active and opens the datalink/ACARS page in the
   MCDU client.
3. User sends "REQUEST CLEARANCE."
4. Server returns the synthesized PDC text; client renders it as a received
   datalink message.
5. Re-opening the page or re-requesting shows the same clearance (no
   duplicate issuance).

## Acceptance Criteria
1. A planned leg with a filed route returns a clearance containing departure,
   destination, route, initial altitude, and squawk.
2. Requesting twice for the same leg returns an identical clearance both
   times.
3. A planned leg with no filed route is rejected with a specific error, not a
   generic failure.
4. The clearance is retrievable later (e.g. after client restart) without
   re-requesting, via the persisted record.

## Non-Functional Notes
- This is a simulated clearance for logging/immersion purposes, not a
  real-world IFR clearance; wording should not be ambiguous about that if the
  client ever surfaces it outside the sim context.
- Route/altitude text should reuse existing `.lnmpln`/SimBrief parsing rather
  than re-deriving flight-plan structure.
