# Specification: Create Blank Trip (Planned Trip)

## User Story
As a user of the logger, I want to create a trip before flying it, without assigning an existing flight first, so I can prefile flight plans to that planned trip.

## Goal
Allow users to create an empty/planned trip directly from the Trips area (e.g., **New Trip**), with no required linked flights at creation time.

## Functional Requirements
1. The system must provide a visible action to create a new trip (e.g., button: **New Trip**).
2. Creating a trip must not require selecting or attaching a pre-existing flight.
3. A newly created trip must be persisted as a valid trip record even when it has zero flights.
4. A newly created blank trip must be marked with a state indicating it is planned/draft (or equivalent status used by the product).
5. Users must be able to open the blank trip and add/prefile one or more flight plans to it after creation.
6. The trip must remain editable after creation until flights are actually flown/logged.

## Data/Domain Requirements
- A trip entity must support zero associated flights.
- A trip entity must support association with prefixed/prefiled flight plans independent of logged flights.
- Required minimum fields for blank-trip creation should be limited to those necessary for persistence (e.g., generated ID, timestamps, owner/user, default status).

## UX Requirements
- The **New Trip** action should be available in the Trips view.
- Success feedback should confirm trip creation and route user to the new trip detail/edit view (or equivalent).
- Empty-state messaging in trip detail should guide user to prefile/add flight plans.

## Validation Rules
- No validation error should block creation solely because no existing flight is linked.
- Standard authorization rules apply: only permitted users can create trips.

## Acceptance Criteria
1. **Create without existing flight**  
	Given I am an authorized user in Trips, when I click **New Trip** and confirm creation, then a trip is created successfully with no linked flights.

2. **Trip visible and persisted**  
	Given I created a blank trip, when I return to the Trips list, then I can see the new trip and open it.

3. **Prefile after creation**  
	Given a blank trip exists, when I add/prefile a flight plan to it, then the flight plan is attached to that trip successfully.

4. **No forced linkage**  
	Given I am creating a trip, when I submit without selecting any pre-existing flight, then the system does not raise a “flight required” validation error.

## Non-Goals
- Auto-creating or auto-linking logged flights during blank-trip creation.
- Defining full flight-plan authoring behavior beyond association to a blank trip.

## Definition of Done
- Blank trip creation is available in UI and API/service layer (if applicable).
- Trips with zero flights are supported and persisted.
- Users can attach/prefile flight plans to the blank trip after creation.
- Acceptance criteria above are testable and passing.
