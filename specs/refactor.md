# Refactor Specification: Split `db.ts` and `server.ts` by Responsibility

## Problem Statement
Current technical debt is primarily structural (file size and responsibility creep), not algorithmic:
- `db.ts` is approximately 1,400 lines.
- `server.ts` is approximately 1,000 lines.

This makes ownership boundaries unclear and increases maintenance risk.

## Goal
Reduce responsibility concentration in `db.ts` and `server.ts` while preserving the current simple architecture.

## Non-Goals
- Do **not** introduce an ORM.
- Do **not** introduce a complex/new architecture.
- Do **not** change the role of `FlightManager` as domain/state-machine logic.

## Target Module Split

### Database Layer
Create and migrate database concerns into:
- `db/flights.ts`
- `db/trips.ts`
- `db/plannedLegs.ts`
- `db/settings.ts`

### Routing Layer
Create and migrate HTTP route concerns into routers for:
- flights
- trips
- plannedLegs
- settings
- exports

## Architectural Constraints
- Keep `FlightManager` as the domain/state-machine layer.
- Preserve existing behavior and API contracts.
- Prefer straightforward file/module extraction over redesign.

## Acceptance Criteria
1. `db.ts` no longer contains all DB responsibilities; domain-specific DB logic is moved to the listed files.
2. `server.ts` no longer contains all route handlers; handlers are organized by router concern listed above.
3. `FlightManager` remains the domain/state-machine boundary.
4. No ORM added.
5. Application behavior remains functionally equivalent.

## Expected Outcome
The codebase remains simple, but `db.ts` and `server.ts` stop being catch-all files, improving maintainability and future changes.