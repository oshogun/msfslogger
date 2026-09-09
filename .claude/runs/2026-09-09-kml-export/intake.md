# Intake — KML export

Run id: 2026-09-09-kml-export
Orchestrator: Claude (msfslogger session)

## Goal (restated)

Add KML export so a user can download a `.kml` file for:

1. **An individual flight** — the flown track of one flight.
2. **A set of flights** — an arbitrary user-picked group (not necessarily a
   trip), e.g. selected from the Home page multi-select toolbar.
3. **A whole trip** — every flight belonging to a trip, in order.

This mirrors the existing PDF export feature (per-flight and per-trip) but adds
a third scope — an arbitrary flight set — that has no PDF precedent, and a new
file format (KML) rather than a rendered document.

## Success criteria

1. `GET /api/flights/:id/export.kml` downloads a valid KML file containing that
   flight's flown track (from `flight_points`) as a line, with basic metadata
   (departure/arrival ICAO, date, callsign/aircraft if available) in the
   placemark name/description.
2. A new endpoint accepts an arbitrary list of flight ids and returns one KML
   file containing one track per flight (each a separate KML `Placemark`/
   `Folder`, clearly labeled) — usable from the Home page's existing
   multi-select toolbar.
3. `GET /api/trips/:id/export.kml` downloads one KML file with every flight in
   the trip, in `start_time` order, each flight's track distinguishable (e.g.
   own folder/name) inside the file.
4. Exported KML opens correctly in Google Earth and other common KML viewers
   (validated by schema/structure inspection since we have no Google Earth in
   this environment — see Verification note below).
5. Nothing about the existing PDF export, flight/trip pages, or Home page
   selection behaviour changes except the addition of KML export entry points.

## Decisions already frozen by the user

None beyond the one-line request itself: *"Add kml exports, for individual
flights, a set of flights or the whole trip."* No format details (LineString vs
gx:Track, styling, file-per-flight vs combined file, exact route/UI copy) were
specified by the user — these are technical choices to be made and frozen in
design.md, not escalated, since none of them are destructive, ambiguous about
user intent, or require domain knowledge only the user has.

## Codebase facts (from survey, see full agent report in this run's history)

Stack: Express 4 + better-sqlite3 (WAL) + TypeScript server; React 18 + Vite
client; Vitest unit tests exist for pure/near-pure logic only (see root
CLAUDE.md "Verification" section) — KML generation should be written as a pure
function so it can join that suite.

- **PDF export precedent** (`src/pdfExport.ts`, `src/server.ts:745-784`):
  server-side Puppeteer render of `/print/flight/:id` and `/print/trip/:id`,
  `.pdf` as a literal suffix on the id-scoped resource path (not a sub-collection
  or format query param), registered before the SPA catch-all
  (`server.ts:786-789`, ordering is load-bearing). Filenames built by
  `flightExportFilename()` (`server.ts:59-65`) and an inline equivalent for
  trips. Client download helper: `client/src/utils/api.ts` `downloadPdf()`
  (fetch → Blob → synthetic `<a download>` click, reads filename from
  `Content-Disposition`). KML export should mirror this URL/response shape,
  **but does not need Puppeteer** — it's a data export, generated directly from
  DB rows, no rendering.
- **Track data**: `flight_points` table (`src/db.ts:64-78`) — one row per
  sample: `flight_id, ts, lat, lon, altitude_ft, airspeed_kts,
  ground_speed_kts, heading_deg, vertical_speed_fpm, on_ground`. Retrieved
  chronologically via `getFlightById()` (`db.ts:394-399`) and, per-flight, via
  `getTripById()` (`db.ts:466-471`). This is the exact data a KML
  `LineString`/`gx:Track` coordinate sequence needs; no new table or migration
  required.
- **Flight/trip grouping**: `trips` group flights purely via `flights.trip_id`
  (no join table). `getTripById()` (`db.ts:450-479`) already returns a trip's
  flights in `start_time` order with points attached — reusable as-is for the
  trip export.
- **No existing route accepts an arbitrary set of flight ids.** Closest
  precedents: `POST /api/flights/combine` (exactly 2 ids in a JSON body,
  `server.ts:163-201`) and the Home page's multi-select toolbar
  (`client/src/pages/Home.tsx:16, 110-133, 196-221`, `selectedIds: Set<number>`)
  which today drives "New Trip" / "Add to Trip" / "Combine Selected" — this
  toolbar is the natural attachment point for a "Export KML" action over the
  current selection. The set-export endpoint has no URL shape to mirror and
  must be designed (a GET with an id list is awkward at scale; existing
  multi-id operations in this codebase use POST + JSON body).
- **No shared route/track format module exists.** `src/lnmpln.ts` (an
  *import* parser for Little Navmap plans) and the planned-but-unbuilt GPX
  import (`.claude/runs/2026-09-07-gpx-import/`, not yet implemented — no
  `src/gpx.ts` exists) are the only geo-format-adjacent code, and neither is a
  writer. A new pure module (e.g. `src/kmlExport.ts`) is needed, following the
  project's established pattern of pure modules with no `./db` import (see
  `src/geo.ts:1-14`, `src/lnmpln.ts:1-3`) so it can be unit-tested per the
  Verification section of CLAUDE.md.
- **Client UI surfaces**: `FlightDetail.tsx` (existing "Export PDF" button,
  `:211-219,437-438`) and `TripDetail.tsx` (existing "Export PDF" button,
  `:125-133,734-750`) are the natural homes for "Export KML" buttons alongside
  the existing ones. `Home.tsx`'s multi-select toolbar (`:196-221`) is the home
  for the flight-set export action.

## Verification

- `src/kmlExport.ts` should be pure (rows in, KML string out) and covered by
  Vitest, per CLAUDE.md's Verification section and the precedent of
  `src/flightManager.ts`/`src/legMatcher.ts`/`src/lnmpln.ts` tests.
- No Google Earth / KML viewer is available in this environment. Verification
  is: unit tests on the generator, `npx tsc`/`npm run build`, `curl` against a
  scratch server instance (not the user's live one — see non-negotiable below)
  to confirm headers/filename/content-type, and validating the output is
  well-formed XML against the KML 2.2 namespace/structure by inspection
  (e.g. an XML parser round-trip in a test, not a live-render check).
- Per project non-negotiables: **never touch the user's running server or live
  `flights.db`** — all curl/manual verification happens against a scratch copy
  of the DB on a scratch port.

## Tier

Full loop. Rationale: introduces a new API contract (new `.kml` endpoints,
including a genuinely new URL shape for the flight-set case with no existing
precedent to copy) and touches several files across server and client
(new `src/kmlExport.ts`, `src/server.ts` routes, three separate UI surfaces).
Design step is **not skipped**: the set-export route shape and the KML content
structure (single file vs per-flight folders, LineString vs gx:Track, what
metadata goes in each Placemark) must be frozen before implementation.
