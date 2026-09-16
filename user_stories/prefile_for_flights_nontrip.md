## User Story

As a user of the msfslogger, I want to be able to benefit from pre filing a flight plan for loose flights, not just those in a given trip, so that any flight can benefit from the corresponding features like ACARS.

## Specification

### Goal
Enable flight-plan prefiling for flights that are not attached to a trip ("loose flights") while preserving existing trip-based prefiling behavior.

### Functional Requirements
1. The system must allow creating a prefiled flight plan without requiring a `trip_id`.
2. Existing prefile flow for trip-linked flights must remain unchanged.
3. A prefiled loose flight must be retrievable, editable, and cancellable using the same lifecycle actions available to trip-linked prefiles.
4. ACARS-related features that depend on a prefiled flight plan must work for loose flights exactly as they do for trip-linked flights.
5. Validation rules for flight-plan fields (aircraft, departure, arrival, route, altitude, schedule, etc.) must be identical for loose and trip-linked prefiles, except for optional `trip_id`.

### Data/Domain Rules
- `trip_id` is optional for a prefiled flight plan.
- A prefiled flight is considered "loose" when `trip_id` is null/absent.
- Prefiled flights must retain a unique identifier regardless of trip association.

### UX/API Behavior
- Users can start a prefile from a non-trip context.
- Any listing/filtering of prefiled flights must include both trip-linked and loose flights.
- Where trip context is shown, loose flights must be clearly marked (e.g., "No trip").

### Acceptance Criteria
1. **Create loose prefile**
	- Given a user is not operating inside a trip
	- When the user submits a valid prefile flight plan
	- Then the system creates the prefile successfully without `trip_id`.

2. **Preserve trip prefile behavior**
	- Given a user is inside a trip
	- When the user creates a prefile flight plan
	- Then the prefile is created and linked to that trip as before.

3. **ACARS compatibility for loose flights**
	- Given a loose prefile exists
	- When ACARS features are invoked for that flight
	- Then ACARS behaves the same as for a trip-linked prefile.

4. **Manage loose prefile lifecycle**
	- Given a loose prefile exists
	- When the user edits or cancels it
	- Then the operation succeeds with the same rules used for trip-linked prefiles.

5. **Unified visibility**
	- Given a user views prefiled flights
	- When flights are listed
	- Then both loose and trip-linked prefiles are visible and distinguishable.

### Out of Scope
- Automatic creation of trips from loose prefiles.
- Changing ACARS business logic beyond enabling non-trip prefile eligibility.
