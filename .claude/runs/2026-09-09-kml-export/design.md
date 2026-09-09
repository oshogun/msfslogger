# Design — KML export (run 2026-09-09-kml-export)

Frozen by the Designer, task T-001. Every decision a later task would otherwise
have to invent is made here. Sections are numbered and the numbers are stable:
downstream tasks are handed slices with
`.claude/tools/ctx.sh design 2026-09-09-kml-export <n>`, so a renamed or
renumbered heading silently breaks their context.

## Amendments

| # | Date | Section | Change | Evidence that forced it |
|---|------|---------|--------|-------------------------|
| — | —    | —       | None yet. | — |

*(When reality contradicts a frozen section after the freeze: edit that section
in place, keep its number, and add a row here.)*

## 0. Prototype evidence

Every load-bearing claim in §4 was produced by running a throwaway generator
against the user's **real** database, opened read-only
(`new Database('flights.db', { readonly: true })` — no writes, no server
touched). The prototype lived in the session scratchpad, never in `src/` and
never in the repo. Numbers quoted below are from that run under Node 20.20.2
with the repo's existing `fast-xml-parser` 5.11.1.

| Fact | Measured |
|---|---|
| Flights in the live DB | 45, all in trip #1 "Circumnavegação" |
| `flight_points` rows | 42 501 total; largest single flight #56 = **2 242** points |
| `flight_points.ts` format | `2026-09-09T02:35:35.639Z` — ISO 8601, UTC, milliseconds |
| `altitude_ft` range | 8.77 → 30 452.32 (float, never null) |
| Flights with a null `departure_icao`/`arrival_icao` | 0 today (combined flights would be) |
| Flights with `point_count` 0 or null | 0 today |
| One flight (1 201 pts) as KML | 48 326 bytes, `XMLValidator.validate` → `true` |
| Three flights, folders | 184 300 bytes, valid |
| Whole trip, 45 flights / 42 501 pts | **1 668 796 bytes, valid, 284 ms** to build |
| Coordinate count in output | 1 201 — exactly `select count(*) from flight_points where flight_id=63` |
| `]]>` inside `aircraft` | escaped to `]]&gt;` before CDATA wrapping; document still valid |
| Zero-point / one-point / all-null-metadata flights | all valid, no literal `null`/`undefined` in output |
| Decimation of a synthetic 12 345-point track | 4 116 coordinates (§4.7 rule) |
| §5.1's structural types vs `src/types.ts` | `tsc --noEmit --strict` OK: `FlightWithPoints` is assignable to `KmlFlight`, `FlightPoint` to `KmlPoint`, `TripWithFlights.flights` to `KmlFlight[]` — no cast, no mapping needed |

Consequences that are frozen because of these numbers: no flight in the live DB
is decimated today (§4.7); build time is not a concern and no streaming or
caching is needed (§2); `Content-Length` must be a **byte** length, not a string
length, because names carry multi-byte characters (`→`, `ã`) (§3).

Two structural facts read out of the code, both load-bearing:

- `src/server.ts` registers `app.get('/api/flights/:id')` at line 328, long
  before the export block at 745. A `GET /api/flights/export.kml` added in the
  export block would therefore be swallowed by `/api/flights/:id`
  (`parseInt('export.kml')` → `NaN` → 400). There is **no** `POST
  /api/flights/:id` route at all. This is the deciding argument in §2.3.
- `src/db.ts:9` computes `DB_PATH` from `process.cwd()` at module load, and
  `initDb()` (`src/db.ts:37-40`) opens the file **read-write** and runs DDL. The
  inspector's `--db` handling in §5.3 follows from that.

## 1. Goal and non-goals

### 1.1 Goal

Add a KML 2.2 export of the **flown track** in three scopes, mirroring the
existing PDF export's URL and download mechanics but generated directly from
rows (no Puppeteer, no new dependency):

1. one flight — `GET /api/flights/:id/export.kml` (§2.1);
2. an arbitrary user-picked set of flights — `POST /api/flights/export.kml`
   (§2.3);
3. a whole trip — `GET /api/trips/:id/export.kml` (§2.2).

All XML is produced by one new pure module, `src/kmlExport.ts` (§5), which
imports nothing from `./db`, does no I/O and is unit-testable.

### 1.2 Non-goals (deliberately out of scope for this run)

- **Animated playback.** No `gx:Track`, no per-point timestamps — see §4.1.
- **Planned routes.** `planned_legs` / `.lnmpln` waypoints are not exported;
  only the flown track. Flagged in §9.2 as a possible follow-up.
- **KMZ**, compression, or `NetworkLink`.
- **Departure/arrival pin placemarks**, altitude-colour ramps, extruded curtain
  walls — considered in §4.2 / §4.5 and rejected for this run.
- **Import** of KML. This run is write-only.
- Any change to PDF export, page layout, Home selection behaviour, the schema,
  packaging or dependencies (§1.3).

### 1.3 Must-not-change list

The Reviewer checks these one by one. Each is an existing behaviour this design
guarantees is untouched.

1. **PDF filenames stay byte-identical.** `flightExportFilename()` gains an
   optional second parameter with a default of `'pdf'` (§3.4); its output for
   every existing caller is unchanged. `git diff` must show no change to the
   route/`route`/`dateStamp` logic inside it.
2. **`sendPdf()` is not modified.** `sendKml()` is a new sibling (§3.5).
3. **The SPA catch-all stays last.** `app.get('*')` remains the final route, and
   all three KML routes are registered above it, inside the export block
   (`src/server.ts:742-784`). `GET /flights/:id` must still return
   `index.html`.
4. **No existing route's method, path, status codes or body changes.** In
   particular `POST /api/flights/combine`, `GET /api/flights/:id`,
   `GET /api/trips/:id` and both `export.pdf` routes are untouched.
5. **`src/types.ts` and `src/db.ts` are not edited** (frozen constraint from
   `plan.json`; this design lives inside it — see §9.1).
6. **No new dependency, no packaging change.** `package.json`,
   `package-lock.json`, `client/package.json` and `Dockerfile*` are untouched.
7. **`downloadPdf()`'s exported signature and behaviour are unchanged** —
   same three parameters, same `tz`/`locale`/`plans` query building. Its two
   call sites (`FlightDetail.tsx:215`, `TripDetail.tsx:129`) are not edited
   (§7.1).
8. **Home's selection behaviour is unchanged**: the toolbar still renders only
   when `n > 0`, the row checkbox is still disabled for `point_count === 0`,
   "Combine Selected" is still `disabled={n !== 2}`, and "New Trip" / "Add to
   Trip" behave exactly as before (§7.4).
9. **The include-flight-plans checkboxes stay PDF-only** on both detail pages —
   the KML export ignores flight plans entirely.
10. **Nothing writes to the database.** All three routes are `SELECT`-only, via
    existing `getFlightById()` / `getTripById()` (§1.5).

### 1.4 Risks, and what would falsify this design

| Risk | What would falsify it | Mitigation now |
|---|---|---|
| A viewer other than Google Earth renders `absolute` altitude oddly, or ignores `<TimeSpan>` | Opening the file in QGIS/Marble and seeing a flat or missing line | Geometry is plain KML 2.2 `LineString` with no extension namespace — the most widely supported form (§4.1) |
| No KML viewer exists in this environment, so "opens correctly in Google Earth" cannot be proven here | The user opens an export and it looks wrong | Verification is structural: `XMLValidator` well-formedness plus element-order conformance to the KML 2.2 XSD `Feature` sequence (§4.2), which is what a strict parser checks |
| A very large trip export (1.6 MB today) grows past what a browser blob download handles comfortably | A future trip of several hundred flights | 100-id cap on the set endpoint (§2.3) and 5 000-point decimation per track (§4.7); trip export is uncapped by design but bounded by the trip's real size |
| `POST` for a read-only export offends REST taste, or a user wants a pasteable URL | User asks for a shareable link | Recorded as an accepted trade in §2.3; the two GET scopes cover the pasteable cases |
| `Content-Length` computed from `string.length` would truncate multi-byte output | A name containing `→` or `ã` — which the live DB already has ("Circumnavegação") | Frozen in §3.2: build a `Buffer` and send its `.length` |

### 1.5 Persistence

**There is no persistence change in this run.** No DDL, no migration, no new
table, no new column, no index. The feature reads `flights` and `flight_points`
through the existing `getFlightById()` (`src/db.ts:394-399`) and
`getTripById()` (`src/db.ts:450-479`), both of which are pure `SELECT`s. Any
diff that adds SQL DDL or a write in this run is out of contract.

The one place this run can touch a database file at all is the CLI inspector
(§5.3), because `initDb()` opens read-write and runs `CREATE TABLE IF NOT
EXISTS` migrations. That is exactly why `--db` is mandatory there and must point
at a **copy**.

## 2. Route contracts

Three routes, all registered inside the existing export block in
`src/server.ts` (currently lines 742-784, above `app.get('*')`). The block
comment "Registered before the SPA catch-all so they aren't swallowed by it" is
extended to name the KML routes too; the ordering is load-bearing (§1.3 item 3).

Common rules for all three:

- Read-only. No side effects, no writes, no background jobs.
- No query parameters are read. Unknown query parameters are ignored (the
  PDF routes' `tz`/`locale`/`plans` have no KML equivalent — KML timestamps are
  the raw UTC ISO strings from the database, see §4.3).
- Success is always `200` with the headers in §3.
- Every error body is `{ "error": "<one sentence>" }` — the shape already used
  everywhere in `src/server.ts`. Never a stack trace.
- All XML is produced by `src/kmlExport.ts`; `src/server.ts` assembles no XML
  and no strings that end up inside the document.

### 2.1 GET /api/flights/:id/export.kml

One flight's flown track.

- **Path param** `id` — parsed with `parseInt(req.params.id, 10)`, exactly as
  `export.pdf` does at `src/server.ts:746`.
- **Data**: `getFlightById(id)` → `FlightWithPoints | null`.
- **Body**: the document of §4.2 case A (a `Document` holding one `Placemark`,
  no `Folder`).
- **200** on success. Failures per §2.4.
- A flight with zero points still returns **200** with a geometry-less
  `Placemark` (§6.1) — an empty logbook entry is not an error.

Example: `curl -si localhost:3100/api/flights/63/export.kml`

### 2.2 GET /api/trips/:id/export.kml

Every flight belonging to a trip.

- **Path param** `id` — `parseInt`, as `src/server.ts:765`.
- **Data**: `getTripById(id)` → `TripWithFlights | null`. Its `flights` array
  already arrives ordered by `start_time ASC` with points attached
  (`src/db.ts:466-471`); the generator re-applies the canonical sort of §4.2
  anyway, which is idempotent on that input.
- **Body**: §4.2 case C — `Document` (named after the trip) → one `Folder` per
  flight → one `Placemark` per folder.
- A trip with **no flights** returns **200** with a `Document` that has a
  `<name>` and the five `<Style>` elements and no features. It is valid KML and
  an empty trip is not an error.
- **200** on success. Failures per §2.4.

### 2.3 POST /api/flights/export.kml — the flight-set endpoint

    POST /api/flights/export.kml
    Content-Type: application/json

**Request body schema** (JSON object; no other key is read):

```jsonc
{
  "ids": [63, 59, 57]     // required. Array of integers. 1 ≤ length ≤ 100.
}
```

Concrete example:

```bash
curl -si -X POST localhost:3100/api/flights/export.kml \
  -H 'Content-Type: application/json' \
  -d '{"ids":[63,59,57]}'
```

**Frozen parameters**

| Question | Frozen answer |
|---|---|
| Method | `POST` |
| Path | `/api/flights/export.kml` |
| Body key | `ids` — nothing else is read |
| Id-count cap | **100**. Checked on the raw array length, *before* de-duplication. |
| Empty array | `400` (§2.4) |
| Non-integer element (`"7"`, `7.5`, `null`, `NaN`) | `400`, whole request rejected (§2.4) |
| Duplicate ids | **Not an error.** De-duplicated, first occurrence wins; the output contains one `Folder` per *distinct* id. |
| Unknown id | `404` naming the first unresolved id in request order (§2.4). Strict, not lenient — see below. |
| Out-of-order ids | **Not significant.** Request order is discarded; output is always sorted by `start_time` ascending, ties by `id` ascending (§4.2). |
| Success status | `200` (nothing is created; `201` would be wrong) |
| Response | Exactly the §4.2 case B document |

**Why POST, and why this path**

1. **A GET cannot live where the other export routes live.**
   `app.get('/api/flights/:id')` is registered at `src/server.ts:328`;
   the export block is at 745. `GET /api/flights/export.kml` added to that block
   would be matched by `/api/flights/:id` first and answered `400 Invalid id`.
   Making it work would mean *moving* a GET route above line 328 — a
   non-additive edit to a busy file, and a new ordering trap of exactly the kind
   the file already carries two warning comments about (lines 162, 435, 743).
   `POST /api/flights/export.kml` collides with nothing: there is no
   `POST /api/flights/:id` route.
2. **It matches the only multi-id precedent in the codebase.**
   `POST /api/flights/combine` (`src/server.ts:163-201`) takes ids in a JSON
   body and validates them with `Number.isInteger`; §2.4's error shapes and
   messages are deliberately modelled on it.
3. **It has no length ceiling**, so the cap in §2.3 is a policy choice rather
   than a URL-length workaround, and raising it later needs no redesign.
4. **The client already fetches downloads over XHR**, not by navigation
   (`downloadPdf` at `client/src/utils/api.ts:20-50` does fetch → Blob →
   synthetic `<a download>`), so a POST download costs the client one extra
   `init` argument (§7.1) and nothing else.

**Alternatives considered**

- `GET /api/flights/export.kml?ids=63,59,57` — pasteable and cacheable, and 100
  ids is only ~400 characters so length is not a real problem. Rejected for
  reason 1 above: it would force a reordering edit to `src/server.ts` for a
  purely cosmetic gain. (This is the one place where the phase-2 "paste a URL"
  phrasing in `plan.json` does not hold for the set scope; `curl` covers it, and
  the two single-resource scopes remain pasteable GETs.)
- `GET /api/flights/export.kml?id=63&id=59` (repeated param) — same ordering
  problem, plus Express's `req.query.id` is `string | string[]` depending on
  count, which is an easy off-by-one type bug.
- `POST /api/exports/kml` with `{scope, ids}` — one endpoint for all three
  scopes. Rejected: it abandons the `.kml`-suffix-on-the-resource shape the PDF
  routes established, and makes the two simple GET cases worse to serve one
  awkward case.
- **Lenient unknown-id handling** (skip missing ids, `404` only if none
  resolve). Rejected: `POST /api/flights/combine` is strict, a silently short
  export is worse than a clear error, and the client only ever sends ids it just
  rendered — an unknown id means the page is stale, which the user should see.

### 2.4 Status codes and error bodies

Every error body is a JSON object with a single `error` key. Status codes and
exact messages:

| Route | Condition | Status | Body |
|---|---|---|---|
| §2.1 | `parseInt(id)` is `NaN` (e.g. `/api/flights/abc/export.kml`) | `400` | `{"error":"Invalid id"}` |
| §2.1 | `getFlightById(id)` returns `null` | `404` | `{"error":"Flight not found"}` |
| §2.1 | generator or send throws | `500` | `{"error":"<String(err)>"}` |
| §2.2 | `parseInt(id)` is `NaN` | `400` | `{"error":"Invalid id"}` |
| §2.2 | `getTripById(id)` returns `null` | `404` | `{"error":"Trip not found"}` |
| §2.2 | generator or send throws | `500` | `{"error":"<String(err)>"}` |
| §2.3 | body is not an object, `ids` missing, `ids` not an array, or any element fails `Number.isInteger` | `400` | `{"error":"ids must be an array of integers"}` |
| §2.3 | `ids.length === 0` | `400` | `{"error":"ids must contain at least one flight id"}` |
| §2.3 | `ids.length > 100` | `400` | `{"error":"Too many flights: 137 requested, maximum is 100"}` (the two numbers are interpolated) |
| §2.3 | some id has no row; `id` is the **first** such id in request order | `404` | `{"error":"Flight 42 not found"}` (mirrors `src/server.ts:177`) |
| §2.3 | generator or send throws | `500` | `{"error":"<String(err)>"}` |

Notes:

- The 400 checks run in the order listed: shape → emptiness → cap → per-element
  integer check. A body that is both empty and malformed reports the malformed
  message.
- The cap check uses the **raw** `ids.length`, before de-duplication (§2.3).
- A syntactically invalid JSON body is rejected by `express.json()` before the
  handler runs; that is existing framework behaviour and is not changed here.
- `500` is logged server-side with a `[KML]` prefix, matching
  `console.error('[PDF] …')` at `src/server.ts:759`.
- No route ever returns `304`, `206` or a redirect; no `Cache-Control` header is
  set (same as `sendPdf`).

## 3. Response headers and filename conventions

### 3.1 Content-Type

    Content-Type: application/vnd.google-earth.kml+xml; charset=utf-8

The IANA-registered KML media type. The `charset` parameter is included because
the document contains non-ASCII characters (`→` in every placemark name, `ã` in
the live trip name) and the XML declaration says UTF-8.

### 3.2 Content-Length

The generator returns a `string`. The route converts once and sends the buffer:

```ts
const buf = Buffer.from(kml, 'utf8');
res.setHeader('Content-Length', String(buf.length));
res.end(buf);
```

`Content-Length` is the **byte** length. Using `kml.length` would under-report
by one byte for every `→` (3 bytes, 1 UTF-16 unit) and truncate the download.
This is not hypothetical: every multi-flight document contains `→`.

### 3.3 Content-Disposition

    Content-Disposition: attachment; filename="flight-63-padq-pape-2026-09-09.kml"

Always `attachment`, always a quoted ASCII filename, no `filename*`/RFC 5987
form (the client reads the plain `filename="…"` with
`/filename="([^"]+)"/`, `client/src/utils/api.ts:38`).

### 3.4 Filename patterns

All three reuse the existing `slugify()` (`src/server.ts:40-51`) and
`dateStamp()` (`src/server.ts:53-57`) unchanged.

| Scope | Pattern | Example |
|---|---|---|
| Flight (§2.1) | `flightExportFilename(flight, 'kml')` | `flight-63-padq-pape-2026-09-09.kml` |
| Flight, no ICAOs (a combined flight) | same helper, route segment omitted | `flight-71-2026-09-09.kml` |
| Trip (§2.2) | `trip-${slugify(trip.name) || trip.id}-${dateStamp(trip.created_at)}.kml` | `trip-circumnavegacao-2026-08-17.kml` |
| Set (§2.3) | `flights-${n}-${dateStamp(earliest start_time)}.kml` | `flights-3-2026-09-07.kml` |

`flightExportFilename` is generalised in place, preserving its current output
for every existing caller:

```ts
function flightExportFilename(flight: Flight, ext: 'pdf' | 'kml' = 'pdf'): string {
  const route = (flight.departure_icao || flight.arrival_icao)
    ? `-${slugify(`${flight.departure_icao ?? 'unknown'}-${flight.arrival_icao ?? 'unknown'}`)}`
    : '';
  return `flight-${flight.id}${route}-${dateStamp(flight.start_time)}.${ext}`;
}
```

The trip pattern is the inline expression already at `src/server.ts:779` with
`.pdf` → `.kml`; it stays inline rather than being extracted, so the PDF line is
not touched.

**The set export has no natural name.** `n` is the number of *distinct,
resolved* flights actually in the document, and the date is
`dateStamp()` of the **earliest** `start_time` among them — deliberately derived
from the data rather than from `Date.now()`, so the same request always yields
the same filename and a test can assert it. With one flight in the set the name
is still `flights-1-….kml`, not the single-flight pattern: the file's shape
(folders) follows the endpoint, so its name should too.

### 3.5 Header sanitising

`sendKml()` is a new function beside `sendPdf()` (`src/server.ts:67-73`) and
applies the **same** sanitising rule, for the same reason: the filename embeds
user-controlled text (a trip name, an aircraft-derived ICAO slug) directly into
a response header, so any quote, backslash, slash, CR or LF must not survive.

```ts
function sendKml(res: express.Response, kml: string, filename: string): void {
  const safeName = filename.replace(/["\\\r\n/]/g, '_');
  const buf = Buffer.from(kml, 'utf8');
  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.end(buf);
}
```

The regex is copied verbatim from `sendPdf`, character for character. In
practice `slugify()` has already stripped everything dangerous, but the guard is
the last line of defence and is not dropped on that argument.

## 4. KML document structure

Namespace: `http://www.opengis.net/kml/2.2`, declared once on the root `<kml>`
element. No other namespace is declared anywhere in the document.

### 4.1 LineString vs gx:Track — LineString

**Frozen: a plain KML 2.2 `<LineString>`.** No `gx:Track`, no
`xmlns:gx="http://www.google.com/kml/ext/2.2"`, no `<when>` elements, no
per-point timestamps.

Time is carried at the Placemark level instead, as a standard KML 2.2
`<TimeSpan>` built from the flight's `start_time` and `end_time` (§4.3). That
gives the Google Earth time slider a per-flight extent — enough to show a trip
leg by leg — without an extension namespace.

Why:

- `gx:Track` is a Google extension. Google Earth animates it beautifully;
  everything else is a lottery. The plain `LineString` is the one geometry every
  KML consumer since 2.0 renders, and this is a *data* export whose consumers we
  do not control.
- `gx:Track` requires `<when>` and `<gx:coord>` to be emitted as two parallel,
  positionally-matched sequences. A drop or an off-by-one in either produces a
  file that still parses and is silently wrong — a bad failure mode for a format
  we cannot open here to check.
- `flight_points.ts` carries milliseconds (`…:35.639Z`). KML's `dateTime` is
  XML Schema `dateTime`, which permits fractional seconds, but viewer support
  for them in `<when>` is uneven; a `gx:Track` design would have to add a
  truncation rule and a test for it. `<TimeSpan>` sidesteps it (§4.3 keeps the
  raw string; a `TimeSpan` that a viewer ignores costs nothing).
- Decimation (§4.7) is trivial on a coordinate list and fiddly on two parallel
  lists.

**Alternative considered — emit both:** a `gx:Track` *and* a `LineString` in the
same Placemark. Rejected: Google Earth would draw the path twice, the file
roughly doubles in size (a trip export is already 1.67 MB), and the two
representations can drift.

**Alternative considered — `?format=track` query parameter** to opt into
`gx:Track`. Rejected as scope: it doubles the generator's surface and its tests
for a feature nobody has asked for. If the user wants animated playback, §9.2
records it as a clean follow-up run — the change is additive and touches only
the generator.

### 4.2 How the three scopes map onto Document / Folder / Placemark

One file per request, always. Never a KMZ, never multiple files.

```
kml
└── Document                       ← always exactly one
    ├── name                       ← §4.3
    ├── Style id="track-0" … "track-4"   ← always all five, §4.4
    └── (case A)  Placemark             ← single flight: no Folder
        (case B/C) Folder → Placemark   ← one Folder per flight, in order
```

| Case | Scope | Document `<name>` | Structure |
|---|---|---|---|
| **A** | one flight (§2.1) | `Flight #63 PADQ → PAPE — 2026-09-09` (i.e. `Flight ` + the label of §4.3) | `Document` → one `Placemark`, no `Folder` |
| **B** | flight set (§2.3) | `Selected flights (3)` — the count is the number of distinct resolved flights | `Document` → one `Folder` per flight → one `Placemark` |
| **C** | trip (§2.2) | the trip's `name`, XML-escaped (`Circumnavegação`) | `Document` → one `Folder` per flight → one `Placemark` |

- **Ordering, cases B and C:** flights are sorted by `start_time` **ascending**,
  ties broken by `id` ascending. This is applied by the generator itself
  (§5.1), so the route, the inspector and the tests cannot disagree. It is
  idempotent for the trip case, whose rows already arrive in that order from
  `src/db.ts:466`. Request order in §2.3 is therefore discarded — a Set in the
  browser has insertion order, which is selection order, which is noise.
- **`Folder` name = `Placemark` name** = the label of §4.3. The duplication is
  deliberate: Google Earth's tree shows the folder name when the folder is
  collapsed and the placemark name when it is open, and one `Folder` per flight
  gives every flight its own visibility checkbox — the thing that makes a
  45-flight trip usable.
- **Case A has no Folder** because a single-flight file with one folder wrapping
  one placemark is noise in the tree.
- **Element order inside `Placemark` is the KML 2.2 XSD `Feature` sequence**:
  `name`, `description`, `TimeSpan`, `styleUrl`, geometry. Not alphabetical, not
  convenient order — a strict parser rejects the others. Inside `Document`:
  `name`, then the `Style` elements, then the features.
- **No `<open>`, `<visibility>`, `<Snippet>`, `<LookAt>` or `<ExtendedData>`.**
  Considered and rejected: `<LookAt>` would force a bounding-box computation
  with its own edge cases (antimeridian, single point) for a view Google Earth
  computes for itself.
- **Considered and rejected: departure/arrival pin Placemarks** (a green start
  pin and a red end pin per flight). Genuinely nice in Google Earth, but it
  triples the placemark count, needs two more `<Style>`s with icon hrefs
  pointing at Google's CDN, and is not in the intake's success criteria.
  Follow-up material (§9.2).

**The literal document.** This is a real, validated case-B export of two real
flights from the live database, cut to three points each so it is readable.
Every coordinate below is a real row. An implementer can copy this shape without
another decision; the only differences at full size are more coordinate lines
and more folders.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Selected flights (2)</name>
  <Style id="track-0">
    <LineStyle><color>fffaa560</color><width>3</width></LineStyle>
  </Style>
  <Style id="track-1">
    <LineStyle><color>ff99d334</color><width>3</width></LineStyle>
  </Style>
  <Style id="track-2">
    <LineStyle><color>ff0b9ef5</color><width>3</width></LineStyle>
  </Style>
  <Style id="track-3">
    <LineStyle><color>fffa8ba7</color><width>3</width></LineStyle>
  </Style>
  <Style id="track-4">
    <LineStyle><color>ff7171f8</color><width>3</width></LineStyle>
  </Style>
  <Folder>
    <name>#59 PANC → PADQ — 2026-09-07</name>
    <Placemark>
      <name>#59 PANC → PADQ — 2026-09-07</name>
      <description><![CDATA[<table><tr><th>Aircraft</th><td>Carenado C182Q N738RK</td></tr><tr><th>From</th><td>PANC</td></tr><tr><th>To</th><td>PADQ</td></tr><tr><th>Start</th><td>2026-09-07T22:55:19.474Z</td></tr><tr><th>End</th><td>2026-09-08T01:11:41.635Z</td></tr><tr><th>Duration</th><td>2h 16m</td></tr><tr><th>Distance</th><td>252.1 nm</td></tr><tr><th>Max altitude</th><td>2506 ft</td></tr><tr><th>Track points</th><td>3</td></tr></table>]]></description>
      <TimeSpan><begin>2026-09-07T22:55:19.474Z</begin><end>2026-09-08T01:11:41.635Z</end></TimeSpan>
      <styleUrl>#track-0</styleUrl>
      <LineString>
        <extrude>0</extrude>
        <tessellate>0</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>
          -149.984045,61.167890,38.9
          -152.017963,59.427381,760.3
          -152.496094,57.751028,12.7
        </coordinates>
      </LineString>
    </Placemark>
  </Folder>
  <Folder>
    <name>#63 PADQ → PAPE — 2026-09-09</name>
    <Placemark>
      <name>#63 PADQ → PAPE — 2026-09-09</name>
      <description><![CDATA[<table><tr><th>Aircraft</th><td>Black Square 208B Grand Caravan Default Red</td></tr><tr><th>From</th><td>PADQ</td></tr><tr><th>To</th><td>PAPE</td></tr><tr><th>Start</th><td>2026-09-09T00:44:26.913Z</td></tr><tr><th>End</th><td>2026-09-09T02:35:35.640Z</td></tr><tr><th>Duration</th><td>1h 51m</td></tr><tr><th>Distance</th><td>272.3 nm</td></tr><tr><th>Max altitude</th><td>10080 ft</td></tr><tr><th>Track points</th><td>3</td></tr></table>]]></description>
      <TimeSpan><begin>2026-09-09T00:44:26.913Z</begin><end>2026-09-09T02:35:35.640Z</end></TimeSpan>
      <styleUrl>#track-1</styleUrl>
      <LineString>
        <extrude>0</extrude>
        <tessellate>0</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>
          -152.488563,57.749284,20.8
          -156.288925,56.691826,3035.1
          -159.159853,55.909142,14.1
        </coordinates>
      </LineString>
    </Placemark>
  </Folder>
</Document>
</kml>
```

Note the folders are in `start_time` order (#59 on 09-07 before #63 on 09-09)
even though the request was `{"ids":[63,59]}` — that is §4.2's sort, and the
style index follows the *output* position, not the request position.

Whitespace and indentation are as shown (two spaces per level; coordinates
indented under `<coordinates>`, one per line). It is not semantically
meaningful, but freezing it keeps diffs and test fixtures stable. The document
ends with a single trailing newline after `</kml>`.

### 4.3 Placemark metadata and where it comes from

Two derived strings, both defined here and nowhere else.

**Label** (used as both `<Folder><name>` and `<Placemark><name>`, and as part of
the case-A document name):

    #<id> <DEP> → <ARR> — <YYYY-MM-DD>

- `<id>` — `Flight.id`.
- `<DEP>` — `Flight.departure_icao`, or the literal `????` when null.
- `<ARR>` — `Flight.arrival_icao`, or `????` when null.
- The separator is U+2192 RIGHTWARDS ARROW with a space either side, matching
  the client's own route rendering (`client/src/pages/Home.tsx:173`).
- `— <date>` is an em dash, a space, then `dateStamp`-equivalent logic on
  `Flight.start_time`: `new Date(start_time).toISOString().slice(0,10)`, or the
  literal `unknown date` if `start_time` is missing or unparseable. (The
  generator implements this itself — it must not import `src/server.ts`.)
- Examples: `#63 PADQ → PAPE — 2026-09-09`; for a combined flight,
  `#71 ???? → ???? — 2026-09-09`.

**Description** — a CDATA-wrapped HTML table, so Google Earth's balloon renders
it as a table rather than a run-on line. Exactly these nine rows, in this order,
every time (no row is ever omitted, so the balloon has a fixed shape):

| Row label | Source | Rendering when null / absent |
|---|---|---|
| `Aircraft` | `Flight.aircraft` | `Unknown` |
| `From` | `Flight.departure_icao` | `Unknown` |
| `To` | `Flight.arrival_icao` | `Unknown` |
| `Start` | `Flight.start_time`, raw ISO string | `Unknown` |
| `End` | `Flight.end_time`, raw ISO string | `In progress` |
| `Duration` | `Flight.duration_sec` → `${h}h ${m}m`, or `${m}m` when `h === 0`; `h = Math.floor(s/3600)`, `m = Math.floor((s%3600)/60)` | `Unknown` |
| `Distance` | `Flight.distance_nm` → `${n.toFixed(1)} nm` | `Unknown` |
| `Max altitude` | `Flight.max_altitude_ft` → `${Math.round(n)} ft` | `Unknown` |
| `Track points` | the number of coordinates **actually emitted** (post-decimation, §4.7) | `0` |

Markup, verbatim:
`<table><tr><th>LABEL</th><td>VALUE</td></tr>…</table>`, wrapped in
`<![CDATA[ … ]]>`. Both the label and the value pass through `escapeXml()`
(§4.6) before interpolation.

Timestamps are the raw UTC strings from the database. They are **not**
localised: the server's timezone is not the user's (the PDF path forwards
`tz`/`locale` for exactly this reason), and a KML file is a durable artifact
that may be opened anywhere, so UTC with an explicit `Z` is the honest choice.

`Flight.notes`, `flight_plan_name`, `max_airspeed_kts`, `planned_leg_id` and the
`departure_lat/lon`, `arrival_lat/lon` columns are **not** exported. They add
balloon noise without adding anything the track does not already show.

**`<TimeSpan>`** — emitted only when `start_time` is a non-empty string:

```xml
<TimeSpan><begin>{start_time}</begin><end>{end_time}</end></TimeSpan>
```

`<end>` is omitted when `end_time` is null (an in-progress flight): a `TimeSpan`
with only a `begin` is valid and means "from then on". When `start_time` itself
is missing the whole element is omitted.

### 4.4 Styles

Five `<Style>` elements, `id="track-0"` … `id="track-4"`, are emitted in **every
document** including the single-flight case. Always all five: a fixed prelude is
one less thing to compute, costs ~330 bytes, and keeps the styles' ids stable
across scopes.

```xml
<Style id="track-N">
  <LineStyle><color>AABBGGRR</color><width>3</width></LineStyle>
</Style>
```

- **Width 3** for every style. Thick enough to see against terrain, thin enough
  not to smear at trip zoom.
- **Colours** are the client's existing leg palette from
  `client/src/pages/Home.tsx:154`
  (`#60a5fa`, `#34d399`, `#f59e0b`, `#a78bfa`, `#f87171`) converted to KML's
  `aabbggrr` byte order with full opacity, so a trip's legs are the same colours
  in Google Earth as on the app's own map:

  | Index | CSS | KML `<color>` |
  |---|---|---|
  | 0 | `#60a5fa` | `fffaa560` |
  | 1 | `#34d399` | `ff99d334` |
  | 2 | `#f59e0b` | `ff0b9ef5` |
  | 3 | `#a78bfa` | `fffa8ba7` |
  | 4 | `#f87171` | `ff7171f8` |

  Note the byte order: KML is `alpha, blue, green, red` — the *reverse* of CSS
  hex. Getting this wrong is invisible in a well-formedness check and shows up
  only as wrong colours, so §8 asks for the literal string to be asserted.
- **Colour cycling: yes, for sets and trips.** The Placemark at output position
  `i` uses `#track-${i % 5}`. `i` is the index *after* the §4.2 sort, so the
  colour sequence is a function of the document, not of the request.
- The single-flight document always uses `#track-0`.
- **No `PolyStyle`, `IconStyle`, `BalloonStyle` or `<StyleMap>`** — there are no
  polygons, no icons, and the default balloon renders the §4.3 table correctly.
- Alternative considered: one colour per flight derived from a hash of the id,
  so a given flight is always the same colour across exports. Rejected — two
  adjacent legs could land on near-identical colours, which is the exact problem
  the cycle solves, and the app's own map already cycles.

### 4.5 Coordinate encoding

Inside `<coordinates>`, one point per line, each line

    lon,lat,alt

with **no spaces around the commas** — a space inside a coordinate tuple ends
the tuple in KML. Tuples are separated by a newline plus indentation (whitespace
between tuples is free).

| Rule | Frozen value | Reason |
|---|---|---|
| Order | `lon,lat,alt` | KML is longitude-first. The reverse produces a plausible-looking file pointing at the wrong hemisphere; §8 makes the tests bite on it. |
| Longitude precision | `toFixed(6)` | ~11 cm at the equator, far below GPS noise |
| Latitude precision | `toFixed(6)` | as above |
| Altitude unit | **metres** — `altitude_ft * 0.3048` | KML altitudes are always metres |
| Altitude precision | `toFixed(1)` | 10 cm; `altitude_ft` is a float (`46.354595…`) so some rounding is required, and one decimal keeps the file ~8 % smaller than three |
| Conversion constant | `0.3048` exactly, as a named constant `FT_TO_M` | the international foot; no other value is acceptable |
| `<altitudeMode>` | `absolute` | Altitudes are MSL from the sim. `clampToGround` throws away the whole vertical profile; `relativeToGround` would need terrain we do not have. |
| `<extrude>` | `0` | A curtain wall down to the ground looks striking but hides the terrain under a long track and doubles the visual weight of a 45-leg trip. Considered, rejected; it is a one-character change if the user asks. |
| `<tessellate>` | `0` | Tessellation only affects ground-clamped geometry; with `absolute` it is a no-op, and `0` says so honestly. |
| Trailing values | none | no fourth field, no `\r` |

Both `<extrude>` and `<tessellate>` are emitted explicitly rather than left to
default, so the file states its intent to a reader.

Worked example, from a real row (`flight_points.id = 49820`):
`lat 55.90914215639822`, `lon -159.15985271873274`, `altitude_ft
46.35459507171225` →

    -159.159853,55.909142,14.1

(`46.35459507171225 × 0.3048 = 14.1289…` → `14.1`.)

No coordinate filtering of any kind: points are emitted in `ts ASC` order
exactly as the query returned them. No de-duplication of repeated positions, no
smoothing, no on-ground trimming, no altitude flooring at zero. The export is
the recorded track, not a cleaned-up version of it.

### 4.6 XML escaping

**Exactly one function**, `escapeXml(value: string): string`, is applied to
**every** interpolated string in the document, without exception:

```ts
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

`&` must be replaced first, or the ampersands of the later replacements get
double-escaped.

Applied to: the `Document` `<name>` (trip names are user-supplied —
`Circumnavegação`, but also anything the user types), every `<Folder><name>`,
every `<Placemark><name>`, every `<th>` label and `<td>` value inside the
description, and both `<TimeSpan>` values. Numbers formatted by the generator
(coordinates, ids, style indices) are produced from `number` values and cannot
contain markup, so they are not escaped — but anything that arrives as a
`string` from the database is, unconditionally, even when it "cannot" contain a
special character.

**The CDATA rule.** The description is wrapped in `<![CDATA[ … ]]>` so Google
Earth renders it as HTML. Escaping is applied to the values *before* wrapping,
which is not redundant: it is what makes the wrapper safe. Because `>` is always
escaped to `&gt;`, the sequence `]]>` can never appear inside the CDATA block,
so the block can never be terminated early. Verified against a real
`aircraft` value doctored to `A&B <x> "q" 'z' ]]>` — the output contained
`A&amp;B &lt;x&gt; &quot;q&quot; &apos;z&apos; ]]&gt;` and
`XMLValidator.validate` returned `true`.

Within CDATA, an HTML renderer decodes `&amp;` back to `&`, so the balloon shows
the original text. That is the intended round trip.

**Control characters.** XML 1.0 forbids most C0 control characters even when
escaped. Any character with a code point below U+0020 other than tab (U+0009),
LF (U+000A) and CR (U+000D) is **dropped** by `escapeXml` before the
replacements above. No such value exists in the live database, but a pasted note
could carry one and it would make the whole file unparseable.

### 4.7 Decimation

**Threshold: 5 000 points per flight.** Below or at it, every point is emitted.

Rule, precise enough to implement twice:

```
MAX_TRACK_POINTS = 5000
if points.length <= MAX_TRACK_POINTS: emit all points, in order
else:
  stride = Math.ceil(points.length / MAX_TRACK_POINTS)     // integer ≥ 2
  out = [points[i] for i in 0, stride, 2*stride, … while i < points.length]
  if out[out.length-1] !== points[points.length-1]: out.push(points[points.length-1])
  emit out
```

Properties: the first point is always kept; the last point is always kept, so
the track ends where the flight ended; output length ≤ `MAX_TRACK_POINTS + 1`;
the result is a deterministic function of the input array alone.

Why 5 000, and why decimate at all:

- The largest flight in the user's database today is **2 242** points, so **no
  real flight is decimated** at this threshold. The rule is a guard against a
  pathological future track (a very long haul, or a faster sample rate), not a
  behaviour the user will see now. Any lower threshold would change today's
  output, which is the wrong trade for a logbook.
- 5 000 points is ~200 KB of coordinates, which every KML viewer handles
  comfortably.
- The count in the description's `Track points` row (§4.3) is the emitted count,
  not the stored count, so a decimated file says so.

The trip scope applies the rule **per flight**, not to the document as a whole:
a 45-flight trip may legitimately contain 42 501 coordinates in total (1.67 MB,
built in 284 ms — measured, §0) and no flight of it is decimated.

## 5. Module API

### 5.1 src/kmlExport.ts — exported surface

`src/kmlExport.ts` **imports nothing from `./db`**, nothing from `./server`,
nothing from `./index`, and performs no I/O — no `fs`, no `http`, no
`better-sqlite3`. It is a pure module in the style of `src/geo.ts` and
`src/lnmpln.ts`: values in, string out.

It also **imports nothing from `./types`.** The input types are declared
structurally in this file. Two reasons: it keeps the module standalone (T-003's
grep for `from './db'` is only half the point — the module should be liftable
into a test with no other source file), and it lets `tests/kmlExport.test.ts`
build a two-field point and a nine-field flight instead of a full 20-column
`Flight` row. `FlightWithPoints` from `src/types.ts` is structurally assignable
to `KmlFlight` (every field below exists on `Flight` with the same type, and
`FlightPoint` is a superset of `KmlPoint`), so `src/server.ts` can pass
`getFlightById(id)!` and `trip.flights` straight in with no cast and no mapping.
That assignability was checked, not assumed: the declarations below plus
`const _a: KmlFlight = f` for a `declare const f: FlightWithPoints` pass
`tsc --noEmit --strict` against the real `src/types.ts` (§0).

```ts
// ── Input types (structural; FlightWithPoints from ./types satisfies KmlFlight) ──

/** The subset of FlightPoint the generator reads. */
export interface KmlPoint {
  lat: number;
  lon: number;
  /** Feet MSL, as stored. Converted to metres on output — design §4.5. */
  altitude_ft: number;
}

/** The subset of FlightWithPoints the generator reads. */
export interface KmlFlight {
  id: number;
  aircraft: string | null;
  departure_icao: string | null;
  arrival_icao: string | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  points: KmlPoint[];
}

/** Body of POST /api/flights/export.kml — design §2.3. Imported by src/server.ts. */
export interface KmlFlightSetRequest {
  ids: number[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** design §2.3 — maximum ids accepted by the flight-set endpoint. */
export const MAX_FLIGHT_SET_IDS = 100;

/** design §4.7 — per-flight coordinate cap before decimation kicks in. */
export const MAX_TRACK_POINTS = 5000;

/** design §4.5 — international foot. */
export const FT_TO_M = 0.3048;

// ── Generators ───────────────────────────────────────────────────────────────

/**
 * One flight, no Folder wrapper. design §4.2 case A.
 * A flight with zero points yields a geometry-less Placemark (§6.1).
 */
export function buildFlightKml(flight: KmlFlight): string;

/**
 * An arbitrary set of flights, one Folder each. design §4.2 case B.
 * Sorts by start_time asc, id asc; does NOT de-duplicate (the caller does, §2.3).
 */
export function buildFlightSetKml(flights: KmlFlight[]): string;

/**
 * A whole trip, one Folder per flight. design §4.2 case C.
 * `tripName` becomes the Document <name>, escaped.
 */
export function buildTripKml(tripName: string, flights: KmlFlight[]): string;

// ── Helpers, exported for tests and for the inspector ────────────────────────

/** design §4.6. The single escaping rule; used at every interpolation point. */
export function escapeXml(value: string): string;

/** design §4.3. `#63 PADQ → PAPE — 2026-09-09`. */
export function flightLabel(flight: KmlFlight): string;

/** design §4.7. Pure, deterministic, first and last point always retained. */
export function decimateTrack<T>(points: T[], max?: number): T[];
```

Notes binding on the implementation:

- `buildFlightSetKml` and `buildTripKml` apply the §4.2 sort themselves. They
  must not mutate the array they are given (`[...flights].sort(...)`).
- All three return a `string` ending in `</kml>\n`. Encoding to a `Buffer` is the
  route's job (§3.2), not the generator's.
- Nothing throws. There is no input this module rejects: null metadata, zero
  points and an empty flight array all have defined output (§6). A thrown error
  from here would surface as a `500` (§2.4), which should therefore never
  happen in practice.
- No mutable module-level state, no clock, no randomness: the same input always
  produces a byte-identical string. This is what lets §8's tests assert on
  literal fragments.

### 5.2 What src/server.ts imports

```ts
import {
  buildFlightKml, buildFlightSetKml, buildTripKml,
  MAX_FLIGHT_SET_IDS,
  type KmlFlightSetRequest,
} from './kmlExport';
```

`src/server.ts` owns: id parsing and validation (§2.4), calling
`getFlightById()` / `getTripById()`, de-duplicating the id list, filename
construction (§3.4) and `sendKml()` (§3.5). It assembles no XML.

The set endpoint composes `getFlightById()` once per distinct id — the frozen
constraint that `src/db.ts` is not edited (see §9.1). At the 100-id cap that is
200 prepared-statement executions on a local SQLite file; the measured cost of
reading all 45 flights and all 42 501 points was 284 ms including string
building (§0), so no bulk query is needed.

### 5.3 src/inspect-kml.ts — CLI argument surface

```
Usage: npx ts-node src/inspect-kml.ts --db <path-to-flights.db> (--flight <id> | --trip <id> | --flights <id,id,…>) [--out <file>]
```

| Argument | Required | Meaning |
|---|---|---|
| `--db <path>` | **yes** | Path to a **copy** of `flights.db` (or to the directory containing one). |
| `--flight <id>` | one of the three | Single-flight document (§4.2 case A) |
| `--trip <id>` | one of the three | Trip document (case C) |
| `--flights <id,id,…>` | one of the three | Flight-set document (case B); same de-dup and sort as §2.3/§4.2 |
| `--out <file>` | no | Write the document here instead of stdout |

Behaviour:

- **`--db` is mandatory.** With no `--db`, with more than one scope flag, or
  with none, the tool prints a one-line usage message to stderr and exits `2` —
  never a stack trace.
- The path is resolved; if its basename is `flights.db` the tool `chdir`s to its
  directory, otherwise it treats the path as a directory and `chdir`s there. It
  then prints the resolved database path to **stderr** so the operator can see
  which file was opened, and only then does `require('./db')`.
- **Why `chdir` and not a flag:** `src/db.ts:9` freezes
  `DB_PATH = path.join(process.cwd(), 'flights.db')` at module load, so `./db`
  must not be imported at the top of the file. The `require()` after the
  `chdir` is the first import of that module in the process — the same idiom,
  and the same reason, as `src/inspect-legmatch.ts:404-423`, whose comment
  should be referenced.
- **`--db` is mandatory because `initDb()` writes.** `src/db.ts:37-40` opens the
  file read-write, sets `journal_mode = WAL` and runs `CREATE TABLE IF NOT
  EXISTS` migrations. Pointing this tool at the live `flights.db` would write to
  the user's logbook, which is a standing non-negotiable. Requiring an explicit
  path makes that impossible to do by accident.
- An unknown flight or trip id prints `Flight <id> not found` (or
  `Trip <id> not found`) to stderr and exits `1`. No stack trace.
- On success the document goes to stdout **and nothing else does** — every
  diagnostic goes to stderr, so `npx ts-node src/inspect-kml.ts … | node -e
  '…XMLValidator…'` works without filtering. Exit `0`.

## 6. Edge cases

Each row is a frozen behaviour, not a suggestion. §8's tests name them.

### 6.1 Flight with zero points

`Placemark` is still emitted, with `<name>`, `<description>` (`Track points`
row reads `0`) and `<TimeSpan>`, and **no geometry element at all** — no
`LineString`, no empty `<coordinates>`. A `Placemark` with no geometry is valid
KML 2.2 and appears in the viewer's tree as a nameable, un-locatable item.

Rejected alternative: emitting `<LineString><coordinates></coordinates>
</LineString>`. It validates as XML but a `LineString` with fewer than two
coordinates is not a line, and viewers behave inconsistently with it. Also
rejected: omitting the flight entirely — the user asked for those flights, and
a silently missing folder is worse than an empty one.

In the trip and set scopes the flight still gets its `Folder`, and it still
consumes a colour index (§4.4), so removing points from a flight does not
recolour its neighbours.

### 6.2 Flight with exactly one point

Geometry is a `<Point>`, not a `LineString`:

```xml
<Point>
  <altitudeMode>absolute</altitudeMode>
  <coordinates>-152.488563,57.749284,20.8</coordinates>
</Point>
```

Same `lon,lat,alt` encoding and precision as §4.5. No `extrude`/`tessellate`
(not meaningful on a Point). Everything else about the Placemark is unchanged.

### 6.3 Null `departure_icao` / `arrival_icao` / `aircraft`

Combined flights (`combineFlights()`) have no ICAO codes; the PDF path already
handles this at `src/server.ts:60-63`.

- In the **label** (§4.3): a null ICAO renders as `????`, giving
  `#71 ???? → ???? — 2026-09-09`.
- In the **description**: `From`/`To`/`Aircraft` render as `Unknown`.
- In the **filename** (§3.4): the existing `flightExportFilename` logic drops
  the route segment entirely when both are null → `flight-71-2026-09-09.kml`.
- The literal strings `null` and `undefined` must never appear in the output.
  §8 greps for them.

### 6.4 Null `end_time` (in-progress flight)

- `<TimeSpan>` carries `<begin>` only, no `<end>` (§4.3).
- The description's `End` row reads `In progress`.
- `duration_sec`, `distance_nm` and `max_altitude_ft` are typically also null on
  such a flight; each renders `Unknown` per §4.3.
- The track is whatever points have been recorded so far. The export is a
  snapshot; nothing streams and nothing waits for the flight to end.

### 6.5 Unknown or non-numeric ids

- Non-numeric path id (`/api/flights/abc/export.kml`): `400 {"error":"Invalid
  id"}` — `parseInt` → `NaN`, exactly as the PDF routes.
- Unknown path id: `404 {"error":"Flight not found"}` / `{"error":"Trip not
  found"}`.
- In the set body: any element failing `Number.isInteger` (including `"63"` as a
  string, `63.5`, `null`, `true`, `NaN`) rejects the whole request with `400
  {"error":"ids must be an array of integers"}`. The check is
  `Number.isInteger`, matching `src/server.ts:166`.
- An unknown id inside an otherwise valid set: `404 {"error":"Flight 42 not
  found"}` for the **first** unresolved id in request order. No partial
  document is ever returned.

### 6.6 Empty id array, and a list over the cap

- `{"ids":[]}` → `400 {"error":"ids must contain at least one flight id"}`.
- `{}` or `{"ids":"63"}` or a JSON array as the top-level body → `400
  {"error":"ids must be an array of integers"}`.
- `ids.length > 100` → `400 {"error":"Too many flights: 137 requested, maximum
  is 100"}`. The cap is checked on the raw length, before de-duplication, so
  `{"ids":[1,1,1,…×137]}` is rejected too.
- The client never sends more than 100 (§7.4 blocks it), so this path exists for
  `curl` and for a stale page.

### 6.7 Duplicates, and a trip with no flights

- `{"ids":[63,63,59]}` → one folder for #63, one for #59. First occurrence
  wins; the duplicate is dropped before any lookup, so it is not counted against
  anything and does not affect the filename's `n` (§3.4).
- A trip with zero flights → `200`, a `Document` with a `<name>` and the five
  styles and no features (§2.2).
- A set that resolves to one flight → still case B (a single `Folder`) and still
  the `flights-1-….kml` filename (§3.4).

## 7. Client contract

### 7.1 client/src/utils/api.ts — the download helper

The fetch → Blob → synthetic `<a download>` plumbing moves into one private
function; `downloadPdf` keeps its exact exported signature so **neither existing
call site is edited** (`FlightDetail.tsx:215`, `TripDetail.tsx:129`).

```ts
/** Everything the download plumbing needs. Private to this module. */
type DownloadInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/**
 * fetch → Blob → synthetic <a download>. The only place in the client that
 * calls URL.createObjectURL. Reads the filename from Content-Disposition,
 * falls back to `fallbackName`. Throws Error(body.error ?? statusText) on a
 * non-2xx so the caller can render a message instead of navigating to JSON.
 */
async function download(url: string, fallbackName: string, init?: DownloadInit): Promise<void>;

/** UNCHANGED SIGNATURE. Builds tz/locale/plans params, then delegates. */
export async function downloadPdf(
  path: string,
  fallbackName: string,
  opts?: { includePlans?: boolean },
): Promise<void>;

/** GET a .kml endpoint (§2.1, §2.2). No query parameters are sent. */
export async function downloadKml(path: string, fallbackName: string): Promise<void>;

/** POST /api/flights/export.kml with {ids} (§2.3). */
export async function downloadFlightSetKml(ids: number[]): Promise<void>;
```

- `downloadFlightSetKml` posts to the literal path `/api/flights/export.kml`
  with `headers: { 'Content-Type': 'application/json' }` and
  `body: JSON.stringify({ ids })`, and passes a fallback name of
  `flights-${ids.length}.kml` (used only if the server's
  `Content-Disposition` is missing, which it never is — §3.3).
- `downloadPdf`'s body moves *inside* it unchanged: same `URLSearchParams`, same
  `tz`/`locale` try/catch, same `plans=0` rule, same `` `${path}?${params}` ``
  URL. Only the last four statements (fetch, error check, blob, anchor) are
  replaced by a call to `download`. Its observable behaviour is identical
  (§1.3 item 7).
- `URL.createObjectURL` must appear exactly once in `client/src/`, inside
  `download`.
- The existing `apiFetch` is not touched.

### 7.2 FlightDetail.tsx

A second button immediately after the existing "Export PDF" button
(`client/src/pages/FlightDetail.tsx:437-439`), inside the same
`<div className="flight-actions">`, before the include-flight-plan label.

- Copy: **`Export KML`**; while pending, **`Exporting KML…`** (ellipsis
  character `…`, matching `Generating PDF…`).
- `className="btn btn-ghost"` — same as the PDF button.
- New state `const [exportingKml, setExportingKml] = useState(false)`, separate
  from `exporting`, so a KML export does not disable the PDF button or vice
  versa. `disabled={exportingKml}`.
- Handler:
  ```ts
  async function handleExportKml() {
    setExportingKml(true);
    setExportError('');
    try {
      await downloadKml(`/api/flights/${id}/export.kml`, `flight-${id}.kml`);
    } catch (err) {
      setExportError('Export failed: ' + (err as Error).message);
    } finally {
      setExportingKml(false);
    }
  }
  ```
- Errors reuse the existing `exportError` state and its `<span
  className="edit-error">` at line 453 — no new error element.
- The include-flight-plan checkbox stays bound to `exporting` only; KML ignores
  flight plans (§1.3 item 9).

### 7.3 TripDetail.tsx

Identical treatment beside `client/src/pages/TripDetail.tsx:734-736`: same copy,
same `btn btn-ghost`, its own `exportingKml` state, shared `exportError`, and a
handler that differs from §7.2's only in its call:

```ts
await downloadKml(`/api/trips/${id}/export.kml`, `trip-${id}.kml`);
```

The button is placed between the "Export PDF" button and the
include-flight-plans label, so "Delete Trip" stays last in the row.

### 7.4 Home.tsx multi-select toolbar

One more button in the `combine-toolbar` div
(`client/src/pages/Home.tsx:196-221`), placed **after** "Combine Selected" so the
existing buttons keep their positions.

```tsx
<button className="btn btn-ghost" disabled={exportingKml} onClick={handleExportKml}>
  {exportingKml ? 'Exporting KML…' : 'Export KML'}
</button>
```

- **With 0 selected: nothing.** The whole toolbar is already wrapped in
  `{n > 0 && (…)}` at line 196, so the action cannot be reached with an empty
  selection. That condition is not changed, and no new empty-state UI is added.
  The handler still guards `if (selectedIds.size === 0) return;` — a cheap
  defence, since `n` and `selectedIds` are the same source of truth.
- **With more than 100 selected**, the handler does not call the API: it
  `alert()`s `Select at most 100 flights to export.` and returns. This mirrors
  the page's existing failure idiom (`handleNewTrip`/`handleAddToTrip` both use
  `alert`); Home has no inline error element and this design does not add one.
- Handler:
  ```ts
  async function handleExportKml() {
    if (selectedIds.size === 0) return;
    if (selectedIds.size > 100) { alert('Select at most 100 flights to export.'); return; }
    setExportingKml(true);
    try {
      await downloadFlightSetKml([...selectedIds]);
    } catch (err) {
      alert('Export failed: ' + (err as Error).message);
    } finally {
      setExportingKml(false);
    }
  }
  ```
- **The selection is not cleared** after a successful export. Exporting is
  non-destructive, unlike "New Trip"/"Add to Trip", which clear because the rows
  have moved.
- No change to `toggleCheck`, to the `combinable` rule (`point_count === 0` rows
  stay un-checkable), or to the `disabled={n !== 2}` on "Combine Selected".
- Request order does not matter (§4.2 sorts), so `[...selectedIds]` is passed
  as-is.

### 7.5 Shared types across the wire

There are **no shared TypeScript types between server and client for this
feature**, and none are added. The client sends `{ ids: number[] }` as a literal
object and consumes an opaque `Blob`; `KmlFlightSetRequest` (§5.1) exists on the
server side only, for `src/server.ts` to type its `req.body` cast. The client
does not import from `src/` (it has its own `client/src/types.ts`), and this run
does not change that.

## 8. Verification plan

Every command below is prefixed with the Node 20 selector, because the default
`node` on this machine is v26 and `better-sqlite3` will not load under it:

    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20

**Standing rules for every task in this run** (`.claude/ENVIRONMENT.md`, and
`plan.json`'s frozen decisions):

- Never stop, restart, rebuild over or reconfigure the user's server on port
  **3000**, and never write to the repo's `flights.db`.
- Any server a task starts runs on **port 3100**, from a scratch directory,
  against a **copy** of the database:
  `S="$SCRATCH/app"; mkdir -p "$S"; cp flights.db flights.db-wal flights.db-shm "$S/" 2>/dev/null; for x in dist client node_modules flight_plans airports.json; do ln -sfn "$PWD/$x" "$S/$x"; done; (cd "$S" && PORT=3100 node dist/index.js &)`
  — and it is killed when the task ends. There is no `DB_PATH` env var: the
  server must be *run from* the scratch directory (`src/db.ts:9`,
  `src/server.ts:108,788` all resolve from `process.cwd()`).
- `md5sum flights.db` before and after, identical, in any task that ran a server
  or the inspector.

### 8.1 T-003 — generator and inspector

- `grep -nE "from '\./(db|server|index)'" src/kmlExport.ts` prints nothing.
- `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null; npx tsc --noEmit` exits 0.
- `cp flights.db flights.db-wal flights.db-shm "$SCRATCH/" 2>/dev/null` before any inspector call; `md5sum flights.db` before and after, identical.
- `grep -n "cwd\|chdir\|DB_PATH\|--db" src/inspect-kml.ts` shows the scratch-selection mechanism (§5.3).
- `npx ts-node src/inspect-kml.ts --db "$SCRATCH/app/flights.db" --flight <a real id with points>` — first element declares the KML 2.2 namespace, and the coordinate count equals `select count(*) from flight_points where flight_id=?` on the scratch DB (both numbers reported). Reference value from §0: flight 63 → 1 201.
- `npx ts-node src/inspect-kml.ts --db "$SCRATCH/app/flights.db" --trip <a real trip id>` and `--flights <id>,<id>,<id>` — one labelled container per flight, in §4.2 order; container names reported.
- Each output piped to
  `node -e "const {XMLValidator}=require('fast-xml-parser');const s=require('fs').readFileSync(0,'utf8');console.log(JSON.stringify(XMLValidator.validate(s)))"`
  prints `true`.
- §6 edge cases through the inspector or a scratch driver: zero-point,
  one-point, null ICAOs — valid XML with no literal `null`/`undefined` (show the
  grep).
- A value containing `& < > " '` is exported and still validates, escaped per
  §4.6.
- `npx ts-node src/inspect-kml.ts` with no arguments, and with an unknown id,
  each print one line and exit non-zero (`echo $?` shown), no stack trace.
- `git diff --stat package.json package-lock.json` is empty.

### 8.2 T-004 — routes

- `grep -n "export.kml\|app.get('\*'" src/server.ts` shows all three KML routes
  at line numbers strictly less than the catch-all's.
- `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null; npx tsc --noEmit && npm run build:server` exits 0.
- Scratch server per the recipe above; start and shutdown both shown.
- `curl -si localhost:3100/api/flights/<id>/export.kml` → 200 with the §3
  headers; header block quoted verbatim.
- `curl -si localhost:3100/api/trips/<id>/export.kml` → 200, one labelled
  container per flight, count matching the trip's flight count.
- The set endpoint called with the exact §2.3 shape (full curl command
  reported) → 200, one container per requested id.
- Every body piped through
  `node -e "const {XMLValidator}=require('fast-xml-parser');console.log(JSON.stringify(XMLValidator.validate(require('fs').readFileSync(0,'utf8'))))"`
  prints `true`.
- Each §2.4 failure mode shown: non-numeric id, unknown flight id, unknown trip
  id, missing/empty id array, non-array body, over-cap list, and a list mixing
  valid and unknown ids.
- Regression: `curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/api/flights/<id>/export.pdf localhost:3100/api/trips/<id>/export.pdf`
  still 200 for both; `curl -s localhost:3100/flights/<id> | head -c 200` still
  returns the SPA `index.html`.
- `md5sum flights.db` identical before and after;
  `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/status` still 200
  with the same PID serving it.
- `git diff --name-only` lists `src/server.ts` and nothing else.

### 8.3 T-005 — unit tests

- `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null; npm test` exits 0; summary line and the number of tests added quoted.
- `npm run test:types` exits 0.
- One test each: single-flight happy path; multi-flight set with per-flight
  containers in the §4.2 order; whole trip in `start_time` order; zero-point
  flight (§6.1); one-point flight (§6.2); null
  `departure_icao`/`arrival_icao`/`aircraft`/`end_time` (§6.3, §6.4); a value
  containing `& < > " '` (§4.6); coordinate encoding — `lon,lat,alt` order with
  the feet-to-metres conversion and precision of §4.5 asserted on an exact known
  value (use `lat 55.90914215639822, lon -159.15985271873274, altitude_ft
  46.35459507171225` → `-159.159853,55.909142,14.1`).
- Every generated document asserted well-formed via
  `XMLValidator.validate(...) === true`.
- Hermetic: `grep -nE "from '\.\./src/db'|require\('better-sqlite3'\)|fetch\(|readFileSync|http" tests/kmlExport.test.ts`
  prints nothing beyond an allowed `fast-xml-parser` import.
- Mutation check: swap lat/lon order in `src/kmlExport.ts`, `npm test`, report
  the failing test names, `git checkout -- src/kmlExport.ts`, re-run green.
- `git diff --name-only` lists `tests/kmlExport.test.ts` and nothing else.

Additionally worth asserting, and cheap: the literal `<color>fffaa560</color>`
(§4.4 byte order) and the absence of the string `xmlns:gx` (§4.1).

### 8.4 T-007 — client

- `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null; npm run build` exits 0.
- `grep -rn "Export KML" client/src/pages/` shows one occurrence in each of
  `FlightDetail.tsx`, `TripDetail.tsx`, `Home.tsx`.
- `grep -rl "Export KML" client/dist/assets/*.js` matches at least one built
  bundle.
- `grep -n "createObjectURL" client/src -r` shows it only in
  `client/src/utils/api.ts`.
- The request the Home toolbar builds is replayed by hand with `curl` against a
  scratch server (recipe above), same method, path, headers and body → 200 and
  an `XMLValidator`-accepted body; the curl command shown next to the source
  lines it mirrors.
- Empty-selection behaviour per §7.4, quoted from the source.
- `git diff client/src/pages/FlightDetail.tsx client/src/pages/TripDetail.tsx`
  shows no change to `handleExportPdf`'s URL, the include-plans checkboxes, or
  the PDF button's copy.
- `git diff --name-only` lists only the four allowed paths.
- Scratch server shut down, `md5sum flights.db` unchanged, port 3000 untouched.

### 8.5 T-010 — clean build and end-to-end

- From clean (`rm -rf dist client/dist` first):
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null; npm run build` exits 0 and the tree is left shippable (stated explicitly — the user's next restart of port 3000 picks up this `dist/`).
- `npm test` and `npm run test:types` exit 0; both summary lines quoted.
- Scratch server per the recipe; start and shutdown shown; port 3000 and the
  repo's `flights.db` never written to.
- All three KML endpoints 200 with correct headers and `XMLValidator`-accepted
  bodies; each response's byte size and container count reported.
- Both PDF endpoints still 200 with `Content-Type: application/pdf`; an SPA
  route still returns `index.html`.
- `git diff --stat package.json package-lock.json Dockerfile* client/package.json`
  is empty.
- `md5sum flights.db` identical before and after; the live server's PID on port
  3000 unchanged.
- `git status --porcelain` shows no source file modified by that task.

### 8.6 What this plan cannot prove

No KML viewer exists in this environment, so "opens correctly in Google Earth"
is *not* proven by any command above. What is proven: well-formedness
(`XMLValidator`), the KML 2.2 namespace, XSD-conformant element ordering (§4.2),
coordinate order and units (§4.5), and escaping (§4.6). The residual risk is
carried in §1.4 and is the reason §4.1 chose the most conservative geometry
available.

## 9. Open questions

Everything a designer could decide is decided above. What follows is either a
scope question for the user or a note the frozen constraints require.

### 9.1 What this design needed from src/types.ts and src/db.ts — nothing

`plan.json` freezes: *"src/types.ts is NOT edited by this run … src/db.ts is NOT
edited by this run"*, and requires the Designer to say so explicitly if the
design needs either. **It does not.**

- `src/types.ts`: not edited and **not even imported**. `src/kmlExport.ts`
  declares its own structural input types (§5.1), which `FlightWithPoints`
  satisfies. If a Dispatcher finds `getFlightById(id)!` is *not* assignable to
  `KmlFlight`, that is a design error to report — not a licence to edit
  `src/types.ts`.
- `src/db.ts`: not edited. The set endpoint composes `getFlightById()` per
  distinct id (§5.2). A bulk `WHERE id IN (…)` query would be tidier, but the
  measured cost (§0: the whole 45-flight, 42 501-point trip in 284 ms) does not
  justify reopening the constraint.
- `src/server.ts`'s `flightExportFilename()` gains a defaulted second parameter
  (§3.4). That file *is* in T-004's allowed paths, so this is in scope; it is
  called out here only because it is the one edit to an existing function
  anywhere in this run.

### 9.2 For the user — genuine scope questions, none blocking

1. **Animated playback.** The export uses `LineString` + `TimeSpan` (§4.1), so
   Google Earth draws the path and can filter by time, but does not fly the
   aircraft along it. A `gx:Track` variant would add that at the cost of
   compatibility with non-Google viewers. Deliberately not built; a clean
   follow-up run if the user wants it.
2. **Planned routes.** Only the flown track is exported. A trip's imported
   `.lnmpln` legs could be drawn alongside it as a second, dashed placemark per
   leg. Out of scope here (§1.2).
3. **Departure/arrival pins.** No start/end markers (§4.2). Cheap to add later;
   left out to keep the tree clean.
4. **The 100-flight cap** on the set export (§2.3). The whole logbook is 45
   flights today, so it is unreachable in practice; it is a policy number, and
   raising it is a one-constant change plus §7.4's message.

None of these change the contracts frozen above; each is additive.
