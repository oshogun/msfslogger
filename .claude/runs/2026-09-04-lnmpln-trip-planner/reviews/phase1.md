# T-007 — Review of phase 1 (parser, schema, endpoints, client, build)

**Overall verdict: `approve`.** No blocking defect. Eight follow-ups, all
non-blocking, listed at the end.

Everything below was re-run by the reviewer against the real fixtures and a
`npm run backup` copy of the live database (`backups/20260904-230104`), under
Node 20.20.2 per `ENVIRONMENT.md`. The Dispatchers' own reports were not taken
as evidence. **Live `flights.db` re-verified untouched on completion**:
md5 `491aef512b3cdfb25b975845a905828a` before and after, tables still
`flight_points, flights, sqlite_sequence, trips`, 33 flights / 1 trip, no
`planned_leg_id` column. Scratch directory and test server removed.

---

## 1. Per-task verdicts

| Task | Verdict | DoD lines verified independently |
|---|---|---|
| T-002 parser | **approve** | 20 of 20 |
| T-003 schema + CRUD | **approve** | 12 of 12 |
| T-004 REST | **approve** | 17 of 18; DoD 15 unverifiable (see F-8) |
| T-005 client | **approve** | 12 of 12 |
| T-006 rehearsal | **approve** | 7 of 7, reproduced |

### T-002 — parser, fixtures, inspector

`npx ts-node src/inspect-lnmpln.ts samples/lnmpln/*.lnmpln` exits 0 and reports
KSBA→KMRY 7 wpt / 7500 ft, KMRY→KSTS 5 / 2500, KSTS→KACV 6 / 3500, KSFO→KLAX
3 / 27000 — matching DoD 3 exactly. DoD 4's full procedure set round-trips
(WESLA5/28L/SUSEY, IRNMN2/24R/BURGL, KLAX24R/24R/CUSTOM/3.00/1000.00/0.00).
DoD 18: cycles 1801 ×3 and 2609, read per file. DoD 19: the all-four glob
reports `NO_UNIQUE_HEAD` as expected; `'samples/lnmpln/VFR*.lnmpln'` reports
`CHAINED` with order KSBA→KMRY, KMRY→KSTS, KSTS→KACV from alphabetical input.

Every `bad-*.lnmpln` was run individually (DoD 15). All eleven produce a
one-line reason and exit 1 — no stack trace, no partial object:
`EMPTY_FILE`, `NOT_XML` (truncated comment), `NO_FLIGHTPLAN` ×2,
`TOO_FEW_WAYPOINTS` ×3, `MISSING_IDENT`, `MISSING_POSITION`,
`BAD_COORDINATE` ×2.

Every remaining synthetic fixture was run: BOM stripped, `+02` offset →
`2020-09-11T16:05:15.000Z`, `CruisingAltF` 8500.75 preferred over a disagreeing
`CruisingAlt`, two `<Waypoints>` blocks concatenated in document order (4
waypoints: KSFO EBAYE SUDDO KLAX), Description-after-Pos identical to
Description-before-Pos, snippet endpoints flagged, nested/unbalanced comment
parsed, `UNKNOWN_ELEMENT` capped at ten paths.

DoD 2 holds: `src/lnmpln.ts:19-20` imports only `fast-xml-parser` and `./geo` —
no `fs`, no `./db`. DoD 1: `package.json:21` `"fast-xml-parser": "^5.11.1"` in
`dependencies`. `npx tsc --noEmit` clean (DoD 17).

### T-003 — schema and CRUD

Migration run against a copy of the live db: tables gain `planned_legs`,
`planned_waypoints`, `planned_alternates`; `flights` gains the three
`planned_leg_*` columns; `trips` gains `is_active`; 33 flights / 1 trip
**unchanged**. Server restarted twice — no error, `planned_legs` has exactly
one definition, `flights` still 23 columns (DoD 2, 3).

DoD 6 verified by forcing a `NOT NULL constraint failed:
planned_waypoints.ident` partway through `createPlannedLeg`: the leg row and all
its waypoints roll back, waypoint count identical before and after, zero orphans.
DoD 7: `DELETE /api/trips/4` (which held three planned legs) returned
`{"deleted":true}`, and orphan counts for legs, waypoints and alternates are all
0 — `PRAGMA foreign_keys = ON` is set at `src/db.ts:40`, so the CASCADEs are
live. DoD 12: after importing the VFR trio, all eighteen procedure columns are
NULL and the legs are otherwise complete. DoD 9: nothing in the new
`── Planned legs ──` section of `src/db.ts` touches `flight_plan_name` or
`flight_plans/`.

### T-004 — REST

**DoD 6, the sharp regression, passes.** Posting the three real files in
alphabetical filename order (= exact reverse route order) into an empty trip
returns `{"ordering":"chain","reason":"CHAINED"}` and the database reads back:

```
seq 1  KSBA KMRY   (file "VFR Santa Barbara Muni (KS…")
seq 2  KMRY KSTS   (file "VFR Monterey Rgnl (KMRY) t…")
seq 3  KSTS KACV   (file "VFR Charles M Schulz - Son…")
```

DoD 9: re-imported into a second trip in a *third* multipart order — identical
resolved order. DoD 16: all twelve procedure values round-trip, zero NULLs.
DoD 17: all four files in one request → `NO_UNIQUE_HEAD`, four legs created in
upload order. DoD 7: round trip (KAAA↔KBBB) and two unrelated legs both fall
back to `NO_UNIQUE_HEAD` in upload order, still `201` (DoD 8).

DoD 3, every rejection re-run: no file → 400 `No files uploaded`; not XML → 400;
parser refusal → 400 `BAD_COORDINATE: waypoint 2 (NPOLE) has Lat=91, outside
±90`; 600 KB file → 400 `File too large (max 512KB)` (the PDF path's 20 MB
message is untouched, selected on `err.field` at `src/server.ts:565`); trip 9999
→ 404; trip `abc` → 400. DoD 4: one good + one bad file → 201, the good leg
created, the bad one named with its reason.

DoD 10: every new path returns `application/json; charset=utf-8`, never
`index.html`. DoD 12: DELETE → 200, repeat → 404, no orphan children. DoD 13:
reorder to reverse works and the subsequent GET shows the new order. Reorder
validation rejects a short array, a duplicate-id array, a string array and a
non-array, all 400.

DoD 14, PDF non-regression: `POST/GET/DELETE /api/flights/45/flight-plan`
returns 200/200(application/pdf)/200, `flight_plan_name` set to `t.pdf` and
cleared to `null`, and a non-PDF upload still returns `File must be a PDF`.

### T-005 — client

`npm run build:client` exits 0 (tsc + vite). The mirror-drift tool reports
`PlannedLeg` 50 fields, `PlannedWaypoint` 13, `PlannedAlternate` 9 — no drift
(DoD 7). `interleaveTripRows` short-circuits to the pre-feature mapping when no
unflown legs exist (`PlannedLegRows.tsx:39-41`), so DoD 8 holds structurally.
`ActiveTrip` in `client/src/types.ts:228` is unused but is explicitly in the
frozen §17 mirror list — not drift.

DoD 6 path traced: when *every* file is rejected the server returns 400 with
`{imported, batch, results}` and no top-level `error`;
`TripDetail.tsx:154` correctly detects `results` and falls through to render the
per-file reasons at `TripDetail.tsx:344-345`, rather than the `{ error }` branch.
That is the right split.

### T-006 — rehearsal

Reproduced §1 (build), §2 (migration on a live-db copy, counts unchanged), §3
(end-to-end, same seq/ident output) and §4/§6 equivalents. §5's dependency claims
check out exactly: `fast-xml-parser@5.11.1` is 1.4 MB with six real transitive
deps — `@nodable/entities`, `fast-xml-builder`, `is-unsafe`,
`path-expression-matcher`, `strnum`, `xml-naming` — all present on disk, all
pure JS, ~2.15 MB total. No Dockerfile change is needed; the conclusion stands.

---

## 2. The seven adjudications

### 1. `NOT_XML` (HTTP) vs `NO_FLIGHTPLAN` (CLI) — **acceptable as is. No change.**

Both are literally what the frozen design specifies, and neither is wrong.
design.md §5.3 defines the parser's `NOT_XML` as "`XMLParser` throws, **or** the
result has no object root". I confirmed the mechanism directly:
`parser.parse('this is not xml at all')` under fast-xml-parser 5.11.1 returns
`{}` — an object root, and it does not throw. So `NOT_XML` cannot fire for that
input and `NO_FLIGHTPLAN` is the parser's correct verdict. design.md §7.1 then
separately, and deliberately, requires the server to sniff: "A file is accepted
only if, after BOM stripping and `trimStart()`, it begins with `<` … Anything
else is `rejected` with `NOT_XML` **before the parser is called**." Both
components are conformant.

The sniff should **not** defer to the parser: it is the equivalent of the PDF
feature's `isPdfBuffer`, it costs nothing, and "does not begin with `<`" is a
better message for a user who dragged the wrong file than "no
`<LittleNavmap><Flightplan>` element". The residual asymmetry is that the CLI
lacks the sniff — see F-6, a two-line follow-up, not a phase-1 change.

### 2. T-003 scope drift (`trips.is_active`, both partial UNIQUE indexes) — **correct as implemented. Do not revert.**

design.md §3 is the frozen migration and it specifies **one block**: the three
tables, then `flights.planned_leg_id/link_source/prev_trip_id`, then
`trips.is_active`, then both partial unique indexes — verbatim, including the
comment about running the `CREATE INDEX` statements unconditionally. T-003's own
DoD 1 says "per the T-001 DDL", and §3 *is* that DDL. `src/db.ts:258-286`
reproduces it exactly, including the two subtleties §3 calls out (no default on
`planned_leg_id` because `ADD COLUMN … REFERENCES` requires one; indexes outside
the `if` blocks).

Splitting it would be actively worse. `flights.planned_leg_id REFERENCES
planned_legs(id)` cannot exist before `planned_legs` does, so the FK column
belongs with the table creation; and half of §3 landing now and half in T-011,
in a file both tasks own, invites a merge conflict for no benefit. `plan.json`'s
T-011 boundary predates the §3 freeze.

**Action for the Orchestrator (not the Dispatcher):** amend `plan.json` to record
that T-011 DoD 1, 3 and 8 were satisfied by T-003, so T-011 scopes down to
`link()`/`unlink()`/activate semantics (T-011 DoD 2, 4, 5, 6, 7). This was
disclosed, not silent.

### 3. `ParsedFlightPlan` deviation — **confirmed sound; nothing frozen changed. `navDataCycle` may stay unpersisted.**

I diffed `src/lnmpln.ts:191-252` against
`contracts/planned-legs.d.ts:201-250`: all seventeen frozen fields are present
with identical names and types, and `simData` / `navDataSource` / `navDataCycle`
(`src/lnmpln.ts:222-224`) are purely additive. Nothing was removed, renamed or
retyped.

Half the stated rationale is solid and half is weak, but the conclusion holds:

- **Solid.** T-002 DoD 18 requires "the NavData cycle is read per file". You
  cannot satisfy that without somewhere to put it. The inspector prints
  `cycle=2609` / `cycle=1801` because these fields exist.
- **Weak.** The "otherwise every real file emits a spurious `UNKNOWN_ELEMENT`"
  half does not hold: recognition and persistence are independent, and the file's
  own comment says so — `FileVersion` and `Documentation` sit in
  `KNOWN_HEADER` (`src/lnmpln.ts:316-319`) precisely as recognised-but-unread.
  `SimData`/`NavData` could have been listed in `KNOWN_FLIGHTPLAN` the same way.

**`navDataCycle` parsed and discarded should persist as it is for phase 1.** DoD
18 says *read*, not *store*; §2.2's column list is frozen and has no home for it;
no consumer exists; and §5.4h explicitly forbids comparing cycles across legs, so
storing it invites exactly the misuse the design bans. Revisit only if a consumer
appears (F-7).

### 4. fast-xml-parser 5.11.1 vs the §5.1 frozen config — **behaves exactly as specified. Confirmed empirically.**

I ran the frozen config verbatim against a representative document under
5.11.1 and asserted each of §5.1's three binding claims:

- `parseTagValue: false` — `<Ident>1000</Ident>` → `"1000"` (string),
  `<Region>07</Region>` → `"07"` (leading zero intact).
- `parseAttributeValue: false` — `Lat="34.42"` → `"34.42"` (string).
- `isArray` — the second argument arrives as the **dotted jpath string** at
  runtime (`LittleNavmap.Flightplan.Waypoints.Waypoint`, …), so `String(jpath)`
  is a no-op safety net, not a semantic change. All four frozen jpaths force
  arrays: a single `<Waypoints>` with a single `<Waypoint>` yields
  `Array.isArray` true at both levels.
- Comments are dropped (default `commentPropName: false`); no validator runs.
- `preserveOrder` is not set.

The one v5 behaviour worth recording is the one adjudication 1 turns on:
`parse()` on non-XML returns `{}` rather than throwing.

### 5. The `UNKNOWN_ELEMENT` boundary — **claim tested and true for children; one narrower gap it does not cover.**

I ran the child case directly against `parseLnmpln`:

| Mutation | Result |
|---|---|
| `<Ident>` grows a child | **rejected** `MISSING_IDENT` — loudest possible |
| `<CruisingAltF>` grows a child | `cruiseAltFt: null` + explicit `CRUISE_ALT_MISSING` warning |
| `<Name>` grows a child | `name: null` — visible in the parse result, no warning |

The argument holds: a text-read element that grows children reads back as `null`,
which is visible or fatal, never silent. Not scanning them is correct.

**The gap the argument does not cover: an *attribute* added to a text-read
element is silently dropped, with no warning and no visible change.**
`<Ident Scheme="icao">KSBA</Ident>`, `<CruisingAltF Unit="ft">5500</CruisingAltF>`
and `<Name Lang="en">Santa Barbara</Name>` all parse to the same values as
without the attribute, because `toText()` (`src/lnmpln.ts:374`) reads `#text` and
ignores `@_*`. This is genuinely silent. It is also much narrower than the
container case — the loss would be a qualifier on a value, not a mis-read value —
and no known element carries an attribute today. Follow-up F-5, not a blocker.

### 6. `SINGLE_LEG` returning `resolved: true` — **honoured by both T-004 and T-005. Confirmed over HTTP.**

`src/server.ts:451` maps `order.resolved` to `ordering`, so a one-file import
returns `{"ordering":"chain","reason":"SINGLE_LEG"}` — verified twice (the IFR
file alone, and `bom.lnmpln` alone). `TripDetail.tsx:159` shows the fallback
notice only on `body.batch.ordering === 'upload'`, so `SINGLE_LEG` raises no
warning, exactly as §9.2.1 item 5 requires. Neither component special-cases the
reason string, which is the point of putting the rule in the data structure.

### 7. `flights.db` relative to `process.cwd()` — **pre-existing; not made materially worse. Out of scope for phase 1.**

`const DB_PATH = path.join(process.cwd(), 'flights.db')` (`src/db.ts:8`) is
unchanged by this diff. Starting the server from the wrong directory already
created a fresh empty database there, and that failure mode is unchanged in kind.

The one delta this feature introduces: `initDb()` now also runs `ALTER TABLE` on
`flights` and `trips`, so a mis-`cwd`'d start against an *unintended but real*
database now modifies its schema rather than only reading it. That is a marginal
increase in blast radius, and a small one: the migration is additive, idempotent,
`IF NOT EXISTS`/`PRAGMA`-guarded, and writes no row (design.md §3 item 4 —
verified: 33 flights and 1 trip unchanged across the migration, and every
existing row got NULL / 0). Nothing here warrants changing `DB_PATH` inside this
feature. Record it in residual risks and address it in T-023 if at all.

---

## 3. Findings

None blocking. Ordered by significance.

- **F-1 (follow-up, T-004).** `src/server.ts:421` — the duplicate check queries
  the database only, and every insert happens after the scan loop, so **the same
  file uploaded twice in one request creates two legs**. Verified: posting
  `bom.lnmpln` twice in one request → `imported: 2`, both `status: "imported"`.
  This is literally conformant to design.md §9.1 ("if a leg **already exists** in
  the same trip with the same `source_sha256`"), and the re-drag accident §9.1
  actually names — two separate requests — *is* caught. But the consequence §9.1
  warns about is the same one: a silently doubled planned distance feeding
  T-020's progress denominator. Fix is two lines (a `Set` of hashes seen in this
  batch, checked alongside `findPlannedLegBySource`). Worth doing before T-020.

- **F-2 (follow-up, T-005).** Per-file parser `warnings[]` are returned by the
  server (`src/server.ts:430`) and rendered **nowhere**: the client's import list
  filters to `r.status !== 'imported'` (`TripDetail.tsx:344`), and nothing logs
  them server-side either. `src/lnmpln.ts:250` says "Surfaced per file in the
  import response", and §5.4e calls `UNKNOWN_ELEMENT` "the mechanism that would
  have caught `<CustomOffsetAngle>` the day the first IFR plan arrived" — a
  mechanism that only works if a human sees it. Today a successful import that
  raised `UNKNOWN_ELEMENT`, `BOM_STRIPPED` or `CREATION_DATE_UNPARSEABLE` is
  completely silent. No phase-1 DoD line requires this (T-005 DoD 10 covers only
  the *chain* warning, which is correctly shown), so it is a follow-up — but it
  is the one that most undercuts a stated design intent. Suggest at minimum a
  `console.warn` per warning at import, and ideally a collapsed notice in the
  import results.

- **F-3 (cosmetic, T-004).** `src/server.ts:434` — when every file is rejected,
  `chainOrderForBatch([])` returns `SINGLE_LEG`, so the 400 body carries
  `{"ordering":"chain","reason":"SINGLE_LEG"}` for a batch that imported zero
  legs. Harmless (the client only branches on `ordering === 'upload'`, so nothing
  misleading is shown) but nonsensical in a log. Consider an `EMPTY_BATCH` reason
  or omitting `batch` when `imported` is empty.

- **F-4 (style, T-005).** `client/src/components/PlannedLegRows.tsx:70-73` —
  `endpointLabel` is the identity function, and its doc comment ("True beside a
  departure/destination ident only when the endpoint really is an airport")
  describes behaviour it does not have. The *rendered* behaviour is correct —
  idents are shown verbatim and the `Snippet` badge at line 99 carries the
  meaning, satisfying DoD 4 — but the comment will mislead the next reader.
  Either delete the wrapper or fix the comment.

- **F-5 (follow-up, T-002).** See adjudication 5: an attribute added to a
  text-read element is silently dropped. If it is ever worth closing, the cheap
  version is to have `toText`/`toNumber` note any `@_*` key on a node whose value
  they read.

- **F-6 (follow-up, T-002).** `src/inspect-lnmpln.ts` lacks the `looksLikeXml`
  sniff that `src/server.ts:404` applies, which is the sole cause of the
  `NOT_XML` / `NO_FLIGHTPLAN` split in adjudication 1. Adding the same two-line
  check to the CLI would make the two front ends report identically. Optional.

- **F-7 (note, T-002).** `navDataCycle` (`src/lnmpln.ts:857`) is parsed and
  discarded on the import path. Correct for phase 1 (adjudication 3); revisit
  only with a consumer and a Designer amendment to §2.2.

- **F-8 (process, T-004).** T-004 DoD 15 requires "a copy-pasteable curl
  transcript covering import, list, delete, reorder and three rejection cases".
  No such transcript exists under `.claude/runs/…/` — T-004's `allowed_paths` is
  `["src/server.ts"]` only, so it could not have written one. Presumably it was
  returned in the T-004 response envelope. **Orchestrator to confirm**; it is not
  a code defect, and I reproduced every case in that list independently
  (section 1, T-004).

- **F-9 (hardening, T-004).** `src/server.ts:401` stores `file.originalname`
  untruncated into `source_filename`, whereas the PDF path truncates to 255
  (`src/server.ts:329`). Not a vulnerability — see below — just an inconsistency
  that lets a pathological filename bloat a row.

### Security

**No SQL injection.** Every new statement in `src/db.ts` (lines 634–901) and
`src/server.ts` (lines 373–512) uses `?` placeholders; no template literal or
concatenation builds SQL. The only dynamic `SET` clauses in the file —
`src/db.ts:355` and `src/db.ts:481` — are pre-existing, unmodified by this diff,
and gated by hard-coded `allowed` whitelists.

**The reorder endpoint is safe on both axes.** `src/server.ts` requires
`Array.isArray(legIds) && legIds.every(Number.isInteger)` before anything else,
then requires the array to be the exact multiset of the trip's leg ids, and
`reorderPlannedLegs` additionally scopes each `UPDATE` with `WHERE id = ? AND
trip_id = ?`. I probed with `["1 OR 1=1","x",3]`, a bare string, duplicate ids
and a short array — all 400, none reached SQLite.

**Path traversal is structurally impossible, confirmed empirically.**
`uploadLnmpln` uses `multer.memoryStorage()`; the raw bytes never touch the
filesystem (design.md §10), and `originalname` is used only as a string — hashed,
bound as a parameter, and echoed into JSON. I posted a file with
`filename=../../../../../tmp/pwned.lnmpln`: multer normalised it to
`pwned.lnmpln`, no file was created anywhere, and the leg imported normally. The
echoed filename is rendered through React (`TripDetail.tsx:345`), which escapes
it, so it is not an XSS vector either.

**Limits are correctly separated.** `MAX_LNMPLN_BYTES = 512 * 1024` and
`MAX_LNMPLN_FILES = 25` on a distinct multer instance; `MAX_FLIGHT_PLAN_BYTES`
(20 MB) untouched; the shared error middleware picks the message from
`err.field`, verified by triggering both limits.
