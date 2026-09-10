# Intake — Sidebar navigation + legs pagination

Run id: 2026-09-09-sidebar-nav-legs-paging
Orchestrator: Claude (msfslogger session)

## Goal (restated)

The app has no persistent navigation today: `Home` is a single page with one
big combined table (trips as collapsible group headers interleaved with their
flight rows). As trips accumulate this "single vertical row" of trips does not
scale. Separately, `TripDetail`'s legs table renders every leg of a trip in one
unbroken list, which gets unwieldy for trips with many legs.

This run:

1. Adds a persistent, Notion-style left sidebar as the app's primary
   navigation: a collapsible list of trips (each expandable to its legs) plus
   standalone (non-trip) flights, replacing `Home`'s combined table as the way
   users find and open a trip or flight.
2. Adds pagination to the legs table inside `TripDetail` so a trip with many
   legs renders as fixed-size pages instead of one long list.

## Success criteria

1. A persistent sidebar is visible app-wide (inside `AppShell`, alongside
   routed content — not on the print-only or device/override pages, matching
   the existing pattern of keeping those outside `AppShell`).
2. The sidebar lists trips (collapsible/expandable to show that trip's legs as
   sub-items) and standalone flights not part of any trip. Clicking a trip or
   flight navigates to its existing detail route (`/trip/:id`, `/flight/:id`).
   The currently open trip/flight is visually indicated as active in the
   sidebar.
3. `Home` (`/`) no longer shows the old combined table. It becomes a
   lightweight landing view (e.g. summary stats, recent activity) computed
   from data already available via the existing `/api/trips` and
   `/api/flights` endpoints — no new backend endpoint.
4. `TripDetail`'s legs table is paginated client-side, 20 legs per page, over
   the already-interleaved flown-flights + planned-legs array
   (`interleaveTripRows`) that the existing `GET /api/trips/:id` response
   already provides in full. No backend/API change.
5. Existing behaviour is preserved: trip edit form, map, atlas view, stats
   grid, export/delete actions, planned-leg ghost rows, and the print/device
   pages (which stay outside `AppShell` and unaffected by the sidebar).
6. `npx tsc` / `npm run build` (client + server) pass; `npm test` still passes
   unchanged (this run touches no code under test).

## Decisions already frozen by the user

- **Sidebar scope**: sidebar *replaces* `Home`'s combined table as primary
  nav. `Home` becomes a lightweight landing/dashboard, not the trip/flight
  browser.
- **Legs pagination**: 20 legs per page, implemented client-side (windowing
  the array already returned by `GET /api/trips/:id`) — explicitly not a
  backend/API change. The realistic case is "dozens of legs," not thousands;
  no requirement to optimize for 100+-leg trips beyond correct paging.

## Skipped steps and why

- **Design step is skipped.** Both features wire up *existing* contracts only:
  the sidebar consumes `GET /api/trips` and `GET /api/flights` (already used
  by `Home` today), and legs pagination slices an array the client already has
  in full from `GET /api/trips/:id`. No schema change, no new endpoint, no new
  shared type between client and server. Per `.claude/agents.md` § Cost
  discipline rule 3 / § Design role, Design is reserved for runs that
  introduce a contract — this one does not.
- **DevOps (Ship) step is skipped** unless implementation surfaces a build/
  packaging change; this is a client-only UI change, `npm run build` is the
  existing build path, nothing about packaging or deploy changes.

## Codebase facts (from exploration, `Explore` agent report)

Stack: Express + better-sqlite3 server (`src/`), React 18 + Vite +
react-router-dom 6 client (`client/src/`). Plain global CSS
(`client/src/index.css`, `client/src/print.css`), no CSS framework, no CSS
modules.

- `client/src/main.tsx` — wraps app in `<BrowserRouter>`.
- `client/src/App.tsx` — `AppShell` renders `<Header/>` + `<Routes>` for `/`,
  `/flight/:id`, `/trip/:id`. Print routes (`/print/flight/:id`,
  `/print/trip/:id`) and `/device`, `/override` are deliberately routed
  **outside** `AppShell` (existing comment: they must not mount `Header`,
  whose `useStatus` polling would block PDF export "settling"). The new
  `Sidebar` must follow the same exclusion — mount only inside `AppShell`,
  alongside `Header`, not on those routes.
- `client/src/components/Header.tsx` — slim top bar, logo + connection-status
  badge, no nav links today.
- `client/src/pages/Home.tsx` — today: one big `<table>`, trips as
  collapsible group headers (`collapsedTrips` state) interleaved with flight
  rows via `trip.flatMap`. This table goes away per success criterion 3.
- `client/src/pages/TripDetail.tsx` (770 lines) — stats grid, notes, edit
  form, `TripMap`, legs `<table>` built from
  `interleaveTripRows(trip.flights, trip.planned_legs)`
  (`client/src/components/PlannedLegRows.tsx`), export/delete actions. The
  legs table is what gets paginated. `TripDetail` already uses
  `useSearchParams` for the `?view=overview|atlas` toggle — a precedent to
  follow for a `?page=N` param so pagination state survives reload/back-nav.
- `client/src/components/PlannedLegRows.tsx` — `interleaveTripRows()` merges
  flown flights with unflown planned legs into one ordered array; renders
  `GhostLegRow` for unflown legs.
- `GET /api/trips` → `getTrips()` (`src/db.ts:425`) — all trips, each with all
  flights (points stripped for lightness), no limit.
- `GET /api/flights` → `getFlights()` (`src/db.ts:390`) — all flights, no
  limit/offset.
- `GET /api/trips/:id` → `getTripById()` (`src/db.ts:450`) — full trip incl.
  every flight's full point track and every planned leg with waypoints/
  alternates, unpaginated. This is the data source `TripDetail` already holds
  in full; pagination in this run only changes how much of that array is
  *rendered* at once, not what's fetched.
- No existing `LIMIT`/`OFFSET`/pagination support anywhere in `src/` for
  flights or legs (grepped; only unrelated hit is a duplicate-detection
  `LIMIT 1` in `db.ts:945`).
- `client/src/types.ts` — hand-maintained client mirror of server types.

## Known follow-up, explicitly out of scope

`getTripById` eagerly loads every flight's full point track for the whole
trip in one response, so a many-leg trip is already heavy on the wire before
any UI pagination. Fixing that (e.g. a `?points=0` flag, lazy per-leg point
loading — there's a `?plans=0` precedent near `src/server.ts:92` for PDF
export) is a reasonable follow-up run but is explicitly not this run's
problem: the user asked for UI paging of an already-fetched list, not payload
reduction.
