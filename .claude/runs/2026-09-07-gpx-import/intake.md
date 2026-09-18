# Intake — GPX track import as a flight

Run id: `2026-09-07-gpx-import`
Requested by: user, via Orchestrator conversation. User asked to "make a plan" —
this run currently covers Intake + Plan only; Design/Implement/Review/Ship are
not yet started.

## Goal

Let a user upload a `.gpx` GPS track (e.g. recorded by a phone app or a
different logger, not by this app's own SimConnect recording) and have it
become a normal flight record — visible, editable, and exportable exactly like
a flight the server recorded live.

## Success criteria

- A user can upload one or more `.gpx` files from the web UI and get back one
  flight per file, with departure/arrival ICAO, duration, distance, max
  altitude, and a track that renders correctly on the existing map and
  altitude-chart components.
- Imported flights behave like normal flights everywhere downstream: they
  appear on Home, can be edited/deleted, attached to a trip, get a PDF export,
  and can be linked to a planned leg — no special-cased UI path required to use
  them.
- Bad input (non-GPX file, GPX with no track points, unparseable XML) fails
  per-file with a clear error, the same way `.lnmpln` import reports per-file
  failures today, and never produces a half-written flight.

## Scope decisions made so far (defaults chosen by the Orchestrator — open to
user correction, not yet frozen by a Designer)

1. **New provenance column.** Add a column to `flights` (e.g. `source TEXT NOT
   NULL DEFAULT 'simconnect'`, value `'gpx'` for imports) so the UI can label an
   imported flight and so duration/interruption logic that assumes a live
   SimConnect recording (pause detection, active-trip auto-linking's "just
   took off" checks) isn't silently misapplied to a track that was never live.
   This is a schema change — **routes this run through the Design step**, not
   just Plan → Implement.
2. **Reuse the existing write path.** The importer should call the same
   `insertFlight` / `insertPoint` / `closeFlight` functions `flightManager.ts`
   uses (`src/db.ts:313,321,371`), not a parallel write path — it synthesizes
   the same shape of finalized flight from a static point list instead of a
   live state machine.
3. **Departure/arrival ICAO** via the existing `findNearestAirport()`
   (`src/airports.ts:102`) on the track's first/last points — identical to the
   live flow.
4. **No aircraft type in GPX.** The upload form takes an optional free-text
   aircraft field (flights already support editing this after the fact, so it
   is not blocking).
5. **Computed fields with no GPX source data** (airspeed, heading, vertical
   speed, on-ground) are derived from consecutive trackpoints (bearing,
   distance/time, altitude delta/time) the same way the live recorder would —
   `on_ground` has no reliable signal from GPS alone and defaults to false for
   imported points.
6. **Point density.** Phone-recorded GPX tracks are commonly 1-second
   interval; the app's own recording writes one point per `RECORD_INTERVAL_MS`
   (5s, `flightManager.ts`). Open question for the Planner/Designer: import at
   native resolution, or resample to ~5s to match existing chart/map
   assumptions and keep `flight_points` row counts consistent with
   SimConnect-recorded flights. Recommend resampling for consistency.
7. **Endpoint and upload conventions follow the `.lnmpln` precedent**
   (`src/server.ts:426-546`, `uploadLnmpln` multer instance at
   `src/server.ts:24-27`): a dedicated small-file-size multer instance, XML
   content sniff, per-file try/parse/insert, a batch response shape
   `{imported, results}` with one entry per file (`status`, `flight_id` or
   `error`). Proposed route: `POST /api/flights/import/gpx`.
8. **Client entry point follows the `TripDetail.tsx` `.lnmpln` import
   precedent** (`TripDetail.tsx:158-202`) but lives on the Home page (a GPX
   import isn't tied to a trip) — file input (`accept=".gpx"`, multiple),
   optional aircraft/notes field, `FormData` POST, per-file result list,
   refresh the flight list afterward.
9. **Parsing library.** `fast-xml-parser` is already a dependency (used by
   `src/lnmpln.ts`) and GPX is XML — reuse it rather than adding a new GPX
   parsing dependency.
10. **Duplicate import.** Out of scope for v1: re-importing the same file
    twice creates two flights. (`.lnmpln`'s SHA-256 dedupe is for planned legs,
    a different table with different semantics — not reused here unless the
    Planner flags it as needed.)

## Steps this run skips, and why

- **Ship (DevOps)** — this run touches no build, packaging, or deploy config;
  skip unless a later phase turns out to need it (e.g. a new npm dependency
  requiring a Docker image change, which is not expected since
  `fast-xml-parser` is already installed).

## Research already done (do not re-derive; hand these as context slices)

Full findings are in this Orchestrator's own investigation this session,
summarized in decisions 1–9 above with file:line citations. Key files for a
Planner/Designer to open directly (not re-explore):

- `src/db.ts:37-78,237-275,313,321,371` — schema, inline migration pattern,
  `insertFlight`/`insertPoint`/`closeFlight`.
- `src/flightManager.ts:19-27,183-313,474-517` — live flight state machine;
  the logic a GPX importer parallels for a static point list.
- `src/airports.ts:79-111` — `findNearestAirport`.
- `src/lnmpln.ts` (whole file) + `src/server.ts:24-27,365,426-546,781-792` —
  file-import endpoint precedent (multer config, content sniff, per-file
  batch response, error handling).
- `client/src/pages/TripDetail.tsx:149-202,534-563` — client upload precedent.
- `package.json` (root) — confirm `fast-xml-parser` version before use.

## Next step

Delegate to `planner` (model: opus) to produce `plan.json`: phases, tasks,
`allowed_paths`, acceptance criteria — including a Design phase for the schema
addition (decision 1) before any implementation task.
