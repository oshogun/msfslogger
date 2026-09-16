# Intake — create-blank-trip

Source: `user_stories/create_blank_trip.md`

## Goal

Let a user create a trip with zero flights, without selecting an existing
flight first, and reach that trip's detail page to prefile flight plans into
it afterward.

## Success criteria (from the user story's Acceptance Criteria)

1. Creating a trip does not require selecting or linking an existing flight.
2. The new trip is persisted and visible in the trips list (Sidebar) immediately.
3. A flight plan can be prefiled to the blank trip after creation.
4. No "flight required" validation error is raised when submitting without a
   flight selected.
5. Success feedback routes the user to the new trip's detail view.

## What's already in place (verified by direct inspection, not assumed)

- `POST /api/trips` (`src/routes/trips.ts:23`) already creates a trip from
  `{name, notes?}` alone — no flight/leg parameter, no FK requiring one.
  `createTrip()` (`src/db/trips.ts:10`) is a plain `INSERT`.
- `trips.name`/`notes`/`created_at` are the only columns besides `id` and
  `is_active`; no schema constraint blocks zero flights. Already covered by
  `tests/db/trips.test.ts:64` ("reports zero flights and null aggregates for
  a trip with no flights").
- `TripDetail.tsx` (`/trip/:id`) already renders a graceful empty state
  ("No flights in this trip.", line 778) and already exposes the
  `.lnmpln`/SimBrief prefile-into-this-trip UI (`POST /api/trips/:id/planned-legs`
  and `.../simbrief`) unconditionally — not gated on flight count. So AC3 is
  already satisfied by existing code; nothing to build there.
- `planned_legs.trip_id` is nullable (from the `2026-09-16-loose-flight-prefile`
  run), confirming trips and prefiles were already decoupled from "must have a
  flight" thinking elsewhere in the codebase.

## The actual gap

`client/src/pages/AllFlights.tsx`:
- The only "New Trip" button in the app lives inside the selection toolbar,
  rendered only when `n > 0` (line 202) — i.e. only reachable after checking
  at least one existing flight. There is no UI path to create a trip with zero
  flights today, even though the backend already allows it.
- `handleNewTrip` (line 97) creates the trip, assigns selected flights, then
  clears selection and stays on `/flights` — it never navigates to the new
  trip, so AC5 (route to trip detail) isn't met even for the existing
  flight-selection flow.

## Frozen decision

Asked the user whether a blank trip needs an explicit "planned/draft" status
(the story's FR4 implies one, but no `trips.status` column exists — only
`is_active`, unrelated). User's answer, verbatim:

> I'm not sure a "planned" status for a trip is necessary. A trip is a trip,
> regardless if it has any real flights flown yet or not

**Decision: no new `status` column, no derived "Planned" badge either.** A
trip's status is not tracked or displayed at all — it's just a trip with
however many flights it has (zero is a normal, unremarkable state). This
directly drops the story's FR4 and the "default status" line in Data/Domain
Requirements; the rest of the story stands as written.

## Scope

**Tier 2** per `.claude/agents.md` § Cost discipline rule 6 — a change with a
single seam (one file, one component), reusing an existing endpoint and
existing types, no new contract. Planner and Designer are skipped; this
`intake.md` is the only planning artifact.

One task:

- Add an always-visible "New Trip" entry point in `AllFlights.tsx` (not gated
  on flight selection) that prompts for a name, `POST`s `/api/trips` with
  `{name}` alone, and navigates to `/trip/:id` on success. Leave the existing
  selection-toolbar "New Trip" (create-trip-from-selected-flights) flow's
  behavior otherwise unchanged — it's a different use case, out of scope here.

Owner: `frontend_jr` (single component, no new contract, mechanical — reuses
the `apiFetch`/`prompt`/`navigate` patterns already present in the same file).
Then `reviewer`.

## Out of scope (non-goals, per the story)

- Auto-creating or auto-linking logged flights during blank-trip creation.
- Full flight-plan authoring behavior.
- Any trip status/lifecycle field (frozen decision above).
- A dedicated `/trips` list page — the Sidebar already lists all trips
  (including newly created blank ones) and is the de facto "Trips view."
