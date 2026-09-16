# Design freeze — loose-flight prefile

Run id: `2026-09-16-loose-flight-prefile`
Task: T-001. Status: frozen.

Slice this document with `.claude/tools/ctx.sh design 2026-09-16-loose-flight-prefile <n> [<n> …]`.
Section numbers are stable and are the only way downstream tasks are given
this design. Every section is written to stand on its own; cross-references
are by number.

**Numbering is internal to this document.** No `§` reference, run id, task id,
`design.md`, `plan.json` or "Amendment" label may appear in a comment in
`src/`, `client/src/` or `tests/`. Where a section's reasoning belongs in the
code, the comment states the reasoning, not a pointer to where it came from.

## 1. Amendments

None. This table is appended to — never renumbered — if reality contradicts a
frozen section after the freeze.

| # | Date | Section | What changed | Evidence that forced it |
|---|------|---------|--------------|-------------------------|

---

## 2. Scope, vocabulary and what is verified vs designed

### 2.1 What this freeze covers

`planned_legs.trip_id` becomes nullable. A leg with `trip_id IS NULL` is a
**loose prefile**: a flight plan imported from `.lnmpln` or SimBrief that
belongs to no trip. Every downstream consumer — listing, status edit, delete,
flight linking, ACARS, ground sessions — treats it identically to a
trip-linked leg. Existing trip-linked behaviour is unchanged (§11).

Three phases implement it: schema + CRUD + routes (§3, §4, §5),
FlightManager/ACARS null tolerance (§6), client (§7).

### 2.2 Vocabulary

- **loose leg / loose prefile** — a `planned_legs` row with `trip_id IS NULL`.
- **trip-linked leg** — `trip_id` non-null. Exactly today's leg.
- **the loose pool** — the set of loose legs, for duplicate detection (§8.1)
  and `seq` (§8.2). It is one pool, shared by every loose leg, and it is
  disjoint from every trip's pool.
- **the live database** — the user's `flights.db`, which already holds 22 legs
  under the old `NOT NULL` constraint. Never touched by any task in this run.

### 2.3 Verified against the real thing, not assumed

Everything in §3 was run against a **copy** of the live `flights.db`
(6.3 MB: 22 planned legs, 188 waypoints, 7 alternates, 2 leg-scoped ACARS
messages, 4 ground sessions with a leg link, 21 flights with a leg link),
under Node 20.20.2 and better-sqlite3 against SQLite **3.45.3** — the same
versions the app runs. The evidence log is §3.7. The live file was read
read-only, and after all prototyping still reports `trip_id.notnull = 1`,
22 legs, 188 waypoints, `sqlite_sequence.seq = 34` — i.e. the migration never
ran against it.

Four facts in this document are marked **verify-only**: they are statements
about code that already exists and needs no change. An implementer confirms
them; a Reviewer re-runs the grep. They are §6.4, §6.5, and the two
"unchanged" lists in §4.5 and §5.4.

---

## 3. Persistence

### 3.1 The column

```sql
trip_id  INTEGER REFERENCES trips(id) ON DELETE CASCADE
```

`NOT NULL` is dropped. `REFERENCES trips(id) ON DELETE CASCADE` is kept
exactly as it is: deleting a trip still deletes its legs, and a NULL `trip_id`
references nothing, so no cascade can reach a loose leg. Nothing else about
the column, and nothing about the other 49 columns, changes.

The canonical `CREATE TABLE IF NOT EXISTS planned_legs` block in
`src/db/schema.ts` is edited in place to drop the two words `NOT NULL` from
the `trip_id` line, and its comment is updated to say what NULL means. Full
text: `.claude/runs/2026-09-16-loose-flight-prefile/contracts/planned_legs_nullable_trip.sql`,
block (A). That block alone is enough for a **fresh** database. It is not
enough for the user's, which is what §3.3 exists for.

### 3.2 Indexes — no structural change

```sql
CREATE INDEX IF NOT EXISTS idx_planned_legs_trip   ON planned_legs(trip_id, seq);
CREATE INDEX IF NOT EXISTS idx_planned_legs_source ON planned_legs(trip_id, source_sha256);
```

Both stay exactly as they are. SQLite index keys admit NULL, so a loose leg
indexes under `(NULL, seq)` / `(NULL, source_sha256)` with no special
handling, and both of this run's new predicates are served by an index
search rather than a scan. Measured on the rebuilt copy:

| query | plan |
|---|---|
| `WHERE trip_id IS ? AND source_sha256 = ?`, param `NULL` | `SEARCH planned_legs USING COVERING INDEX idx_planned_legs_source (trip_id=? AND source_sha256=?)` |
| same, param `1` | identical |
| `WHERE trip_id = ? AND source_sha256 = ?`, param `1` (today's query) | identical |
| `SELECT COALESCE(MAX(seq),0)+1 … WHERE trip_id IS ?`, param `1` | `SEARCH planned_legs USING COVERING INDEX idx_planned_legs_trip (trip_id=?)` |
| same with `= ?` (today's query) | identical |

No partial index, no `COALESCE(trip_id, -1)` expression index, no separate
loose-leg index. The alternative considered and rejected is in §9.3.

The unified listing (§4.4) plans as `SCAN planned_legs` + `USE TEMP B-TREE FOR
ORDER BY`. Over 22 rows — and over any plausible number of prefiles — that is
not worth an index; the sort key is an expression and the result set is the
whole table anyway. Stated so a Reviewer does not read the scan as an
oversight.

### 3.3 The one-time rebuild for an existing database

SQLite has no `ALTER TABLE … ALTER COLUMN`, and `CREATE TABLE IF NOT EXISTS`
never touches a table that already exists — so on the user's database the
edit in §3.1 changes nothing at all, and `trip_id` keeps its `NOT NULL`
constraint forever. The constraint can only be removed by rebuilding the
table.

The rebuild lives in `src/db/schema.ts`, in the migration section after the
big `db.exec(...)`, in the same shape as the `PRAGMA table_info` +
`ALTER TABLE ADD COLUMN` migrations already there. Full SQL:
`contracts/planned_legs_nullable_trip.sql`, block (B). The recipe, in order:

1. **Gate.** Read `PRAGMA table_info(planned_legs)`, find the `trip_id` row,
   and return immediately if it is missing or its `notnull` flag is `0`. A
   fresh database created by §3.1 reports `0` and skips; a database that has
   already been migrated reports `0` and skips. This is the only gate, and it
   is derived from the thing being changed rather than from a version marker,
   so it cannot get out of step with reality. (Measured: `notnull` is `1` for
   `INTEGER NOT NULL REFERENCES …` and `0` for `INTEGER REFERENCES …`.)
2. **Disable foreign keys, outside any transaction**, and re-read the pragma
   to confirm it actually took. If it still reads `1`, throw without touching
   the table. Non-negotiable, and the reason is §3.4.
3. `BEGIN`.
4. `CREATE TABLE planned_legs_new (…)` — the 50 columns of §3.1, `trip_id`
   nullable, everything else identical, `id INTEGER PRIMARY KEY AUTOINCREMENT`
   preserved.
5. `INSERT INTO planned_legs_new (<50 columns>) SELECT <the same 50 columns>
   FROM planned_legs` — **explicit column lists on both sides, never
   `SELECT *`** (§3.6).
6. Read `SELECT seq FROM sqlite_sequence WHERE name = 'planned_legs'` and hold
   it. Must happen before step 7 (§3.5).
7. `DROP TABLE planned_legs`.
8. `ALTER TABLE planned_legs_new RENAME TO planned_legs`. Drop-then-rename,
   never rename-the-old-one-out-of-the-way — §3.4 measured why.
9. Recreate both indexes from §3.2 with `CREATE INDEX IF NOT EXISTS`. Step 7
   dropped them, and `applySchema`'s own `CREATE INDEX` statements ran before
   this block, so nothing else will.
10. `UPDATE sqlite_sequence SET seq = :keep WHERE name = 'planned_legs' AND
    seq < :keep` (§3.5). The `seq < :keep` guard makes it a no-op rather than
    a regression if the copied rows already carried the counter higher.
11. `PRAGMA foreign_key_check`. A non-empty result throws, which rolls back —
    a rebuilt table with dangling references must never commit.
12. `COMMIT`, then **restore the foreign-keys pragma to its previous value**
    in a `finally`, so an exception anywhere in 3–11 cannot leave the process
    running with foreign keys off.

Rollback: steps 3–11 are one transaction, so a failure leaves the original
table in place and the process dies at startup with a real error rather than
running against half a schema. `initDb()` calls `applySchema()` before the
server listens, so there is no window where requests see the intermediate
state.

Measured on the copy: 56 ms, `notnull` 1 → 0, all row counts and a
`group_concat` digest of every leg's `(id, trip_id, seq, status,
source_sha256)` **identical** before and after, `PRAGMA integrity_check` ok,
`PRAGMA foreign_key_check` empty, both indexes present, all five child tables'
`REFERENCES planned_legs(id)` clauses untouched, and the pragma restored to
`1`. Running the gated function three times in a row: run 1 rebuilds, runs 2
and 3 skip, and every count is unchanged after each (§3.7).

### 3.4 Foreign keys must be bracketed OFF — measured, not assumed

Five tables hold a foreign key referencing `planned_legs.id`
(`planned_waypoints`, `planned_alternates` and `acars_messages` with
`ON DELETE CASCADE`; `flights` and `ground_sessions` with `ON DELETE SET
NULL`), and `planned_legs` itself references `trips.id`. `initDb()` sets
`PRAGMA foreign_keys = ON` before calling `applySchema()`, and better-sqlite3
reports `foreign_keys = 1` even on a bare handle that never set it — so the
rebuild runs with enforcement on unless it turns it off itself.

**With foreign keys ON, `DROP TABLE planned_legs` fires every referencing
action and silently destroys the user's data.** Run against a copy of the live
database, with that one pragma left on and everything else identical to §3.3:

| | before | after |
|---|---|---|
| planned_legs | 22 | 22 |
| planned_waypoints | 188 | **0** |
| planned_alternates | 7 | **0** |
| acars_messages (leg-scoped) | 2 | **0** |
| ground_sessions with a leg link | 4 | **0** |
| flights with a leg link | 21 | **0** |

`PRAGMA integrity_check` returned `ok` and `PRAGMA foreign_key_check` returned
empty afterwards, because the rows were deleted rather than orphaned. Nothing
in the migration would have noticed. This is the single most dangerous thing
in the run.

Two further measured facts the recipe depends on:

- **The pragma is a silent no-op inside a transaction.** After `BEGIN`,
  `PRAGMA foreign_keys = OFF` leaves it reading `1`; the same is true inside
  better-sqlite3's `db.transaction()` wrapper. It reads `0` only when set
  outside a transaction. So the toggle goes before `BEGIN`, the whole rebuild
  is *not* wrapped in `db.transaction()`, and step 2 of §3.3 re-reads the
  pragma before proceeding. An implementer who reaches for `db.transaction()`
  out of habit reproduces the table above exactly.
- **`ALTER TABLE … RENAME TO` rewrites other tables' `REFERENCES` clauses
  regardless of the pragma.** On 3.45.3, renaming `parent` to `parent_old`
  rewrote `child`'s clause to `REFERENCES "parent_old"(id)` with foreign keys
  both ON and OFF. (The SQLite documentation's claim that this is gated on the
  `foreign_keys` pragma does not describe 3.45.3's behaviour; what actually
  gates it is `PRAGMA legacy_alter_table`, which this design does not use.)
  Renaming `planned_legs` out of the way would therefore leave all five child
  tables pointing at a table named `planned_legs_old`. Drop-then-rename avoids
  this entirely: nothing references `planned_legs_new`, so its rename rewrites
  nothing, and the children's clauses — still naming `planned_legs` — bind to
  the new table. Verified end to end: after the rebuild every child DDL still
  reads `REFERENCES planned_legs(id)`, an orphan insert into a child is
  refused, `DELETE FROM trips` still cascades to its legs and their waypoints,
  and deleting a leg still cascades to its waypoints and NULLs
  `flights.planned_leg_id`.

### 3.5 `sqlite_sequence` must be carried across — measured

`planned_legs.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, whose whole point is
that an id is never reused. `DROP TABLE` deletes the table's `sqlite_sequence`
row, and the `INSERT … SELECT` only raises the new table's counter to
`MAX(id)`. On the live database today `sqlite_sequence.seq` is **34** while
`MAX(id)` is **33** — the highest-numbered leg was deleted at some point — so
a rebuild that ignores the counter hands id 34 to the next leg imported.

Measured both ways on copies: without step 10 the counter came out 33 and the
next inserted leg got **id 34**, an id AUTOINCREMENT had already issued. With
step 10 the counter stayed 34 and the next leg got **id 35**.

This matters beyond tidiness: leg ids appear in ACARS dedup keys
(`dispatch:ofp:<leg>`, `oooi:<flight>:OUT`), in URLs the user may have open
(`/planned-leg/:legId/acars`), and in the MCDU client's state.

### 3.6 Placement in `applySchema()`, and the rule for future migrations

The rebuild block goes in the migration section of `applySchema()`, after the
`flights` and `trips` column migrations, and it is the last `planned_legs`
statement in the function.

Two ordering rules, frozen, because a rebuild is not like an
`ADD COLUMN` migration:

1. **The rebuild's `CREATE TABLE`/`INSERT` column lists are frozen at the 50
   columns `planned_legs` has today and must not be edited when the canonical
   table later gains a column.** The block only ever runs against a database
   that predates this run, and such a database has exactly these 50 columns.
2. **Any future `ALTER TABLE planned_legs ADD COLUMN` migration goes after
   this block, never before it.** A column added before it would exist on the
   old table and not in the rebuild's list, and would be silently dropped.

The explicit column lists in step 5 of §3.3 exist for rule 1: `SELECT *` would
make the mismatch silent instead of a hard SQLite error.

### 3.7 Evidence log

All commands run under `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20`,
against copies in the session scratchpad (`…/scratchpad/proto/`), made with
`cp flights.db flights.db-wal flights.db-shm` per `.claude/ENVIRONMENT.md`.

| what | command | result |
|---|---|---|
| live table state, read-only | `node -e "…new Database('flights.db',{readonly:true})…"` | `trip_id.notnull = 1`, 22 legs, `sqlite_sequence.seq = 34`, `MAX(id) = 33`, SQLite 3.45.3, no triggers or views referencing `planned_legs` |
| §3.3 recipe on a copy | `node …/rebuild.js …/safe.db safe` | `notnull` 1→0, every count preserved, leg digest `IDENTICAL`, `integrity_check ok`, `foreign_key_check []`, both indexes present, all five child `REFERENCES` clauses intact, pragma restored to 1, 56 ms |
| same, foreign keys left ON | `node …/rebuild.js …/naive-fk-on.db naive-fk-on` | the destruction table in §3.4 |
| same, without the counter carry | `node …/rebuild.js …/naive-seq.db naive-seq` | `sqlite_sequence` 34→33, next leg inserted as id 34 (reuse) |
| gated function ×3 on a copy, reading the frozen SQL from `contracts/planned_legs_nullable_trip.sql` | `node …/migrate.js …/idem.db` | run 1 rebuilds; runs 2 and 3 skip on the gate; counts identical after each |
| pragma-inside-transaction, rename semantics, gate probe, query plans | `node …/hazards.js` | §3.4 and §3.2 tables |
| duplicate pools and seq scoping on the rebuilt copy | `node -e "…"` (§8.1, §8.2) | a loose leg and a trip leg sharing one sha256 resolve to different rows; `IS`/`=` identical for a non-null trip |
| live file untouched afterwards | `node -e "…readonly…"` | still `notnull = 1`, 22 legs, 188 waypoints, `seq = 34` — i.e. the old schema, unmigrated |

The live file's md5 changed during the run (`f93ae5e9…` → `a3dfdfa0…`) with no
write from any command here; per `.claude/ENVIRONMENT.md` the running server's
own WAL checkpointing does that. The structural check in the last row is the
real proof of non-contamination.

---

## 4. CRUD contract — `src/db/plannedLegs.ts`

This file owns every function below. No other module may write `planned_legs`.

### 4.1 `CreatePlannedLegInput`

```ts
export interface CreatePlannedLegInput {
  tripId: number | null;   // CHANGED: was `number`. null creates a loose leg.
  plan: CreatePlannedLegPlan;
  sourceFilename: string;
  sourceSha256: string;
}
```

That widening is the **only** change to this interface.
`CreatePlannedLegPlan` and its five helper interfaces are untouched.

### 4.2 `createPlannedLeg` — one predicate changes

The seq query becomes:

```sql
SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM planned_legs WHERE trip_id IS ?
```

`IS` instead of `=`, and nothing else in the function changes — not the
`INSERT`, not the child inserts, not the transaction, not the parameter order.
`trip_id = NULL` is NULL and never true, so with `=` every loose leg would be
computed as seq 1 (measured: `= ?` returned `next_seq 1` for the loose pool
where `IS ?` returned 3). For a non-null `tripId`, `IS ?` returns the same row
set and the same query plan as `= ?` (§3.2), so trip-linked numbering is
untouched.

`seq` stays `NOT NULL` and stays 1-based-per-pool. See §8.2 for the full rule.

### 4.3 `findPlannedLegBySource`

```ts
/** The existing leg holding these bytes within the same pool: one trip, or
 *  the loose pool. Null when this pool has never seen them. */
export function findPlannedLegBySource(tripId: number | null, sha256: string): PlannedLeg | null
```

```sql
SELECT * FROM planned_legs WHERE trip_id IS ? AND source_sha256 = ? LIMIT 1
```

`IS`, for the reason in §4.2 — with `=` a loose re-import would never be
recognised as a duplicate and every upload of the same file would add another
leg. An explicit `OR (trip_id IS NULL AND ? IS NULL)` branch would work too
and is rejected in §9.2. The pool semantics are §8.1.

### 4.4 `getAllPlannedLegs` — the unified listing

```ts
/** Every planned leg, loose and trip-linked, children attached and the
 *  owning trip's name resolved. Ordering: §8.3. */
export function getAllPlannedLegs(): PlannedLegListItem[]
```

```sql
SELECT l.*,
       t.name AS trip_name,
       (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
  FROM planned_legs l
  LEFT JOIN trips t ON t.id = l.trip_id
 ORDER BY (l.trip_id IS NULL) DESC, l.trip_id ASC, l.seq ASC, l.id ASC
```

then the same `attachPlannedLegChildren` mapping `getPlannedLegsForTrip` uses,
so waypoints and alternates arrive in `seq ASC` exactly as they do everywhere
else.

`LEFT JOIN`, not an inner join: an inner join silently drops every loose leg,
which is the one bug this function exists to avoid. `trip_name` is null if and
only if `trip_id` is null — the foreign key guarantees a non-null `trip_id`
names a row in `trips`.

`PlannedLegListItem` is a **new** interface, owned by `src/types.ts`:

```ts
/** GET /api/planned-legs element: a planned leg with its owning trip's name
 *  resolved, so a unified list needs no second request. trip_name is null
 *  exactly when trip_id is null. */
export interface PlannedLegListItem extends PlannedLegWithChildren {
  trip_name: string | null;
}
```

`PlannedLegWithChildren` itself is **not** given a `trip_name` — it is the
return type of six other functions and every one of them would have to invent
a value. §9.4 covers the alternative.

### 4.5 Unchanged — verify-only

Not one of these changes signature or behaviour. An implementer that edits any
of them has gone outside the design:

- `getPlannedLegsForTrip(tripId: number)` — still `WHERE l.trip_id = ?`, still
  `ORDER BY l.seq ASC, l.id ASC`, still returns only that trip's legs. `= ?`
  is correct here precisely because a loose leg must never appear in a trip's
  list.
- `reorderPlannedLegs(tripId: number, legIds: number[])` — stays `number`,
  stays `UPDATE … WHERE id = ? AND trip_id = ?`. **Reordering is a trip-only
  concept and loose legs are out of scope for it, frozen.** A loose leg's seq
  is assigned once at import (§8.2) and never changed. The listing order in
  §8.3 is total without it.
- `getPlannedLegById`, `deletePlannedLeg`, `setPlannedLegStatus`,
  `setPlannedLegHandOutcome`, `recordPlannedLegArrival`,
  `linkFlightToPlannedLeg`, `unlinkFlightFromPlannedLeg`,
  `clearPlannedLegLink`, `getFlightPlannedLegId` — all keyed by `legId` or
  `flightId`, none reads `trip_id` as a scope. `linkFlightToPlannedLeg` reads
  `SELECT trip_id FROM planned_legs WHERE id = ?` and writes it to
  `flights.trip_id`; `flights.trip_id` is already `number | null` in
  `src/types.ts`, so linking a flight to a loose leg correctly moves the
  flight out of any trip, and unlinking restores
  `planned_leg_prev_trip_id` exactly as it does today. The local row type in
  that function is annotated `{ trip_id: number }` and must be widened to
  `{ trip_id: number | null }`; that is a type annotation, not a behaviour
  change, and is the only edit permitted in this bullet.
- `getPlannedLegCandidatesForActiveTrip` — §6.4.

---

## 5. API surface

All routes live in `src/routes/plannedLegs.ts` and are mounted at `/api` by
`src/server.ts`, behind `requireAuth` and `requireSameOrigin`. Two are new;
the rest of the file is untouched.

### 5.1 `GET /api/planned-legs` — new

Unified listing for the Prefiles page (§7.4) and for every picker that today
fans out over `/api/trips/:id/planned-legs` (§7.5).

- **Request**: no body, no query parameters. Filtering is the client's job;
  the endpoint has no `?trip_id=` and no `?status=` — adding one later is
  additive and does not break this contract.
- **200**: `PlannedLegListItem[]` (§4.4). Empty array when there are no legs
  at all — never 404.
- **500**: `{ "error": "<String(err)>" }`, matching every other read in this
  router.

`GET /api/trips/:id/planned-legs` is **unchanged**: same path, same 400 on a
bad id, same 404 on a missing trip, same body, and it still returns only that
trip's legs and never a loose one.

### 5.2 `POST /api/planned-legs` — new, multipart `.lnmpln`

A copy of `POST /api/trips/:id/planned-legs` with the trip lookup removed. The
handler body is otherwise the same code path and must stay so: same
`uploadLnmpln.array('lnmpln', MAX_LNMPLN_FILES)` middleware and field name,
same `looksLikeXml` sniff, same `parseLnmpln`, same sha256 over the file
bytes, same `allow_duplicates === '1'` multipart check, same in-batch
duplicate tracking, same `chainOrderForBatch`, same insert loop, same
`batch.ordering` omission when nothing imported.

Differences, and only these:

- No `:id` parameter, therefore **no "Invalid trip id" 400 and no "Trip not
  found" 404**.
- `createPlannedLeg({ tripId: null, … })` and
  `findPlannedLegBySource(null, sha256)`.
- The cross-request duplicate message is
  `` `Already imported without a trip as leg ${existing.seq}` `` (the
  trip-nested route says "into this trip"). The in-batch duplicate message is
  unchanged.

Responses are shape-identical to the trip-nested route, so the client reuses
`PlannedLegImportResponse` and its rendering with no new branch: **201**
`{ imported, batch, results }`; **400** `{ imported, results }` when nothing
imported; **400** `{ error }` for "No files uploaded"; **500** `{ error }`.
Multer limit errors still unwind to the app-level handler in `src/server.ts`
keyed on `err.field` — unchanged, because the field name is still `lnmpln`.

Samples: `contracts/samples.md`.

### 5.3 `POST /api/planned-legs/simbrief` — new, JSON

A copy of `POST /api/trips/:id/planned-legs/simbrief` with the trip lookup
removed. **The step order is the contract, exactly as it is there**: settings
read, network call, parse, duplicate check, then `createPlannedLeg` as the
first and only write to `planned_legs`, then — and only then — the ACARS
dispatch release in its own try/catch. Do not move the write earlier and do
not add a second write to `planned_legs`.

Differences, and only these:

- No `:id`, therefore **no `INVALID_TRIP` 400 and no `NOT_FOUND` 404**.
- `createPlannedLeg({ tripId: null, … })`,
  `findPlannedLegBySource(null, sha256)`.
- Duplicate message: `` `This SimBrief plan is already imported without a trip
  as leg ${existing.seq}. Generate a new OFP on simbrief.com, or re-import to
  add it again.` ``
- Log lines say `no-trip` where the trip-nested route says `trip ${tripId}`.

**The dispatch release is filed the same way** — `insertAcarsMessageOnce` with
`planned_leg_id: legId`, `dedup_key: dispatchDedupKey(legId)`, its own
try/catch so a message failure never turns a committed import into an error.
This is what makes acceptance criterion 3 (ACARS parity for loose prefiles)
true at creation time rather than only later.

Responses, identical in shape to the trip-nested route: **201**
`{ imported: [leg], result: { status: 'imported', … } }`; **200**
`{ imported: [], result: { status: 'duplicate', … } }`; **400** `NO_USER_ID`
/ `UNKNOWN_USER`; **404** `NO_PLAN`; **504** `TIMEOUT`; **502** `NETWORK` /
`BAD_STATUS` / `BAD_BODY`; **500** `{ error, code: 'DB_ERROR' }`. The
`SIMBRIEF_FAILURE_STATUS` map is shared, not copied.

### 5.4 Routes that need no change — verify-only

| route | why it already works for a loose leg |
|---|---|
| `GET /api/planned-legs/:legId` | keyed by leg id |
| `PATCH /api/planned-legs/:legId` | keyed by leg id; the 400 on a system status and the 409 on a linked leg are unchanged |
| `DELETE /api/planned-legs/:legId` | keyed by leg id; `deletePlannedLeg` restores `flights.trip_id` from `planned_leg_prev_trip_id`, which is already nullable |
| `PUT /api/flights/:id/planned-leg` | keyed by flight id, looks the leg up by id alone, deliberately not trip-scoped |
| `PUT /api/flights/:id/planned-leg-status` | keyed by flight id; the gate reads three `flights` columns and the leg's status |
| `GET/POST /api/planned-legs/:legId/acars-messages`, `…/wx`, `…/loadsheet` | §6.5 |
| every `/api/ground-sessions*` route | §6.5 |
| `GET /api/trips/:id/planned-legs` | §5.1 |
| `PATCH /api/trips/:id/planned-legs/order` | trip-scoped by design (§4.5) |

Acceptance criterion 4 ("manage loose prefile lifecycle") is satisfied by this
table plus §5.1–§5.3: edit is the existing `PATCH`, cancel is the existing
`DELETE`, and neither needed a change.

### 5.5 Registration order

Register the two new routes **before** `router.get('/planned-legs/:legId', …)`
in the file. Express matches in registration order and
`POST /api/planned-legs/simbrief` cannot today be shadowed by any existing
route (there is no `POST /planned-legs/:legId`), but the ordering is the
property that keeps it true if one is ever added. Grouping: the two loose
creation routes go directly after their trip-nested counterparts, so the pairs
read together.

---

## 6. FlightManager, live status, matching and ACARS

### 6.1 `PlannedLegCache` — `src/flightManager.ts`

Module-private interface. Two fields widen:

```ts
interface PlannedLegCache {
  flightId: number;
  plannedLegId: number;
  tripId: number | null;      // CHANGED: was number
  tripName: string | null;    // CHANGED: was string
  destinationIdent: string;
  waypoints: { ident: string; lat: number; lon: number }[];
  remainingFromNm: number[];
}
```

### 6.2 `buildPlannedLegCache` and `buildGroundSessionCache`

Both must call `getTripName(leg.trip_id)` **only when `leg.trip_id !== null`**,
and set `tripName: null` otherwise. `getTripName(tripId: number)` in
`src/db/trips.ts` keeps its signature — it is never handed a null, so it never
needs to answer for one.

`buildPlannedLegCache` today writes `tripName: getTripName(leg.trip_id) ?? ''`.
The `?? ''` fallback goes away: its only reachable value is the trip's name
(the foreign key makes a missing trip impossible), so the change is invisible
for trip-linked legs and `null` becomes the honest answer for a loose one.

`buildGroundSessionCache` already declares `tripId`/`tripName` as
`number | null` / `string | null` and already defaults both to null — the only
edit is guarding the `getTripName` call inside its `if (leg)` branch.

`refreshPlannedLegForFlight` and `autoLinkPlannedLeg` need no change: they
pass a leg through to `buildPlannedLegCache` and never read `trip_id`.

### 6.3 `PlannedLegLiveStatus` — `src/types.ts`

```ts
export interface PlannedLegLiveStatus {
  plannedLegId: number;
  tripId: number | null;    // CHANGED: was number
  tripName: string | null;  // CHANGED: was string
  destinationIdent: string;
  nextWaypointIdent: string;
  remainingDistanceNm: number;
  distanceIsApproximate: true;
}
```

This matches the precedent `GroundSessionLiveStatus` already sets in the same
file, where both fields have always been nullable. `getPlannedLegStatus()`
copies the two cache fields through and needs no other edit.

`LegMatchCandidate.tripId` stays `number` — §6.4 is why.

### 6.4 Auto-matching structurally excludes loose legs — verify-only, and correct

`getPlannedLegCandidatesForActiveTrip()` reads:

```sql
FROM planned_legs l
JOIN trips t ON t.id = l.trip_id AND t.is_active = 1
```

An inner join on `t.id = l.trip_id` can never match a row whose `trip_id` is
NULL, so **no loose leg can ever be an auto-match candidate**, with no code
change and no filter. Measured on the rebuilt copy: with loose legs present,
the query returned only the trip-linked rows.

This is intentional and stays. Auto-matching at takeoff is defined against
*the active trip* — it exists to pick the right leg out of a planned sequence
the pilot is flying. A loose prefile is by definition not part of one. It also
means `LegMatchCandidate.tripId` stays `number`, `src/legMatcher.ts` needs no
change, and the ground-session auto-match (which uses the same candidate list)
is likewise unaffected.

Manual linking is unaffected and is the route to a loose leg:
`PUT /api/flights/:id/planned-leg` looks the leg up by id alone and is
deliberately not trip-scoped (§5.4). A loose leg is therefore linked to a
flight by hand, and from then on every downstream behaviour — live status,
`recordPlannedLegArrival` at touchdown, the hand close-out — runs unchanged.

### 6.5 ACARS and ground sessions need no contract change — verify-only

`src/routes/acars.ts`, `src/acars.ts`, `src/db/acarsMessages.ts`,
`src/routes/groundSessions.ts` and `src/db/groundSessions.ts` contain **zero**
occurrences of `trip_id`, `tripId` or `tripName` (`grep -c` per file, all 0,
re-run at design time). Every read and write there is keyed on
`planned_leg_id` or `flight_id`. Dispatch release, weather request/reply,
loadsheet, PDC, OOOI events and position reports therefore work on a loose leg
the moment the leg exists, which is acceptance criterion 3.

The only ACARS-adjacent thing this run adds is §5.3 filing the dispatch
release for a loose SimBrief import, and that is a call to the existing
`insertAcarsMessageOnce` with the existing dedup key.

Ground-session *display* of a trip name flows through
`buildGroundSessionCache` (§6.2) and is already nullable end to end.

---

## 7. Client contract

### 7.1 Type mirror — `client/src/types.ts`

This file owns every client type and mirrors the server 1:1. Three edits, one
addition:

```ts
export interface PlannedLeg {
  id: number;
  trip_id: number | null;   // CHANGED: was number. null = loose prefile.
  // …unchanged
}
// PlannedLegWithChildren extends PlannedLeg and inherits the change.

export interface PlannedLegListItem extends PlannedLegWithChildren {
  trip_name: string | null; // NEW. null exactly when trip_id is null.
}

export interface PlannedLegLiveStatus {
  tripId: number | null;    // CHANGED: was number
  tripName: string | null;  // CHANGED: was string
  // …unchanged
}
```

`PlannedLegImportResponse`, `PlannedLegImportResult`, `SimbriefImportResponse`
and `SimbriefImportResult` are **unchanged** and are reused verbatim for the
two loose routes (§5.2, §5.3). `GroundSessionLiveStatus` is already nullable
on both fields and is unchanged.

### 7.2 The "No trip" convention

Wherever a planned leg's trip would be shown, a loose leg shows the literal
string:

```
No trip
```

Exactly that — two words, capital N, lower-case t, no parentheses, no em-dash,
no "—", no "Unassigned". It is the string acceptance criterion 5 names and it
must read identically on every surface: the Prefiles page (§7.4), the flight
detail planned-leg line, the ACARS page's back link area, and both leg pickers
(§7.5).

The condition is `trip_id === null` on a leg row, or `tripId === null` on a
live-status object. When a trip name is expected but absent for a leg that
does claim a trip (`trip_id !== null && trip_name === null`, unreachable under
the foreign key), render "No trip" as well rather than an empty string —
degrading to the same words is better than a blank.

### 7.3 Never render a trip link with a null trip id

No `<Link to={`/trip/${trip_id}`}>` may ever be rendered when `trip_id` is
null: it would produce `/trip/null`, which routes to `TripDetail` and fails
with a bad-id fetch. Every site guards or omits the link. The three that exist
today:

| file | line today | today | required |
|---|---|---|---|
| `client/src/pages/FlightDetail.tsx` | ~304 | `Leg {seq} of <Link to={`/trip/${plannedLeg.trip_id}`}>{plannedTripName}</Link>`, with `'its trip'` as the no-name fallback | render the `Link` only when `plannedLeg.trip_id !== null && plannedTripName`; otherwise the bare text `No trip`, no link. The `'its trip'` fallback is replaced by `No trip`. |
| `client/src/pages/AcarsMessages.tsx` | ~239 | back link `to={plannedLeg ? `/trip/${plannedLeg.trip_id}` : '/flights'}`, labelled "← Back to trip" | when the leg is loaded and `trip_id === null`, link to the Prefiles page (§7.4) and label it `← Back to prefiles`. Unchanged for a trip-linked leg; the not-yet-loaded fallback to `/flights` is unchanged. |
| `client/src/components/Sidebar.tsx` | ~170 | `/trip/${trip.id}` from the trips list | unchanged — it iterates `trips`, never legs |

`FlightDetail.tsx` also resolves the trip name by scanning `/api/trips`
(`trips.find(t => t.id === leg.trip_id)?.name ?? null`). With `trip_id` null
that `find` returns undefined and the name is null, which is already correct —
the only required change there is the link guard above.

### 7.4 The Prefiles page

New page, new route `"/prefiles"`, new sidebar entry labelled **Prefiles**,
placed directly after "All flights". It is the non-trip entry point acceptance
criteria 1 and 5 need, and the only place a loose prefile can be created or
seen.

Data: one `GET /api/planned-legs` (§5.1). No per-trip fan-out.

Minimum content, frozen:

1. **A list of every planned leg, loose and trip-linked**, in the order §8.3
   defines, each row showing at least:
   - the status badge, from the existing `plannedLegBadge(leg.status)` in
     `client/src/components/PlannedLegRows.tsx` — the same four-label
     vocabulary as everywhere else, plus the existing Snippet badge when
     `is_snippet === 1`;
   - the route, `departure_ident → destination_ident`;
   - the trip: a `<Link to={`/trip/${trip_id}`}>{trip_name}</Link>` when
     `trip_id !== null`, and otherwise the literal `No trip` **with no link**
     (§7.2, §7.3).
2. **A creation section**, reusing the two UI patterns from `TripDetail.tsx`
   verbatim in structure, class names and copy:
   - "Import Planned Route (.lnmpln)" — the same `<input type="file"
     accept=".lnmpln" multiple>`, the same raw `fetch` (not `apiFetch`) with a
     `FormData` carrying field name `lnmpln`, the same `results[]` /
     `batch.ordering` rendering and the same warning list — posting to
     `POST /api/planned-legs` (§5.2);
   - "Import from SimBrief" — the same saved-pilot-id block reading and
     writing `/api/settings/simbrief`, the same disabled/hint logic, the same
     `imported` / `duplicate` result rendering — posting to
     `POST /api/planned-legs/simbrief` (§5.3).

   Both response shapes are unchanged (§7.1), so the existing parsing is
   copied, not redesigned.
3. After a successful import, reload the list from `GET /api/planned-legs`.

Deliberately **not** on this page: reorder controls (§4.5 — loose legs are
never reordered, and reordering a trip's legs stays on the trip page), and
trip assignment (moving a loose leg into a trip is out of scope for this run —
§12.3).

Per-row actions beyond the link are optional for the first pass; if any are
offered they must be the existing endpoints: skip/unskip via
`PATCH /api/planned-legs/:legId`, delete via `DELETE /api/planned-legs/:legId`,
ACARS via the existing `/planned-leg/:legId/acars` route.

### 7.5 The two leg pickers

`client/src/pages/Home.tsx` (ground-session manual leg picker, ~line 105) and
`client/src/pages/TripDetail.tsx` (`loadLinkableLegs`, ~line 415) both build
their option list by fetching `/api/trips` and then one
`/api/trips/:id/planned-legs` per trip. That fan-out cannot see a loose leg,
so acceptance criteria 3 and 4 fail for loose prefiles until both switch to a
single `GET /api/planned-legs` (§5.1), keeping the same
`.filter(l => l.linked_flight_id === null)`.

The option label keeps its shape and takes the trip name from `trip_name`:

- Home: `` `${leg.trip_name ?? 'No trip'} · ${leg.departure_ident} → ${leg.destination_ident}` ``
- TripDetail: `` `${leg.trip_name ?? 'No trip'} · Leg ${leg.seq}: ${leg.departure_ident} → ${leg.destination_ident}` ``

The local state type `{ tripName: string; leg: PlannedLegWithChildren }[]`
collapses to `PlannedLegListItem[]`; the `N + 1` request pattern collapses to
one request. `TripDetail.tsx`'s comment explaining that the picker is
deliberately not scoped to this trip stays true and stays.

`client/src/components/PlannedLegRows.tsx` needs **no change**:
`plannedLegBadge`, `plannedLegLandingNote`, `interleaveTripRows` and
`GhostLegRow` never read `trip_id`. `TripMap`, `FlightMap`, `PrintTrip` and
`PrintFlight` likewise.

---

## 8. Algorithms and rules

### 8.1 Duplicate detection — the pools

One rule, applied at both import routes:

> A planned leg is a duplicate of an existing one when it has the same
> `source_sha256` **and the same trip scope**. "No trip" is one scope, shared
> by every loose leg; each trip is its own scope; the scopes are disjoint.

Implemented as `WHERE trip_id IS ? AND source_sha256 = ?` (§4.3). Consequences,
all intended:

- The same `.lnmpln` file may exist once as a loose leg and once in each trip.
  Measured: a loose leg and a trip leg sharing `source_sha256` resolve to
  their own rows, and neither lookup returns the other.
- Uploading the same file twice with no trip is reported as
  `status: 'duplicate'` naming the existing loose leg (§5.2) — the same
  behaviour a trip gets.
- `allow_duplicates` still bypasses the check entirely, on both routes, with
  its existing per-route encoding (`'1'` in multipart, `true` in JSON).
- SimBrief's hash is still over `requestId / sequenceId / timeGenerated`, not
  the response body — unchanged, and it scopes the same way.

`source_sha256` remains non-unique at the database level: this is an
application rule with an `allow_duplicates` escape hatch, and a UNIQUE index
would turn the escape hatch into a constraint error. No index change (§3.2).

Frozen decision satisfied: "prefiled flights must retain a unique identifier
regardless of trip association" — that identifier is `planned_legs.id`, an
AUTOINCREMENT primary key that has never depended on `trip_id`, and §3.5
protects its never-reused property across the migration.

### 8.2 `seq` assignment

> `seq` is 1-based and dense-on-import **within a pool**, where a pool is one
> trip or the loose set. At import, `seq = COALESCE(MAX(seq), 0) + 1` over the
> legs of the same pool, computed inside `createPlannedLeg`'s transaction
> (§4.2). It is gappy after a delete, exactly as it is today.

- Loose legs get 1, 2, 3, … independently of every trip's numbering. Two legs
  in different pools sharing a `seq` is normal and carries no meaning.
- A loose leg's `seq` is never changed afterwards: `reorderPlannedLegs` and
  `PATCH /api/trips/:id/planned-legs/order` stay trip-scoped (§4.5), and there
  is no loose equivalent in this run.
- Every read of legs still orders by `(seq, id)`, which stays total within a
  pool even with gaps or a shared `seq`.
- `.lnmpln` batch imports still assign `seq` in `chainOrderForBatch` order, not
  upload order, for a loose batch exactly as for a trip batch (§5.2) — the
  chain sort is over the files in the request and knows nothing about trips.

Where `seq` is displayed for a loose leg (e.g. the duplicate messages in §5.2
and §5.3, "as leg 2"), it means the loose pool's numbering. Acceptable: the
message names a leg the user can find in the same list.

### 8.3 Unified listing order

`GET /api/planned-legs` (§4.4, §5.1) orders by:

```sql
ORDER BY (l.trip_id IS NULL) DESC, l.trip_id ASC, l.seq ASC, l.id ASC
```

Read as three rules:

1. **Loose legs first**, as one block. `(trip_id IS NULL)` is 1 for a loose
   leg and 0 otherwise, and `DESC` puts the 1s first. Loose legs lead because
   they have no other page in the app; a trip's legs are already visible on
   the trip page.
2. **Then trip-linked legs, grouped by trip**, ascending `trip_id` — i.e.
   oldest trip first, since `trips.id` is AUTOINCREMENT.
3. **Within every block, `seq ASC, id ASC`** — byte-identical to the order
   `GET /api/trips/:id/planned-legs` returns, so a trip's legs read the same
   way on the Prefiles page as on its own page.

The key is total (`id` is unique), so the order is deterministic and two
implementations of it agree. Measured on the rebuilt copy: the loose leg came
first, then trip 1's legs in `seq` order.

### 8.4 What is *not* an algorithm change

`chainOrderForBatch`, `matchPlannedLeg`, `decideHandClose`, the arrival
deviation measurement and the interleaving rule in `PlannedLegRows.tsx` are
all untouched by this run. None of them reads `trip_id`.

---

## 9. Alternatives considered

### 9.1 Migration: rebuild vs. leave `NOT NULL` and use a sentinel trip

Rejected: a "no trip" sentinel row in `trips` would make `trip_id` non-null at
the cost of a fake trip appearing in `/api/trips`, in the sidebar, in every
picker and in `getPlannedLegCandidatesForActiveTrip` (where it could become
*active*). It trades a one-time 56 ms migration for a permanent lie in the
data model. The rebuild is the honest change and the frozen decision — "a
prefiled flight is considered loose when `trip_id` is null/absent" — names
NULL specifically.

### 9.2 Duplicate predicate: `IS ?` vs `(trip_id = ? OR (trip_id IS NULL AND ? IS NULL))`

Both are correct. `IS ?` wins on three counts: one parameter instead of two
(no chance of binding them inconsistently), an identical query plan to today's
`= ?` for the trip-linked case (§3.2), and it reads as the rule rather than as
a workaround. The `OR` form also risks a future editor "simplifying" it back
to `=`. Recorded because a Reviewer should know the alternative was considered
and is not wrong, merely worse.

### 9.3 Indexes: leave as-is vs. an expression index on `COALESCE(trip_id, -1)`

Rejected. NULL is a legal index key in SQLite and the measurements in §3.2
show both new predicates using an index search on the existing indexes. An
expression index would add a second structure to keep in step with the
migration for no measured gain, on a table with tens of rows.

### 9.4 Unified listing: `trip_name` on the response vs. a client-side join

Rejected the client-side join (`GET /api/trips` + `find`), which is what
`FlightDetail.tsx` does today. On a page whose entire purpose is a mixed list,
it means a second request, a second failure mode, and a rendering flash where
every leg briefly reads "No trip" before the trips arrive — indistinguishable
from a genuinely loose leg, which is precisely the distinction acceptance
criterion 5 is about. A `LEFT JOIN` costs one line of SQL and removes all
three. `trip_name` is confined to the new `PlannedLegListItem` (§4.4) so no
existing type gains a field.

### 9.5 Creation routes: two new paths vs. an optional `trip_id` on one route

Rejected making `POST /api/trips/:id/planned-legs` accept a nullable trip via
the body, and rejected a single `POST /api/planned-legs` with an optional
`trip_id` field that would eventually replace the trip-nested route. Both
would change a route the client already calls, against the non-negotiable that
trip-linked behaviour stays byte-identical. Two sibling routes keep the
existing path untouched, keep the "is there a trip?" decision in the URL where
Express can answer it without parsing a body, and let the loose routes drop
the trip 404 rather than make it conditional.

### 9.6 Loose-leg ordering: `seq` per loose pool vs. `seq = 0` / NULL for all loose legs

Rejected both. `seq NOT NULL` stays, so NULL is out; a constant 0 would make
`ORDER BY seq, id` degenerate to id order and would make the duplicate
messages ("as leg 0") meaningless. A per-pool sequence costs one word in one
SQL string (§4.2) and keeps every existing read working unchanged.

### 9.7 Reordering loose legs

Deliberately not designed. It is in none of the five acceptance criteria, it
needs a UI affordance the Prefiles page does not otherwise have, and
`reorderPlannedLegs`' "caller has already checked legIds is exactly this
trip's set" contract would have to grow a null-trip branch. §8.3's order is
total without it. If it is ever wanted, it is additive: a
`PATCH /api/planned-legs/order` and a `tripId: number | null` widening of
`reorderPlannedLegs`.

---

## 10. Type ownership

One owner per shared type, so parallel tasks do not collide in one file.

| type / function | file that owns it | phase |
|---|---|---|
| `planned_legs` DDL and the rebuild migration | `src/db/schema.ts` | 1 |
| `CreatePlannedLegInput`, `findPlannedLegBySource`, `createPlannedLeg`, `getAllPlannedLegs` | `src/db/plannedLegs.ts` | 1 |
| `PlannedLeg.trip_id`, `PlannedLegListItem` (new), `PlannedLegLiveStatus` | `src/types.ts` | 1 (row + list item), 2 (live status) |
| `GET /api/planned-legs`, `POST /api/planned-legs`, `POST /api/planned-legs/simbrief` | `src/routes/plannedLegs.ts` | 1 |
| `PlannedLegCache`, `buildPlannedLegCache`, `buildGroundSessionCache` | `src/flightManager.ts` | 2 |
| `PlannedLeg.trip_id`, `PlannedLegListItem`, `PlannedLegLiveStatus` (client mirror) | `client/src/types.ts` | 3 |
| the Prefiles page | `client/src/pages/Prefiles.tsx` (new) | 3 |
| route registration + sidebar entry | `client/src/App.tsx`, `client/src/components/Sidebar.tsx` | 3 |
| link guards | `client/src/pages/FlightDetail.tsx`, `client/src/pages/AcarsMessages.tsx` | 3 |
| picker switch to the unified listing | `client/src/pages/Home.tsx`, `client/src/pages/TripDetail.tsx` | 3 |

`src/types.ts` is touched in phase 1 and phase 2. Both edits are in different
interfaces; if the phases are ever run in parallel they are not.

---

## 11. Must-not-change list

The Reviewer checks these one by one. Each is existing behaviour this design
guarantees is untouched.

1. **The user's `flights.db` and the running server on port 3000 are not
   touched by any task in this run.** Verification uses copies and other
   ports.
2. **No row is lost by the migration.** After it, `planned_legs`,
   `planned_waypoints`, `planned_alternates`, `acars_messages`,
   `ground_sessions` and `flights` hold exactly the rows they held before, and
   every `planned_leg_id` / `trip_id` value is unchanged. §3.4 is the failure
   mode; §3.7 is how it is checked.
3. **`planned_legs.id` values are unchanged and no id is ever reused** —
   `sqlite_sequence` survives the rebuild (§3.5).
4. **No column is dropped, renamed or repurposed.** The rebuild reproduces all
   50 columns with their types, defaults and CHECKs; only `trip_id`'s
   `NOT NULL` is removed.
5. **`GET /api/trips/:id/planned-legs` returns exactly what it returns today**
   — same rows, same order, same 400/404, and never a loose leg.
6. **`POST /api/trips/:id/planned-legs` and
   `POST /api/trips/:id/planned-legs/simbrief` are unchanged**, including both
   trip 404s, the duplicate wording that says "into this trip", the
   `batch.ordering` omission when nothing imported, and the dispatch release.
7. **`PATCH /api/trips/:id/planned-legs/order` and `reorderPlannedLegs` stay
   trip-scoped**, with the same validation that `legIds` is exactly that
   trip's set.
8. **`seq` numbering for trip-linked legs is unchanged** — `IS ?` returns the
   same value `= ?` did for every non-null trip (§3.2, §4.2).
9. **Duplicate detection within a trip is unchanged**: the same file in the
   same trip is still a duplicate, in the same request and across requests,
   with the same in-batch behaviour.
10. **Auto-matching is unchanged.** `getPlannedLegCandidatesForActiveTrip`,
    `matchPlannedLeg`, its reason codes and `LegMatchCandidate.tripId: number`
    all stay exactly as they are (§6.4).
11. **ACARS and ground-session behaviour is unchanged** for trip-linked legs:
    no file listed in §6.5 is edited.
12. **`getTripName(tripId: number)` keeps its signature** and is never called
    with null.
13. **A trip-linked leg's live status is unchanged**: `tripId` and `tripName`
    carry the same values they do today; only the declared types widen.
14. **The trip page renders identically** for a trip with no loose legs
    anywhere in the database — `PlannedLegRows.tsx` is not edited, and
    `interleaveTripRows`' "a trip with zero planned legs is byte-identical to
    the flights-only mapping" property is preserved.
15. **`npm test` stays green**, including `tests/db/schema.test.ts`'s
    idempotency and table-list assertions and `tests/db/plannedLegs.test.ts`.
    The migration must not add a table to `sqlite_master` — `planned_legs_new`
    exists only inside the transaction and `tests/db/schema.test.ts` asserts
    the exact table list.

---

## 12. Risks

### 12.1 The migration is the run's one irreversible step

A bug in §3.3 runs once, at the user's next server start, against their real
logbook. Mitigations already in the design: the transaction (§3.3 step 3–11),
the `foreign_key_check` gate before commit (step 11), the pragma re-read
(step 2), and the fact that a failure aborts startup rather than half-applying.
What would falsify the design: any child-table count changing across the
migration on a copy of the live database. The implementer must re-run §3.7's
first two rows on a *fresh* copy after writing the real code, and report the
counts — not trust this document's numbers, which were produced by a prototype
of the same recipe rather than by the shipped code.

**The user should take `npm run backup` before the first start on the migrated
build.** Recommending it is the Orchestrator's call, not an agent's, but the
run report should say so.

### 12.2 The MCDU client is a separate repo and reads `/api/status`

`PlannedLegLiveStatus.tripName` widening from `string` to `string | null`
(§6.3) is a wire change. Nothing in `client/` reads that field —
`LivePanel.tsx` uses only `destinationIdent`, `nextWaypointIdent` and
`remainingDistanceNm` — but the Tauri/MCDU client at
`github.com/oshogun/msfslogger_mcdu` may. It only ever sees a null there when
the user flies a *loose* leg, which cannot happen until this run ships, so
there is no retroactive breakage; but that client should be told, with the
exact JSON (`contracts/samples.md`, the status sample), before a user flies
one. Same for `GroundSessionLiveStatus`, whose nulls become reachable with a
non-null `plannedLegId` for the first time.

### 12.3 Scope edges this design deliberately leaves open

- **Moving a loose leg into a trip (or out of one) after creation.** Not in
  the acceptance criteria, no endpoint, no UI. Additive later: a
  `PATCH /api/planned-legs/:legId { trip_id }` plus a `seq` re-assignment into
  the destination pool.
- **Reordering loose legs** — §9.7.
- **Filtering the Prefiles list** (by status, by trip, unflown-only). §5.1
  takes no query parameters; adding one later is additive.
- **Automatic creation of a trip from a loose prefile** — explicitly out of
  scope per the frozen decisions in `intake.md`.

### 12.4 Test coverage gap this run inherits

`tests/db/schema.test.ts` builds pre-migration tables by hand to exercise the
`ADD COLUMN` migrations. The rebuild deserves the same treatment: a
hand-built `planned_legs` with `trip_id INTEGER NOT NULL`, rows in it and in
two child tables, then `applySchema` twice, asserting `notnull` becomes 0, the
child rows survive, `sqlite_sequence` is preserved and the second call is a
no-op. Without it, §3.4's failure mode is caught only by a human reading the
diff. This is the highest-value test in the run and belongs to the phase-1
implementer.

### 12.5 Two copies of the import handler

§5.2 and §5.3 duplicate two long handlers minus a trip lookup. The duplication
is deliberate — factoring them would mean editing the trip-nested routes,
against must-not-change 6 — but it means a future fix to `.lnmpln` import has
two places to land. If the Reviewer sees the copies drift within this run,
that is a finding. Extracting a shared helper is a reasonable follow-up run
once both paths are known good.

---

## 13. Contract artifacts

| file | what it is |
|---|---|
| `contracts/planned_legs_nullable_trip.sql` | The frozen DDL: block (A) the canonical table for a fresh database, block (B) the one-time rebuild, statement by statement, with the measurements inline. §3. |
| `contracts/loose-planned-legs.d.ts` | Type stubs for every changed and new interface, each naming the file that owns it. Reference only — nothing imports or compiles it. §4, §6, §7.1. |
| `contracts/samples.md` | Request/response samples for the three new endpoints and for `/api/status` with a loose leg. §5. |
