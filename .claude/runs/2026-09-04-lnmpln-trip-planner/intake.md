# Intake — LNMPLN trip planner

Run id: 2026-09-04-lnmpln-trip-planner
Orchestrator: Claude (msfslogger session)

## Goal (restated)

Import Little Navmap `.lnmpln` flight plans into msfslogger as the **expected
route** of a trip. Each imported plan becomes a *planned leg* of that trip, so a
trip is pre-logged before it is flown. When a flight is then tracked live, it is
automatically attached to the planned leg it corresponds to, so the app knows
the intended destination and predicted route while the flight is still in the
air.

## Success criteria

1. A `.lnmpln` file (one or many at once) can be imported into a trip and
   becomes an ordered planned leg with departure, destination, cruise altitude,
   route waypoints and alternates.
2. A trip shows planned legs that have not been flown yet, alongside the flights
   already flown, in route order.
3. Taking off near a planned leg's departure airport, while that trip is the
   active trip, automatically links the new flight to that planned leg and to
   the trip.
4. The planned route is drawn on the trip and flight maps, distinct from the
   flown track.
5. Nothing about existing flights, trips or PDF attachments changes behaviour.

## Decisions already frozen by the user

- **XML parsing**: add `fast-xml-parser` as a server runtime dependency. Do not
  hand-roll the XML parse.
- **Leg matching**: an explicit *active trip* flag. Auto-matching only considers
  unflown planned legs of the one active trip. Manual link/unlink must also
  exist as an escape hatch.

## LNMPLN format — verified facts

Authoritative sources read: the online manual FILES.html (complete annotated
example extracted verbatim) and the XSD at
https://www.littlenavmap.org/schema/lnmpln.xsd (a copy of that XSD is at
`.claude/runs/2026-09-04-lnmpln-trip-planner/lnmpln.xsd`).

Structure: `<LittleNavmap>` → `<Flightplan>` containing, in XSD order:

| Element | Card. | Notes |
|---|---|---|
| `Header` | 1 | `FlightplanType` (IFR/VFR), `CruisingAlt` (int ft), `CruisingAltF` (float ft), `CreationDate` (local time + tz offset), `FileVersion`, `ProgramName`, `ProgramVersion`, `Documentation`, plus plan remarks |
| `SimData` | 0..1 | e.g. `MSFS`, optional `Cycle` attribute |
| `NavData` | 0..1 | e.g. `NAVIGRAPH`, `Cycle="2008"` |
| `AircraftPerformance` | 0..1 | `FilePath`, `Type` (aircraft ICAO type, e.g. `BE51`), `Name` |
| `Departure` | 0..1 | `Pos`, `Start` (e.g. `PARKING 1`), `Type` (None/Airport/Runway/Parking/Helipad), `Heading` (true) |
| `Procedures` | 0..1 | `SID`, `STAR`, `Approach` |
| `Alternates` | 0..N | each holds 1..N `Alternate` (`Name?`, `Ident`, `Type?`, `Pos?`) |
| `Waypoints` | 1..N | each holds 1..N `Waypoint` |

`Waypoint` children (XSD order): `Name?`, `Ident`, `Region?`, `Airway?`,
`Track?`, `Type`, `Comment?`, `Pos`.
`Pos` is an empty element with attributes `Lat` (required), `Lon` (required),
`Alt` (optional, decimal).
`Type` is restricted to: `AIRPORT`, `UNKNOWN`, `WAYPOINT`, `VOR`, `NDB`, `USER`.

`Procedures/SID` and `STAR`: `Name`, `Runway?`, `Transition?`. A SID may instead
be a custom departure with `Type=CUSTOMDEPART` + `CustomDistance`.
`Procedures/Approach`: `Name?`, `ARINC?`, `Runway?`, `Type?`, `Suffix?`,
`Transition?`, `TransitionType?`, and for custom approaches `Type=CUSTOM` with
`CustomDistance`, `CustomAltitude`, `CustomOffsetAngle`.

### Traps found in the real format — the parser must handle all of these

1. **Units and coordinates.** "Coordinates are always latitude and longitude in
   decimal/signed notation." "Altitude in feet." No conversion needed, but
   values must be range-checked (lat ±90, lon ±180) before they reach the DB.
2. **`Comment` vs `Description`.** The XSD declares `<Comment>` on `Header` and
   `Waypoint`; the official annotated example writes `<Description>` in both
   places. Accept **either** spelling for remarks.
3. **Element order is not reliable.** The XSD fixes an order but the example
   deviates (it puts `Description` after `Pos` in a Waypoint). Parse by tag
   name, never by position.
4. **`Waypoints` is `maxOccurs="unbounded"`.** Concatenate every `Waypoint` from
   every `Waypoints` block, in document order. Same for `Alternates`.
5. **Procedure waypoints are never present.** The manual states this explicitly:
   the `Waypoints` list is the en-route skeleton only, so SID/STAR/approach legs
   are absent. Any distance computed from the waypoint chain is therefore an
   approximation and must be labelled as such — do not present it as the real
   flown distance.
6. **Endpoints are not guaranteed to be airports.** The manual notes "other
   waypoint types are allowed for flight plan snippets" for both the first and
   last waypoint. Treat first/last as departure/destination, but only claim an
   ICAO when the `Type` is `AIRPORT`; otherwise flag the plan as a snippet.
7. **XML comments appear inside the file**, and the official example even
   contains an unbalanced/nested comment block around the alternative custom
   SID. A real XML parser must be used (this is one reason for the
   fast-xml-parser decision).
8. **`Pos/@Alt` is optional** on both `Waypoint` and `Alternate`.
9. **`CruisingAltF` is the precise value**; `CruisingAlt` is the rounded int.
   Prefer `CruisingAltF`, fall back to `CruisingAlt`.
10. **`CreationDate` carries a timezone offset** (`2020-09-11T18:05:15+02`) with
    a two-digit offset that `new Date()` parses inconsistently — normalise it.
11. Files are UTF-8 and may carry a BOM.
12. `Departure/Pos` (the parking spot) is more precise than the departure
    airport waypoint's `Pos`, and `Departure/Type` says whether the plan starts
    at a gate, a runway or nothing at all.

## Codebase facts

Stack: Express 4 + better-sqlite3 (WAL) + TypeScript on the server; React 18 +
Vite + react-router-dom 6 + react-leaflet 4 on the client. No test framework is
present. No ORM — hand-written SQL in `src/db.ts`.

Relevant files:

- `src/db.ts` — schema in `initDb()`, migrations done by inspecting
  `PRAGMA table_info(flights)` and issuing `ALTER TABLE ... ADD COLUMN`. All
  flight/trip/point CRUD lives here. Has a private `haversineNm` and
  `bearingDeg`.
- `src/flightManager.ts` — the flight state machine. `startFlight()` calls
  `findNearestAirport()` and `insertFlight()`; `endFlight()` calls
  `findNearestAirport()` and `closeFlight()`. Has its own copy of `haversineNm`.
- `src/airports.ts` — OurAirports-backed ICAO lookup, `findNearestAirport(lat,
  lon, maxNm = 10)`. Third copy of `haversineNm`. Note the lookup is a linear
  scan over ~40k airports.
- `src/server.ts` — all REST routes. Multer is already configured for the
  20 MB PDF flight-plan upload. Route-ordering matters: literal routes are
  registered before `/:id` ones, and everything before the SPA catch-all
  `app.get('*')`.
- `src/flightPlans.ts` — on-disk storage for the **PDF** attachments in
  `flight_plans/<flightId>.pdf`. This is a *different* feature from LNMPLN
  import and must not be conflated with it: `flights.flight_plan_name` refers to
  the attached PDF.
- `src/journey.ts` — trip analytics (`buildJourney`). Contains a comment left
  deliberately: an "around the world" progress bar was removed because raw
  distance flown is not progress around a globe, and it says that if it returns
  "alongside planned trips, measure progress along the planned route (or
  longitude swept), not raw distance." Planned legs are exactly what unblocks
  that.
- `src/pdfExport.ts` — Puppeteer render of `/print/trip/:id` + `pdf-lib` merge.
- `client/src/pages/TripDetail.tsx` — Overview/Atlas tabs, legs table, edit
  form, export controls.
- `client/src/components/TripMap.tsx` — leaflet polylines per leg, `LEG_COLORS`.
- `client/src/pages/Home.tsx` — flight list, trip grouping, trip creation.
- `client/src/components/LivePanel.tsx` — live sim readout.
- `client/src/types.ts` — client mirror of the server types. It is maintained by
  hand and must be kept in step.

Existing DB tables: `flights`, `flight_points`, `trips`. `flights.trip_id` is
the (unconstrained) link to `trips`.

Style conventions observed and to be matched:
- Comments explain *why*, not *what*, and are used sparingly but substantively.
- Route handlers validate input explicitly and return `{ error: string }` with a
  proper status code.
- Migrations are additive and idempotent.
- No test framework — verification is by running the app.
