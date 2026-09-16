# Intake — loose-flight prefile

Run id: `2026-09-16-loose-flight-prefile`
Source: `user_stories/prefile_for_flights_nontrip.md` (verbatim spec below)

## Goal

Today "prefile" = the **planned-leg** feature (`src/db/plannedLegs.ts`,
`src/routes/plannedLegs.ts`, table `planned_legs`). Every planned leg
requires a trip: `planned_legs.trip_id INTEGER NOT NULL REFERENCES trips(id)`,
and the only creation routes are trip-nested
(`POST /trips/:id/planned-legs`, `POST /trips/:id/planned-legs/simbrief`).

Goal: let a user prefile a flight plan (.lnmpln or SimBrief import) with no
trip at all — a "loose" planned leg — and have it behave identically to a
trip-linked one for every downstream consumer: listing, edit/cancel
(status PATCH, delete), linking to a flight, and ACARS (dispatch release,
weather requests, OOOI events, ground-session dispatch/loadsheet access).

## Success criteria (from the spec's Acceptance Criteria, verbatim)

1. **Create loose prefile** — user not in a trip context, submits a valid
   prefile flight plan → system creates the prefile successfully without
   `trip_id`.
2. **Preserve trip prefile behavior** — user inside a trip, creates a prefile
   → prefile created and linked to that trip as before.
3. **ACARS compatibility for loose flights** — ACARS features invoked for a
   loose prefile behave the same as for a trip-linked prefile.
4. **Manage loose prefile lifecycle** — edit or cancel a loose prefile
   succeeds under the same rules as trip-linked.
5. **Unified visibility** — listing prefiled flights shows both loose and
   trip-linked, distinguishably (e.g. "No trip").

## Frozen decisions (quoted from the spec, verbatim)

- "`trip_id` is optional for a prefiled flight plan."
- "A prefiled flight is considered "loose" when `trip_id` is null/absent."
- "Prefiled flights must retain a unique identifier regardless of trip
  association."
- "Users can start a prefile from a non-trip context."
- "Any listing/filtering of prefiled flights must include both trip-linked
  and loose flights."
- "Where trip context is shown, loose flights must be clearly marked (e.g.,
  "No trip")."
- Out of scope: "Automatic creation of trips from loose prefiles." /
  "Changing ACARS business logic beyond enabling non-trip prefile
  eligibility."

## What the spec's terms map to in this codebase

- "prefile" / "prefiled flight plan" = a row in `planned_legs`, created via
  `.lnmpln` upload or SimBrief import.
- "flight" in the spec's sense (a prefile that can later be flown) = the
  optional `flights` row later linked via `flights.planned_leg_id`. The
  story is about the **planned leg itself** existing without a trip, not
  about `flights.trip_id` (already nullable today).

## Scope findings that shape the plan (pre-investigation, so Planner doesn't re-derive them)

- **Schema**: `planned_legs.trip_id` is `NOT NULL`; must become nullable.
  `idx_planned_legs_trip` and `idx_planned_legs_source` are both
  `(trip_id, ...)` composite indexes — a loose leg's `source_sha256`
  duplicate-check (`findPlannedLegBySource`) currently scopes by trip_id,
  and needs a defined behavior when trip_id is null.
- **seq numbering**: `createPlannedLeg` computes
  `MAX(seq)+1 WHERE trip_id = ?`, and `reorderPlannedLegs` /
  `PATCH /trips/:id/planned-legs/order` are trip-scoped operations with no
  equivalent for loose legs today. Reordering loose legs relative to each
  other is not in the acceptance criteria — needs a design decision (e.g.
  seq is a per-trip concept only, loose legs get a fixed/independent
  sequence).
- **Creation routes are trip-nested only**: `POST /trips/:id/planned-legs`
  and `POST /trips/:id/planned-legs/simbrief`. A parallel non-trip route
  (or an optional trip id on a unified route) is needed.
- **Listing is trip-scoped only**: `getPlannedLegsForTrip(tripId)` /
  `GET /trips/:id/planned-legs`. There is no "all planned legs" query or
  route today — needed for unified visibility (AC5).
- **`FlightManager` (`src/flightManager.ts`) assumes non-null trip_id**:
  `PlannedLegCache.tripId: number` and `buildPlannedLegCache` /
  `buildGroundSessionCache` call `getTripName(leg.trip_id)` unconditionally.
  `getTripName(tripId: number)` in `src/db/trips.ts` takes a non-null id.
  These need to tolerate `trip_id === null`.
- **ACARS itself is already trip-agnostic**: `src/routes/acars.ts`,
  `src/acars.ts`, `src/db/acarsMessages.ts`, and ground-session dispatch
  (`src/routes/groundSessions.ts`) all key off `planned_leg_id`, never
  `trip_id`. This is good news for AC3 — likely little to no ACARS logic
  needs to change, only the places that render/derive a trip name for
  display.
- **Client**: prefile creation UI lives inside `TripDetail.tsx`
  (trip-scoped page); `PlannedLegRows.tsx` renders legs within trip context.
  There is no non-trip entry point or unified planned-legs list page today.
  `client/src/types.ts` mirrors the server's planned-leg / trip types.

## Steps this run takes / skips

- **Design: taken.** This run changes a schema constraint
  (`planned_legs.trip_id` nullable) and adds new API surface (a non-trip
  creation route and/or a unified listing route) — both are "introduces a
  contract" per `.claude/agents.md`. Freeze before implementation.
- **Ship (DevOps): skipped.** No build/packaging/deploy/CI change implied;
  recorded here per Cost discipline rule 3.

## Non-negotiables carried into every task envelope

- Never touch the live server or `flights.db` — scratch copies, other ports.
- Existing trip-linked prefile behavior (AC2) must not regress — this is a
  widening of `trip_id`'s cardinality, not a rewrite of the existing path.
