# Design freeze — LNMPLN trip planner

Run: `2026-09-04-lnmpln-trip-planner`
Covers: **T-001** (planned-leg data model, LNMPLN parse contract, phase-1 REST surface)
and **T-010** (active-trip semantics, flight↔planned-leg link, auto-match algorithm).

Companion files:

- `contracts/planned-legs.d.ts` — TypeScript interface stubs (types only).
- `contracts/schema.sql` — DDL + the exact `initDb()` migration steps. Reference
  only; it is **not** wired into the build. `src/db.ts` remains the single place
  that issues SQL.

This document is the freeze. A Dispatcher implementing T-002 … T-021 should not
need to make another architectural decision. Where a decision was genuinely open,
the alternatives and the reason for the choice are recorded, so a Reviewer can
check the reasoning and not just the result.

> Note on task paths: `plan.json` gives T-001 the paths
> `design/data-model.md` + `design/stubs/**` and T-010 `design/matching.md`.
> The Orchestrator's request envelope superseded that with `design.md` +
> `contracts/**`. Section 22 maps every DoD bullet of both tasks to a section
> here so the Reviewer can check them off against the original wording.

---

## Amendment A — 2026-09-04 — three real `.lnmpln` files

Three genuine Little Navmap **3.0.18** exports arrived after the initial freeze
and are now at `samples/lnmpln/` (covered by T-002's `allowed_paths`). They are
VFR, C172, and chain into one trip: **KSBA→KMRY→KSTS→KACV**.

The frozen §5.1 fast-xml-parser configuration was prototyped against all three
and parses them correctly — `isArray` jpaths resolve, `parseTagValue: false`
keeps every `<Ident>` a string, `@_Lat`/`@_Lon` attribute access works, and the
full `-03:00` offset on `CreationDate` parses natively. **§5.1 is unchanged.**
Great-circle sums over the waypoint chains are 201.2 / 140.0 / 191.1 nm,
independently reproduced here, which validates the §6 distance rule.

One real defect was found, and four format facts plus one new display rule were
confirmed. Changes, all made in place with section numbering unchanged:

| Section | Change |
|---|---|
| **§9.2** | **Defect fixed.** Upload order is *not* route order. Import now chain-sorts a batch by matching each leg's destination ident to the next leg's departure ident, and falls back to upload order when the chain does not resolve uniquely. This is the substantive change; everything else is a confirmation or a display rule. |
| §7.1 | Import response: `imported[]` is in final `seq` order, `results[]` stays in upload order; new `batch` field reports which ordering was used and why. |
| §5.4 | **New.** Four rules confirmed by the real files: never branch on `FileVersion`/`ProgramVersion`; `<Departure>` is commonly absent entirely; USER waypoint idents repeat across legs; `<AircraftPerformance>` may have no `<FilePath>`. |
| §6.1 | **New display rule.** `Pos/@Alt` is a computed profile altitude, not a planned constraint. |
| §13.3 | Confirms the matcher's use of the first waypoint's position: no real file carried a `<Departure>` element at all. |
| §20 | Five new must-not-change items (22–26). |
| §21 | Risk 1 rewritten: partly retired, with an explicit list of what these files do and do not cover. |

**Why the defect is the common case, not an edge case.** Little Navmap's default
filename is `VFR <depname> (ICAO) to <destname> (ICAO).lnmpln`. A browser file
picker hands multer the files in alphabetical order, and for this trip that is:

```
VFR Charles M Schulz - Sonoma Coun (KSTS) to ... (KACV)   ->  KSTS -> KACV
VFR Monterey Rgnl (KMRY) to ... (KSTS)                    ->  KMRY -> KSTS
VFR Santa Barbara Muni (KSBA) to ... (KMRY)               ->  KSBA -> KMRY
```

— the exact reverse of the route. Selecting every file at once is the obvious way
to import a trip, so the original "upload order is route order" rule would have
been wrong for the first real batch anyone imports.

---

## Amendment B — 2026-09-04 — the first real IFR plan

`samples/lnmpln/IFR San Francisco Intl (KSFO) to Los Angeles Intl (KLAX).lnmpln`,
Little Navmap 3.0.18, KSFO→KLAX, FL270, NavData cycle 2609. It is the first real
file with a `<Procedures>` block, and it broke two things and corrected a third.
It belongs to a different trip from the VFR trio, so a mixed batch falls back on
`NO_UNIQUE_HEAD` — the §9.2.1 rule behaving as designed.

| Section | Change |
|---|---|
| **§2.2, `schema.sql`, stubs** | **Defect fixed.** The nine procedure columns silently discarded four fields of this file's approach. Now **eighteen** columns: the approach's `type`, `arinc`, `suffix`, `transition_type` and its three `Custom*` values, plus the SID's `type` and `custom_distance_nm` for the manual's `CUSTOMDEPART` form. |
| **§5.4e** | **New rule.** The official XSD is **not exhaustive**. `<CustomOffsetAngle>` is in this real file and appears nowhere in the XSD. Unknown elements are tolerated everywhere and reported as `UNKNOWN_ELEMENT` warnings. |
| **§6** | **Rewritten around a measurement.** The old "typically 10–40 nm" estimate was wrong and understated. |
| **§6.2** | **New display rule.** The planned route and the flown track are *expected* to diverge at both ends of an IFR leg. Not a rendering bug. |
| §5.4f–h | Departure runway comes from `Procedures/SID/Runway`; `Approach/Name` is not a fix reference when `Type=CUSTOM`; `NavData Cycle` varies between files. |
| §20 | Three new must-not-change items (27, 28, 29). |
| §21 | Trap 5 and the procedures path retired from the synthesized-only list; `<Alternates>` explicitly still unexercised by any real file. |

**The measurement that rewrote §6.** This plan's en-route skeleton is
KSFO → EBAYE → KLAX. Independently reproduced here:

```
waypoint chain (the stored approx_distance_nm)  293.5 nm
direct great circle KSFO -> KLAX                293.2 nm
excess                                            0.25 nm
```

With exactly one en-route waypoint, the "route" the file describes **is the
straight line**. Every departure and arrival turn this flight actually makes
lives in `WESLA5.SUSEY` and `IRNMN2.BURGL` — names the file records but whose
legs it never contains. So the procedure gap is not a bounded correction of a few
tens of miles; on an IFR plan it can be the entire shape of the route, and it is
worst on exactly the plans that have procedures.

---

## Amendment C — 2026-09-05 — what the phase-3 review found

Four corrections, all arising from T-014's review of the manual escape hatch.
Three are ordinary defects and are recorded in `reviews/phase3.md`; the two
below changed this document, and both were adjudicated by the Orchestrator
because the frozen design was self-inconsistent rather than merely unimplemented.

**C-1. Eligibility is decided in the matcher, never in the query (§13.2, §13.5).**
The candidate loader was named `getUnflownPlannedLegsForActiveTrip` and filtered
`status NOT IN ('flown','diverted')` in SQL. That reads as harmless — the name
endorses it — but §13.2 step 5 defines `LEG_ALREADY_FLOWN` as a refusal reached
*inside* the matcher, and a leg filtered out by the query never reaches step 5.
The code was therefore unreachable in production, and the case it exists to
explain degraded into a bare `NO_LEG_IN_RADIUS`: measured against the real
fixtures, a second KSBA takeoff after leg 1 is flown reported the nearest
remaining candidate at ~160 nm rather than naming the obstacle 0 nm away.

The query already deferred `skipped` and already-linked legs to step 5, so
`flown`/`diverted` was an arbitrary exception to a rule the design otherwise kept.
§13.2's own argument for why strict ambiguity refusal is affordable — *"by the
time leg 3 is flown, leg 1 is `flown` and linked, so step 5 filters it out"* — is
written in terms of step 5, not the query.

**The loader returns every leg of the active trip and is renamed
`getPlannedLegCandidatesForActiveTrip`.** Step 5 is the single place eligibility
is decided. Done now, before T-015 and T-016 exist, precisely so no call site
needs revisiting — and so T-015's scenario harness cannot green-light a branch
production can never reach.

**C-2. `deleteTrip()` must restore link-moved flights (§16).** §16 said it needed
no change. That holds for `trip_id` in general and still does. It does not hold
for a flight a *link* moved into the trip: the cascade nulls `planned_leg_id`,
the dead `trip_id` remains, and `planned_leg_prev_trip_id` is discarded unread —
the one path where the link's promise to restore is silently broken. §16 now
carries the fix. Ordinary trip membership is untouched, as §20 requires.

**The rule both share, worth stating once.** A guard belongs at the layer every
caller passes through. C-1 moves a decision *out* of the query into the matcher
because that is where every candidate is judged; the re-link guard (F-2) went
*into* `linkFlightToPlannedLeg` rather than the endpoint because T-016 calls the
db function directly, and an endpoint guard would have protected the watched path
while leaving the unattended one exposed. Phase 4 adds a second caller to
everything this phase built; anything guarded only at the HTTP edge is guarded
only against the user.

---

## 1. Vocabulary, and the rule that keeps two features apart

This codebase already has a feature called *flight plan*: a **PDF attached to a
flown flight** (`flights.flight_plan_name`, `src/flightPlans.ts`,
`flight_plans/<flightId>.pdf`, `/api/flights/:id/flight-plan`, the export
checkbox "Include flight plans (N)"). That feature is untouched by this work.

The new feature is called a **planned leg**: a route imported from a Little
Navmap `.lnmpln` file and attached to a **trip**, before it is flown.

**Naming rule (binding).**

| Concept | Identifier shape | Examples |
|---|---|---|
| PDF attachment (existing) | contains `flight_plan` / `flight-plan` | `flights.flight_plan_name`, `/api/flights/:id/flight-plan`, `flight_plans/` |
| Planned leg (new) | contains `planned` | `planned_legs`, `flights.planned_leg_id`, `/api/trips/:id/planned-legs`, `PlannedLegRows.tsx` |

No new identifier, table, column, route segment, file, CSS class or UI string
may contain the bare words "flight plan" / `flightPlan` / `flight_plan`. No
existing one may gain the word "planned". A Reviewer can check this with
`grep -rn "flight.plan" src client/src` and confirm every hit is the PDF feature.

User-facing strings, frozen:

- Import control: **"Import Little Navmap plan (.lnmpln)"**
- Table rows: **"Planned"** (badge), route drawn as **"planned route"**
- Existing export checkbox stays **"Include flight plans (N)"** (PDFs). Unchanged.

---

## 2. Data model

### 2.1 Where waypoints and alternates live: normalised tables, not a JSON column

**Decision: three normalised tables — `planned_legs`, `planned_waypoints`,
`planned_alternates`. No JSON column anywhere.**

Reasons, in order of weight:

1. **The project's only test harness is `sqlite3` on the command line.** There is
   no test framework, and `plan.json` states verification is "by running the app,
   by curl against endpoints, by sqlite3 against the database". Every DoD in
   phases 1 and 3 is phrased as a `sqlite3` query — *"select count(*) from
   planned_legs where trip_id not in (select id from trips)"*, *"confirm that no
   planned_waypoints rows survive for that leg"*. A JSON blob is opaque to all of
   them. Normalised rows keep the project's verification method working.
2. **`ON DELETE CASCADE` does the cleanup.** `flight_points` already models
   exactly this shape (a child row list keyed by parent with a cascade and one
   index). Copying it costs nothing and inherits its correctness.
3. **The matcher never reads the waypoint table.** Both endpoints are
   denormalised onto `planned_legs` (`departure_lat/lon`, `destination_lat/lon`,
   `*_ident`, `*_is_airport`), so the hot path at takeoff is one indexed query
   over a table with tens of rows and zero joins. This is the important structural
   move: the matcher's cost is independent of route length.
4. **The map needs the whole chain**, which is one indexed read
   (`WHERE planned_leg_id = ? ORDER BY seq`), or one read per trip joined by leg.
5. There are **no JSON columns anywhere in this codebase today** and no
   `json_extract` usage. A JSON column would be the only place where hand-written
   SQL stops being inspectable, and would need `JSON.parse` guards on every read.

Rejected: a `waypoints_json TEXT` column on `planned_legs`. It is smaller and
faster to write, and that is all.

### 2.2 Tables

Full DDL is in `contracts/schema.sql`. Summary:

**`planned_legs`** — one row per imported `.lnmpln` file, belonging to one trip.
Carries: `trip_id`, `seq`, `status`; the denormalised departure and destination
(`ident`, `name`, `lat`, `lon`, `is_airport`); the plan's own start spot
(`departure_start`, `departure_start_type`, `departure_pos_lat/lon` — trap 12);
`is_snippet`, `cruise_alt_ft`, `flightplan_type`, `aircraft_type`; the eighteen
flat procedure fields (§2.2.1);
`waypoint_count`, `alternate_count`, `approx_distance_nm`,
`arrival_deviation_nm`; `remarks`, `plan_created_at`; and the provenance
(`source_filename`, `source_sha256`, `source_program`, `imported_at`).

**`planned_waypoints`** — `planned_leg_id`, `seq` (1-based, document order),
`ident`, `name`, `region`, `airway`, `track`, `type`, `comment`, `lat`, `lon`,
`alt_ft`.

**`planned_alternates`** — `planned_leg_id`, `seq`, `ident`, `name`, `type`,
`lat`, `lon`, `alt_ft`. `lat`/`lon` are **nullable** here: `Alternate/Pos` is
optional in the XSD (trap 8), unlike `Waypoint/Pos` which is required.

**Procedures are stored as flat text on the leg, not as rows.** The file never
contains procedure waypoints (trap 5), so a `planned_procedure_legs` table would
have nothing to hold.

#### 2.2.1 The eighteen procedure columns  *(amended 2026-09-04, Amendment B)*

The original freeze had nine — name, runway and transition for each of SID, STAR
and approach. The first real IFR file proved that lossy: its approach is
characterised *entirely* by fields none of those nine hold.

```
Approach: Name=KLAX24R  Runway=24R  Type=CUSTOM
          CustomDistance=3.00  CustomAltitude=1000.00  CustomOffsetAngle=0.00
```

Under the nine-column schema, `Type` and all three `Custom*` values were
discarded, and the stored row could not even distinguish a custom
runway-extension approach from a published one of the same name. The columns are:

| Group | Columns |
|---|---|
| SID | `sid_name`, `sid_runway`, `sid_transition`, `sid_type`, `sid_custom_distance_nm` |
| STAR | `star_name`, `star_runway`, `star_transition` |
| Approach | `approach_name`, `approach_runway`, `approach_transition`, `approach_type`, `approach_arinc`, `approach_suffix`, `approach_transition_type`, `approach_custom_distance_nm`, `approach_custom_altitude_ft`, `approach_custom_offset_deg` |

All are nullable `TEXT` except the three numeric `Custom*` values, which are
`REAL` and carry their unit in the name, as `distance_nm` / `altitude_ft` already
do elsewhere in this schema. `sid_type` and `sid_custom_distance_nm` exist for
the manual's `Type=CUSTOMDEPART` form, which the XSD does not declare either
(§5.4e).

STAR keeps three columns: neither the manual nor any observed file gives a STAR a
type or a custom form. That is a bet, and §5.4e is how it is hedged — an
unrecognised child of `<STAR>` surfaces as an `UNKNOWN_ELEMENT` warning rather
than vanishing, so the gap becomes visible the first time it occurs instead of
being discovered as missing data much later.

This is still a flat projection, not a model: eighteen text and number columns
that the leg row displays. Modelling procedure *legs* remains the over-modelling
this design refuses, for the unchanged reason that the file never contains them.

### 2.3 Columns added to existing tables

| Table | Column | Type | Purpose |
|---|---|---|---|
| `trips` | `is_active` | `INTEGER NOT NULL DEFAULT 0` | the active-trip flag (§11) |
| `flights` | `planned_leg_id` | `INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL` | the link (§12) |
| `flights` | `planned_leg_link_source` | `TEXT` | `'auto'` \| `'manual'` \| `NULL` |
| `flights` | `planned_leg_prev_trip_id` | `INTEGER` | the `trip_id` held immediately before the link, so unlink restores it (§12.2) |

No existing column is renamed, retyped, dropped, or given a new meaning. All four
are added with the `PRAGMA table_info` + `ALTER TABLE … ADD COLUMN` idiom already
in `initDb()` (§3).

`flights.trip_id` keeps its current unconstrained form — **do not add a foreign
key to it**. Deleting a trip today leaves its flights alive with a dangling
`trip_id`, and the UI promises exactly that ("The flights will not be deleted").
Adding an FK would change that behaviour.

### 2.4 ON DELETE behaviour

`initDb()` sets `PRAGMA foreign_keys = ON`, so these are enforced.

| Parent → child | Action | Effect |
|---|---|---|
| `trips` → `planned_legs` | `ON DELETE CASCADE` | **Deleting a trip deletes its planned legs, and their waypoints and alternates.** A planned leg has no meaning without its trip: it is that trip's intent. Flights are *not* deleted (no FK on `flights.trip_id`), so `deleteTrip()`'s user-visible contract is unchanged. |
| `planned_legs` → `planned_waypoints` | `ON DELETE CASCADE` | same idiom as `flight_points` |
| `planned_legs` → `planned_alternates` | `ON DELETE CASCADE` | same |
| `planned_legs` → `flights.planned_leg_id` | `ON DELETE SET NULL` | deleting a leg unlinks any flight but never deletes the flight |

Cascade chain when a trip is deleted: `trips` → `planned_legs` (rows gone) →
`planned_waypoints` / `planned_alternates` (rows gone) **and** every
`flights.planned_leg_id` that pointed into them becomes `NULL`. SQLite applies
these recursively inside the same statement. `deleteTrip()` needs no new code
for this, and `select count(*) from planned_legs where trip_id not in (select id
from trips)` returns 0 afterwards, as T-003 requires.

The reverse direction — deleting a **flight** — is *not* covered by a foreign key
and needs application code. See §16.

### 2.5 Indexes

```
idx_planned_legs_trip        planned_legs(trip_id, seq)
idx_planned_legs_source      planned_legs(trip_id, source_sha256)     -- duplicate detection
idx_planned_waypoints_leg    planned_waypoints(planned_leg_id, seq)
idx_planned_alternates_leg   planned_alternates(planned_leg_id, seq)
idx_flights_planned_leg      UNIQUE flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL
idx_trips_active             UNIQUE trips(is_active) WHERE is_active = 1
```

The last two are **partial unique indexes**, and they are load-bearing: they turn
"at most one flight per planned leg" and "at most one active trip" from a
convention into a database guarantee. If a Dispatcher gets a statement order
wrong, SQLite raises `SQLITE_CONSTRAINT` instead of silently producing two active
trips. That is the intent — do not drop them, and do not "fix" a constraint error
by removing the index.

There is deliberately **no** index on `planned_legs(status)` and **no**
`UNIQUE(trip_id, seq)`. Cardinality is in the tens; and a unique `seq` would make
a reorder (which renumbers 1..N) trip over itself mid-transaction, since SQLite
has no deferred unique constraints. Uniqueness of `seq` is guaranteed by the
reorder transaction instead (§9.2), and **every read orders by `seq ASC, id ASC`**
so the order is total even if two rows ever shared a `seq`.

---

## 3. Migration — exact steps in `initDb()`

Two edits to `src/db.ts`, in this order.

**(a) Extend the existing `db.exec(...)` template literal** — the one that
already creates `flights`, `flight_points`, `idx_points_flight` and `trips` — by
appending the three `CREATE TABLE IF NOT EXISTS` statements and their
`CREATE INDEX IF NOT EXISTS` statements from `contracts/schema.sql`. Do not
modify the existing `CREATE TABLE` bodies.

The new tables must be created **before** the `ALTER TABLE flights ADD COLUMN
planned_leg_id … REFERENCES planned_legs(id)` below, or the FK target will not
exist.

**(b) Extend the migration block** that follows it:

```
const cols = (db.prepare('PRAGMA table_info(flights)').all() as { name: string }[]).map(c => c.name);
… existing checks unchanged …
if (!cols.includes('planned_leg_id')) {
  db.exec('ALTER TABLE flights ADD COLUMN planned_leg_id INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL');
}
if (!cols.includes('planned_leg_link_source')) {
  db.exec('ALTER TABLE flights ADD COLUMN planned_leg_link_source TEXT');
}
if (!cols.includes('planned_leg_prev_trip_id')) {
  db.exec('ALTER TABLE flights ADD COLUMN planned_leg_prev_trip_id INTEGER');
}

const tripCols = (db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]).map(c => c.name);
if (!tripCols.includes('is_active')) {
  db.exec('ALTER TABLE trips ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
}

// Unconditional and idempotent: an index can be missing even when its column exists
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_flights_planned_leg ON flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_active        ON trips(is_active)        WHERE is_active = 1;
`);
```

Four things a Dispatcher must get right, all of which SQLite enforces:

1. `ADD COLUMN … REFERENCES` is legal **only when the default is NULL**, which is
   why `planned_leg_id` has no default. `is_active` has no `REFERENCES`, so
   `NOT NULL DEFAULT 0` is legal there.
2. The new columns are added **only** in the migration block, and **not** added to
   the `CREATE TABLE flights` / `CREATE TABLE trips` bodies. This is the same
   choice already made for `flights.trip_id`, and it means a fresh database and an
   upgraded one take the identical code path and end up byte-identical in
   `.schema`.
3. The `CREATE INDEX` statements run unconditionally (they are
   `IF NOT EXISTS`), not inside the `if (!cols.includes(...))` blocks. The
   existing `idx_flights_trip` is created inside its `if`, which means a database
   that gained the column without the index never gets it. Do not copy that
   detail; do not change the existing line either.
4. Nothing in this migration writes to any existing row. Every existing `flights`
   row gets `NULL` in the three new columns and every existing `trips` row gets
   `is_active = 0`, i.e. no active trip until the user picks one.

Running the server twice against the same file must produce no error, and
`.schema planned_legs` must show exactly one definition.

---

## 4. Module layout, ownership, and the geo question

| File | Owner task | Contents |
|---|---|---|
| `src/geo.ts` | **T-002** (new; see amendment below) | `haversineNm`, `bearingDeg` — shared, pure |
| `src/lnmpln.ts` | T-002 | `parseLnmpln()`, `ParsedFlightPlan` and every parse-shape type, `LnmplnParseError` |
| `src/types.ts` | T-003 / T-011 | persisted row types: `PlannedLeg`, `PlannedWaypoint`, `PlannedAlternate`, `PlannedLegWithChildren`, additions to `Flight`/`Trip`/`TripWithFlights` |
| `src/db.ts` | T-003 / T-011 | all SQL; planned-leg CRUD; link/unlink; active trip |
| `src/server.ts` | T-004 / T-012 | REST |
| `src/legMatcher.ts` | T-015 | `matchPlannedLeg()` — pure, no I/O |
| `src/flightManager.ts` | T-016 | calls the matcher once per flight start |
| `client/src/types.ts` | T-005 / T-011-mirror | hand-written mirror |

The split of parse-shape types (`src/lnmpln.ts`) from persisted row types
(`src/types.ts`) is what lets T-002 and T-003 run in parallel. **`src/db.ts` must
not import from `src/lnmpln.ts`** and vice versa; `src/server.ts` is the only
module that sees both, and it is where a `ParsedFlightPlan` is turned into the
arguments of `createPlannedLeg()`.

### 4.1 The fourth copy of `haversineNm` — extract `src/geo.ts`, yes, now

`haversineNm` exists three times today, privately, in `src/db.ts`,
`src/airports.ts` and `src/flightManager.ts`. This feature needs it in two more
places that **cannot** borrow any of them:

- `src/lnmpln.ts` computes `approxDistanceNm` and must not import `./db`
  (T-002 verifies this with grep).
- `src/legMatcher.ts` computes the takeoff-to-departure distance and must not
  import `./db` or `./airports` (T-015 verifies this with grep).

**Decision: create `src/geo.ts` with `haversineNm` and `bearingDeg`, and have
only the new modules use it. Do not touch the three existing private copies in
this feature.**

Plainly: this leaves four implementations in the tree (three legacy + one shared)
rather than one. That is the deliberate trade. Migrating `db.ts`,
`airports.ts` and `flightManager.ts` onto `src/geo.ts` would touch the two files
where a regression is most expensive (the flight state machine and the distance
accumulator) and would put an unrelated edit into three different phases' diffs.
The cleanup is a **follow-up task after phase 5**, not part of this feature. What
this feature does guarantee is that there is now one obvious home for it, and
that no *new* copy is written.

`src/geo.ts` must be a byte-for-byte behavioural copy of the existing function
(same `R = 3440.065`), so that a later consolidation is a pure deletion.

### 4.2 Required amendment to `plan.json` allowed_paths

`src/geo.ts` is in no task's `allowed_paths`. The Orchestrator must add it to:

- **T-002** `allowed_paths` (creates `src/geo.ts`), and
- **T-015** `allowed_paths` (imports it — no edit needed, but the reviewer should
  see it declared).

Also worth adding to T-005 for completeness: `client/src/components/PlannedLegRows.tsx`
is already listed. No other amendment is needed.

---

## 5. The LNMPLN parse contract

Entry point, in `src/lnmpln.ts`:

```
export function parseLnmpln(input: string | Buffer, sourceFilename?: string): ParsedFlightPlan;
export class LnmplnParseError extends Error { readonly code: LnmplnRejectCode }
```

It **returns** a `ParsedFlightPlan` or **throws** `LnmplnParseError`. Warnings are
carried in the returned value (`warnings: LnmplnWarning[]`), never thrown. The
REST layer distinguishes `err instanceof LnmplnParseError` → 400 from anything
else → 500; this is why rejection is a typed error and not a `null` return.

Full types: `contracts/planned-legs.d.ts`.

### 5.1 fast-xml-parser configuration (frozen)

```
new XMLParser({
  ignoreAttributes:     false,
  attributeNamePrefix:  '@_',
  parseTagValue:        false,   // see below — this one matters
  parseAttributeValue:  false,   // see below
  trimValues:           true,
  isArray: (name, jpath) => [
    'LittleNavmap.Flightplan.Waypoints',
    'LittleNavmap.Flightplan.Waypoints.Waypoint',
    'LittleNavmap.Flightplan.Alternates',
    'LittleNavmap.Flightplan.Alternates.Alternate',
  ].includes(jpath),
})
```

Three things about this configuration are binding.

- **Do not set `preserveOrder: true`.** It is tempting for trap 3, and it is the
  wrong tool: it returns a completely different (positional) shape, which is the
  very thing trap 3 says to avoid. With the default shape, access is by tag name,
  and fast-xml-parser preserves order *within* a repeated tag name — which is all
  that document order across `<Waypoints>` blocks and `<Waypoint>` children
  requires (trap 4).
- **`parseTagValue: false` and `parseAttributeValue: false` are mandatory.** With
  the defaults, fast-xml-parser coerces numeric-looking text to numbers, and this
  file format is full of numeric-looking *strings*: an `<Ident>` of `1000`, a
  `<Region>` of `07`, a runway `<Runway>` of `09`, a `<Transition>` of `05`. A
  coerced ident silently loses leading zeros and stops comparing equal to the
  airport ident. Every numeric field is therefore converted explicitly by the
  parser, through one helper that returns `number | null` and rejects `NaN`,
  `Infinity` and the empty string. This is trap 13 — one the intake could not
  know about because it is created by the parser choice, not the file format.
- **Do not run `XMLValidator`.** The official annotated example contains an
  unbalanced/nested comment block (trap 7) and would be rejected by a strict
  validator. The contract is: let `XMLParser` parse leniently, then validate the
  *semantic* shape ourselves (§5.3). If `XMLParser` itself throws, that is
  `NOT_XML`.

### 5.2 The twelve traps, one by one

| # | Trap | What the parser does | Reject / warn |
|---|---|---|---|
| 1 | Units and coordinates: decimal signed degrees, altitude in feet | No unit conversion. Every `Pos/@Lat`, `Pos/@Lon` converted with an explicit finite-number check, then range-checked `-90 ≤ lat ≤ 90`, `-180 ≤ lon ≤ 180`. | **Reject** `BAD_COORDINATE` if a required Lat/Lon is missing, non-finite or out of range. Alternates with no `Pos` at all are accepted with `ALTERNATE_POSITION_MISSING` (their `Pos` is optional). |
| 2 | `<Comment>` vs `<Description>` | Reads `Comment ?? Description` at both `Header` and `Waypoint`. | **Accept.** Warn `DESCRIPTION_INSTEAD_OF_COMMENT` when only `Description` is present; warn `COMMENT_AND_DESCRIPTION_BOTH_PRESENT` and prefer `Comment` when both exist and differ. |
| 3 | Element order is not reliable | Everything is read by tag name off the parsed object. No positional access anywhere; no index into a children array except within a single repeated tag. | n/a — structural. |
| 4 | `Waypoints`/`Alternates` are `maxOccurs="unbounded"` | `isArray` forces both the blocks and their children to arrays; the parser concatenates every block's children in array order, which is document order. `seq` is assigned 1..N over the concatenation. | **Accept.** Warn `MULTIPLE_WAYPOINT_BLOCKS` when more than one block is present, because that is rare enough to be worth seeing in the import log. |
| 5 | Procedure waypoints are never present | The waypoint chain is the en-route skeleton only. `approxDistanceNm` is the great-circle sum over that chain and `distanceIsApproximate` is the literal type `true` — it cannot be set to `false` by any code path. | **Accept.** Warn `PROCEDURES_PRESENT_WAYPOINTS_ABSENT` whenever a `Procedures` element exists, since the gap between the stored distance and the real one is then larger. See §6. |
| 6 | Endpoints are not guaranteed to be airports | First waypoint → `departure`, last → `destination`, always. `isAirport` is `type === 'AIRPORT'`. `isSnippet = !(departure.isAirport && destination.isAirport)`. An ident is **never** presented as an ICAO code when `isAirport` is false. | **Accept.** Warn `SNIPPET_DEPARTURE_NOT_AIRPORT` / `SNIPPET_DESTINATION_NOT_AIRPORT`. Additionally warn `IDENT_NOT_ICAO_SHAPED` when `isAirport` is true but the ident is not 3–4 of `[A-Z0-9]` — MSFS carries non-ICAO idents and they must still import. |
| 7 | XML comments, including an unbalanced/nested block | `XMLParser` runs with comments ignored and no validator. If it throws, the file is rejected. If it returns a damaged tree, the §5.3 semantic checks are the safety net. | **Reject** `NOT_XML` only if the parser throws. A tree that parses but yields fewer than two waypoints is rejected as `TOO_FEW_WAYPOINTS`, which is the observable symptom of a swallowed block. |
| 8 | `Pos/@Alt` is optional | `altFt: number \| null` on waypoints and alternates. | **Accept.** Warn `WAYPOINT_ALT_INVALID` and store `null` if `@Alt` is present but not a finite number. |
| 9 | `CruisingAltF` is precise, `CruisingAlt` is rounded | `cruiseAltFt = CruisingAltF ?? CruisingAlt ?? null`. Never the other way round. | **Accept.** Warn `CRUISE_ALT_F_MISSING` when falling back to `CruisingAlt`; warn `CRUISE_ALT_MISSING` when both are absent and the value is `null`. Never a rejection — the XSD says required, real files are not guaranteed to be. |
| 10 | `CreationDate` carries a 2-digit offset | Normalised before `new Date()`: `+02` / `-05` → append `:00`; `+0200` → insert the colon; a trailing `Z` or an already-full `±HH:MM` is left alone. Result stored as a full ISO instant via `toISOString()`. | **Accept.** Warn `CREATION_DATE_NO_OFFSET` when there is no offset at all (parsed in the server's zone, which is a guess); warn `CREATION_DATE_UNPARSEABLE` and store `null` if it still will not parse. Never a rejection. |
| 11 | UTF-8, possibly with a BOM | A `Buffer` is decoded as `utf8`; a leading U+FEFF is stripped from the string before parsing, which covers both the decoded BOM and a BOM already present in a string input. | **Accept.** Warn `BOM_STRIPPED`. |
| 12 | `Departure/Pos` is the parking spot, more precise than the airport waypoint | Kept separately as `departure.startPos` / `startName` / `startType` / `headingTrueDeg`. It **never** overwrites `departure.lat/lon`, which stay the first waypoint's position (the airport reference point). | **Accept.** No warning. See §13.3 for why the matcher uses the waypoint position and not this one. |

Two additions the intake did not list but the format allows, resolved here so a
Dispatcher does not have to guess:

- **Unknown `<Type>` value on a waypoint** (outside the XSD enumeration): kept as
  the raw string, warn `UNKNOWN_WAYPOINT_TYPE`. Only `AIRPORT` is behaviourally
  significant, so an unknown type is harmless.
- **`AircraftPerformance/Type`** is stored as `aircraftType`. It is *not* used by
  the matcher in this feature (§13.2) — it is display-only.

### 5.3 Rejections (hard errors)

`parseLnmpln` throws `LnmplnParseError` with exactly one of these codes, and a
one-line message naming the offending element. Never a stack trace to the user,
never a partially-populated object.

| Code | Condition |
|---|---|
| `EMPTY_FILE` | zero bytes, or whitespace only after BOM stripping |
| `NOT_XML` | `XMLParser` throws, or the result has no object root |
| `NO_FLIGHTPLAN` | no `LittleNavmap.Flightplan` node |
| `TOO_FEW_WAYPOINTS` | fewer than **two** `Waypoint` elements across all blocks — a plan needs a departure and a destination |
| `MISSING_IDENT` | a `Waypoint` or `Alternate` with no non-empty `Ident` |
| `MISSING_POSITION` | a `Waypoint` with no `Pos`, or `Pos` missing `@Lat` / `@Lon` |
| `BAD_COORDINATE` | a coordinate that is non-finite or out of range |

These map one-for-one onto the `bad-*.lnmpln` fixtures T-002 must produce.

### 5.4 Rules confirmed by the real files  *(added 2026-09-04)*

Four facts observed in all three Little Navmap 3.0.18 exports, each turned into a
binding rule so a Dispatcher does not have to rediscover them.

**(a) Never branch on `FileVersion` or `ProgramVersion`.** The real files carry
`<FileVersion>1.2</FileVersion>`; the manual documents 1.0. The parser must not
gate, branch on, warn about, or reject any file because of either value. They are
**provenance only**: `ProgramName` + `ProgramVersion` are concatenated into
`sourceProgram`, `FileVersion` is not persisted at all. A version check would
have rejected every real file this project has.

**(b) `<Departure>` is commonly absent entirely.** None of the three files has
one — Little Navmap omits the element when no parking spot or runway was chosen,
which is the normal case for a plan built on the map. Therefore
`departure_pos_lat`, `departure_pos_lon`, `departure_start` and
`departure_start_type` are **`NULL` in the common case**, and **nothing may
depend on them**: not the matcher (§13.3), not the map, not the leg row. They are
a bonus when present. Trap 12 stands, but it describes the exception.

**(c) A waypoint is identified by (`planned_leg_id`, `seq`), never by ident.**
All three files number their user waypoints `WP1`, `WP2`, `WP3`, so the same
ident appears in every leg of the trip and means something different in each.
Binding: no code may key, dedupe, join, `Map`-index or React-`key` a waypoint by
ident, and no map marker, tooltip or list label may present an ident as unique
across legs. Where a marker names a waypoint across a multi-leg map, it must be
qualified by its leg (`Leg 2 · WP1`). This is also why `planned_waypoints` has no
unique constraint on `ident`.

**(d) `<AircraftPerformance>` may have no `<FilePath>`.** The real files carry
only `<Type>` and `<Name>`. Every child of `AircraftPerformance` is optional, and
only `Type` is read (into `aircraftType`, display-only).

**(e) The official XSD is a guide, never an authority on completeness.**
*(added 2026-09-04, Amendment B)*

The real IFR file writes `<CustomOffsetAngle>0.00</CustomOffsetAngle>` inside
`<Approach>`. That element name **does not appear anywhere** in
`littlenavmap.org/schema/lnmpln.xsd` — verified by grep against the copy at
`.claude/runs/2026-09-04-lnmpln-trip-planner/lnmpln.xsd`, which declares
`Approach` as only `Name/ARINC/Runway/Type/Suffix/Transition/TransitionType/CustomDistance/CustomAltitude`.
The XSD is likewise silent on the `SID` `Type=CUSTOMDEPART` + `CustomDistance`
form that the manual documents.

So Little Navmap demonstrably writes elements its own published schema does not
declare. This is stronger than §5.1's "do not run `XMLValidator`" — that rule was
about tolerating the manual's malformed comment block; this one is about the
schema being an incomplete description of the format. Binding consequences:

1. **Never treat an unrecognised element as an error.** No rejection code exists
   for one and none may be added. Unknown elements and attributes are skipped.
2. **Never derive a "known fields" list from the XSD alone.** Where the manual and
   the XSD disagree, the manual and the observed files win.
3. **Report what was not consumed.** The parser emits an `UNKNOWN_ELEMENT`
   warning naming the path of any child element it did not read, under
   `Flightplan`, `Header`, `Procedures/SID`, `Procedures/STAR`,
   `Procedures/Approach`, `Departure`, `AircraftPerformance`, `Waypoint` and
   `Alternate`. Excluded from the check: attribute keys (the `@_` prefix), the
   `#text` key, and the root's `xmlns:xsi` / `xsi:noNamespaceSchemaLocation`. The
   warning caps at the first ten paths so a wildly unexpected file cannot produce
   an unbounded message.

   This is the "capture where it carries meaning" mechanism, and it is
   deliberately a warning rather than a storage column: warnings already surface
   per file in the import response (§7.1) and in the import log, so an element
   that turns out to matter is visible the first time a user imports a file
   containing it — which is exactly how `CustomOffsetAngle` would have been
   caught had this rule existed before the file arrived. A generic capture column
   would mean a JSON blob, which §2.1 rules out.

**(f) The departure runway comes from `Procedures/SID/Runway`.** With no
`<Departure>` element in any of the four real files — the IFR plan included, and
it has a SID off runway 28L — `Procedures/SID/Runway` is the **only** place a
departure runway appears. §5.4b is now confirmed across four of four real files.
Anything that wants to show a departure runway reads `sid_runway`, and shows
nothing when it is null.

**(g) `Approach/Name` is not a fix reference when `Type=CUSTOM`.** The manual
describes `Name` as the approach fix name. In this file, with `Type=CUSTOM`, it
is the synthesized label `KLAX24R` — ICAO plus runway. So `approach_name` must be
displayed as an opaque label and never resolved, looked up, or joined against
navdata. `approach_type` is what says whether the name means anything beyond a
label.

**(h) `NavData Cycle` varies between files in one logbook.** 2609 in the IFR
file, 1801 in the three VFR files. Cycles are provenance only; nothing may assume
they agree across a trip's legs, and nothing may compare them.

---

## 6. Route distance: how it is computed and how it is labelled

`approxDistanceNm` = sum of `haversineNm` over consecutive waypoints in the
chain, from the first to the last. Great-circle, so the antimeridian is handled by
construction; **no raw longitude subtraction anywhere**.

It is stored as `planned_legs.approx_distance_nm`.

It is an approximation, always, and never presented otherwise.

**How large the error is — measured, not estimated** *(rewritten 2026-09-04,
Amendment B; the previous text guessed "typically 10–40 nm" and was wrong).*

The real KSFO→KLAX IFR plan is the whole argument:

```
en-route skeleton  KSFO -> EBAYE -> KLAX     293.5 nm   <- what we store
direct great circle KSFO -> KLAX             293.2 nm
excess                                         0.25 nm
```

The stored "route" is the straight line, to within a quarter of a mile, because
there is exactly one en-route waypoint between the two airports. Meanwhile the
aircraft will fly `WESLA5.SUSEY` off runway 28L and arrive on `IRNMN2.BURGL` to
the 24R approach — every turn this flight makes is in a procedure, and the file
records the procedures' *names* while never containing their legs (trap 5).

The structural statement, which replaces the number: **the error is unbounded in
the sense that matters — it scales with how much of the route's shape the
procedures carry, and it is worst precisely on the IFR plans that have them.** A
VFR plan drawn waypoint by waypoint is close to right; an IFR plan can store a
straight line for a route that is nothing of the kind. No fixed correction factor
can be applied, and none may be invented.

The rest of the rule follows from that:

- The type system carries it: `distanceIsApproximate: true` is a **literal
  type**, not a boolean, so no code path can flip it.
- The column is named `approx_distance_nm`, not `distance_nm`, so it never reads
  as a peer of `flights.distance_nm` (which *is* measured).
- **Binding UI rule:** every rendering of this number is prefixed `approx.` —
  `approx. 412 nm`. This applies to the trip legs table (T-005), the trip map
  tooltip (T-008), the live panel's remaining distance (T-019), the journey
  progress denominator (T-020) and the PDF (T-021). A Reviewer should reject any
  display of a planned distance without the qualifier.

Consequence for T-020: flown distance regularly exceeds planned distance, so
progress must be clamped to 0..100 — which that task's DoD already requires, and
this is the reason. On an IFR trip the overshoot can be substantial rather than
marginal, so the clamp is load-bearing, not a rounding guard.

### 6.1 `Pos/@Alt` is a profile altitude, not a constraint  *(added 2026-09-04)*

A second display rule with the same force as the `approx.` rule above.

Little Navmap writes a **computed** altitude into each waypoint's `Pos/@Alt`,
taken from the aircraft performance profile — it is where the aircraft is
*predicted* to be, not an altitude the pilot planned or a constraint the route
carries. The KSBA→KMRY file shows this plainly: cruise is 7500 ft, and the first
en-route waypoint SUDDO carries `Alt="5058.61"` because the C172 is still
climbing there; every later waypoint sits at 7500.

Binding:

- Storing it in `planned_waypoints.alt_ft` is correct and stays.
- **No view may label it a planned, target or constraint altitude.** It is never
  rendered as `SUDDO 5058 ft` in a way that reads like a crossing restriction, and
  it is never compared against the flown track to judge whether the pilot "made"
  an altitude.
- The leg's planned altitude is `cruise_alt_ft`, and that is the only altitude the
  leg row, the tooltip and the PDF may present as planned.
- If a profile is ever drawn from these values, it is labelled *predicted profile*
  and carries the same `approx.` caveat, for the same reason: the performance
  model that produced it is not the aircraft that will fly it.

### 6.2 The planned route and the flown track are expected to diverge  *(added 2026-09-04)*

Frozen as **correct behaviour**, so that no Dispatcher and no Reviewer treats it
as a rendering bug.

When T-017 draws the KSFO→KLAX planned route beneath the flown track, the planned
line will run nearly straight KSFO → EBAYE → KLAX while the actual track curves
away at both ends — out through `WESLA5.SUSEY` and in through `IRNMN2.BURGL`.
**The two will visibly disagree at the departure and arrival ends, sometimes by
tens of miles. That is the file being drawn faithfully** (§6): the procedure legs
are not in it.

Therefore:

- **Do not snap, warp, clip or interpolate the planned line toward the flown
  track**, at either end or anywhere else. The planned route is drawn from
  `planned_waypoints` exactly as stored.
- **Do not treat divergence as a match failure.** It says nothing about whether
  the flight belongs to the leg; §13 owns that question and uses endpoint
  proximity, never route similarity.
- Neither T-008's nor T-017's acceptance may read the divergence as a defect. If
  the two lines coincide end to end on an IFR leg with procedures, *that* is the
  suspicious result.
- The UI may explain it once, in the leg's tooltip or a footnote: *planned route
  excludes SID/STAR/approach legs*. It must not try to hide it.

---

## 7. Phase-1 REST surface

All routes return `{ error: string }` with a status code on failure, matching the
existing handlers exactly. All ids are parsed with `parseInt(…, 10)` and
`isNaN` → `400 { error: 'Invalid id' }`, as today.

### 7.1 Import

```
POST /api/trips/:id/planned-legs
Content-Type: multipart/form-data
  lnmpln:           one or more .lnmpln files   (multer field name, array, max 25)
  allow_duplicates: optional, "1" to import a file that duplicates an existing leg
```

Response `201`:

```
{
  "imported": PlannedLegWithChildren[],       // in final seq order (chain-sorted, see §9.2)
  "batch": { "ordering": "chain", "reason": "CHAINED" },
  "results": [
    { "filename": "LEBL-LEMD.lnmpln", "status": "imported",  "planned_leg_id": 12,
      "warnings": [{ "code": "CRUISE_ALT_F_MISSING", "message": "…" }] },
    { "filename": "same.lnmpln",      "status": "duplicate", "planned_leg_id": 9,
      "error": "Already imported into this trip as leg 3" },
    { "filename": "broken.lnmpln",    "status": "rejected",
      "error": "TOO_FEW_WAYPOINTS: plan has 1 waypoint, needs at least 2" }
  ]
}
```

| Status | When |
|---|---|
| `201` | at least one file was imported |
| `400` | invalid trip id; no files in the request; **every** file was rejected or was a duplicate (body still carries `results`, so the client can show per-file reasons); a multer limit was hit |
| `404` | trip does not exist |
| `500` | anything that is not an `LnmplnParseError` |

**Two orderings, deliberately different.** `results[]` has one entry per uploaded
file **in upload order**, so the user can map an error back to the file they
picked. `imported[]` is in **final `seq` order**, which after chain-sorting
(§9.2) is route order and generally *not* upload order. `batch.ordering` is
`"chain"` or `"upload"` and `batch.reason` is the `BatchChainReason` — the client
uses it to say "imported in route order" or "these plans do not form a single
chain, so they were imported in the order you picked them; drag to reorder".

**Batch failure policy (frozen): per-file outcomes, partial success allowed.**
Each file is parsed and inserted independently, and each insert is its own
transaction, so there is never a half-written leg. Dragging eight files and
having a ninth typo abort all of them is a worse outcome than importing eight and
naming the ninth. The all-or-nothing alternative was rejected for that reason.

**Upload limits.** A separate multer instance:

```
const MAX_LNMPLN_BYTES = 512 * 1024;      // a real plan is a few KB
const MAX_LNMPLN_FILES = 25;
const uploadLnmpln = multer({ storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LNMPLN_BYTES, files: MAX_LNMPLN_FILES } });
```

`MAX_FLIGHT_PLAN_BYTES` (20 MB, PDFs) and its `upload` instance are untouched.

**The shared error middleware needs one change.** The existing handler reports
`File too large (max 20MB)` for *any* `LIMIT_FILE_SIZE`, which would be a lie for
an oversized `.lnmpln`. `MulterError` carries `err.field`, so the message must be
chosen from it: `err.field === 'lnmpln'` → the LNMPLN limit, otherwise the PDF
limit. Also map `LIMIT_FILE_COUNT` to `Too many files (max 25)`. This is the only
change to existing code in T-004, and it is additive.

**Content sniffing.** A file is accepted only if, after BOM stripping and
`trimStart()`, it begins with `<`. `.lnmpln` has no magic number, so this is the
equivalent of the PDF feature's `isPdfBuffer`. Anything else is `rejected` with
`NOT_XML` before the parser is called. The filename extension is *not* trusted and
*not* required.

### 7.2 The rest of phase 1

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/trips/:id/planned-legs` | — | `200` `PlannedLegWithChildren[]`, ordered `seq ASC, id ASC`, children attached | `400` invalid id, `404` trip not found, `500` |
| `GET /api/planned-legs/:legId` | — | `200` `PlannedLegWithChildren` | `400`, `404`, `500` |
| `DELETE /api/planned-legs/:legId` | — | `200` `{ deleted: true }` | `400`, `404` (including a repeated delete), `500` |
| `PATCH /api/trips/:id/planned-legs/order` | `{ legIds: number[] }` | `200` `PlannedLegWithChildren[]` in the new order | `400` invalid id / not an array / not exactly the set of this trip's leg ids, `404` trip not found, `500` |

`PATCH /api/trips/:id/planned-legs/order` takes the **complete permutation**, not
a move instruction. It is idempotent, it cannot leave gaps or duplicates, and the
server can validate it exactly: the array must be the same multiset as
`SELECT id FROM planned_legs WHERE trip_id = ?`, otherwise `400
{ error: 'legIds must list every planned leg of this trip exactly once' }`.
Renumbering is `seq = index + 1` inside one transaction.

### 7.3 Route registration order

Register a new `// ── Planned legs ───` block **after** the existing `── Trips ──`
block and **before** the `── PDF export ──` block, so everything stays ahead of
`app.get('*')`.

Facts that determine the order:

- Express 4 matches `/api/trips/:id` against exactly three segments, so
  `/api/trips/5/planned-legs` (four segments) is **not** shadowed by it. No
  ordering constraint between them.
- `PATCH /api/trips/:id/planned-legs/order` is safe because there is deliberately
  **no** `/api/trips/:id/planned-legs/:legId` route — single-leg operations live
  under the separate `/api/planned-legs/:legId` prefix. If anyone ever adds one,
  `/order` must be registered first.
- `/api/planned-legs/…` and `/api/active-trip` are new top-level prefixes and
  cannot be shadowed by anything that exists.
- **`app.get('*')` catches every unmatched GET and returns `index.html` with a
  200.** A mistyped GET route therefore fails by serving HTML, not by 404ing —
  which is exactly why T-004's DoD demands a curl of every new path checking for a
  JSON content type. All new GET routes go before it. The multer error middleware
  stays last, after the catch-all, unchanged.

The single genuinely dangerous shape — a literal in the `:id` position, e.g.
`DELETE /api/trips/active` sitting behind `DELETE /api/trips/:id` — is avoided
entirely by putting the active-trip endpoints under `/api/active-trip` (§11.2).

### 7.4 Additive changes to existing endpoints

| Endpoint | Added |
|---|---|
| `GET /api/trips` | each trip gains `is_active: 0\|1`, `planned_leg_count: number`, and `planned_legs: []` (always empty here, mirroring the existing `points: []`) |
| `GET /api/trips/:id` | gains `is_active`, `planned_leg_count`, and `planned_legs: PlannedLegWithChildren[]` **fully populated** |
| `GET /api/flights`, `GET /api/flights/:id`, `PATCH /api/flights/:id` | each flight row gains `planned_leg_id`, `planned_leg_link_source`, `planned_leg_prev_trip_id` automatically, because these handlers use `SELECT *` |

No field is removed, renamed or retyped. `curl` before and after must show the
same keys plus these.

---

## 8. Where the planned route is delivered to the client

**Decision: `GET /api/trips/:id` embeds planned legs *with* their waypoints and
alternates. `GET /api/trips` embeds none. `GET /api/trips/:id/planned-legs`
exists as well, for refreshes.**

Reasons:

1. **`GET /api/trips/:id` already returns every recorded point of every flight in
   the trip.** A 2-hour flight is ~1,500 `flight_points` rows; a trip with ten
   flights ships megabytes today. A 30-waypoint planned leg is ~4 KB and twenty
   of them ~90 KB — two to three orders of magnitude below what the endpoint
   already sends. Splitting them out would optimise the wrong thing.
2. **The print path cannot afford a second fetch.** `/print/trip/:id` is rendered
   by Puppeteer and the export completes when `MapReadySignal` fires. Adding a
   second round trip that the map depends on introduces a race between "tiles
   loaded" and "planned route arrived", and the failure mode is a PDF that is
   silently missing the planned route. Embedding removes the race.
3. The trip map needs the whole chain on first paint to fit its bounds (T-008
   requires a fitted map for a trip that has planned legs and no flights).

`GET /api/trips/:id/planned-legs` is not redundant: after an import or a delete,
the client refreshes just the legs instead of re-downloading every flight point
(T-005 requires the page to update without a browser reload).

`GET /api/trips` stays light on purpose — it already deliberately sends
`points: []` — so the home page gets only `planned_leg_count` and `is_active`,
which is all a badge needs.

---

## 9. Re-import, ordering, reordering

### 9.1 Re-importing the same plan into the same trip

Each leg stores `source_sha256`, the SHA-256 of the **raw uploaded bytes**, and
`source_filename`.

On import, if a leg already exists in the *same trip* with the same
`source_sha256`:

- default: the file is **skipped**, reported as `status: "duplicate"` with the
  existing `planned_leg_id`, and nothing is written;
- with `allow_duplicates=1`: a second leg is created and appended.

Rationale: the common accident is re-dragging the same files, and silently
doubling the route quietly doubles the trip's planned distance — which then feeds
T-020's progress denominator. The escape hatch exists because deliberately flying
the same plan twice (a ferry back on the same route) is a real case.

Import **never mutates an existing leg**. There is no upsert and no "replace".
Editing a plan in Little Navmap and re-importing produces different bytes, hence
a different hash, hence a new leg; the user deletes the old one. This keeps
import a pure append and means no imported leg can change under a flight that is
already linked to it.

Hashing raw bytes (not the parsed content) means a BOM or a whitespace change
defeats the duplicate check. That is the conservative direction: a false "new
leg" is visible and deletable, a false "duplicate" silently loses an import.

### 9.2 Ordering — chain-sorted within a batch  *(amended 2026-09-04)*

`planned_legs.seq` is 1-based and dense within a trip. On import, new legs are
appended starting at `MAX(seq) + 1` for that trip, computed inside the same
transaction.

**Upload order is not route order.** The original freeze appended in multipart
order; the first three real files proved that wrong (see Amendment A). The rule
is now:

> After every file in the batch has been parsed, the successfully-imported legs
> are **chain-sorted**: each leg's `destination_ident` is matched to the next
> leg's `departure_ident`. The chain order is used **only when it resolves
> uniquely over the batch**. Otherwise upload order is kept and the response says
> so.

#### 9.2.1 The chain-resolution rule

> A working reference implementation of this rule, with the verification table
> below as executable cases, is at `prototypes/chain-sort.prototype.js`. It is a
> prototype, not a contract — where it and this section disagree, this section
> wins. `prototypes/parse-check.prototype.js` is the harness that validated the
> §5.1 parser configuration against the real files.


Over the set of legs about to be inserted in this batch, with idents compared
uppercase and trimmed:

1. **Eligibility.** Every leg in the batch must have
   `departure_is_airport && destination_is_airport`. If any leg is a snippet, the
   batch is not chain-sortable → `SNIPPET_IN_BATCH`. This is not fussiness: real
   files reuse USER idents (`WP1`, `WP2`, `WP3` appear in all three sample legs,
   §5.4), so chaining on non-airport idents would match unrelated legs together.
2. **Head.** Find every leg whose `departure_ident` is not any other leg's
   `destination_ident`. There must be **exactly one** → otherwise
   `NO_UNIQUE_HEAD`.
3. **Walk.** From the head, repeatedly find the unused leg whose
   `departure_ident` equals the current leg's `destination_ident`. There must be
   **exactly one** each time → two or more is `AMBIGUOUS_SUCCESSOR`, zero while
   legs remain unused is `BROKEN_CHAIN`.
4. **Consume.** The walk must consume every leg in the batch. Anything else falls
   back.
5. A batch of fewer than two legs is `SINGLE_LEG`: trivially ordered, **no
   warning**.

On success the reason is `CHAINED`. On any refusal the insert order is the
upload order, unchanged, and the batch reports the reason.

#### 9.2.2 Why this does not contradict "refuse, never guess"

§13.2 refuses to pick between two candidate legs at takeoff. This rule refuses in
exactly the same way, and for the same reason: a uniquely-resolving chain is a
**fact derived from the file contents**, not an inference. The moment more than
one reading exists, it stops sorting and says so. The verification cases —
checked against the rule before freezing it:

| Batch | Outcome |
|---|---|
| KSBA→KMRY, KMRY→KSTS, KSTS→KACV (the real files, uploaded in any order) | `CHAINED` — one head (KSBA is no leg's destination), each step has exactly one successor, all three consumed |
| **Round trip** A→B, B→A | **falls back**, `NO_UNIQUE_HEAD` — A is leg 2's destination and B is leg 1's, so there are *zero* heads |
| **Repeated visit** A→B, B→A, A→C | **falls back**, `NO_UNIQUE_HEAD` — zero heads again |
| **Repeated visit with a head** A→B, B→C, C→B, B→D | **falls back**, `AMBIGUOUS_SUCCESSOR` — A is a unique head, but B has two unused successors |
| Two unrelated plans A→B, C→D | **falls back**, `NO_UNIQUE_HEAD` — two heads |
| The same plan twice (`allow_duplicates=1`) A→B, A→B, B→C | **falls back**, `NO_UNIQUE_HEAD` — two heads |
| One file | `SINGLE_LEG`, silent |
| A circuit A→A | **falls back** if batched with others; silent `SINGLE_LEG` when alone |

The round trip is the case the rule most had to survive, and it falls back
cleanly. That matters because it is also the case §13.2 calls the common one.

#### 9.2.3 Scope and mechanics

- **Batch-local only.** Chain-sorting decides the order of the legs created by
  *this request*, among themselves. It never reads, reorders or renumbers legs
  already in the trip, and it never chains a new leg onto an existing one. Legs
  are still appended after `MAX(seq)`.
- **Only imported legs participate.** Files that were rejected or skipped as
  duplicates are not in the batch, so a batch reduced to a broken chain by a
  duplicate simply falls back — the conservative outcome.
- **The user's override is unchanged**: `PATCH /api/trips/:id/planned-legs/order`
  (§7.2) is authoritative and is never second-guessed by a later import.
- **Where it lives.** `chainOrderForBatch(plans: ParsedFlightPlan[])` is a pure
  function in `src/lnmpln.ts` (T-002), not in `src/server.ts`: it reads only
  parsed endpoints, needs no database, and belongs where `inspect-lnmpln.ts` can
  exercise it. **T-002 acceptance:**
  `src/inspect-lnmpln.ts` must print the resolved order
  `KSBA→KMRY, KMRY→KSTS, KSTS→KACV` from alphabetically-ordered input, and must
  print the fall-back reason for a synthesized A→B / B→A pair. **Name the three
  trip files explicitly; do not glob.**

  > *Corrected again 2026-09-05 (Orchestrator).* This first globbed
  > `samples/lnmpln/*.lnmpln`, then `VFR*.lnmpln`. Both are now wrong. A fifth
  > real file, `VFR Monterey Rgnl (KMRY) to San Francisco Intl (KSFO).lnmpln`,
  > also matches `VFR*` and gives KMRY two successors (KSTS and KSFO), so that
  > glob now correctly reports `AMBIGUOUS_SUCCESSOR`. **A glob is the wrong
  > shape for this assertion**: the fixture directory is expected to grow, and
  > every new file silently changes what the test asserts. Name the three files
  > of the trip. The ambiguity itself is not a defect — it is §9.2.1 refusing to
  > guess, and it is now demonstrated by real data rather than a synthesized
  > pair.

  > *Corrected 2026-09-04 (Orchestrator).* This line originally globbed
  > `samples/lnmpln/*.lnmpln` and was written before the IFR fixture arrived.
  > That glob is now **expected** to report `NO_UNIQUE_HEAD`, not `CHAINED`:
  > KSFO→KLAX belongs to a different trip, so the batch has two heads and
  > correctly falls back. The demonstration is stated against the VFR trio.
  > Do not "fix" the all-four glob to chain — that would mean the rule had
  > started guessing across unrelated trips.
  `src/server.ts` (T-004) calls it and inserts in the returned order.

Every read is `ORDER BY seq ASC, id ASC`. The `id` tiebreak makes the order total
even if two rows ever share a `seq`; do not rely on it, but do not omit it.

Reorder is the full-permutation `PATCH` of §7.2, renumbering 1..N in one
transaction. Deleting a leg leaves a gap in `seq` (2, 4, 5); this is intentional —
renumbering on delete would silently change the `seq` of legs the user did not
touch, and the ordering only ever needs to be *relative*.

### 9.3 How planned legs interleave with flown flights in the trip table

The server does not compute this; it is a pure client-side function over
`trip.flights` and `trip.planned_legs` (T-005). The rule, frozen:

1. The **flown spine** is `trip.flights` ordered by `start_time ASC` — exactly
   the order the table uses today. Flown rows are never reordered by this
   feature.
2. Each **unflown** planned leg (no linked flight) is inserted **immediately
   before the first flown flight in the spine that is linked to a planned leg
   with a higher `seq`**; if there is no such flight, it goes at the end.
3. Unflown legs that land in the same slot are ordered by `seq ASC, id ASC`.

This gives the right answer in all three real cases: import five plans then fly
leg 1 → legs 2–5 sit under the flown leg 1; a trip with old flights and freshly
imported plans → the plans sit at the bottom, where the future is; fly leg 3 out
of order → legs 1 and 2 appear above it. A trip with zero planned legs produces
byte-identical output to today, which is what T-005 requires.

---

## 10. The raw `.lnmpln` file is not kept

**Decision: the uploaded bytes are parsed in memory and discarded. Nothing is
written to disk. There is no `planned_routes/` directory.**

The alternatives and why they lose:

- **A file on disk, e.g. `planned_routes/<legId>.lnmpln`.** Planned legs are
  deleted by `ON DELETE CASCADE` when a trip is deleted — *inside SQLite*, with no
  application code running. Every such delete would orphan a file, invisibly,
  forever, unless `deleteTrip()` first enumerated the trip's legs to unlink them
  by hand. That is precisely the hand-management wart that already makes
  `combineFlights()` and `deleteFlight()` call `deleteFlightPlanFile()` at exactly
  the right moment, and this feature would make it worse by adding a cascade the
  application cannot see.
- **The raw XML in a `TEXT` column on `planned_legs`.** Lifecycle-clean, but it
  bloats every `SELECT *` on the table — including the one the matcher runs at
  takeoff — for a payload nothing renders.

What is kept instead, and why it is enough: `source_filename`, `source_sha256`,
and `source_program` (`ProgramName` + `ProgramVersion`, e.g. `Little Navmap
3.0.12`). Together with the import log line — which records filename, byte length,
sha256 and every warning code — that is enough to reproduce a mis-parse from the
user's own copy of the file, which they still have in Little Navmap. The
authoritative fixtures for parser behaviour live in `samples/lnmpln/` (T-002),
which is where a regression should be pinned anyway.

If "re-parse an old import after fixing the parser" is ever wanted, the right
shape is a side table `planned_leg_sources(planned_leg_id PRIMARY KEY, xml TEXT)`
so `planned_legs` stays lean and the cascade still cleans up. **Out of scope.**

---

## 11. Active-trip semantics

### 11.1 Where the flag lives

**Decision: `trips.is_active INTEGER NOT NULL DEFAULT 0`, plus the partial unique
index `idx_trips_active`.**

A single-row settings table was the alternative. The column wins because: this
codebase has no settings table and adding one for a single integer is a new
concept; `GET /api/trips` already selects from `trips`, so the badge on the home
page costs nothing (T-012 requires the client not to make a second call); and a
partial unique index gives a database-level "at most one" guarantee that a
settings row cannot give any more cheaply.

### 11.2 The statement sequence that guarantees at most one active trip

In `src/db.ts`, in **one** `db.transaction`, in **this order**:

```
setActiveTrip(tripId: number | null):
  BEGIN                                        (better-sqlite3 transaction)
  UPDATE trips SET is_active = 0 WHERE is_active = 1;      -- clear first, always
  if (tripId !== null)
    UPDATE trips SET is_active = 1 WHERE id = ?;           -- then set
  COMMIT
```

Clearing before setting is not stylistic: with `idx_trips_active` in place, the
reverse order raises `SQLITE_CONSTRAINT_UNIQUE` whenever another trip is already
active. The index is there to make the wrong order fail loudly rather than
silently produce two active trips.

`setActiveTrip(null)` clears the flag and is the "no active trip" state. Setting a
trip that does not exist changes nothing; the caller checks existence first and
returns 404.

After **any** sequence of activations,
`select count(*) from trips where is_active = 1` is 0 or 1. That is T-011's
acceptance check and it follows from the index, not from care.

### 11.3 Endpoints

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/active-trip` | — | `200 { "tripId": number \| null, "name": string \| null }` | `500` |
| `PUT /api/active-trip` | `{ "tripId": number \| null }` | `200 { "tripId", "name" }` | `400` body is not an integer or null, `404` trip not found, `500` |

Camel-cased because this is a computed payload, not a row (§17).

One `PUT` sets *and* clears, which removes the need for a `DELETE
/api/trips/active` — a literal sitting in the `:id` slot of the existing
`DELETE /api/trips/:id`, i.e. the one route shape that could shadow into a
destructive handler. The prefix `/api/active-trip` cannot collide with anything.

Deleting the active trip simply removes the row, so nothing is active afterwards;
no special case is needed.

---

## 12. The flight ↔ planned-leg link

### 12.1 Where it lives

**Decision: on `flights`, as `planned_leg_id`.** Not on `planned_legs`.

- `flights.trip_id` is already exactly this idiom — an integer link column on the
  flight row — and the client `Flight` type already mirrors it.
- Every handler that returns a flight uses `SELECT * FROM flights`, so the link
  ships with `GET /api/flights`, `GET /api/flights/:id`, the flights embedded in
  `GET /api/trips/:id`, and (later) `/api/status`, with **zero joins**. The
  mirror-image choice would need a correlated subquery in every one of them.

Uniqueness, both directions:

- *A flight has at most one planned leg*: it is a single column.
- *A planned leg has at most one flight*: `idx_flights_planned_leg`, a partial
  unique index on `flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL`.

The leg's side of the link is derived, never stored:

```
SELECT l.*, (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
FROM planned_legs l …
```

`linked_flight_id` is snake_case even though it is computed, because it rides on a
row payload — the same choice `getTrips()` already makes for `flight_count` and
`total_distance_nm`.

> **Reconciliation with T-011's DoD.** Its wording ("the leg's link column is
> NULL") assumes the link lives on `planned_legs`. T-010 assigns that choice to
> this document, and the choice is `flights.planned_leg_id`. T-011's check
> becomes: after deleting a linked flight,
> `select planned_leg_id from flights where planned_leg_id = <leg>` returns no
> rows, `select status from planned_legs where id = <leg>` returns `planned`, and
> the leg reappears in `getPlannedLegCandidatesForActiveTrip()` as an *eligible*
> candidate. Same guarantee, different query.

### 12.2 Unlink restores the previous trip

Linking may move a flight into the leg's trip. Unlinking must put it back, not
blindly `NULL` it.

- **On link**: `planned_leg_prev_trip_id := flights.trip_id` (whatever it is,
  including `NULL`), then `trip_id := leg.trip_id`, `planned_leg_id := leg.id`,
  `planned_leg_link_source := 'auto' | 'manual'`.
- **On unlink**: `trip_id := planned_leg_prev_trip_id`, then all three
  `planned_leg_*` columns := `NULL`.

One column suffices, with no "was it set?" flag, because every case restores
correctly: previously in no trip → `NULL` stored → `NULL` restored; previously in
another trip U → U restored; previously already in this trip T → T restored. The
column is only ever meaningful while `planned_leg_id` is non-null.

**Re-targeting** (`PUT` a different leg onto an already-linked flight) is
performed as a full unlink followed by a full link, in one transaction, so
`planned_leg_prev_trip_id` is never overwritten with a trip that a previous link
itself assigned.

### 12.3 Endpoints

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `PUT /api/flights/:id/planned-leg` | `{ "plannedLegId": number \| null }` | `200` the updated flight row (`getFlightById(id)`, matching `PATCH /api/flights/:id`) | `400` invalid id or body; `404` flight or leg not found; `409` that leg is already linked to flight N; `500` |
| `PATCH /api/planned-legs/:legId` | `{ "status": "planned" \| "skipped" }` | `200` `PlannedLegWithChildren` | `400` invalid id, or a status other than those two (`flown`/`diverted` are set by the system only); `404`; `409` cannot skip a leg that has a linked flight; `500` |

`null` unlinks. One endpoint, symmetric with `PUT /api/active-trip`.

**Manual linking is deliberately not restricted to the active trip.** Any leg of
any trip that is not already linked can be linked by hand. This is the escape
hatch, and it must not be constrained by the mechanism it exists to correct.

---

## 13. The auto-match algorithm

### 13.1 Signature

Pure, in `src/legMatcher.ts`. No import of `./db`, `./airports`, `fs` or `http`;
it imports only `./geo`. Full types in `contracts/planned-legs.d.ts`.

```
export const DEPARTURE_RADIUS_NM = 10;
export function matchPlannedLeg(input: LegMatchInput): LegMatchResult;
```

`LegMatchInput`: `{ lat, lon, startTime, aircraft, activeTripId, flightAlreadyLinkedTo, candidates, radiusNm? }`
`LegMatchResult`: `{ plannedLegId, tripId, reason, distanceNm, nearbyLegIds }`

`reason` is **always** set — on a match it is `MATCHED`. There is no path that
returns a bare `null` without a reason code; that is what makes every refusal
loggable and explainable in the UI.

### 13.2 The algorithm, step by step

The caller passes candidates in; the matcher does the filtering, so the T-015
scenario harness can exercise every refusal without a database.

```
0. if (flightAlreadyLinkedTo != null)          -> FLIGHT_ALREADY_LINKED
1. if (activeTripId == null)                   -> NO_ACTIVE_TRIP
2. pool = candidates where tripId === activeTripId
   if (pool empty)                             -> NO_PLANNED_LEGS
3. for each c in pool: d(c) = haversineNm(lat, lon, c.departureLat, c.departureLon)
4. near = pool where d(c) <= (radiusNm ?? DEPARTURE_RADIUS_NM)
   if (near empty)                             -> NO_LEG_IN_RADIUS
                                                  (distanceNm = min d over pool, for the log)
5. eligible = near where isEligible(c), with per-leg refusal precedence:
      c.status === 'flown' | 'diverted'        -> LEG_ALREADY_FLOWN
      c.status === 'skipped'                   -> LEG_SKIPPED
      c.linkedFlightId != null                 -> LEG_ALREADY_LINKED
      !c.departureIsAirport                    -> SNIPPET_NO_DEPARTURE_AIRPORT
   if (eligible empty) -> the refusal of the NEAREST leg in `near`
                          (so the message explains the specific obstacle)
6. if (eligible.length >= 2)                   -> AMBIGUOUS
                                                  nearbyLegIds = their ids, ascending
7. exactly one                                 -> MATCHED
```

Determinism: `haversineNm` is deterministic, the candidate list arrives in a
defined order (`seq ASC, id ASC`), `nearbyLegIds` is sorted, and no step depends
on iteration order. `startTime` and `aircraft` are carried for the log line and
for a future tie-break; **they do not influence the result in this version**, and
must not be quietly made to.

**Ambiguity is refused, never guessed.** No nearest-wins, no lowest-`seq`
tie-break. Two legs departing the same field is the common case in this domain
(A→B, B→A, A→C: legs 1 and 3 both depart A), and the cost is asymmetric — an
unlinked flight is one click to fix, a wrongly linked flight corrupts a trip's
record and the user may never notice. The saving grace, worth stating because it
is why the strict rule is affordable: by the time leg 3 is flown, leg 1 is
`flown` and linked, so step 5 filters it out and exactly one candidate remains.
Ambiguity survives only when the user genuinely has two *unflown* plans from the
same field — which is precisely when guessing would be wrong.

### 13.3 The radius, and why 10 nm

`DEPARTURE_RADIUS_NM = 10`, compared against the great-circle distance from the
takeoff position to `planned_legs.departure_lat/lon` — the departure **waypoint's**
position (the airport reference point), not `departure_pos_lat/lon` (the parking
spot from trap 12). The gate is within ~2 nm of the reference point, which is
noise at this scale, and using the waypoint avoids a null branch since
`Departure/Pos` is optional while the first waypoint is not.

*Confirmed by the real files (2026-09-04): none of the three Little Navmap 3.0.18
exports contains a `<Departure>` element at all, so `departure_pos_lat/lon` are
`NULL` in the common case (§5.4b). Had the matcher been written against the
parking spot it would have had nothing to match on for any real file imported so
far.*

Justification for the number:

- `FlightManager.startFlight()` fires after `AIRBORNE_DEBOUNCE_FRAMES = 3`
  consecutive frames with `!onGround && airspeedKnots > 30`. The agent polls
  SimConnect at `SimConnectPeriod.SECOND`, so that is ~3 s after rotation —
  roughly 0.15 nm at 150 kts. In the ordinary case the reported position is
  essentially over the field.
- The radius is not sized for that case, it is sized for the ragged ones: a large
  airport is ~3 nm across; the agent reconnects with `RECONNECT_DELAY_MS = 5000`
  and can miss the rotation entirely; MSFS can load the aircraft already airborne;
  a circuit never touches down. 10 nm covers all of these.
- **10 nm is exactly `findNearestAirport`'s default `maxNm`.** Using the same
  number means the flight's own `departure_icao` and the matched leg's
  `departure_ident` are resolved from the same neighbourhood, so they agree or
  both abstain. A different radius would create cases where the flight says LEBL
  and the leg says nothing, or vice versa.
- Widening it is not how a wrong match happens, because two planned departures
  within 10 nm of each other trigger `AMBIGUOUS` and refuse. The realistic failure
  is the opposite: a user who starts recording 200 nm out gets
  `NO_LEG_IN_RADIUS` and links by hand. That is the correct failure direction.

`plan.json` flags the radius as an open question expecting one tuning pass after
phase 4. It is a single exported constant with a `radiusNm` override on the input
precisely so that tuning is a one-line change plus a harness re-run.

Ident equality (`departure_ident === flight.departure_icao`) is deliberately
**not** a criterion: MSFS and Navigraph idents do not always agree with
OurAirports' `gps_code`, so requiring it would refuse valid matches, and it cannot
break a tie (both same-airport candidates share the ident). It is logged, not
tested.

### 13.4 Reason codes, verbatim

```
MATCHED
NO_ACTIVE_TRIP
NO_PLANNED_LEGS
NO_LEG_IN_RADIUS
AMBIGUOUS
LEG_ALREADY_FLOWN
LEG_ALREADY_LINKED
LEG_SKIPPED
SNIPPET_NO_DEPARTURE_AIRPORT
FLIGHT_ALREADY_LINKED
```

**`nearbyLegIds` is not one set.** For `AMBIGUOUS` it carries the *eligible* ids
— step 6's "their ids" — because an ineligible leg did not cause the ambiguity
and naming it would blame the wrong leg. For every other outcome reached after
the radius test it carries *all* ids within the radius, which is what §13.5's log
line means by "within 10 nm". Before the radius is usefully applied
(`NO_ACTIVE_TRIP`, `NO_PLANNED_LEGS`, `FLIGHT_ALREADY_LINKED`,
`NO_LEG_IN_RADIUS`) it is empty. Clarified 2026-09-05: T-015 found the two texts
disagreeing and implemented each where it speaks. Do not collapse them.

**`FLIGHT_ALREADY_LINKED` is unreachable from `startFlight()`, by construction.**
`insertFlight()` runs one line earlier, so a freshly inserted flight cannot
already hold a link and the argument is always `null` there. The guard stays
anyway: `matchPlannedLeg` is a pure function with its own harness, step 0 is
meaningful to any other caller, and a matcher that silently ignored an existing
link would be a worse function. Recorded 2026-09-05 (T-018 finding F-4) so the
next reader does not "clean up" a branch that production never takes and does not
mistake its absence from a production log sweep for a defect.

These strings are the contract between the matcher, the log, the API and the UI.
Do not rename them, do not localise them at the source, do not add a case without
adding it here. The UI maps each to one sentence; `AMBIGUOUS` names the candidate
legs from `nearbyLegIds`.

### 13.5 Integration, cost, and restarts (T-016)

- Called **once**, from `startFlight()`, immediately after the existing
  `findNearestAirport()` call and after `insertFlight()` (the flight id is needed
  to write the link). One extra query loads the candidates:
  `getPlannedLegCandidatesForActiveTrip()` — one indexed read over a table with tens
  of rows, joined to `trips` on `is_active = 1`.

  *Clarified 2026-09-05 (T-016).* The **matched** path costs a second read,
  `getPlannedLegById()`, because `LegMatchCandidate` carries `departureIdent` but
  no destination, and the log line below names the whole route. It runs once per
  flight and only on a match. "One extra query" above is a budget for the frame
  path and the common case; it is not a licence to drop the `LEBL→LEMD` fragment,
  which is most of the line's value when someone is working out why a flight
  attached to the wrong leg.
- **Never called from `onFrame`, `recordPoint` or `writePoint`.** A 50-frame
  simulated flight must produce exactly one match log line.
- **No new airport scan.** `findNearestAirport` is a linear scan over ~40k
  airports with no early exit, currently called twice per flight (start and end).
  This feature adds **zero** calls: the matcher works on the leg's own stored
  coordinates. So the linear scan does not matter here — it stays at two calls per
  flight, off the frame path. Optimising it is out of scope; making it per-frame
  is forbidden.
- **Logging.** One line per flight start, in the existing `[FlightManager]` style,
  on both outcomes:
  `[FlightManager] Flight #42 linked to planned leg #7 (LEBL→LEMD, 1.2 nm, MATCHED)`
  or `[FlightManager] Flight #42 not linked — AMBIGUOUS (legs 7, 11 within 10 nm)`.
  A non-match is never silent.
- **Restart safety.** The link is a persisted column written in the same code path
  as the flight row, at takeoff. A server restart mid-flight loses the in-memory
  `FlightManager` state exactly as it does today (an already-known behaviour) but
  loses nothing about the link. Nothing is held only in memory.
- **A flight recorded with no active trip must produce a row identical, column for
  column, to one recorded before this change** — the three new columns are `NULL`
  and nothing else differs.

---

## 14. Landing: what happens when the arrival is not the planned destination

In `endFlight()`, after the existing `closeFlight()`, and only if the flight has
a `planned_leg_id`:

```
ARRIVAL_RADIUS_NM = 10                          -- same rationale as the departure radius
deviation = haversineNm(frame.lat, frame.lon, leg.destination_lat, leg.destination_lon)
if (deviation <= ARRIVAL_RADIUS_NM)  leg.status := 'flown'
else                                  leg.status := 'diverted'
leg.arrival_deviation_nm := round(deviation, 1)          -- recorded in both cases
```

**The link is kept either way. A diversion never auto-unlinks.**

Why: the link records *intent* — this flight was flown as this planned leg — and
that stays true when the destination changes. Unlinking would erase the only
record that the leg was attempted, and would return the leg to `planned`, where a
later takeoff from the same field could match it again. Keeping the link with a
`diverted` status makes the deviation a visible fact rather than a silent
absence.

`arrival_deviation_nm` is written on **both** paths, so the trip page can show
"flown, 3.1 nm from plan" as well as "diverted, 47 nm from LEMD".

The UI shows, on the leg row: the badge `Diverted`, the planned destination
ident, the actual arrival (`flights.arrival_icao`, or the coordinates when it did
not resolve), the deviation in nm, and an unlink control. A `diverted` leg is not
re-matchable (§13.2 step 5). Unlinking resets it to `planned` and clears
`arrival_deviation_nm`, which is how the user reopens it.

Logged in one line either way:
`[FlightManager] Flight #42 landed 47.2 nm from planned LEMD — leg #7 marked diverted`.

---

## 15. Planned-leg state machine

Five user-visible states from one stored column plus the derived link:

| State | Stored | Meaning |
|---|---|---|
| `imported` | `status='planned'`, no linked flight | on the plan, not yet attempted |
| `linked` | `status='planned'`, linked flight with `end_time IS NULL` | being flown right now |
| `flown` | `status='flown'` | landed within `ARRIVAL_RADIUS_NM` of the planned destination |
| `diverted` | `status='diverted'` | landed elsewhere; link kept, `arrival_deviation_nm` recorded |
| `skipped` | `status='skipped'` | the user decided not to fly it |

`status` is constrained by a `CHECK (status IN ('planned','flown','diverted','skipped'))`
in the DDL. This is the one place this design adds a construct the codebase does
not already use, and it is deliberate: it turns a typo'd `'DIVERTED'` into an
immediate exception instead of a leg that silently never matches again.

Transitions — every one, and who triggers it:

| From | To | Trigger | Actor |
|---|---|---|---|
| `imported` | `linked` | auto-match at takeoff returns `MATCHED` | `FlightManager.startFlight()` (T-016) |
| `imported` | `linked` | `PUT /api/flights/:id/planned-leg` with a leg id | user |
| `linked` | `flown` | landing within `ARRIVAL_RADIUS_NM` | `FlightManager.endFlight()` |
| `linked` | `diverted` | landing outside `ARRIVAL_RADIUS_NM` | `FlightManager.endFlight()` |
| `linked` | `imported` | `PUT … { plannedLegId: null }` | user (escape hatch) |
| `linked` | `imported` | the linked flight is deleted | `deleteFlight()` (§16) |
| `linked` | `imported` | the linked flight is combined with another | `combineFlights()` (§16) |
| `flown` / `diverted` | `imported` | unlink; also clears `arrival_deviation_nm` | user |
| `flown` / `diverted` | `imported` | the linked flight is deleted or combined | `deleteFlight()` / `combineFlights()` |
| `imported` | `skipped` | `PATCH /api/planned-legs/:legId {status:'skipped'}` | user |
| `skipped` | `imported` | `PATCH … {status:'planned'}` | user |
| any | *(gone)* | `DELETE /api/planned-legs/:legId` | user |
| any | *(gone)* | the trip is deleted | SQLite `ON DELETE CASCADE` |

Two rules that fall out and must be respected:

- **Only `planned` legs are auto-match candidates.** `flown`, `diverted` and
  `skipped` are all filtered in step 5, each with its own reason code.
- **`flown` and `diverted` are set by the system only.** The `PATCH` endpoint
  accepts `planned` and `skipped` and nothing else; a client cannot declare a leg
  flown.
- **A linked leg's status is not the user's to set at all** *(2026-09-05, T-018
  finding F-1)*. `setPlannedLegStatus` refuses with a 409 naming the flight
  whenever the leg still has one. The narrow bug was `PATCH {status:'planned'}`
  on a linked `flown`/`diverted` leg: it returned 200, destroyed
  `arrival_deviation_nm`, and kept the link — a state this table does not
  define. The guard is deliberately wider than that one case, because the table
  already says the only route out of `flown`/`diverted` is **unlink**, which
  clears the deviation precisely because the link is going away with it.
  Consequence worth knowing: a `skipped` leg that was then linked by hand cannot
  be un-skipped directly; unlink it first. That combination is contradictory
  anyway — a leg with a flight attached is not skipped — and the 409 says so.

There is no `linked` value in the `status` column on purpose: "linked" is
`status='planned'` plus the existence of the link, so the two facts can never
drift apart.

---

## 16. Lifecycle interactions with existing code

Three existing functions in `src/db.ts` need a line. All three are the same shape
as the `deleteFlightPlanFile()` calls already sitting in them — and they are
needed for the same reason: SQLite cannot clean up the *other* side of the link.

**`deleteFlight(id)`** — the FK is on `flights.planned_leg_id`, so deleting the
flight row removes the link but leaves `planned_legs.status` at `flown`, i.e. a
leg permanently flown by a flight that no longer exists. Before the `DELETE`,
call a shared helper:

```
clearPlannedLegLink(flightId):        -- one transaction
   UPDATE planned_legs SET status = 'planned', arrival_deviation_nm = NULL
     WHERE id = (SELECT planned_leg_id FROM flights WHERE id = ?);
   UPDATE flights SET planned_leg_id = NULL, planned_leg_link_source = NULL,
                      planned_leg_prev_trip_id = NULL
     WHERE id = ?;
```

Note this helper does **not** restore `trip_id` — the flight is being destroyed.
The user-facing unlink (§12.2) is a different function that does restore it.

**`combineFlights(a, b)`** — it deletes both source flights with a raw
`DELETE FROM flights` (not through `deleteFlight`), so it must call
`clearPlannedLegLink()` on **both** source flights, resetting both legs to
`planned`. The link is **not** carried over to the combined flight, unlike the
PDF attachment. Reason, and it should be written as a comment in the code: the
existing `INSERT` in `combineFlights` does not carry `trip_id` either, so a
carried-over leg link would put the new flight in no trip while claiming a leg
that belongs to one. Combining is a repair operation; the user re-links by hand
with the escape hatch. This is a known, documented limitation, not an oversight.

**`deleteTrip(id)`** — *amended, see Amendment C.* The cascade handles legs,
waypoints, alternates and the `SET NULL` on linked flights, and a flight that was
in the trip by ordinary assignment still keeps its dangling `trip_id` exactly as
today. But a flight a **link** moved into the trip is different in kind, and the
cascade strands it: `planned_leg_id` is nulled, the dead `trip_id` stays, and
`planned_leg_prev_trip_id` — the record of where the flight came from — is
discarded unread. So before the delete, in the same transaction, restore
`trip_id` from `planned_leg_prev_trip_id` and clear all three `planned_leg_*`
columns for every flight whose `planned_leg_id` belongs to a leg of this trip.
The rows must be read *before* the cascade fires; afterwards the association is
gone. Only link-moved flights are touched.

**`deletePlannedLeg(legId)`** — the cascade handles the children and the
`SET NULL`, but the flight's two bookkeeping columns must be cleared too, and its
`trip_id` restored from `planned_leg_prev_trip_id`, in the same transaction as the
delete. Deleting a leg must never leave a flight in a trip it was moved into by a
link that no longer exists.

---

## 17. Client type mirror — exactly what to add to `client/src/types.ts`

`client/src/types.ts` is hand-maintained and must mirror the server field for
field, including nullability. Add:

```
export interface PlannedWaypoint { … }              // mirrors src/types.ts
export interface PlannedAlternate { … }
export interface PlannedLeg { … }
export interface PlannedLegWithChildren extends PlannedLeg {
  linked_flight_id: number | null;
  waypoints: PlannedWaypoint[];
  alternates: PlannedAlternate[];
}
export type PlannedLegStatus = 'planned' | 'flown' | 'diverted' | 'skipped';
export interface PlannedLegImportResult { … }       // per-file outcome
export interface PlannedLegImportResponse { … }
export interface ActiveTrip { tripId: number | null; name: string | null }
```

Extend the existing interfaces:

```
Flight  += planned_leg_id: number | null
        += planned_leg_link_source: 'auto' | 'manual' | null
        += planned_leg_prev_trip_id: number | null

Trip    += is_active: number                  // 0 | 1, SQLite has no boolean
        += planned_leg_count: number
        += planned_legs: PlannedLegWithChildren[]   // [] from GET /api/trips
```

Note the client `Trip` is used for both the list and the detail response, so
`planned_legs` is required and empty in the list — mirroring how `flights[].points`
already arrives empty from `GET /api/trips`. Do not make it optional; an empty
array is the honest shape and removes a `?.` from every consumer.

Naming convention, as elsewhere in this codebase: **snake_case for anything that
is a persisted row or a row-shaped aggregate** (`planned_leg_id`,
`linked_flight_id`, `planned_leg_count` — following `flight_count`,
`total_distance_nm`), **camelCase for computed payloads** (`ActiveTrip.tripId`,
everything in `ParsedFlightPlan`, everything in `LegMatchResult` — following
`src/journey.ts`, whose `Journey` type is entirely camelCase).

---

## 18. UI contract notes that bind later tasks

- **Colour.** `LEG_COLORS` is `['#60a5fa','#34d399','#f59e0b','#a78bfa','#f87171']`.
  The planned route uses a colour outside that palette — frozen as `#94a3b8`
  (slate), dashed (`dashArray: '6 6'`), `weight: 2`, drawn **beneath** flown
  tracks. The visual language is identical on the trip map (T-008), the flight map
  (T-017) and the printed map (T-021).
- **Ghost rows.** Planned legs appear in the existing legs table, dimmed, with a
  `Planned` badge, ordered by §9.3. A leg with `is_snippet = 1` shows its idents
  without claiming they are airports and carries a `Snippet` badge.
- **`approx.`** prefixes every planned distance, everywhere (§6).
- **Waypoint markers are qualified by their leg.** A tooltip reads `Leg 2 · WP1`,
  never `WP1`, and React keys are `${legId}-${seq}`, never the ident: real files
  number their user waypoints `WP1`/`WP2`/`WP3` in *every* leg (§5.4c). This binds
  T-008 (trip map markers) and T-017 (flight map) directly.
- **Altitudes.** The leg row and tooltips show `cruise_alt_ft` as the planned
  altitude. A waypoint's `alt_ft` is a computed profile value and is never
  labelled planned or constraint (§6.1).
- **Expect the planned line and the flown track to disagree** at both ends of an
  IFR leg, by tens of miles. It is correct, it is never "fixed" by snapping the
  planned line, and neither T-008 nor T-017 may read it as a defect (§6.2).
- **Procedures on the leg row.** `SID WESLA5 · 28L · SUSEY` / `STAR IRNMN2 · 24R ·
  BURGL` / `APP KLAX24R · 24R`. Where `approach_type` is `CUSTOM` the row says so,
  because the name is a synthesized label rather than a published procedure
  (§5.4g).
- **A trip with no planned legs and no active flag renders exactly as it does
  today.** Every one of T-005, T-008, T-013, T-020 and T-021 has this as an
  acceptance criterion; it is the same requirement stated five times, and it means
  every new element is conditional on data that did not exist before.

---

## 19. Forward notes for phases 4–5 (not designed here, but constrained here)

So that phase 5 does not need a second design pass:

- **`/api/status` (T-019)** gains a `plannedLeg` key **only** while
  `flightState === 'FLYING'` and the current flight has a link; otherwise the
  payload is byte-identical to today. Shape is camelCase (computed):
  `{ plannedLegId, tripId, tripName, destinationIdent, nextWaypointIdent,
  remainingDistanceNm, distanceIsApproximate: true }`. `FlightManager` caches the
  leg and its waypoints in memory **once, at link time**, so a 1 Hz status poll
  never re-queries.
- **`buildJourney()` (T-020)** takes planned legs as a second, optional argument
  and returns progress as `flownDistanceNm / totalApproxPlannedDistanceNm`,
  clamped to 0..100, `null` when the trip has no planned legs. The existing
  comment in `src/journey.ts` is updated in place — it is the note that says
  progress must be measured along the planned route, and it becomes true rather
  than aspirational.

---

## 20. What a Dispatcher must NOT change

Anything in this list requires escalating to the Orchestrator first.

**The PDF flight-plan feature — entirely.**
1. `flights.flight_plan_name`, `src/flightPlans.ts`, the `flight_plans/` directory
   and its `<flightId>.pdf` naming.
2. `POST/GET/DELETE /api/flights/:id/flight-plan`, `MAX_FLIGHT_PLAN_BYTES = 20 MB`
   and its `upload` multer instance.
3. The meaning of `?plans=0` on the export routes, and the "Include flight plans
   (N)" label. `planCount` in `TripDetail.tsx` counts PDFs and keeps counting PDFs.

**Schema.**
4. No existing column renamed, retyped, dropped, or reordered. Additive only.
5. The `CREATE TABLE` bodies of `flights`, `flight_points` and `trips` stay as
   they are; new columns arrive only through the `PRAGMA table_info` +
   `ALTER TABLE ADD COLUMN` block.
6. Do **not** add a foreign key to `flights.trip_id`.
7. Do not drop `idx_flights_planned_leg` or `idx_trips_active`, and do not
   "resolve" a `SQLITE_CONSTRAINT` from them by removing the index — it means the
   statement order is wrong.
8. No JSON columns. No ORM. No migration framework.

**The flight state machine.**
9. `AIRBORNE_DEBOUNCE_FRAMES`, `LANDED_DEBOUNCE_FRAMES`, `RECORD_INTERVAL_MS`,
   `MAX_COUNTED_GAP_MS`, and the `activeMs` / `interrupted` duration accounting.
10. `findNearestAirport`'s signature and its `maxNm = 10` default; it stays at two
    calls per flight and never enters the frame path.
11. The matcher runs once per flight start. Nothing this feature adds may run per
    frame.
12. `combineFlights()`'s filler-point interpolation and its `ownDurationSec` rule.

**HTTP.**
13. `app.get('*')` stays the last GET route; the multer error middleware stays
    last overall. New routes go before both.
14. Existing endpoints stay additive-only in their responses; no key removed or
    renamed.
15. No route segment that puts a literal in an existing `:id` position.

**Parser.**
16. Do not set `preserveOrder: true`; do not enable `parseTagValue` /
    `parseAttributeValue`; do not run `XMLValidator`. §5.1 explains each.
17. `distanceIsApproximate` stays the literal type `true`; the `approx.` prefix is
    not optional in any view.
18. Do not "fix" a rejection by relaxing a coordinate range check.

**Process.**
19. No test framework, no new client state library, no new runtime dependency
    beyond `fast-xml-parser`.
20. Do not delete the comment in `src/journey.ts`; T-020 updates it in place.
21. Do not migrate the three existing private `haversineNm` copies onto
    `src/geo.ts` in this feature (§4.1).

**Amendment A (2026-09-04).**
22. Do not branch, gate, warn or reject on `FileVersion` or `ProgramVersion`
    (§5.4a). The real files are `1.2`; the manual says `1.0`.
23. Do not key, dedupe, join or label a waypoint by ident alone, anywhere,
    including map markers and tooltips (§5.4c). USER idents repeat across legs.
24. Do not present `Pos/@Alt` as a planned or constraint altitude (§6.1). It is a
    computed profile value; `cruise_alt_ft` is the leg's planned altitude.
25. Do not chain-sort across an import boundary, and do not renumber existing
    legs on import (§9.2.3). Chain-sorting is batch-local; the reorder `PATCH`
    is the user's authoritative override.
26. Do not add a tie-break to the chain-resolution rule (§9.2.1). Anything that
    does not resolve uniquely falls back to upload order and says so.

**Amendment B (2026-09-04).**
27. Do not reject, and do not add a rejection code for, an element the XSD does
    not declare (§5.4e). `<CustomOffsetAngle>` is in a real file and in no
    version of the schema. Unknown elements are skipped and reported as
    `UNKNOWN_ELEMENT` warnings.
28. Do not drop procedure fields to "simplify" the eighteen columns (§2.2.1), and
    do not model procedure *legs* as rows — the file never contains them.
29. Do not snap, warp or clip the planned route toward the flown track, and do
    not treat their divergence as a bug or as a match failure (§6.2). Do not
    reintroduce a fixed nm correction factor for the procedure gap (§6).

---

## 21. Residual risks this design does not remove

1. **Real-file coverage is now partial, not absent** *(revised twice, latest
   2026-09-04 Amendment B)*. Four genuine Little Navmap 3.0.18 exports are in
   `samples/lnmpln/`: three VFR legs that chain into one trip, and one IFR plan
   with procedures. Between them they retire the worst of this risk — the §5.1
   parser configuration, `@_Lat`/`@_Lon` attribute access, string-preserving
   idents, the endpoint/`isAirport` rule, the great-circle distance sums (201.2 /
   140.0 / 191.1 and 293.5 nm, all independently reproduced), a full `±HH:MM`
   `CreationDate`, and now `<Procedures>` including a custom approach. Each new
   file found a real defect that no synthesized fixture would have: the VFR trio
   found the §9.2 ordering defect, the IFR plan found the §2.2.1 procedure-column
   loss and corrected §6's error estimate.

   What they still do **not** cover, so these remain synthesized-only and can be
   self-consistently wrong:

   | Trap | Still unexercised by real data |
   |---|---|
   | 4 | multiple `<Waypoints>` blocks — all four files have exactly one |
   | 4, 8 | **`<Alternates>` — no real file contains the element at all**, so neither the multi-block concatenation nor the optional `<Pos>` on an alternate has ever been seen in genuine output |
   | 7 | XML comments, and the manual's unbalanced/nested comment block |
   | 8 | a missing `Pos/@Alt` on a waypoint |
   | 10 | the **two-digit** offset form (`+02`); all four real files use a full `-03:00`, which parses natively |
   | 11 | a UTF-8 BOM |
   | 12 | `<Departure>` — absent from four of four, which is itself the finding in §5.4b |
   | — | every rejection path (`synthetic/bad-*.lnmpln`) |
   | — | `SID Type=CUSTOMDEPART`, and every approach field except `Name/Runway/Type/Custom*` |

   The matcher's `AMBIGUOUS` path is also unexercised: no two real legs depart the
   same field, which is precisely the shape §13.2 is built to refuse. T-015's
   scenario table must still cover it with synthesized candidates.

   The remaining high-value real file is one with an **alternate** — ideally an
   IFR plan with `<Alternates>` and a published (non-custom) approach, which would
   close the last cluster of untested format surface.
2. **The 10 nm radius is a reasoned guess** calibrated against the debounce and
   `findNearestAirport`, not against observed takeoffs. Expect one tuning pass.
   It is one constant with a per-call override.
3. **Combining flights drops a leg link** (§16), by design. If that turns out to
   annoy in practice, the fix is to carry `trip_id` *and* the link together — a
   change to `combineFlights` that is out of scope here.
4. **`seq` gaps after deletes** are intentional and could look odd if any view
   ever renders `seq` as "Leg N". Render positional indices, not `seq`.

---

## 22. DoD traceability

**T-001** — DDL for the three tables §2.2 + `contracts/schema.sql`; columns on
existing tables and the `PRAGMA`/`ALTER` idiom §2.3, §3; `ON DELETE` behaviour and
what happens to a leg when its trip is deleted §2.4; `ParsedFlightPlan` declared
in `src/lnmpln.ts` with row types in `src/types.ts` §4, `contracts/planned-legs.d.ts`;
all 12 traps mapped to a field or a rule §5.2 (incl. `isSnippet`, `cruiseAltFt`,
`remarks`, `createdAt`, `approxDistanceNm` + `distanceIsApproximate`); phase-1
REST surface with methods, shapes and statuses §7, route ordering §7.3; embedding
decision and reason §8; batch-import failure policy §7.1; no implementation code
beyond stubs and DDL.

**T-010** — where the active flag lives and the exact statement sequence §11.1,
§11.2; the link's table and both uniqueness rules §12.1; unlink restores the prior
`trip_id` §12.2; pure function signature with inputs, chosen leg or null plus a
reason code §13.1, `contracts/planned-legs.d.ts`; radius in nm justified against
the airborne debounce §13.3; every refusal rule enumerated §13.2; landing
behaviour and what the user sees §14; once per flight start, no per-frame cost, no
second airport scan §13.5; restart behaviour §13.5; reason codes verbatim §13.4;
state machine with every transition and its actor §15; no implementation code
beyond the signature and the enum.
