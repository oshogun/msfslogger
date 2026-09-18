# User Story: SimBrief Flight Plan Import

## Story
As a user of this platform, besides the existing Little Navmap integration, I want to import flight plans directly from SimBrief so that I can add my latest SimBrief route to planned legs with a single click.

## Goal
Enable a one-click SimBrief import flow using a saved SimBrief User ID.

## Functional Requirements
- Add a configurable input field for **SimBrief User ID**.
- Persist the SimBrief User ID for future use.
- Provide an **Import from SimBrief** action/button.
- On click, fetch the **most recent** SimBrief flight plan for the configured User ID.
- Convert/import the fetched plan into the app format and append/populate it as **planned legs**.
- Keep existing Little Navmap integration unchanged.

## User Flow
1. User opens settings/integration area.
2. User pastes SimBrief User ID.
3. User saves configuration.
4. User clicks **Import from SimBrief**.
5. System fetches latest SimBrief OFP/route data and updates planned legs.

## Acceptance Criteria
1. A visible SimBrief User ID field exists and accepts valid input.
2. The SimBrief User ID is stored and prefilled on next app load/session.
3. Clicking **Import from SimBrief** triggers a fetch for the latest SimBrief plan for that User ID.
4. Imported route legs appear in planned legs without manual re-entry.
5. If fetch fails (invalid ID, network/API error, no recent plan), the user sees a clear error message and existing planned legs remain unchanged.
6. Little Navmap integration continues to work as before.

## Non-Functional Notes
- Import action should complete within a reasonable time under normal network conditions.
- Error states should be user-friendly and actionable.
- Logging should capture import success/failure for troubleshooting.
