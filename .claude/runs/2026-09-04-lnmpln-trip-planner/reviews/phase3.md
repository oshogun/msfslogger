# T-014 — Review of phase 3 (T-011, T-012, T-013: active trip + the manual escape hatch)

**Overall verdict: `request_changes`.** The escape hatch itself works — I drove it
end to end in a real browser and every state reachable by linking can be undone
by unlinking, from the UI, without touching the database. Nothing here is
broken. But four things must be settled before T-015/T-016 are written, two of
them the adjudications the Orchestrator referred to me, and two of them paths
that silently destroy data the moment T-016 starts writing arrival state:

- **F-1** `PATCH /api/planned-legs/:legId {status:'planned'}` on a `flown` leg
  leaves `arrival_deviation_nm` set (a state §15 has no name for).
- **F-2** (= adjudication B) re-linking a flight to the leg it already holds
  silently resets `flown` → `planned` and discards the recorded deviation.
- **F-3** (= adjudication A) the candidate query pre-filters `flown`/`diverted`,
  so `LEG_ALREADY_FLOWN` can never fire in production and the user gets a
  misleading `NO_LEG_IN_RADIUS` at 160 nm instead.
- **F-4** the active-trip control renders on every trip page, so a trip with no
  planned legs and no active flag does **not** render as it did before —
  T-013 DoD 8 and design.md §18 both say it must.

Per-task verdicts: **T-011 `request_changes`** (F-2, F-3, F-6), **T-012
`request_changes`** (F-1), **T-013 `request_changes`** (F-4). None of the fixes
is large: three of them are one to three lines, F-4 is a product decision.

Diff reviewed: `git diff 8cec371` for `src/db.ts`, `src/types.ts`,
`src/server.ts`, `client/src/pages/TripDetail.tsx`,
`client/src/components/PlannedLegRows.tsx`, `client/src/pages/Home.tsx`,
`client/src/index.css` (uncommitted working-tree changes on
`feat/lnmpln-trip-planner-phase3`). `client/src/App.tsx`,
`client/src/pages/Override.tsx` and the `── The Override ──` block at
`client/src/index.css:625-645` are the user's own unrelated feature and are out
of scope — **confirmed not disturbed**: `App.tsx`'s only diff is the two
`Override` lines, `Override.tsx` is untracked and untouched, and phase 3's CSS
sits in its own block at `index.css:412-441`, 180 lines above the Override block
with no overlap.

Everything below marked **[executed]** was reproduced by me. Claims marked
**[read]** are from reading the code and are labelled as such. The environment:
`npm run backup` → `backups/20260905-035758` (34 flights / 1 trip / 1 planned
leg / 0 active), a scratch server on port **3911** against that copy, a
`git worktree` at `8cec371` with its own server on **3912** and a second
phase-3 server on **3913** for the fresh-database comparison, the three real VFR
fixtures imported into one trip and the IFR fixture into another, and a
headless-Chromium harness (puppeteer, already a project dependency) driving the
real running app. Port 3000 (the user's own server) was never touched. The live
`flights.db` was opened read-only once and is re-verified at the end.

---

## T-011 — `src/db.ts`, `src/types.ts` — verdict: `request_changes`

| # | definition_of_done | verdict |
|---|---|---|
| 1 | DDL already added by T-003; this task owns only the functions; verify, do not re-add | **holds [executed]** |
| 2 | active-trip flag persisted per T-010, additive `PRAGMA table_info` + `ALTER TABLE` | **holds [executed]** |
| 3 | after any sequence of activations, `count(*) where is_active=1` is 0 or 1 | **holds [executed]** |
| 4 | link columns additive; existing rows NULL and otherwise untouched | **holds [executed]** |
| 5 | link/unlink exported; unlink restores the prior `trip_id` | **holds [executed]** |
| 6 | double-link fails loudly rather than overwriting | **holds [executed]** |
| 7 | deleting a flight clears the link, leaves the leg unflown and re-linkable | **holds [executed]** |
| 8 | deleting a planned leg clears the link, flight and trip membership intact | **holds [executed]** |
| 9 | restarting twice against the same DB: no error, no duplicate columns | **holds [executed]** |

**1, 2, 4, 9 — the migration.** The diff touches no DDL at all (`git diff`
confirms `src/db.ts:240-290` is unchanged), which is correct per the amendment.
I ran `initDb()` three times in a row against a copy: `flights` stays at 23
columns with zero duplicates every time, `trips` is
`id,name,notes,created_at,is_active`, and both partial unique indexes are
present with exactly the frozen definitions (`idx_flights_planned_leg ON
flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL`, `idx_trips_active ON
trips(is_active) WHERE is_active = 1`). Stronger: I dumped `sqlite_master` from
a fresh database created by the **8cec371 worktree** and from one created by the
phase-3 working tree and `diff`'d them — **byte-identical**. Nothing in this
phase alters, renames, drops or reorders any table, column or index.

**3 — the at-most-one-active-trip invariant. Verified independently, not taken
on T-011's word. [executed]** Twelve activations in sequence through
`PUT /api/active-trip`, querying `trips` with `better-sqlite3` after each:
`1 → 2 → 2 → 2 → 3 → null → null → 1 → 3 → 2 → null → 1`. `count(*) where
is_active = 1` was 1 or 0 at every single step, never 2, including the three
consecutive re-activations of the same trip and both consecutive
`setActiveTrip(null)` calls. Then 60 concurrent `PUT`s alternating
`{1}`/`{2}`/`{null}`: 60× HTTP 200, zero `SQLITE_CONSTRAINT` in the server log,
count 0 at the end. The statement order at `src/db.ts:954-961` (clear first,
then set) is doing its job.

**5 — unlink restores the prior `trip_id`. Verified independently, all three
cases. [executed]** Using real flights from the logbook copy:

| case | before | after link | after unlink |
|---|---|---|---|
| previously **no trip** — flight 1 → leg 5 (trip 2) | `trip_id=NULL` | `trip_id=2, leg=5, src=manual, prev=NULL` | `trip_id=NULL`, all three columns NULL |
| previously **another trip** — flight 2 (trip 3) → leg 5 (trip 2) | `trip_id=3` | `trip_id=2, leg=5, prev=3` | `trip_id=3`, all NULL |
| previously **the leg's own trip** — flight 3 (trip 1) → leg 4 (trip 1) | `trip_id=1` | `trip_id=1, leg=4, prev=1` | `trip_id=1`, all NULL |

Not nulled in any case. `src/db.ts:1109-1136`.

**6 — double-link. [executed]** Flight 4 → leg 5 while flight 2 holds it:
`409 {"error":"Planned leg 5 is already linked to flight 2"}`, flight 4
untouched (`planned_leg_id` still NULL), flight 2 untouched. The explicit
`holder` check at `src/db.ts:1074-1079` names the offending flight, which is
what the 409 body needs; `idx_flights_planned_leg` stands behind it.

**7 — deleting a linked flight. [executed]** Linked flight 4 (trip 1) to leg 6
(trip 2), then wrote `status='flown', arrival_deviation_nm=7.7` on leg 6 to
stand in for what T-016 will do, then `DELETE /api/flights/4`. Leg 6 came back
`status='planned', arrival_deviation_nm=NULL, linked_flight_id=NULL`. A sweep
for dangling links (`planned_leg_id` pointing at a missing leg) and for orphan
bookkeeping (`planned_leg_id IS NULL` but `link_source`/`prev_trip_id` set)
returned empty. `src/db.ts:410` + `:1139-1163`.

**8 — deleting a linked planned leg. [executed]** Linked flight 7 (trip 1) to
leg 6 (trip 2) → `trip_id=2, prev=1`; wrote `flown/2.2` on the leg;
`DELETE /api/planned-legs/6`. Flight 7 came back `trip_id=1`, all three
`planned_leg_*` columns NULL. `deletePlannedLeg` (`src/db.ts:872-895`,
unchanged in this diff) already does the restore §16 asks for.

### Adversarial probes on T-011

- **Force `SQLITE_CONSTRAINT_UNIQUE` from `idx_trips_active` — could not, which
  is the right answer. [executed]** Beyond the sequences and the 60-way
  concurrent hammer above, I checked the only other writer: `updateTrip`
  (`src/db.ts:481-490`) has a hard allow-list of `['name','notes']`, so
  `PATCH /api/trips/:id` cannot set `is_active`, and `createTrip` never inserts
  it. `setActiveTrip` is the sole path and it clears before it sets. The order
  in §11.2 is doing its job.
- **Re-target leg 1 → leg 2 in a single `linkFlightToPlannedLeg` call.
  Verified myself, not taken from T-011's report. [executed]** Flight 2,
  originally trip 3. `PUT {plannedLegId:5}` (leg 5 is in trip 2) →
  `trip_id=2, prev=3`. Then, in one call, `PUT {plannedLegId:4}` (leg 4 is in
  trip 1) → `trip_id=1, leg=4, **prev=3**` — the *original* trip, not the trip
  the first link moved it into. Unlinking then returned it to trip 3. The
  re-read at `src/db.ts:1088-1090`, after the nested unlink, is what makes this
  correct, and the comment says so.
- **`combineFlights` with both flights linked. [executed]** Flight 10 → leg 4
  (`flown`, dev 1.1), flight 11 → leg 7 (`diverted`, dev 44.0), then
  `POST /api/flights/combine`. Both legs came back `planned` with
  `arrival_deviation_nm=NULL` and no linked flight; both source rows gone; the
  combined flight has `planned_leg_id=NULL` and (as before this feature)
  `trip_id=NULL`. No dangling link, no leg stuck in a non-`planned` status
  without a flight. `src/db.ts:639-640`, inside the existing outer
  `db.transaction` at `:526`.
- **`deleteTrip` needs no change — confirmed, with one caveat. [executed]**
  Linked flight 9 (trip 1) to leg 9 (trip 3) → `trip_id=3, prev=1`, then
  `DELETE /api/trips/3`. As T-011 flagged, the flight keeps
  `planned_leg_link_source='manual'` and `planned_leg_prev_trip_id=1` while
  `planned_leg_id` is NULL. **I tested whether that stale state can ever be read
  back as meaningful, and it cannot.** A subsequent `PUT {plannedLegId:null}` is
  a no-op (`unlinkFlightFromPlannedLeg` returns early on `planned_leg_id ==
  null`, `src/db.ts:1114`), and a subsequent link/unlink cycle *overwrote*
  `prev` with the flight's then-current `trip_id` and restored that, never the
  stale 1. §12.2's argument holds. The caveat is F-5 below, which is about the
  flight being stranded, not about the stale columns.
- **`getUnflownPlannedLegsForActiveTrip` against the contract. [read +
  executed]** The returned shape matches `contracts/planned-legs.d.ts:524-537`
  field for field, including `departureIdent: null` when
  `departureIsAirport` is false (`src/db.ts:1051-1053`) and the boolean
  coercion. `ORDER BY l.seq ASC, l.id ASC` is present. Returns `[]` when nothing
  is active. All six exported signatures match
  `contracts/planned-legs.d.ts:643-667` exactly. See F-3 for the `WHERE` clause.
- **`setActiveTrip` on a trip that does not exist — F-6.** See findings.

---

## T-012 — `src/server.ts` — verdict: `request_changes`

| # | definition_of_done | verdict |
|---|---|---|
| 1 | endpoints to mark active, clear active, read active | **holds [executed]** |
| 2 | link/unlink endpoints; 404 unknown ids, 409 leg already linked | **holds [executed]** |
| 3 | `GET /api/trips` exposes which trip is active — no second call | **holds [executed]** |
| 4 | new routes registered before the `/:id` routes they could shadow and before `app.get('*')`; curl returns JSON, never index.html | **holds [executed]** |
| 5 | curl transcript covering activate/read/re-activate/link/double-link/unlink/unlink-of-unlinked | **holds [executed]** |
| 6 | manual linking deliberately NOT restricted to the active trip | **holds [executed]** |
| 7 | existing endpoints unchanged apart from additive fields | **holds [executed]** |
| — | `PATCH /api/planned-legs/:legId` refuses `flown`/`diverted` and 409s on a linked leg | **holds, but see F-1** |

**1, 5 — the full transcript. [executed]** `GET /api/active-trip` →
`{"tripId":null,"name":null}` when nothing is active and
`{"tripId":2,"name":"REVIEW California"}` when trip 2 is. `PUT` sets and clears
through the one route. Re-activating a different trip deactivates the first, at
the database, every time (see T-011 item 3).

**Malformed `PUT /api/active-trip` bodies — every case the Orchestrator asked
for, plus more. [executed]**

| body | result |
|---|---|
| *(no body at all, with and without `Content-Type`)* | `400 {"error":"tripId must be an integer or null"}` |
| `{}` | `400` same |
| `{"tripId":1.5}` | `400` same |
| `{"tripId":"1"}` | `400` same |
| `{"tripId":true}` | `400` same |
| `[1,2]` *(not an object)* | `400` same |
| `"hello"` / `42` *(bare JSON scalars)* | `400` from `body-parser`'s strict mode, before the handler |
| `{tripId:1}` *(malformed)* | `400` from `body-parser` |
| `{"tripId":9999}` / `-1` / `0` / `1e3` / `99999999999999999999` | `404 {"error":"Trip not found"}` |

`Number.isInteger` (`src/server.ts:287`) is the right predicate and it holds for
all of these. The bare-scalar and malformed-JSON cases return express's default
HTML error page rather than JSON — I confirmed this is **pre-existing app-wide
behaviour** (identical output from `PATCH /api/flights/1` with the same body),
not something T-012 introduced, so it is out of scope here.

**A 404 leaves the current state alone. [executed]** With trip 2 active, a
`PUT {"tripId":9999}` returned 404 and trip 2 was still the active trip — the
existence pre-check at `src/server.ts:290-292` runs before `setActiveTrip`, so
the db-layer behaviour in F-6 is not reachable through HTTP.

**2 — link/unlink errors. [executed]** `404 Flight not found` (unknown flight,
checked before the body), `404 Planned leg not found` (unknown leg),
`400 plannedLegId must be an integer or null`, `409` naming the holding flight,
`200` for `{"plannedLegId":null}` on a flight with no link (idempotent, and the
comment at `src/server.ts:635-638` explains why that is a no-op and not a 404).

**3. [executed]** `is_active` rides on `SELECT t.*` in `getTrips`
(`src/db.ts:449-462`), so the Home badge costs no second call — confirmed in
the browser (see T-013 item 3).

**4 — route ordering. [executed]** `/api/active-trip` is a new top-level prefix
and cannot sit in any existing `:id` slot (§20 item 15); `GET` at
`src/server.ts:275`, `PUT` at `:285`, both far ahead of `app.get('*')` at
`:691`, and the multer error middleware at `:695` remains last overall (§20
item 13). `PATCH /api/planned-legs/:legId` at `:584` and
`PUT /api/flights/:id/planned-leg` at `:615` likewise. Every new route returned
JSON, never index.html, on both success and every error path above.

**6 — the deliberate non-restriction. [executed]** With trip 5 as the active
trip, I linked a flight to leg 4 of trip 1 (not active): `200`. The leg picker
in the UI likewise offered legs from all three trips
(`REVIEW Pacific · Leg 1`, `REVIEW California · Legs 1-3`,
`Circumnavegação · Leg 1`). This is the escape hatch behaving as §12.3 requires.

**7 — response shapes. [executed]** I ran the **same database** against the
8cec371 worktree server (3912) and the phase-3 server (3911) and diffed the
recursive key sets of `/api/trips`, `/api/trips/:id`, `/api/flights`,
`/api/flights/:id`, `/api/trips/:id/planned-legs`, `/api/planned-legs/:legId`,
`/api/status` and `/api/trips/:id/journey`: **identical on all eight**. No key
added, removed or renamed (§20 item 14).

**`PATCH /api/planned-legs/:legId`. [executed]** `flown` → 400, `diverted` →
400, `SKIPPED` → 400, `{}` → 400, no body → 400, `{"status":null}` → 400,
unknown leg → 404, skipping a leg with a linked flight → `409 {"error":"Planned
leg 12 cannot be skipped: linked to flight 9"}` with the leg unchanged. A client
cannot declare a leg flown (§15). The one gap is F-1.

---

## T-013 — client — verdict: `request_changes`

| # | definition_of_done | verdict |
|---|---|---|
| 1 | trip page has a control to set/clear active; state visible without guessing | **holds [executed]** |
| 2 | activating from a trip page visibly deactivates the previous one after a refresh | **holds [executed]** |
| 3 | Home shows which trip is active with a badge | **holds [executed]** |
| 4 | 'link a flight' / 'unlink', both without a manual reload | **holds [executed]** |
| 5 | flight picker offers unlinked flights; leg picker offers legs of any trip | **holds [executed]** |
| 6 | a 409 double-link renders the server's message inline | **holds [executed]** |
| 7 | `client/src/types.ts` mirrors the server types field for field | **holds [read]** |
| 8 | a trip that is not active and has no planned legs renders exactly as before | **FAILS — F-4 [executed]** |
| 9 | `npm run build:client` completes with no TypeScript errors | **holds [executed]** |

T-013's own report was curl plus code reading and explicitly not a browser, so
everything below was driven through headless Chromium against the real running
app. The client was built to a scratch `--outDir` so the repo's own
`client/dist` was left untouched (verified: mtime unchanged).

**1, 2, 3. [executed]** Trip page shows `Set as Active Trip`; clicking it
confirms (`Make "REVIEW California" the active trip? Any other active trip is
cleared automatically.`) and the row becomes `ACTIVE TRIP  Clear Active Trip`
with `trips.is_active = (1:0, 4:1, 5:0)` in the database. Home then lists
`🚗 REVIEW Pacific | 🚗 REVIEW California**ACTIVE** | 🚗 Circumnavegação`.
Activating trip 5 from its own page flipped the database to `(4:0, 5:1)` and
Home's badge moved to REVIEW Pacific on the next load — the previous trip
visibly deactivates. `Clear Active Trip` returned the count to 0 and
`GET /api/active-trip` to `{"tripId":null,"name":null}`. Zero page errors.
`TripDetail.tsx:434-440`, `Home.tsx:272`, `index.css:412-423`.

**4, 5 — the escape hatch, and DoD item 4 of my own task. [executed]**

- *Ghost-row path.* Opened `Link flight` on the KSBA→KMRY ghost row, picked
  `#1 · … · SSCN → SBFL` from the flight picker, clicked `Link`. Without any
  reload the ghost row was replaced by a flight row reading
  `Leg 1 **PLANNED** … SSCN → SBFL  View **Unlink** Remove`, and the database
  showed `flight 1: trip_id=4, leg=10, src=manual, prev=NULL`.
- *Reopening a flown leg from the UI.* I then wrote
  `status='flown', arrival_deviation_nm=4.2` onto leg 10 to stand in for T-016.
  The flight row's badge became **FLOWN**. Clicking `Unlink` (with its confirm)
  returned leg 10 to `status='planned', arrival_deviation_nm=NULL,
  linked_flight_id=NULL`, put flight 1 back to `trip_id=NULL`, and brought all
  three ghost rows back — **no page reload, no database access**.
- *Same again for `diverted`* (leg 11, dev 61.5, flight 3 from trip 1): badge
  **DIVERTED**, `Unlink` reopened the leg and restored `trip_id=1`.
- *Flight in the leg's own trip* (flight 7, already trip 4 → leg 12 via the
  flight row's `Link to leg`): `prev=4`, and `Unlink` left it in trip 4.
- *Cross-trip.* From trip 4's page I linked a trip-4 flight to
  `Circumnavegação · Leg 1`. The flight left trip 4's page (correct — it moved
  trips) and appeared on trip 1's page carrying `Unlink`, which restored
  `trip_id=4`. The undo control always lives on the page the flight moved to,
  so it is always reachable.
- *Skip / Unskip.* `Skip` on the KMRY→KSTS ghost row set `status='skipped'` and
  the badge to **SKIPPED**; `Unskip` returned it to `planned`. A leg with a
  linked flight has no ghost row at all (`PlannedLegRows.tsx:49` filters it
  out), so the Skip control is unreachable exactly where the server would 409 —
  consistent.
- *Pickers.* The flight picker lists only `planned_leg_id === null` flights
  (`TripDetail.tsx:273-280`), the leg picker only `linked_flight_id === null`
  legs, fanned out across every trip (`TripDetail.tsx:289-302`), matching
  T-012's non-restriction.

**Escape hatch: complete. [executed]** Every state I could reach by linking —
no-trip / other-trip / own-trip origin, and `planned` / `flown` / `diverted`
leg status — was undone from the browser alone. No `sqlite` write was needed to
recover from any of them.

**6 — the 409. [executed]** This one needed care: my first attempt produced a
*200*, because re-linking the **same** flight to the **same** leg succeeds (that
is F-2). Constructing a real conflict — open the picker on leg 10, then let
another client link flight 2 to leg 10 out of band, then confirm — produced
`PUT /api/flights/9/planned-leg -> 409` and the page rendered
`<span class="edit-error">Planned leg 10 is already linked to flight 2</span>`
inside the still-open picker. The server's message verbatim, inline, picker not
closed. `TripDetail.tsx:326-329`, `PlannedLegRows.tsx:221`.

**7. [read]** `client/src/types.ts` is **not in the diff** — it did not need to
be. `Flight.planned_leg_id/_link_source/_prev_trip_id` (`:31-34`),
`Trip.is_active` / `planned_leg_count` (`:47-48`), `PlannedLegStatus` (`:65`)
and `ActiveTrip` (`:234`) were all added in phase 1 and match §17. The one new
server type this phase adds, `LegMatchCandidate` (`src/types.ts:250`), is
server-internal (matcher input) and §17 does not ask for a client mirror.

**9. [executed]** `npx tsc --noEmit` in `client/` → 0 errors; `vite build` →
clean, 101 modules. Server side, `npx tsc --noEmit -p tsconfig.json` → 0 errors.

**8 — fails. See F-4.**

---

## My own definition_of_done

1. **Per-task verdicts** — above.
2. **At-most-one-active-trip, verified independently** — T-011 item 3. **[executed]**
3. **Unlink restores the prior `trip_id`, all three cases** — T-011 item 5. **[executed]**
4. **Escape hatch complete, from the UI** — T-013 items 4/5. **[executed]**
5. **Flight recording unchanged** — below. **[executed]**
6. **Migration additive and idempotent, nothing altered** — T-011 items 1/2/4/9. **[executed]**
7. **PDF flight-plan feature untouched** — below. **[executed]**
8. **Comments explain *why*; no test framework** — below. **[read + executed]**
9. **Verdict with `file:line` findings, written here.**

### 5 — nothing changed about how a flight is recorded [executed]

The strongest form of this check: two servers with **empty, freshly created**
databases — one from a `git worktree` at `8cec371`, one from the phase-3 working
tree — and one script posting the **same 50 frames to both in lockstep** over
the same wall-clock (4 on-ground frames at KSBA, 34 airborne frames tracing
KSBA→KMRY, 12 on-ground frames at KMRY). Neither server had an active trip.

- `PRAGMA table_info(flights)`: **23 columns on both, same names, same order.**
  Nothing removed, nothing renamed, nothing added by this phase (the three
  `planned_leg_*` columns already exist at 8cec371, from T-003).
- The resulting row: **all 23 columns identical**, including `start_time`,
  `end_time` and `duration_sec` — not merely "close", byte-equal.
  `distance_nm 143.3`, `max_altitude_ft 7061`, `point_count 4`,
  `departure_icao "0CA3"`, `arrival_icao "KMRY"` on both.
- `flight_points`: 4 on both.
- `planned_leg_id`, `planned_leg_link_source`, `planned_leg_prev_trip_id`:
  **all NULL**, exactly as §13.5 requires.
- Whole-`sqlite_master` diff between the two fresh databases: **empty**.

`src/flightManager.ts` and `src/ingest.ts` are not in the diff at all, so this
was expected — but it is now measured rather than assumed.

### 7 — the PDF flight-plan feature is untouched (§20 items 1-3) [executed]

- No diff hunk anywhere touches `flight_plan_name`, `flightPlans`,
  `/flight-plan`, `MAX_FLIGHT_PLAN_BYTES`, `planCount`, `plans=0` or the
  "Include flight plans (N)" label. `src/flightPlans.ts`, `src/pdfExport.ts`,
  `PrintTrip.tsx`, `PrintFlight.tsx` and `TripMap.tsx` are unchanged
  (`git diff --stat` empty for all five).
- `planCount` still counts PDFs and only PDFs
  (`TripDetail.tsx:399`: `trip.flights.filter(f => f.flight_plan_name).length`),
  and still drives the `Include flight plans (2)` checkbox at `:716-724`.
- Rendered for real, with the 23 real plan PDFs restored into the scratch
  `flight_plans/`, from **both** servers against the **same** database:

  | | `?plans=0` | default | |
  |---|---|---|---|
  | 8cec371 baseline | 4 pages | 45 pages | |
  | phase-3 | 4 pages | 45 pages | identical |

  Byte sizes differ by ~8% from map-tile load timing, the same nondeterminism
  the phase-2 review documented; page counts and the meaning of `?plans=0` are
  unchanged. A single-flight export (`/api/flights/15/export.pdf`) rendered 1
  page, HTTP 200, in ~5 s.

### 8 — comments and process

**Comments. [read]** They explain *why*, in the repo's existing register, and
several of them are load-bearing rather than decorative: `src/db.ts:948-953`
(why clear-then-set, and what the index would do under the reverse order),
`:1054-1059` (why the re-read after the nested unlink is what keeps `prev`
original), `:1134-1138` (why `clearPlannedLegLink` deliberately does *not*
restore `trip_id`), `:632-638` (why a link is not carried through
`combineFlights`, with the `trip_id` reason spelled out), `src/server.ts:635-638`
(why unlinking an unlinked flight is a 200 and not a 404),
`PlannedLegRows.tsx:5-11` (why `linked` has no badge of its own).
`src/db.ts:1003-1009`'s comment is the exception — it is accurate about what the
query does but its stated rationale is what F-3 disputes. `TripDetail.tsx:424-430`
honestly documents the F-4 deviation rather than hiding it, which is the right
instinct even though I think the deviation should be resolved the other way.
Two cross-reference nits: `src/db.ts:405-408` says "Same idiom as
`deleteFlightPlanFile()` below" — it is above, at `:411`; and `:637` cites
"§20 item 12" for a rule that is about `combineFlights` internals rather than
the link. Neither is worth a diff on its own.

**No test framework, no new dependency. [executed]** `package.json`,
`package-lock.json`, `client/package.json` and `client/package-lock.json` are
all unchanged; no file matching test/spec/jest/vitest/mocha was added; the diff
adds no files at all, only modifies eight.

---

## Findings

### F-1 — `PATCH {status:'planned'}` on a `flown` leg leaves `arrival_deviation_nm` set — **medium**
`src/db.ts:992`, reachable via `src/server.ts:584-607`.

`setPlannedLegStatus` writes only `status`. So a leg that was `flown` with
`arrival_deviation_nm = 9.9` becomes `planned` with **`arrival_deviation_nm`
still 9.9** — a leg that is "on the plan, not yet attempted" (§15 `imported`)
while carrying a recorded arrival deviation. Reproduced **[executed]**:

```
before: [{"id":5,"status":"flown","arrival_deviation_nm":9.9}]
PATCH /api/planned-legs/5 {"status":"planned"}  ->  200
after : [{"id":5,"status":"planned","arrival_deviation_nm":9.9}]
```

§15's transition table has no `flown → imported` edge driven by `PATCH`; the two
edges it does have (unlink, and flight delete/combine) both clear the deviation,
and `unlinkFlightFromPlannedLeg` (`src/db.ts:1120-1122`) and
`clearPlannedLegLink` (`:1150-1152`) both do so. This one path does not.
Harmless only because nothing writes the column until T-016 — which is next.

**Fix (one line):** clear it in the same statement —
`UPDATE planned_legs SET status = ?, arrival_deviation_nm = NULL WHERE id = ?`.
That makes every route back to `planned` consistent. (The alternative — 409 on
`planned` when the leg is `flown`/`diverted` and force the user through unlink —
is defensible too, but it is a new rule; clearing the column is the existing
rule applied uniformly.)

### F-2 — re-linking to the leg already held silently discards the recorded arrival — **medium** (adjudication B)
`src/db.ts:1068-1070`.

Full write-up under **Adjudication B** below. Reproduced **[executed]**: with
leg 5 at `flown / 3.1` and flight 2 linked to it,
`PUT /api/flights/2/planned-leg {"plannedLegId":5}` returns 200 and leaves leg 5
at `planned / NULL`.

### F-3 — the candidate query pre-filters `flown`/`diverted`, making `LEG_ALREADY_FLOWN` unreachable — **medium** (adjudication A)
`src/db.ts:1037`.

Full write-up under **Adjudication A** below. Measured **[executed]**: with
leg 5 (KSBA→KMRY) at `flown`, `getUnflownPlannedLegsForActiveTrip()` returned
only legs 6 and 7 — leg 5 never reaches the matcher, so step 5 can never
classify it.

### F-4 — a trip with no planned legs no longer renders as it did before — **medium**
`client/src/pages/TripDetail.tsx:433-441`.

The `.active-trip-row` block is rendered unconditionally, and the comment at
`:424-430` states this deliberately: *"Always visible, on every trip page — not
conditional on `planned_legs`, unlike everything else this task adds."*

That is a direct conflict with **T-013 DoD 8** ("A trip that is not active and
has no planned legs renders exactly as it did before this change") and with
**design.md §18**, which states the rule and then adds *"it means every new
element is conditional on data that did not exist before."*

Measured, not inferred **[executed]**: I built the 8cec371 client in a worktree,
pointed the baseline server at the **same database**, created a trip with three
flights and zero planned legs, and screenshotted `/trip/6` from both builds.
The diff of the rendered `<main>` text is exactly:

```
> Set as Active Trip
```

— one new button, which also shifts every element below it down ~40 px. Nothing
else differs (the flight rows correctly show only `View`/`Remove`, because
`showLinkToLeg` at `:408` gates the link control on `planned_legs.length > 0`;
Home's badge is likewise gated on `is_active === 1`, so Home passes the rule).

I do not think the Dispatcher is *wrong* about the UX — a trip has to be
activatable before legs are imported, and T-013's own risk note argues for
discoverability. But it is a plainly unmet acceptance criterion and a stated
design rule, and the Orchestrator, not the Dispatcher and not me, should decide
which one gives. **Two ways out:** (a) amend §18 and T-013 DoD 8 to carve out the
active-trip control explicitly, which costs one paragraph and makes the code
correct as written; or (b) gate the control on `trip.planned_legs.length > 0 ||
trip.is_active === 1`, which satisfies the rule as written but means a trip
cannot be made active until it has legs. I lean to **(a)** — the control is the
entry point to the whole feature and hiding it behind an import is a worse trap
than the rendering-drift rule is protecting against — but it must be recorded as
an amendment, not left as an undocumented divergence between §18 and the code.

### F-5 — `deleteTrip` strands a linked flight in the deleted trip — **low**
`src/db.ts:492-495` (unchanged), design.md §16.

§16 says `deleteTrip` needs no change because "flights keep their dangling
`trip_id`, exactly as today". That is true for a flight the *user* put in the
trip. It is not quite true for a flight a **link** moved there: the flight's
original trip is recorded in `planned_leg_prev_trip_id`, and deleting the trip
discards it. Reproduced **[executed]**: flight 9 was in trip 1, linked to leg 9
of trip 3 (`trip_id=3, prev=1`); after `DELETE /api/trips/3` it sits at
`trip_id=3` — a trip that no longer exists — and no longer appears on trip 1's
page, or on any trip page.

It is recoverable (the flight is still on Home and can be re-assigned by hand)
and the stale bookkeeping columns are provably inert (see the probe under
T-011), so this is not a blocker. But it is the one place where a state reached
by linking is *not* undone by the obvious action, and it is worth one line in
§16 acknowledging it — or, if the Orchestrator prefers, a `deleteTrip` that
restores `planned_leg_prev_trip_id` into `trip_id` for its linked flights before
the cascade, which would be symmetric with what `deletePlannedLeg` already does.

### F-6 — `setActiveTrip` on a nonexistent trip clears the active trip instead of "changing nothing" — **low**
`src/db.ts:954-961`.

design.md §11.2: *"Setting a trip that does not exist changes nothing; the
caller checks existence first and returns 404."* The function does not change
nothing — it runs the `UPDATE ... SET is_active = 0` and then matches no rows on
the second statement. Reproduced against a database copy **[executed]**:

```
after setActiveTrip(1):    1
after setActiveTrip(9999): null      <- the active trip was silently cleared
```

Not reachable through HTTP (`src/server.ts:290-292` pre-checks and 404s, which I
confirmed leaves the active trip intact), so this is latent. It matters because
T-016 calls the db layer directly. **Fix (two lines):** inside the transaction,
if `tripId !== null`, run the set first into a `changes` count and roll back /
skip the clear when it is 0 — or more simply, verify existence inside the
transaction and return early. Either keeps the clear-then-set order that
§11.2 requires for the real case.

### Notes, not findings

- `PlannedLegRows.tsx:202,204` and `TripDetail.tsx:682,684` reuse the
  `.flight-plan-status` class for the link pickers' muted status text. Purely a
  style borrow — it does not touch the PDF feature — but a class named for one
  feature now styles another; a neutral `.picker-status` would age better.
- A `skipped` leg **can** be linked (`PUT` does not check status; the UI's leg
  picker even labels it `(Skipped)`), and unlinking it afterwards silently
  returns it to `planned` — i.e. un-skips it. §15 has no `skipped → linked`
  edge. Verified **[executed]**: skip leg 11 → link flight 24 → leg stays
  `skipped` while linked → unlink → leg is `planned`. Recoverable and arguably
  the friendly behaviour for an escape hatch, but §15 should say so.
- Once a leg is linked its ghost row disappears (`PlannedLegRows.tsx:49`), so
  the trip page stops showing which *planned* leg a given flight is flying —
  the flight row carries only a status badge (`PLANNED`/`FLOWN`/`DIVERTED`), not
  the leg's identity, and its "Leg N" is the flight index, not `planned_legs.seq`.
  Fine for this phase; T-017 (flight detail) is where that belongs.
- `deleteFlight` (`src/db.ts:409-413`) calls `clearPlannedLegLink` outside a
  transaction with the `DELETE`. A crash between them leaves the flight
  unlinked but not deleted — benign in both directions, so not worth a change.

---

## Adjudication A — which layer should filter `flown`/`diverted`?

**Decision: step 5, not the query. Drop the `WHERE` clause at `src/db.ts:1037`,
and do it before T-015 is written.**

The facts, all **[executed]** unless noted:

- The query excludes `flown` and `diverted`. With leg 5 at `flown`,
  `getUnflownPlannedLegsForActiveTrip()` returned `[[6,2,"KMRY","planned"],
  [7,3,"KMRY","skipped"]]` — leg 5 absent.
- It **does** return `skipped` legs and **does** return already-linked legs, by
  design, and the comment at `src/db.ts:1003-1009` says so explicitly: those are
  left "to the matcher itself … with their own reason codes (design.md §13.2
  step 5)". So the code already accepts the principle that per-leg eligibility
  belongs in step 5 — it applies it to three of the four cases and makes an
  exception for the fourth.
- The consequence is measurable. After leg 5 (KSBA→KMRY) is flown, the nearest
  remaining candidate to a KSBA takeoff is leg 6/7 at KMRY, ~160 nm away. The
  matcher will return `NO_LEG_IN_RADIUS` with `distanceNm ≈ 160` — "nothing in
  your plan departs from anywhere near here" — when the truth is "that leg is
  right here and you already flew it". That is the wrong sentence to put in
  front of the user, and `LEG_ALREADY_FLOWN` exists precisely to be the right
  one.
- §13.4 calls the ten reason codes "the contract between the matcher, the log,
  the API and the UI". A code no production caller can produce is not a
  contract. Worse for T-015: its scenario harness constructs candidates
  directly, so it *will* exercise `LEG_ALREADY_FLOWN` and pass — a green test
  for a branch the real system can never enter.
- §13.2's own justification for refusing ambiguity is written in terms of step
  5: *"by the time leg 3 is flown, leg 1 is `flown` and linked, so step 5
  filters it out and exactly one candidate remains."* With the query filtering,
  that sentence is false in mechanism even though the outcome coincides — and
  the outcome only coincides because `linkedFlightId != null` catches the same
  leg anyway. Note what that implies: for a leg that is `flown` **and still
  linked**, the query filter is redundant with step 5's `LEG_ALREADY_LINKED`.
  The only case where the query filter actually changes the answer is a
  `flown`/`diverted` leg with **no** linked flight — which, after F-1 and F-2
  are fixed, should not exist, and if it does exist it is exactly the case the
  user most needs explained.
- Cost of removing it: none worth measuring. The candidate set is tens of rows,
  the query is one indexed read joined on `is_active = 1`, and §13.5 fixes the
  call at once per flight start.

Counter-argument, and why it does not carry: the function's frozen *name* says
"Unflown", and `contracts/planned-legs.d.ts:650-651` describes it as "unflown
legs of the active trip" **[read]**. But a name is a description, not a
behavioural contract, and §20 does not protect either. Both are one-line edits,
both live inside T-011's own `allowed_paths` plus the contract file, and **no
caller exists yet** — T-015 and T-016 are unwritten. This is the cheapest moment
this change will ever have.

**Concretely:** delete `WHERE l.status NOT IN ('flown','diverted')`
(`src/db.ts:1037`), rename the function to `getPlannedLegsForActiveTrip` (or
keep the name and amend its doc comment to say it returns *all* legs of the
active trip and that eligibility is step 5's job), and update
`contracts/planned-legs.d.ts:650-651` to match. §13.2 step 5 then becomes the
single place where a leg is judged eligible, which is what the design describes.

## Adjudication B — re-linking a flight to the leg it already holds

**Decision: yes, a guard is needed, and it belongs in the db layer —
`linkFlightToPlannedLeg`, not the endpoint.**

Reproduced **[executed]**: leg 5 at `status='flown', arrival_deviation_nm=3.1`,
flight 2 linked to it. `PUT /api/flights/2/planned-leg {"plannedLegId":5}` →
`200`, and leg 5 is left at `status='planned', arrival_deviation_nm=NULL`. The
link itself survives correctly (`planned_leg_prev_trip_id` is still 3, because
the nested unlink restored the trip and the re-link captured it again), so
nothing is *corrupted* — but a request that asked for no change destroyed a
system-recorded arrival.

Why the db layer and not the endpoint:

1. **T-016 bypasses the endpoint.** It will call
   `linkFlightToPlannedLeg(flightId, legId, 'auto')` directly, from the same
   code path that will later write the arrival. A guard in the endpoint protects
   the manual path — the one where a human is watching — and leaves the
   automatic, unattended path unprotected. That is exactly backwards for a
   silently data-destroying no-op.
2. **The db layer already has the information.** `src/db.ts:1062-1067` reads
   `current.planned_leg_id` as its very first statement. The guard is one line
   at `:1068`: `if (current.planned_leg_id === legId) return;` before the
   existing `if (current.planned_leg_id != null)`. The endpoint would have to
   re-read the flight to know the same thing.
3. **§12.2 already scopes the unlink-then-link dance narrowly.** It defines
   re-targeting as *"`PUT` a **different** leg onto an already-linked flight"*.
   The same leg is not re-targeting. The guard does not invent a rule; it
   restores the code to the design's own wording.
4. **Idempotence is the right shape for a `PUT`.** `PUT /api/active-trip` with
   the already-active trip is a no-op (verified: three consecutive
   `{"tripId":2}` calls left the row untouched), and unlinking an unlinked
   flight is a no-op. Linking a flight to the leg it already holds should be one
   too, and today it is the only one of the three that isn't.

On `planned_leg_link_source`: the one field that could legitimately differ on a
same-leg re-link is `'auto'` → `'manual'`. I would not special-case it — a plain
early return is easier to reason about, and a user who genuinely wants to
re-assert a link already has unlink-then-link, which is what the UI does anyway.
If the Orchestrator wants the source updated, the guard should update *only*
`planned_leg_link_source` and leave `status` and `arrival_deviation_nm` alone.

**Is it urgent?** It is harmless today — nothing writes `flown`/
`arrival_deviation_nm` until T-016 — and it is unreachable from the UI, which I
confirmed: a linked flight's row offers only `Unlink`, never `Link to leg`
(`TripDetail.tsx:637-657`), so the browser cannot produce a same-leg re-link.
It becomes harmful in the very next task. Fix it in this phase, where it is one
line.

---

## Residual risks

1. **The escape hatch depends on the flight staying findable.** Linking moves a
   flight into the leg's trip, so the `Unlink` control lives on whichever trip
   page the flight moved to. That is coherent and I verified it end to end, but
   it means a user who links from trip A watches the row vanish from the page
   they are looking at. There is no toast, no navigation, and no "moved to
   REVIEW Pacific" note. Nothing is lost, but the next click is not obvious.
2. **F-5's stranded flight** is the one link-induced state with no one-click
   undo.
3. **Two pickers fan out over every trip.** `loadLinkableLegs`
   (`TripDetail.tsx:289-302`) issues `GET /api/trips` plus one
   `GET /api/trips/:id/planned-legs` per trip. Fine at this scale (4 trips, 4
   requests); it grows linearly with the logbook's trip count and is only
   triggered on demand.
4. **`arrival_deviation_nm` currently has no writer.** Everything I asserted
   about `flown`/`diverted` behaviour was tested by writing the column myself to
   stand in for T-016. `recordPlannedLegArrival` (`src/db.ts:1165-1169`) is
   correct by inspection **[read]** — it writes both fields in one statement and
   is the only writer — but it has no caller yet, so its integration with
   `endFlight()` is entirely T-016's risk and untested here.
5. **The `AMBIGUOUS`-affordability argument now rests on F-3.** §13.2 justifies
   strict ambiguity refusal by saying a flown leg is filtered out at step 5. If
   F-3 is resolved the way I recommend, that argument becomes literally true. If
   it is resolved the other way, the argument holds only incidentally, via
   `LEG_ALREADY_LINKED` — and would break for a `flown` leg whose flight was
   deleted, which `clearPlannedLegLink` resets to `planned` anyway. Either
   resolution is self-consistent; leaving it unresolved is not.
6. **No automated regression net.** No test framework, correctly (§20 item 19),
   so every guarantee in this review holds only for the code as it stands today.

## Environment

`npm run backup` → `backups/20260905-035758` at the start. All work ran against
that copy on ports 3911/3912/3913; the user's server on port 3000 was never
contacted. The repo's `client/dist` was not rebuilt (scratch `--outDir` used);
the `git worktree` at 8cec371 has been removed (`git worktree list` shows only
the main checkout); all three scratch servers are stopped and the ports are
free. The working tree is exactly as I found it: the same eight modified files
plus `.claude/agents.md` and `client/src/pages/Override.tsx` untracked.

**Live `flights.db` re-verified at the end, all four counts as briefed:**

```
flights = 34 · trips = 1 · planned_legs = 1 · active trips = 0
(plus: linked flights = 0)   mtime unchanged at 03:06
```

---
---

# Round 2 — 2026-09-05 — re-verification after the fixes

**Overall verdict: `approve`.** All six findings **confirmed fixed**, none
rejected. Every regression probe I re-ran passes, including the four the
Orchestrator called out. One residual observation on F-2's `source` field is
recorded below as a documentation ask, not a defect and not a reason to hold the
phase.

Per-task verdicts now: **T-011 `approve`**, **T-012 `approve`**,
**T-013 `approve`**.

The original findings and their evidence above are left exactly as written —
this section only adds what round 2 established. All of it was **executed**
unless marked otherwise: a fresh `npm run backup` → `backups/20260905-043018`,
a scratch server on port **3921** against that copy, a fresh `git worktree` at
`8cec371` with its own client build and server on **3922** sharing the same
database file, the real fixtures re-imported, and headless Chromium driving the
real running app. I did not redo server `tsc`, client build, type-mirror drift
or the live-database check as verification of the fixes — the Orchestrator
confirmed those — though I did re-read the live database at the end as an
environment check.

I read `design.md` Amendment C and the updated
`contracts/planned-legs.d.ts:650-659`, §12.1, §13.5 and §16 first. Both
adjudications are recorded faithfully, including the reason I gave for each, and
Amendment C's added paragraph — *"A guard belongs at the layer every caller
passes through … anything guarded only at the HTTP edge is guarded only against
the user"* — is the right generalisation and the right thing to have written
down before phase 4 adds a second caller to all of this. I checked each fix
against that rule specifically, and each one obeys it.

## F-3 — **confirmed fixed**

`src/db.ts:1068`, renamed `getPlannedLegCandidatesForActiveTrip`, `WHERE
l.status NOT IN (...)` gone.

Built a trip carrying **all four statuses at once** plus a linked flight, made
it active, and called the function directly through `ts-node`:

```
activeTripId = 2
   5  seq 1  KSBA  flown     linkedFlightId null   isAirport true
   6  seq 2  KMRY  planned   linkedFlightId 9      isAirport true
   7  seq 3  KMRY  skipped   linkedFlightId null   isAirport true
   10 seq 4  KSTS  diverted  linkedFlightId null   isAirport true
count = 4     statuses present: ["diverted","flown","planned","skipped"]
```

Every leg of the active trip comes back, `flown` and `diverted` included. So
step 5 now receives them and `LEG_ALREADY_FLOWN` is reachable from the
production caller — the whole point of the adjudication.

Also verified, because the rename touched the query:

- **Ordering survives.** `ORDER BY seq ASC, id ASC` still holds, and the `id`
  tie-break actually works: forcing legs 6 and 10 to share `seq = 2` returned
  `[[1,5],[2,6],[2,10],[3,7]]` — id ascending within the tie. §13.2's
  determinism requirement is intact.
- **Empty case.** `setActiveTrip(null)` → `[]`; re-activating → 4 again.
- **`departureIdent` nulling and the boolean coercion** still behave per
  `contracts/planned-legs.d.ts:524-537`.
- **The doc comment no longer claims a filter it does not apply.**
  `src/db.ts:1057-1067` now says "EVERY leg of the active trip, with no status
  filtering at all", names the four statuses explicitly, and states that
  eligibility is step 5's job. It matches the code.
- **No stale callers.** `grep` finds `getUnflownPlannedLegs` nowhere in `src/`,
  `client/src/`, the contract file or §12.1/§13.5 — the only surviving mention
  is Amendment C's own historical narration of what the name used to be, which
  is correct. The new name appears exactly twice: its definition
  (`src/db.ts:1068`) and a comment reference (`src/types.ts:244`). No caller
  exists yet, which is what made this the cheap moment to do it.

## F-2 — **confirmed fixed**, with one thing to write down

`src/db.ts:1134` — `if (current.planned_leg_id === legId) { return; }`, placed
before the re-target branch.

With leg 6 at `flown / 3.7`, flight 9 linked to it with `source='auto'`:

```
before:  leg 6  flown  dev 3.7   |  flight 9  trip 2  leg 6  src auto  prev 1
PUT /api/flights/9/planned-leg {"plannedLegId":6}   ->  200
after :  leg 6  flown  dev 3.7   |  flight 9  trip 2  leg 6  src auto  prev 1
```

Nothing moved. The original defect — a request that asked for no change silently
resetting a `flown` leg to `planned` and discarding its deviation — is gone.

The guard is in the db function, which is where Amendment C's rule puts it: it
sits inside `linkFlightToPlannedLeg`'s existing first read, so T-016's
`source: 'auto'` call is covered by the same code the endpoint goes through.
`src/db.ts:1112-1128`'s doc comment now explains the no-op and says why it
cannot live in the endpoint.

**Re-targeting to a *different* leg is unaffected** (the guard could plausibly
have swallowed it): flight 27, originally trip 1 → leg 5 (trip 2) → `prev=1`;
then in one call → leg 4 (trip 1) → `trip_id=1, leg=4, **prev=1**`, the original
trip, not the trip the first link assigned; the released leg 6 came back
`planned / NULL / unlinked`; unlinking returned the flight to trip 1.

**On the `source` question the Orchestrator raised — I still prefer the simple
early return, now that it is concrete.** Confirmed by execution: a `'manual'`
PUT of the leg a flight already holds leaves `planned_leg_link_source = 'auto'`.
Three reasons that is the right answer rather than merely the easy one:

1. **The field records how the link came about, and that has not changed.** The
   link *was* made automatically. A later no-op assertion did not create it. A
   phase-5 badge reading "linked automatically" would still be telling the
   truth.
2. **It is unreachable from the UI, in the direction that matters.** I
   re-confirmed that a linked flight's row offers only `Unlink`
   (`TripDetail.tsx:652-658`) — never `Link to leg` — so a user cannot produce a
   same-leg re-link through the browser. The only UI route from an auto link to
   a manual one is unlink-then-link, which correctly writes `'manual'` (verified:
   the re-target above ended at `src='manual'`). So the badge can never diverge
   from what the user actually did through the interface.
3. **Writing `source` would partly reopen what the guard closed.** The guard's
   value is that "same leg ⇒ nothing happens" is a single, checkable sentence. A
   guard that returns early *except* that it performs an UPDATE is a narrower
   version of the bug, and it is the kind of exception that gets forgotten.

**The one thing I would ask for is a sentence, not a behaviour change.** The
doc comment at `src/db.ts:1112-1128` explains the no-op in terms of `status` and
`arrival_deviation_nm` but does not mention that `source` is also not applied. A
future caller reading only the signature — `(flightId, legId, source)` — would
reasonably expect the `source` argument to take effect, and would find it
silently ignored on this one path. One clause ("…and `source` is not applied
either: the link's origin is a fact about how it was created, so converting an
auto link to manual is done by unlinking and re-linking") removes the trap. Not
blocking, and not worth a round 3 on its own — fold it into whatever touches
this file next.

## F-1 — **confirmed fixed**

`src/db.ts` `setPlannedLegStatus`, now
`UPDATE planned_legs SET status = ?, arrival_deviation_nm = NULL WHERE id = ?`.

Both target statuses clear it, not just the one in the original report:

```
flown / 9.9    -> PATCH {"status":"planned"} -> 200 -> planned  / NULL
diverted/61.2  -> PATCH {"status":"skipped"} -> 200 -> skipped  / NULL
```

Every route back out of `flown`/`diverted` — unlink, flight delete, combine,
and now this `PATCH` — clears the deviation. No `planned` or `skipped` leg can
carry one.

**The endpoint's guards are all intact** (re-run because the statement changed):
`{"status":"flown"}` → 400, `"diverted"` → 400, `"SKIPPED"` → 400, `{}` → 400,
unknown leg → 404, and skipping a leg with a linked flight →
`409 {"error":"Planned leg 5 cannot be skipped: linked to flight 20"}` with the
leg unchanged. A client still cannot declare a leg flown (§15).

## F-6 — **confirmed fixed**

`src/db.ts:998-1002` — the existence check now runs inside the transaction,
before the clearing `UPDATE`.

```
setActiveTrip(2)      -> 2     count 1
setActiveTrip(9999)   -> 2     count 1     <- §11.2's "changes nothing", now true
setActiveTrip(-1)     -> 2     count 1
setActiveTrip(0)      -> 2     count 1
setActiveTrip(3)      -> 3     count 1     <- clear-then-set for the real case, intact
setActiveTrip(3) again-> 3     count 1
setActiveTrip(null)   -> null  count 0
setActiveTrip(null) x2-> null  count 0
setActiveTrip(9999) while nothing active -> null  count 0
16-step mixed sequence (ids, nulls and non-existent ids interleaved):
        steps with count > 1: 0
```

The clear-then-set order §11.2 requires is preserved for every real
activation — the early return happens before the clearing `UPDATE` is reached,
so a valid `tripId` still clears first and sets second.

**I still cannot force a `SQLITE_CONSTRAINT_UNIQUE` from `idx_trips_active`
through any public path, and I tried harder than in round 1.** 80 concurrent
`PUT`s mixing four valid trip ids, `null` and a non-existent id: 64× 200,
16× 404, `count = 1` at the end, and zero occurrences of "constraint" in the
server log. `setActiveTrip`'s two `UPDATE`s (`src/db.ts:1003,1005`) remain the
only writers of `is_active` in the entire file — the migration's
`ALTER TABLE ... DEFAULT 0` aside — and `updateTrip`'s `['name','notes']`
allow-list still blocks `PATCH /api/trips/:id`. The new early return added no
new write path.

## F-5 — **confirmed fixed, and the edge case the Orchestrator flagged holds**

`src/db.ts:492-517` — `deleteTrip` is now a transaction that reads link-moved
flights via `JOIN planned_legs l ON l.id = f.planned_leg_id WHERE l.trip_id = ?`
before the delete.

`deleteTrip` changed shape, so I rebuilt the probe from scratch rather than
carrying anything forward. Five flights arranged into five distinct
relationships with trip 3, then `DELETE /api/trips/3`:

| flight | before | after | correct? |
|---|---|---|---|
| 1 | linked in from **no trip** (`trip 3`, leg 9, `prev=NULL`) | `trip_id=NULL`, all three columns NULL | ✅ restored |
| 19 | linked in from **trip 1** (`trip 3`, leg 8, `prev=1`) | `trip_id=1`, all NULL | ✅ restored |
| 20 | **ordinary membership** (`assignFlightToTrip`, never linked) | `trip_id=3` dangling, untouched | ✅ unchanged, exactly as before this feature |
| 23 | **already in trip 3**, then linked to a leg of trip 3 (`prev=3`) | `trip_id=3` dangling, all three columns NULL | ✅ — see below |
| 24 | linked to a leg of **trip 1**, then force-assigned into trip 3 | `trip_id=3` dangling, `planned_leg_id=4` **kept**, `prev=1` kept | ✅ the JOIN correctly does not match it |

**The distinction actually holds**: the JOIN keys on `l.trip_id`, so it matches
exactly the flights whose link points into the trip being deleted, and nothing
else. Flight 20 (ordinary membership) is untouched, preserving §20's promise.
Flight 24 shows the converse — a flight sitting in the doomed trip but linked
*elsewhere* is left alone, its link to a still-living leg intact; I confirmed it
still unlinks correctly afterwards, restoring `trip_id=1` from its preserved
`prev`.

**The Orchestrator's reading of the `prev = the trip being deleted` case is
correct, and is now verified rather than assumed.** Flight 23 was in trip 3, then
linked to a leg of trip 3, so `planned_leg_prev_trip_id = 3`. The restore writes
`trip_id = 3` — which is then deleted — landing it on exactly the same
dangling-`trip_id` outcome as flight 20's ordinary membership. That is the
consistent answer: the flight's own history says it belonged to trip 3
independently of the link, so the link has nothing different to give back.

Cleanup after the delete is complete: trip row gone, legs 8/9/11 cascaded, zero
orphaned `planned_waypoints`, zero dangling `planned_leg_id`, zero rows with
`planned_leg_id IS NULL` but `link_source`/`prev_trip_id` still set.

**Two more `deleteTrip` cases, since the function is new:** a non-existent trip
returns `404 {"error":"Not found"}` and changes nothing; a trip with flights but
**no** linked flights (three assigned flights, zero legs) deletes with all three
flights keeping their dangling `trip_id` — byte-for-byte the pre-feature
behaviour, with the new transaction adding no side effect.

## F-4 — **confirmed fixed**, and the evidence is now stronger than round 1's

`client/src/pages/TripDetail.tsx:420` —
`showActiveTripControl = showLinkToLeg || trip.is_active === 1`.

Reproduced with my own render diff against a fresh `8cec371` worktree, both
servers on the **same database file**, maps hidden to remove tile
nondeterminism:

| page | 8cec371 vs phase-3 |
|---|---|
| **legless + inactive trip** | **pixel-identical** — same PNG MD5 `4ad101ce…`, and identical `<main>` text |
| **Home** (no active trip) | **pixel-identical** — same PNG MD5 `eb3c97da…` |
| trip *with* planned legs | differs, as it should: gains the active-trip control, `Link to leg`, `Link flight`, `Skip` |

That is stronger than round 1, where the same comparison produced a one-line
text diff (`> Set as Active Trip`). T-013 DoD 8 and design.md §18's last bullet
now hold literally: a trip untouched by this feature renders exactly as it did
before, to the pixel.

**All four gate states driven in the browser**, because the widened condition
introduces a state the original code did not have:

1. **legless + inactive** → `.active-trip-row` absent, no `Set as Active Trip`.
2. **has legs + inactive** → control present; clicking it set `is_active` to
   `(1:0, 2:1, 5:0)` and the row became `ACTIVE TRIP  Clear Active Trip`.
3. **Home** → `🚗 R2 Plain Trip | 🚗 R2 California**ACTIVE** | 🚗 Circumnavegação`
   — the badge stays unconditional on `is_active`, so an active trip is
   discoverable from the landing page whether or not it still has legs.
4. **active trip that loses every planned leg** — the case the `|| is_active`
   clause exists for. Deleted all three of the active trip's legs, reloaded:
   `planned_legs = []`, `is_active = 1`, control **still present** reading
   `Clear Active Trip`. Clicked it → count 0; reloaded → now legless *and*
   inactive, control correctly gone. So the flag can never be stranded on a page
   that will not offer a way to clear it.

Zero page errors throughout. The gate is one expression rather than two that can
drift (`showLinkToLeg` is reused), and the comment at `:414-419` gives the
substantive reason — an active trip with no legs is inert, since §13.2 step 2
refuses with `NO_PLANNED_LEGS` — rather than only citing the DoD.

One consequence worth stating plainly, since it is a real workflow change and
not a defect: **a trip cannot be made active until it has at least one imported
plan.** That follows from the design rule the fix restores, it is the honest
behaviour given `NO_PLANNED_LEGS`, and the escape from it (import, then
activate) is one step. It should not surprise anyone later.

## Regressions re-run

All clean. The four the Orchestrator named, plus the three that share touched
code:

- **Re-target keeps the ORIGINAL `prev`** — flight 27: trip 1 → leg 5 (trip 2)
  → `prev=1`; re-targeted in one call to leg 4 (trip 1) → `prev=1`, not 2.
- **Delete a linked flight** — leg at `diverted / 31.4` came back
  `planned / NULL / unlinked`, flight row gone.
- **Delete a linked planned leg** — flight restored to `trip_id=1` with all
  three `planned_leg_*` columns NULL.
- **`combineFlights` with both linked** — legs at `flown / 1.1` and
  `diverted / 44.0` both returned to `planned / NULL / unlinked`, both source
  rows gone, combined flight carries no link and (as before this feature) no
  trip.
- **Unlink restores the prior `trip_id`, all three cases** — no trip → `NULL`;
  another trip → that trip; the leg's own trip → unchanged.
- **Double-link 409** — `Planned leg 5 is already linked to flight 28`, both
  flights untouched.
- **Escape hatch end to end, in the browser** — linked a flight to a ghost leg
  row from the trip page (no reload), wrote `flown / 4.2` onto the leg to stand
  in for T-016, saw the **FLOWN** badge, clicked `Unlink`: leg back to
  `planned / NULL / unlinked` and the flight back to `trip_id=1`, all without a
  reload and without touching the database.
- **409 renders inline** — `Planned leg 12 is already linked to flight 23`,
  verbatim, in the still-open picker.

**Global consistency sweep after every probe above**: zero dangling
`planned_leg_id`, zero orphaned bookkeeping columns, zero legs left `flown`/
`diverted` without a linked flight, zero legs held by two flights, and exactly
one active trip. **The round-2 diff touches no DDL** (`git diff` shows no
`ALTER TABLE` / `CREATE TABLE` / `CREATE INDEX` / `PRAGMA` line) and does not
touch `src/flightManager.ts` or `src/ingest.ts`, so the round-1 finding that
flight recording is byte-identical to `8cec371` still stands unchanged.

## Residual risks, revised

Superseded from round 1: **F-5's stranded flight is gone** (the one link-induced
state with no undo now has one), and **the `AMBIGUOUS`-affordability argument is
now literally true** — with the query unfiltered, a `flown` leg genuinely does
reach step 5 and is filtered there, exactly as §13.2's prose claims.

Still standing:

1. **Linking moves the flight to another trip's page**, so the `Unlink` control
   is always reachable but not always where the user was looking. No toast, no
   navigation hint. Verified working, still a small discoverability gap.
2. **`arrival_deviation_nm` still has no writer.** Everything asserted about
   `flown`/`diverted` in both rounds was tested by writing the column myself to
   stand in for T-016. `recordPlannedLegArrival` remains correct by inspection
   **[read]** and uncalled; its integration with `endFlight()` is T-016's risk.
3. **`source` is not applied on a same-leg re-link** (see F-2 above) — the
   documentation ask, not a defect.
4. **A trip cannot be activated before its first plan import** (see F-4) — a
   deliberate consequence of the design rule, worth remembering when phase 5
   writes onboarding copy.
5. **No automated regression net** (correctly, §20 item 19), so both rounds'
   guarantees hold for the code as it stands today and nothing enforces them
   tomorrow. Phase 4 adds `FlightManager` as a second caller to every function
   reviewed here; Amendment C's rule about guarding at the shared layer is the
   thing to keep checking.

## Environment (round 2)

`npm run backup` → `backups/20260905-043018` at the start. All work ran against
that copy on ports **3921** and **3922**; the user's server on port 3000 was
never contacted, and the live database was opened read-only once at the end. The
repo's `client/dist` was not rebuilt (scratch `--outDir`). The `git worktree` at
`8cec371` has been removed — `git worktree list` shows only the main checkout —
both scratch servers are stopped and their ports are free.
`App.tsx`, `Override.tsx` and the `── The Override ──` CSS block were not read
for review and not touched.

**Live `flights.db` re-verified at the end:**

```
flights = 34 · trips = 1 · planned_legs = 1 · active trips = 0 · linked flights = 0
mtime unchanged at 03:06
```
