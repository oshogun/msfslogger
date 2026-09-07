# Intake — mark a hand-linked planned leg as flown

Run id: 2026-09-07-manual-mark-flown
Orchestrator: Claude (msfslogger session)
Amends: `.claude/runs/2026-09-04-lnmpln-trip-planner/design.md` §14, §15

## The user's request, verbatim

> Add an option to manually change the status of a flight from planned to flown
> if a flight has been linked to the plan manually.

## Goal (restated)

A planned leg only ever reaches `flown` through `FlightManager.endFlight()`,
which runs at touchdown. A flight linked to its leg **by hand** — after the
flight is already over, which is the whole point of the manual escape hatch
(§12.3) — therefore never passes through that code, and its leg is stuck
reading `Planned` forever even though the flight it points at has landed.

This run gives the user a control that closes that leg by hand: mark it
`flown`, and mark it back to `planned` if that was a mistake.

## Success criteria

1. On `/flight/:id`, a flight whose planned-leg link was made manually and
   whose flight has ended offers a control that sets the linked leg's status
   to `flown`.
2. Marking it flown records `arrival_deviation_nm` measured from the flight's
   own arrival position to the planned destination, so the leg reads
   "flown, N nm from plan" exactly as an auto-closed leg does.
3. The same control reverses the change: back to `planned`, clearing
   `arrival_deviation_nm`, without unlinking the flight.
4. The control is absent — and the API refuses — for auto-linked legs, for
   flights still in the air, and for legs the system already closed.
5. Nothing else about planned legs changes: auto-match, skip/unskip, unlink,
   delete, combine and the trip page behave exactly as before.

## Decisions frozen by the user (asked and answered, 2026-09-07)

- **Placement**: the flight detail page only — the Planned Leg section of
  `/flight/:id`, where the manual link is already shown and undone. *Not* the
  trip page leg row.
- **Deviation**: compute it from the flight's arrival position against the
  planned destination and store it, **and always set the status the user asked
  for**. A hand-mark beyond `ARRIVAL_RADIUS_NM` is still `flown`, not
  `diverted` — the system's touchdown rule is deliberately not mirrored here.
- **Reversible**: yes. The same control toggles a hand-marked leg back to
  `planned` and clears the deviation, so a misclick is recoverable without
  unlinking the flight.

## The constraint this run must not break

design.md §15 currently states two rules that this feature deliberately
narrows, and the narrowing must be surgical:

- "**`flown` and `diverted` are set by the system only.** The `PATCH` endpoint
  accepts `planned` and `skipped` and nothing else; a client cannot declare a
  leg flown."
- F-1 (2026-09-05): "**A linked leg's status is not the user's to set at all.**"
  `setPlannedLegStatus` throws `PlannedLegHasLinkedFlightError` whenever the leg
  still has a linked flight. The bug it fixed was `PATCH {status:'planned'}` on a
  linked `flown`/`diverted` leg returning 200, destroying
  `arrival_deviation_nm` and keeping the link.

The reverse direction this run adds (`flown` → `planned`, link kept) is
literally the shape F-1 forbade. It is only safe under a narrower gate:
**the link source is `manual`**, so the deviation being cleared is one this
feature itself computed and can recompute, never a measurement
`endFlight()` took at the real touchdown. A leg whose link source is `auto`
keeps the F-1 guard untouched.

Orchestrator's position, to be tested in Design, not assumed: the gate is
`planned_leg_link_source = 'manual'` **and** the linked flight has
`end_time IS NOT NULL`, and the existing `PlannedLegHasLinkedFlightError` path
stays exactly as it is for every case outside that gate.

## Out of scope

- Trip-page placement of the control.
- Any change to auto-matching, to `endFlight()`'s touchdown rule, or to what
  `diverted` means.
- Letting a client set `diverted` by hand.
