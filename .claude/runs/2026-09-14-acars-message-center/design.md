# Design freeze — ACARS Message Center

Run `2026-09-14-acars-message-center`. Task `T-001`.

This document is the contract for every implementation task in this run. It is
written to be read in slices: pull a section with

    .claude/tools/ctx.sh design 2026-09-14-acars-message-center 4 6.2

Section numbers are stable and are cited by task envelopes. Never renumber or
rename a heading; amend in place and record it in the table below.

**The numbering is internal to this document.** No `§` reference, run id, task
id, `design.md`, `plan.json` or review-file name may appear in a comment in
`src/`, `client/src/` or `tests/`. Where a decision below deserves a comment in
the code, the comment states the reasoning itself, not where it came from.

## Amendments

| # | Date | Section | What changed | Evidence that forced it |
|---|------|---------|--------------|-------------------------|
| — | —    | —       | None yet.    | —                       |

## 1. Scope, the scoping key, and the pre-flight message

### 1.1 What is frozen here

One new table (`acars_messages`, §2), one db domain module
(`src/db/acarsMessages.ts`, §4), one pure module (`src/acars.ts`, §6), three
HTTP routes (§5) and one client page (§7). Nothing in `src/flightManager.ts`,
`src/ingest.ts` or `src/simbriefClient.ts` is wired to any of it this run — the
sibling stories do that later, and §3 is the proof they can.

### 1.2 The scoping key: `flights.id`, with `planned_legs.id` as a second, optional scope

`flights.id` remains the scoping key, per the run's frozen decision. It is not
replaced. A second, nullable reference to `planned_legs(id)` ships alongside it
**in this run**, and `flight_id` is **nullable**:

```
flight_id      INTEGER REFERENCES flights(id)       ON DELETE CASCADE   -- nullable
planned_leg_id INTEGER REFERENCES planned_legs(id)  ON DELETE CASCADE   -- nullable
```

The evidence that forces this, rather than `flight_id INTEGER NOT NULL`:

- `src/db/schema.ts:12-31` — `flights.start_time` is `NOT NULL`. A `flights` row
  cannot be created as a placeholder for a flight that has not started.
- `src/flightManager.ts:236-261` — `startFlight()` calls `insertFlight(...)` with
  a `new Date().toISOString()` start time and only then sets
  `appState.currentFlightId`. There is no earlier moment at which a `flights` row
  exists. Before that call, `appState.currentFlightId` is `null`
  (`src/flightManager.ts:305-309` sets it back to `null` at `endFlight`).
- `user_stories/acars_pdc_request.md` — the whole story is *before pushback*, and
  is expressed against "an active/selected **planned leg**" with a filed route.
  Its AC4 requires the clearance to be retrievable later without re-requesting.
- `user_stories/acars_dispatch_loadsheet.md` AC1 — "Every successful SimBrief
  import produces exactly one dispatch-release message in the corresponding
  **leg's** thread". A SimBrief import happens on a planned leg, with no flight
  in existence.

With `foreign_keys = ON` (`src/db/connection.ts:18`), a `NOT NULL` `flight_id`
would make those two stories physically unable to write a row at the moment they
need to, and adding the column later is exactly the migration AC4 forbids. So
the column ships now.

### 1.3 A row must have at least one scope, and that is enforced above SQL

A row with both `flight_id` and `planned_leg_id` `NULL` is unreachable by every
read in §4 and is refused by `insertAcarsMessage()` (§4.2), which throws before
touching the database.

It is **not** expressed as a table `CHECK (flight_id IS NOT NULL OR
planned_leg_id IS NOT NULL)`. That constraint would be re-evaluated by the
`ON DELETE SET NULL` of a future FK action and could abort an unrelated
`DELETE`; more concretely, it permanently forecloses a message with neither
scope (a system-wide dispatch broadcast, say) without a table rewrite. The
invariant is worth having and is not worth buying at that price.

### 1.4 Posting when `flightManager.appState.currentFlightId` is null

Nothing breaks, because the flight id is a path parameter, not a session fact.
`POST /api/flights/:id/acars-messages` (§5.3) is scoped by `:id`; it never reads
`flightManager`. The page is reached from a flight's detail page, so a flight
row always exists by construction. Consequences, frozen:

- The ACARS routes take **no** `flightManager` parameter — unlike
  `createFlightsRouter` (`src/routes/flights.ts:19`), which needs it. There is
  nothing for them to ask it.
- Posting to a *past* flight is allowed. Restricting writes to
  `currentFlightId` would make AC3 unverifiable without a running sim, and a
  message on a finished flight is harmless.
- The client never sets `planned_leg_id`, and the server never derives it from
  the flight's link on insert. A client-posted message is flight-scoped, full
  stop. Copying `flights.planned_leg_id` onto the row at insert time would leave
  a stale leg reference behind if the flight were later unlinked — and would put
  those rows in the blast radius of a leg deletion (§1.6).
- A future MCDU or server-side writer that genuinely has no flight (PDC,
  dispatch release) writes a leg-scoped row via
  `insertAcarsMessage({ planned_leg_id, ... })`. That path exists in §4 this run
  and is exercised by §3's samples, though no route reaches it yet.

### 1.5 Thread resolution: a flight's thread includes its leg's pre-flight messages

The rule every read obeys, frozen here and implemented once in §4.3:

> The thread of flight *F* is every row with `flight_id = F.id`, **union** every
> row with `planned_leg_id = F.planned_leg_id` when `F.planned_leg_id` is not
> null.

This is what makes §1.2 pay off: a clearance issued against leg 29 before
departure appears in the thread of the flight that later links to leg 29, with
no row rewrite and no backfill. `idx_flights_planned_leg`
(`src/db/schema.ts:295`) is a partial UNIQUE index on
`flights(planned_leg_id)`, so at most one flight can ever claim a leg and the
resolution is unambiguous.

A flight with `planned_leg_id IS NULL` picks up nothing: `planned_leg_id =
(SELECT planned_leg_id FROM flights WHERE id = ?)` evaluates to `NULL`, which is
not true, so no leg rows match. Verified — see §2.7.

### 1.6 ON DELETE behaviour

| FK | Action | Why |
|---|---|---|
| `flight_id → flights(id)` | `ON DELETE CASCADE` | Identical to `flight_points` (`src/db/schema.ts:35`). `deleteFlight()` (`src/db/flights.ts`) issues a plain `DELETE FROM flights`; the thread goes with the flight, needing no change to that function — which is important, because `src/db/flights.ts` is outside T-002's allowed paths. |
| `planned_leg_id → planned_legs(id)` | `ON DELETE CASCADE` | Identical to `planned_waypoints`/`planned_alternates` (`src/db/schema.ts:164,186`). `deletePlannedLeg()` already documents its children as cascading; a leg's clearance and dispatch release are children of the plan they describe. |
| `correlation_id → acars_messages(id)` | `ON DELETE SET NULL` | The reply is not a child of the request. Deleting a request must not silently delete the answer the user already read. |

Two consequences a Reviewer should check are *accepted*, not overlooked:

1. **`combineFlights()` loses both source threads.** It deletes both source
   `flights` rows (`src/db/flights.ts:268-269`), which now cascades their
   messages away, while their points are copied to the new flight. This matches
   what combine already does to the planned-leg link (deliberately dropped,
   `src/db/flights.ts:259-266`), and `src/db/flights.ts` is not in scope this
   run. Recorded as a risk in §8.5; the fix, if the user ever wants one, is to
   re-point `flight_id` inside that transaction.
2. **Deleting a planned leg removes the leg-scoped messages from a linked
   flight's thread.** A PDC describing a route that no longer exists goes with
   the route. The alternative, `ON DELETE SET NULL`, would leave a row with no
   scope at all — unreachable by §1.5 and invisible forever, which is worse than
   deleted.

### 1.7 Alternatives considered

| Option | Why not |
|---|---|
| `flight_id INTEGER NOT NULL`, no leg column | Refused. PDC and dispatch-release are pre-pushback and leg-scoped by their own acceptance criteria; adding the column later is the migration AC4 forbids. |
| Replace `flights.id` with `planned_legs.id` as the scoping key | Not permitted — frozen by intake — and wrong anyway: a flight can be flown with no planned leg at all, and most of the user's 54 flights are. |
| One polymorphic pair (`scope_type TEXT`, `scope_id INTEGER`) | Refused. It cannot carry a foreign key, so the database stops protecting against a dangling id, and every read gains a string comparison. Two nullable typed columns cost one extra column and keep both FKs real. |
| Create a placeholder `flights` row at plan-import time so `flight_id` can be `NOT NULL` | Refused: it would put rows with a synthetic `start_time` into the user's logbook, which every existing list, stat and export reads. Far more invasive than a nullable column. |

## 2. Persistence: the `acars_messages` table

### 2.1 The DDL, verbatim

Also in `contracts/acars_messages.sql`. Paste it into the existing
`db.exec(...)` template literal in `applySchema()`, indented to match its
neighbours (4 spaces for `CREATE`, 6 for columns).

```sql
    -- Datalink-style messages for one flight, or for the planned leg a flight
    -- has not been created for yet (a PDC or a dispatch release arrives before
    -- pushback, when no flights row exists). Exactly one of flight_id and
    -- planned_leg_id is normally set; both may be set by a writer that knows
    -- both. A row with neither is unreachable and is refused above the
    -- database, in src/db/acarsMessages.ts.
    CREATE TABLE IF NOT EXISTS acars_messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Nullable on purpose: startFlight() does not insert a flights row until
      -- the flight begins, and pre-pushback messages have to land somewhere.
      -- CASCADE matches flight_points: deleting a flight deletes its thread.
      flight_id      INTEGER REFERENCES flights(id) ON DELETE CASCADE,
      -- The pre-flight scope. A thread read for a flight also returns the rows
      -- carrying that flight's planned_leg_id, so a clearance issued before
      -- departure shows up in the flight's thread once the link exists.
      planned_leg_id INTEGER REFERENCES planned_legs(id) ON DELETE CASCADE,
      -- 'uplink' (from dispatch to the aircraft) | 'downlink' (from the
      -- cockpit). No CHECK: validated in src/acars.ts, so a future direction
      -- needs no migration.
      direction      TEXT    NOT NULL,
      -- 'pdc' | 'wx' | 'freetext' | 'position-report' | 'dispatch' | 'oooi' |
      -- whatever a later story needs. Deliberately NOT a CHECK constraint: the
      -- position-report feature already needs 'oooi', which the five categories
      -- this table was first specified with do not include, and a CHECK cannot
      -- be widened without rewriting the table.
      category       TEXT    NOT NULL,
      -- Short display heading, e.g. 'PDC', 'METAR EGLL', 'OUT'. NULL renders as
      -- the category.
      label          TEXT,
      -- The message as the crew reads it. Newlines are significant and are
      -- never collapsed on the way in.
      body           TEXT    NOT NULL,
      -- Optional machine-readable twin of body: the loadsheet's fixed fields, a
      -- position report's lat/lon/alt. Opaque JSON text, owned entirely by the
      -- writing feature; no column of this table is derived from it.
      payload_json   TEXT,
      -- The request this row replies to (weather and loadsheet are both
      -- request/reply). SET NULL, not CASCADE: deleting a request must not
      -- silently delete the answer the user already read.
      correlation_id INTEGER REFERENCES acars_messages(id) ON DELETE SET NULL,
      -- Idempotency for writers that must not issue twice: 'pdc:leg:29',
      -- 'oooi:81:OUT', 'dispatch:ofp:<request_id>'. Free-form and owned by the
      -- writer; NULL for everything that may legitimately repeat.
      dedup_key      TEXT,
      -- ISO 8601 UTC instant, real wall-clock, as new Date().toISOString() —
      -- the same clock and format as flights.start_time and flight_points.ts.
      -- There is no sim clock to record: SimFrame carries no sim time.
      sent_at        TEXT    NOT NULL,
      -- NULL means unread. Nothing writes it yet; the column exists so an
      -- unread affordance does not need a migration.
      read_at        TEXT
    );

    -- Covers both halves of the thread read, including its ORDER BY.
    CREATE INDEX IF NOT EXISTS idx_acars_messages_flight ON acars_messages(flight_id, sent_at, id);
    CREATE INDEX IF NOT EXISTS idx_acars_messages_leg    ON acars_messages(planned_leg_id, sent_at, id);
    -- Partial, in the same spirit as idx_flights_planned_leg: it turns "a PDC is
    -- issued once per leg" into a database guarantee while leaving every
    -- ordinary message (dedup_key IS NULL) free to repeat.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_acars_messages_dedup
      ON acars_messages(dedup_key) WHERE dedup_key IS NOT NULL;
```

### 2.2 Where it goes in `applySchema`

Inside the single `db.exec(...)` block, **after** the four `CREATE INDEX IF NOT
EXISTS idx_planned_*` statements (`src/db/schema.ts:197-200`) and **before** the
`-- The single operator account.` comment introducing `auth_user`
(`src/db/schema.ts:202`).

Both parents (`flights`, `planned_legs`) are created above that point, so the
block reads parents-then-children throughout, matching the warning at
`src/db/schema.ts:56-58`. Two honest notes for whoever checks this:

- For `CREATE TABLE`, SQLite does **not** require the parent to exist — verified:
  creating a child with `REFERENCES planned_legs(id)` before `planned_legs`
  exists is accepted, and a later insert with a bad parent id still fails with
  `SQLITE_CONSTRAINT_FOREIGNKEY`. The `:56-58` warning is about `ALTER TABLE ...
  ADD COLUMN ... REFERENCES` in the migration tail, which is stricter. Position
  is therefore a readability rule here, not a correctness one — but it is still
  frozen, so the block has one order and not two.
- The last three tables (`auth_user`, `app_secret`, `app_setting`) have no
  foreign keys at all and read as a self-contained tail. Inserting before them
  keeps that tail contiguous.

Nothing is added to the column-migration tail (`src/db/schema.ts:248-297`). A
brand-new table needs no `ALTER TABLE`: `CREATE TABLE IF NOT EXISTS` is already
the migration, and it is idempotent by construction. See §8.4.

### 2.3 `direction` and `category`: TEXT, validated in `src/acars.ts`, no CHECK

Frozen: **no `CHECK` constraint on either column.**

`user_stories/acars_position_reports.md` says, in its own functional
requirements, "Reports write into the shared ACARS message table as downlink,
category `position-report` / `oooi`". `oooi` is not among the five categories
this table was specified with (`pdc`, `wx`, `freetext`, `position-report`,
`dispatch`). A `CHECK (category IN (...))` written from that list of five would
fail AC4 on the very next story, and SQLite cannot widen a `CHECK` without a
12-step table rewrite under live rows — the one thing this run must not make
necessary.

So the enumeration lives in `src/acars.ts` (§6), where widening it is a
one-line, reviewable, zero-migration change. And the validator there checks the
category's **shape**, not its membership (`/^[a-z][a-z0-9-]{0,31}$/`), so adding
`oooi` or `atis` needs no change to the validator either — only the display
list in §6.3 and the badge map in §7.3 enumerate categories, and both degrade
gracefully on an unknown one.

`direction` gets the same treatment for consistency of the table, but the
vocabulary itself **is** closed at the application layer: `'uplink' |
'downlink'`, checked by membership in §6.4. No sibling story asks for a third.

### 2.4 Columns that ship now, and why each is cheap now and expensive later

Every one of these is unusable-later-without-a-migration, which is the test AC4
sets. Each is nullable, so no existing writer and no sample row is obliged to
fill it.

| Column | Ships | One-sentence reason |
|---|---|---|
| `correlation_id` | **Yes** | `acars_weather_request.md` ("an uplink request entry and, on success, a downlink reply entry") and `acars_dispatch_loadsheet.md` ("request/reply pair like the weather story") are both request→reply, and pairing them by timestamp proximity is a guess where a column is a fact. |
| `dedup_key` | **Yes** | `acars_pdc_request.md` AC2 requires that requesting twice for the same leg returns an identical clearance, and `acars_position_reports.md` AC1 requires exactly one message per OOOI transition; the partial UNIQUE index makes both a database guarantee instead of a promise about application control flow. |
| `payload_json` | **Yes** | The loadsheet's fixed fields and a position report's lat/lon/alt/ETA are structured data that a client should not have to re-parse out of formatted text, and one opaque TEXT column absorbs every future story's structure without a column per field. |
| `read_at` | **Yes** | The message-center story's own functional requirements ask for an unread affordance, and the MCDU client in the other repo can only get read-state from the server; nothing writes it this run, but a `NULL`-means-unread column costs nothing and cannot be added later without the migration AC4 forbids. |
| `label` | **Yes** | Every sibling story's messages have a heading distinct from both the category and the body ("METAR EGLL", "OUT", "LOADSHEET"), and deriving one from the body is string-guessing. |

### 2.5 `sent_at`: type, meaning, and the tiebreak

- **Type** `TEXT NOT NULL`, an ISO 8601 UTC instant produced by
  `new Date().toISOString()` — byte-identical in form to `flights.start_time`
  and `flight_points.ts`. Stored as text so it sorts lexicographically in the
  same order it sorts chronologically, which is what `ORDER BY sent_at` relies
  on.
- **Meaning: real wall-clock time, never sim time.** There is no sim clock to
  record: `SimFrame` (`src/types.ts:1-12`) carries `lat`, `lon`, `altitudeFt`,
  `airspeedKnots`, `groundSpeedKnots`, `headingDeg`, `verticalSpeedFpm`,
  `onGround`, `simRunning` and `aircraft`, and nothing else. The
  position-report story timestamps OOOI events "to the existing
  state-transition event", and `src/flightManager.ts:237,272` stamps those with
  `new Date().toISOString()`. A `sim_time` column would have nothing to put in
  it and is refused (§2.6).
- **Tiebreak: `id` ASC.** Two rows can share a `sent_at` — a request and its
  synthesised reply generated in the same millisecond, or any two messages
  filed in one tick. Every read orders by `(sent_at, id)`. `id` is
  `INTEGER PRIMARY KEY AUTOINCREMENT`, so it is monotonic for the life of the
  database and never reused, making the order total and stable across restarts.
  This is the same "order by (seq, id) so the order stays total" reasoning as
  `planned_legs.seq` (`src/db/schema.ts:62-65`).

### 2.6 Columns deliberately refused

| Refused | Reason |
|---|---|
| `sim_time` | Nothing produces one: `SimFrame` has no sim clock (§2.5). A column no writer can fill is not genericity, it is clutter — and `payload_json` can carry one the day the agent starts sending it. |
| `source` / `written_by` (`'client' \| 'server' \| 'agent'`) | `direction` plus `category` already say who spoke and about what; no sibling story asks who the process was, and `payload_json` absorbs it if one ever does. |
| `thread_id` / an `acars_threads` table | The thread is derived (§1.5), not stored. A stored thread id would need backfilling the moment a flight links to a leg — which is precisely the case §1.5 handles for free. |
| `status` (`sent`/`delivered`/`failed`) | There is no transport to fail: a message is written or the insert throws. A simulated delivery state would be fiction with a column behind it. |
| A `CHECK` on `direction` or `category` | §2.3. |

### 2.7 Migration safety, and the evidence

The table is created by `CREATE TABLE IF NOT EXISTS` inside the existing single
`db.exec` block. Nothing is dropped, nothing is repurposed, no existing column
changes type or nullability, and the column-migration tail
(`src/db/schema.ts:248-297`) is untouched. On the user's live database the whole
change is: three objects appear, zero rows move.

Prototyped against a **copy** of the user's real `flights.db` (plus its `-wal`
and `-shm`), Node 20.20.2, better-sqlite3, SQLite 3.45.3 —
`.claude/runs/2026-09-14-acars-message-center/prototypes/acars-ddl-proto.js`:

```
counts before        : {"flights":54,"trips":1,"planned_legs":20,"flight_points":52746}
counts after         : {"flights":54,"trips":1,"planned_legs":20,"flight_points":52746}
table_info stable    : true      (PRAGMA table_info identical after applying the block twice)
indexes              : idx_acars_messages_dedup(partial=1) | idx_acars_messages_leg(partial=0) | idx_acars_messages_flight(partial=0)
sample flight        : {"id":81,"planned_leg_id":29}
dedup                : SQLITE_CONSTRAINT_UNIQUE — UNIQUE constraint failed: acars_messages.dedup_key
thread (asc, id tiebreak):
     2026-09-14T09:00:00.000Z   1 uplink   pdc             flight=null leg=29
     2026-09-14T09:05:00.000Z   2 uplink   dispatch        flight=null leg=29
     2026-09-14T10:00:00.000Z   3 downlink wx              flight=81   leg=null
     2026-09-14T10:00:04.000Z   4 uplink   wx              flight=81   leg=null
     2026-09-14T10:05:00.000Z   5 downlink oooi            flight=81   leg=null
     2026-09-14T10:42:00.000Z   6 downlink position-report flight=81   leg=null
     2026-09-14T10:42:00.000Z   7 downlink freetext        flight=81   leg=null
unlinked flight 74 sees  : 0 (must be 0)
correlation SET NULL : null
leg-scoped after leg delete : 0
flight-scoped after flight delete : 0
orphans (both null)  : 0
```

The live `flights.db` md5 was `f6f9b399e241585c18f1a488f0976d29` before and
after the prototype run.

### 2.8 Alternatives considered

| Option | Why not |
|---|---|
| `CHECK (category IN ('pdc','wx','freetext','position-report','dispatch'))` | §2.3: it breaks on the next story's `oooi` and cannot be widened without a table rewrite. |
| Add the table via the `ALTER TABLE` migration tail | Meaningless for a new table and it would grow the tail the run is required to leave alone. |
| `sent_at` as INTEGER epoch ms | Would be the only time column in the schema not shaped like `flights.start_time`; every formatter, export and comparison in the codebase already speaks ISO text. |
| Separate `acars_uplink` / `acars_downlink` tables | Doubles every read, and the thread is the product. |
| Store `payload` as a real JSON type with generated columns | SQLite would allow it, but each generated column is a schema commitment to a specific story's field names — the opposite of AC4. |

## 3. Genericity proof: the four sibling stories against the frozen columns

Read with §2.1 (the columns) and `contracts/samples/` (the insertable rows).
Nothing below needs a column §2 does not already have. A story that did not fit
would be a defect in §2 to be fixed there, not a footnote here.

### 3.1 The mapping

`{leg}` is the planned leg's id, `{flight}` the flight's id. Every unlisted
column is `NULL`.

| Story | Message | `flight_id` | `planned_leg_id` | `direction` | `category` | `label` | `body` | `payload_json` | `correlation_id` | `dedup_key` |
|---|---|---|---|---|---|---|---|---|---|---|
| `acars_pdc_request` | crew sends REQUEST CLEARANCE | `NULL` | `{leg}` | `downlink` | `pdc` | `REQUEST CLEARANCE` | `"REQUEST CLEARANCE"` | `NULL` | `NULL` | `NULL` |
| `acars_pdc_request` | the clearance (AC1, AC2, AC4) | `NULL` | `{leg}` | `uplink` | `pdc` | `PDC` | clearance text, newline-separated | `{"departure","destination","route","initial_alt_ft","squawk"}` | request id | `pdc:leg:{leg}` |
| `acars_pdc_request` | AC3 rejection, no filed route | `NULL` | `{leg}` | `uplink` | `pdc` | `UNABLE` | `"NO FLIGHT PLAN ON FILE"` | `NULL` | request id | `NULL` |
| `acars_weather_request` | WX REQUEST `<ICAO>` | `{flight}` | `NULL` | `downlink` | `wx` | `WX REQUEST EGLL` | `"WX REQUEST EGLL"` | `{"icao"}` | `NULL` | `NULL` |
| `acars_weather_request` | METAR/TAF reply (AC1) | `{flight}` | `NULL` | `uplink` | `wx` | `METAR EGLL` | METAR + TAF text | `{"icao","metar","taf","fetched_at"}` | request id | `NULL` |
| `acars_weather_request` | unavailable (AC2) | `{flight}` | `NULL` | `uplink` | `wx` | `WX UNAVAILABLE` | `"WX DATA UNAVAILABLE FOR ZZZZ"` | `{"icao","reason"}` | request id | `NULL` |
| `acars_position_reports` | OOOI event (AC1) | `{flight}` | `NULL` | `downlink` | `oooi` | `OUT` / `OFF` / `ON` / `IN` | `"OUT 1005Z EHAM"` | `{"event","ts","icao"}` | `NULL` | `oooi:{flight}:OUT` |
| `acars_position_reports` | enroute position (AC2) | `{flight}` | `NULL` | `downlink` | `position-report` | `POS` | position/alt/ETA text | `{"lat","lon","alt_ft","next_fix","next_fix_eta","dest_eta"}` | `NULL` | `NULL` |
| `acars_dispatch_loadsheet` | dispatch release on import (AC1) | `NULL` | `{leg}` | `uplink` | `dispatch` | `DISPATCH RELEASE` | route/cruise/fuel/altn/ETE text | `{"route","cruise_alt_ft","plan_fuel_kg","alternates","ete_min"}` | `NULL` | `dispatch:ofp:<request_id>` |
| `acars_dispatch_loadsheet` | REQUEST LOADSHEET | `NULL` | `{leg}` | `downlink` | `dispatch` | `REQUEST LOADSHEET` | `"REQUEST LOADSHEET"` | `NULL` | `NULL` | `NULL` |
| `acars_dispatch_loadsheet` | the loadsheet (AC2) | `NULL` | `{leg}` | `uplink` | `dispatch` | `LOADSHEET` | fixed-field text | `{"block_fuel_kg","payload_kg","zfw_kg","estimated"}` | request id | `NULL` |
| `acars_dispatch_loadsheet` | AC3 rejection | `NULL` | `{leg}` | `uplink` | `dispatch` | `UNABLE` | `"NO DISPATCH DATA ON FILE"` | `NULL` | request id | `NULL` |
| `acars_message_center` (this run) | canned send | `{flight}` | `NULL` | `downlink` | `freetext` | the canned label | the canned body | `NULL` | `NULL` | `NULL` |

Four claims this table makes good on, each checkable:

1. **`oooi` needs no schema change** — it is a value in a `TEXT` column with no
   `CHECK` (§2.3).
2. **Both request/reply stories pair up** — `correlation_id` (§2.4).
3. **Both "issue exactly once" requirements are enforced by the database** —
   `dedup_key` plus its partial UNIQUE index (§2.4, §4.4).
4. **Both pre-pushback stories can write before a flight exists** — leg scope
   (§1.2), and their rows surface in the flight's thread by §1.5.

### 3.2 One conflict, resolved: the weather story's use of "uplink"

`acars_weather_request.md` says the request is written as "an uplink request
entry" and the reply as "a downlink reply entry". That is the reverse of the
substrate's definition, which this design owns:
`acars_message_center.md` fixes `direction` as "uplink from *dispatch*,
downlink from *cockpit*", and real ACARS agrees — a downlink travels aircraft →
ground.

Frozen: **the substrate's definition wins**, and the weather story's prose is
read as loose wording, not as a contract. A crew-initiated request is
`downlink`; the answer from the ground is `uplink`. §3.1 and the sample rows use
that reading consistently, and `acars_dispatch_loadsheet.md` (which calls its
own request "uplink placeholder") is read the same way. When the weather story
is implemented, its envelope should carry this sentence, because the story file
will still read the other way.

### 3.3 The sample rows, and the two placeholder rules

`contracts/samples/01..11-*.json`, one file per row of §3.1 that produces a
distinct shape. Each file is:

```json
{ "story": "...", "note": "...", "scope": "flight" | "leg", "message": { /* CreateAcarsMessage */ } }
```

T-002 inserts `message` **verbatim** through `insertAcarsMessage()` (§4.2) after
exactly two substitutions:

1. **Scope id.** `"{flight_id}"` becomes the scratch flight's id; `"{planned_leg_id}"`
   becomes that same flight's `planned_leg_id`. They appear only in the
   `flight_id`/`planned_leg_id` fields and inside `dedup_key`.
2. **Correlation.** `"correlation_id": "{id:06-wx-request}"` becomes the `id`
   returned by the insert of the sample with that filename.

No other edit is permitted. A sample that will not insert without a new column
is a failure of AC4 and a defect in §2 — it is never a reason to add a column
during implementation; it is a reason to stop and amend this document.

## 4. The db module: `src/db/acarsMessages.ts`

### 4.1 Shape and house style

Modelled on `src/db/settings.ts` and `src/db/flights.ts:30-88`:

- `import { getDb } from './connection';` — `getDb()` is called **inside** every
  function, never cached at module level and never held in a module-level
  prepared statement. The handle only exists after `initDb()`.
- Types come from `../types` (`import type { AcarsMessage, CreateAcarsMessage } from '../types';`).
  The module declares no type of its own. See `contracts/types.acars.ts` for
  the exact declarations and who owns which file.
- No cross-domain module import. This module needs `flights.planned_leg_id`, and
  it reads that column **in its own SQL** rather than calling
  `getFlightById()` — a single SELECT is cheaper than a cross-import and avoids
  the barrel dance at `src/db/flights.ts:3-6`.
- Added to the barrel `src/db.ts` as one line: `export * from './db/acarsMessages';`,
  after the `./db/settings` line. Nothing else in `src/db.ts` changes.
- A module header comment in the style of `src/db/settings.ts:3-6`, stating what
  the table is and that a row is scoped by a flight, a planned leg, or both.

### 4.2 Exported functions, frozen

```ts
/**
 * Inserts one message and returns the stored row.
 *
 * Defaults: sent_at = now (ISO), and every optional column NULL. Throws when
 * neither flight_id nor planned_leg_id is given — such a row is unreachable by
 * every read below.
 *
 * General on purpose: the route layer is only one caller. A server-side writer
 * (an OOOI emitter driven by the flight state machine) calls exactly this,
 * with a planned_leg_id, a payload_json and a dedup_key the route never sets.
 */
export function insertAcarsMessage(msg: CreateAcarsMessage): AcarsMessage;

/**
 * Insert-or-return-existing, keyed on dedup_key (which is required here).
 * Returns { message, created }: created=false means a row with that key was
 * already stored and nothing was written. This is how a re-requested clearance
 * returns the identical clearance, and how an OOOI transition stays exactly
 * once.
 */
export function insertAcarsMessageOnce(
  msg: CreateAcarsMessage & { dedup_key: string }
): { message: AcarsMessage; created: boolean };

/** One row by id, or null. */
export function getAcarsMessageById(id: number): AcarsMessage | null;

/** One row by dedup_key, or null. Null/empty key returns null without a query. */
export function findAcarsMessageByDedupKey(dedupKey: string): AcarsMessage | null;

/**
 * The flight's thread: its own rows, plus the rows of the planned leg it is
 * linked to. Oldest first, (sent_at, id). Returns [] for a flight that does not
 * exist — existence is the route's 404 to decide, not this function's.
 */
export function listAcarsMessagesForFlight(flightId: number): AcarsMessage[];

/**
 * Leg-scoped rows only, oldest first. For a pre-flight reader (a PDC page with
 * no flight yet). No caller this run; the sibling stories are the callers.
 */
export function listAcarsMessagesForPlannedLeg(plannedLegId: number): AcarsMessage[];

/** The flight's planned_leg_id, or null (also null when the flight does not exist). */
export function getFlightPlannedLegId(flightId: number): number | null;
```

`SELECT *` is never used: every read lists the twelve columns in DDL order, so
a future column cannot silently change a response shape.

### 4.3 The thread query, its order, and paging

```sql
SELECT id, flight_id, planned_leg_id, direction, category, label, body,
       payload_json, correlation_id, dedup_key, sent_at, read_at
  FROM acars_messages
 WHERE flight_id = ?
    OR planned_leg_id = (SELECT planned_leg_id FROM flights WHERE id = ?)
 ORDER BY sent_at ASC, id ASC
```

- Both `?` take the same flight id. The subquery yields `NULL` for an unlinked
  flight, and `planned_leg_id = NULL` is never true, so an unlinked flight sees
  only its own rows (§1.5, verified in §2.7 — "unlinked flight 74 sees: 0").
- **Sort order: ascending, `(sent_at, id)`.** `sent_at` is ISO text, so
  lexicographic order is chronological order (§2.5). Ascending is the canonical
  order for this table; "newest first" is a rendering decision made once, in the
  client (§5.6, §7.4).
- **Unbounded, no paging, this run.** The user's largest flight holds ~5 k track
  points; message volume is two orders of magnitude below that, and the
  position-report story is explicitly required to keep its cadence bounded. The
  API response is an object envelope rather than a bare array (§5.2) precisely
  so a `before_id`/`limit` cursor can be added later without changing the
  response type. No `LIMIT` is written now, because a silently truncated thread
  is worse than a slow one, and a cap that nothing reports hitting is a bug
  generator.

### 4.4 `insertAcarsMessageOnce`, exactly

```sql
INSERT INTO acars_messages (...)
VALUES (...)
ON CONFLICT(dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
```

then `findAcarsMessageByDedupKey(dedup_key)` for the row, both inside one
`getDb().transaction(...)`, in the idiom of `getOrCreateAppSecret`
(`src/db/settings.ts:51-60`). `created` is `changes === 1`.

The `WHERE dedup_key IS NOT NULL` in the conflict target is **not optional**:
the unique index is partial, and SQLite requires the target's `WHERE` to match
the index's, or it raises "ON CONFLICT clause does not match any PRIMARY KEY or
UNIQUE constraint". Verified under SQLite 3.45.3: with the clause, a second
insert of the same key writes nothing, leaves the first row's body unchanged and
leaves two `dedup_key IS NULL` rows perfectly legal.

`insertAcarsMessage` (the plain one) uses `.run(...)` and
`getAcarsMessageById(result.lastInsertRowid as number)` inside one transaction —
the `lastInsertRowid` idiom of `insertFlight` (`src/db/flights.ts:32-38`), not
`RETURNING`. `RETURNING` works on this SQLite build, but nothing else in the
codebase uses it and the two-statement form reads the same everywhere.

### 4.5 Deliberately not shipped this run

No `markAcarsMessageRead()`, no unread count, no `deleteAcarsMessage()`, no
update of any kind. A message is immutable once filed, and a function — unlike a
column — can be added the day it has a caller without any migration. The
`read_at` column exists (§2.4); nothing writes it.

### 4.6 Alternatives considered

| Option | Why not |
|---|---|
| Resolve the leg in TypeScript with two queries | One round trip becomes two and the pair is not atomic; the correlated subquery is the same cost in SQLite. |
| `UNION ALL` of two selects instead of `OR` | Identical result, and it needs its own outer `ORDER BY`; the `OR` form lets each index serve its half. |
| Positional arguments (`insertAcarsMessage(flightId, direction, category, ...)`) like `insertFlight` | Ten mostly-nullable parameters is a call site nobody can read; the object form also lets the samples in `contracts/samples/` be inserted verbatim. |
| `insertAcarsMessage` throwing on a duplicate `dedup_key` and letting callers catch | Makes every idempotent writer catch a driver-specific error code; `insertAcarsMessageOnce` states the intent in its name and returns `created` so the caller can still tell. |

## 5. API surface

### 5.1 Routes and mounting

New file `src/routes/acars.ts`, exporting `createAcarsRouter(): Router` in the
factory style of `src/routes/settings.ts` — **no parameter**: these routes never
consult `flightManager` (§1.4).

Mounted in `src/server.ts` as `app.use('/api', createAcarsRouter());`,
immediately after `app.use('/api', createExportsRouter());`
(`src/server.ts:149`) and before the SPA catch-all `app.get('*', ...)`
(`src/server.ts:152`), under its own `// ── ACARS ──` banner comment in the
style of its neighbours. It therefore sits behind `requireSameOrigin`
(`src/server.ts:72`) and `app.use('/api', requireAuth)` (`src/server.ts:79`) with
no per-route decoration, and no existing mount moves.

`/api/flights/:id/acars-messages` cannot be captured by any route already
registered: `createFlightsRouter`'s `/flights/:id` handlers match a two-segment
path, this is three.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/flights/:id/acars-messages` | The flight's thread (§5.2) |
| `POST` | `/api/flights/:id/acars-messages` | Send one canned message (§5.3) |
| `GET` | `/api/acars/canned-messages` | The canned set (§5.5) |

### 5.2 `GET /api/flights/:id/acars-messages`

No query parameters are read; any sent are ignored.

**200** — `AcarsThread` (`contracts/api/GET-thread.200.json`,
`GET-thread-empty.200.json`):

```json
{ "flight_id": 81, "planned_leg_id": 29, "messages": [ /* AcarsMessage, oldest first */ ] }
```

`planned_leg_id` is the leg whose pre-flight rows are included, or `null`. It is
in the response so the client can say "including leg 29's pre-flight messages"
without a second fetch, and so a Reviewer can see which scope a thread was read
under.

An envelope, not a bare array, so `limit`/`before_id` can be added later without
changing the response type (§4.3). This is the one place the ACARS API departs
from `GET /api/flights`' bare array, and it departs deliberately.

**400 / 404** — §5.4.

### 5.3 `POST /api/flights/:id/acars-messages`

Request body — `SendCannedAcarsMessageRequest`
(`contracts/api/POST-send.request.json`):

```json
{ "canned_id": "request-pushback" }
```

Accepted keys, evaluated in this order:

1. `canned_id` (string) — the preferred form. Must be a known id.
2. `body` (string) — for a client holding only the text. Normalised by
   `normaliseCannedBody()` (§6.4) and matched against the canned set. Ignored
   when `canned_id` is present.
3. `direction` (optional) — if present, must be `"downlink"`.
4. `category` (optional) — if present, must equal the resolved canned entry's
   category.

Any other key is ignored, in the spirit of `PUT /api/settings/simbrief`
(`src/routes/settings.ts:23-44`), which reads only its own key.

Everything actually stored comes from the canned entry, never from the request:
`direction`, `category`, `label` and `body` are copied from
`CANNED_MESSAGES` (§6.3); `flight_id` is the path id; `planned_leg_id`,
`payload_json`, `correlation_id`, `dedup_key` and `read_at` are `NULL`;
`sent_at` is the server's clock. A client cannot forge an uplink, cannot
impersonate dispatch, and cannot store free text.

**201** — the created `AcarsMessage`, the row itself, not an id
(`contracts/api/POST-send.201.json`). The client appends this object to the
thread it already holds, which is what makes AC3's "without a page reload" a
single round trip (§7.5). 201 matches `POST /api/flights/combine`
(`src/routes/flights.ts:62`).

No dedup: sending "REQUEST PUSHBACK" twice files two messages, exactly as
pressing the button twice on a real MCDU would.

### 5.4 Rejections, frozen

Bodies are `{ error, code }`, in the style of `src/routes/settings.ts:26,32`.
Verbatim strings in `contracts/api/errors.json`.

| Case | Status | Body |
|---|---|---|
| `:id` is not an integer (`GET` or `POST`) | 400 | `{"error":"Invalid id","code":"INVALID_ID"}` |
| No flight with that id | 404 | `{"error":"Flight 999999 not found","code":"FLIGHT_NOT_FOUND"}` |
| Body is not a JSON object (array, string, `null`) | 400 | `{"error":"Invalid request body","code":"INVALID_BODY"}` |
| Body is malformed JSON text | 400 | `{"error":"Invalid request body","code":"INVALID_BODY"}` |
| Neither `canned_id` nor `body` given, or `canned_id` is not a string | 400 | `{"error":"canned_id must be one of: wx-request, gate-request, request-pushback","code":"UNKNOWN_CANNED_MESSAGE"}` |
| `canned_id` not in the set | 400 | same as above |
| `body` given but not in the canned set | 400 | `{"error":"Only canned messages can be sent from a client. Free text is not accepted.","code":"NOT_A_CANNED_MESSAGE"}` |
| `direction` present and not `"downlink"` | 403 | `{"error":"A client may only send downlink messages","code":"DIRECTION_NOT_PERMITTED"}` |
| `category` present and ≠ the canned entry's | 403 | `{"error":"category must be freetext for canned message request-pushback","code":"CATEGORY_NOT_PERMITTED"}` |
| No session | 401 | `{"error":"Authentication required"}` — the existing gate (`src/server.ts:79`), unchanged |
| Unexpected throw | 500 | `{"error":"<String(err)>"}` — the `try/catch` shape of `src/routes/flights.ts:24-27` |

400 vs 403: 400 means "this is not a message I know"; 403 means "I know exactly
what you asked for and you are not allowed to ask for it". The distinction
matters because the second is the security-relevant one — a client trying to
write an uplink is not making a typo.

The id checks run before the body checks, so a `POST` to a nonexistent flight is
404 regardless of its body. `parseInt(req.params.id, 10)` + `isNaN`, the exact
idiom of `src/routes/flights.ts:69-70`.

Malformed JSON never reaches the route handler — `express.json()` rejects it
first, and the app-level error handler at `src/server.ts:178` translates that
into `INVALID_BODY` only for paths matching
`req.path.startsWith('/api/settings/')`. That predicate does **not** match
`/api/flights/81/acars-messages`, which would therefore fall through to
express's default HTML error page instead of the frozen JSON body. Widen it,
additively, to:

```ts
if (err instanceof SyntaxError && 'body' in err &&
    (req.path.startsWith('/api/settings/') || req.path.endsWith('/acars-messages'))) {
```

The `/api/settings/` arm keeps its exact current behaviour, and this is the only
edit to `src/server.ts` beyond the router mount in §5.1.

### 5.5 The canned set reaches the client as a third endpoint

Frozen: **`GET /api/acars/canned-messages`**, returning
`{ "messages": CannedAcarsMessage[] }` (`contracts/api/GET-canned-messages.200.json`).
It is behind the same `requireAuth` gate as everything else under `/api`.

Why an endpoint rather than a hand-mirrored constant in `client/src/types.ts`,
which is the existing convention for *types*:

- The set is **already server-owned**, because the server rejects a body outside
  it (§5.4). A mirrored copy is a second source of truth for a value the server
  enforces; when they drift, the client renders a button that reliably 400s, and
  nothing catches it — there is no shared package and no test spanning both.
- The MCDU client lives in another repository (`oshogun/msfslogger_mcdu`). It
  cannot import a TypeScript constant from this tree at all. An endpoint is the
  only form of this list it can ever consume, and this run is explicitly meant
  to leave that client a contract it can use.
- The cost is one small GET, issued in the same `Promise.all` as the thread
  fetch (§7.6), on a page the user opens deliberately.

Mirroring the *type* `CannedAcarsMessage` by hand in `client/src/types.ts` stays
correct and is what §7.2 requires: types are mirrored, values are fetched.

### 5.6 "Chronological" and "newest at top", reconciled

AC2 says the thread renders in chronological order. The story's own functional
requirements say "newest at top per convention of the target UI". They are not
in conflict — one is about the sequence being correct and total, the other about
which end of it is nearest the user's eye.

Frozen:

- **The API always returns ascending** — oldest first, `(sent_at, id)` (§4.3).
  One order, no `?order=` parameter: a second order is a second thing to test
  and to get wrong, and a future cursor is far simpler over a fixed sort.
- **The reversal happens in the client, once**, in `AcarsMessages.tsx`, as a
  non-mutating `[...messages].reverse()` at render (§7.4).
- A correlated reply therefore renders **above** its request. That is the
  convention the story asked for and what an MCDU message list does.

### 5.7 Alternatives considered

| Option | Why not |
|---|---|
| `/api/acars/messages?flight_id=81` instead of nesting under the flight | The existing surface nests per-flight resources (`/api/flights/:id/planned-leg`, `/api/flights/:id/flight-plan`); a query-parameter form would be the only one of its kind. |
| `PUT`-style upsert with a client-supplied `dedup_key` | Hands idempotency control to the client for a feature whose only client action is a button press; §4.4 keeps it with the writer that actually needs it. |
| Returning `{ id }` from `POST` like `/api/flights/combine` | Forces a second GET to render the new row, which is the page reload AC3 is about. |
| Accepting free text now, gated by a length cap | Out of scope by the story and by intake; the cap exists in §6.4 to bound what server-side writers store, not to admit free text. |
| Serving the canned set as part of the thread response | Couples two unrelated cache lifetimes and re-sends a constant list on every poll. |

## 6. The pure module: `src/acars.ts`

### 6.1 Purity guarantee

`src/acars.ts` imports **nothing** from `./db`, `express`, `fs`, `http`,
`https`, `better-sqlite3` or any I/O surface, and reads no clock and no
`process.env`. Same seam as `src/simbrief.ts` (see its header,
`src/simbrief.ts:1-6`) and `src/lnmpln.ts`: values in, values out, so every rule
is unit-testable without a database or a server. The only import it may have is
`import type` from `./types`.

Checkable as `grep -n "^import\|require(" src/acars.ts` — the expected output is
at most one `import type ... from './types';` line.

### 6.2 Exports, frozen

```ts
/** The house label for a direction, used by the API error text and by tests. */
export const ACARS_DIRECTIONS = ['uplink', 'downlink'] as const;

/** The categories this codebase knows how to label and colour today. NOT a
 *  closed set: the column accepts any valid-shaped category (see §2.3). */
export const KNOWN_ACARS_CATEGORIES = [
  'pdc', 'wx', 'freetext', 'position-report', 'dispatch', 'oooi',
] as const;

/** The single direction a client is permitted to write. */
export const CLIENT_DIRECTION = 'downlink';

/** Generous ceiling that still bounds the column: a METAR+TAF pair and a full
 *  PDC are each well under it. */
export const MAX_ACARS_BODY_LENGTH = 4096;

export const CANNED_MESSAGES: readonly CannedAcarsMessage[];   // §6.3

export function isAcarsDirection(v: unknown): v is AcarsDirection;
export function isValidAcarsCategory(v: unknown): boolean;     // shape, not membership
export function isKnownAcarsCategory(v: string): boolean;      // membership, for display
export function findCannedMessage(id: unknown): CannedAcarsMessage | null;
export function findCannedMessageByBody(body: unknown): CannedAcarsMessage | null;
export function normaliseCannedBody(raw: string): string;
export function validateAcarsBody(raw: unknown): AcarsBodyResult;
export function cannedMessageIdList(): string;                 // "wx-request, gate-request, request-pushback"
```

`AcarsBodyResult` follows `SimbriefUserIdResult` (`src/simbrief.ts:16-18`)
exactly: `{ ok: true; body: string } | { ok: false; code: 'INVALID_BODY' | 'BODY_TOO_LONG'; error: string }`.
Type declarations for `AcarsDirection`, `AcarsCategory` and `CannedAcarsMessage`
live in `src/types.ts`, not here (`contracts/types.acars.ts`).

### 6.3 The canned set

Exactly three entries, in this order, which is also the render order of the
buttons (§7.4):

| `id` | `label` | `body` | `category` | `direction` |
|---|---|---|---|---|
| `wx-request` | `WX REQUEST` | `WX REQUEST` | `freetext` | `downlink` |
| `gate-request` | `GATE REQUEST` | `GATE REQUEST` | `freetext` | `downlink` |
| `request-pushback` | `REQUEST PUSHBACK` | `REQUEST PUSHBACK` | `freetext` | `downlink` |

Two decisions inside that table:

- **All three are `freetext`, including "WX REQUEST".** The category records what
  a message *is*, and this one is a typed-out phrase that triggers no lookup and
  carries no ICAO. Filing it as `wx` would put an entry in the weather category
  that no reply will ever correlate to, and would make a future "show me the
  weather I fetched" filter lie. When `acars_weather_request.md` ships, its
  REQUEST WX action writes a real `wx` row with an ICAO (§3.1) and this button
  becomes redundant.
- **`id` is lower-kebab and stable**, decoupled from the label, because it is the
  wire value in `POST` bodies (§5.3) and in the MCDU client later; a label is
  display text and may be re-worded.

### 6.4 Normalisation and validation rules

- `normaliseCannedBody(raw)`: `raw.trim()`, then collapse every run of
  whitespace (including newlines and tabs) to one space, then `toUpperCase()`.
  Applied **only** to a client-submitted `body` before matching it against the
  canned set — never to a stored body. Server-written bodies (a PDC, a METAR)
  keep their newlines and their case exactly (§2.1).
- `findCannedMessageByBody(body)`: returns the entry whose `body`, passed
  through the same normalisation, equals the normalised input. Non-string,
  empty or unmatched input returns `null`.
- `findCannedMessage(id)`: exact, case-sensitive match on `id`. No trimming — an
  id is a wire value, not user typing.
- `isValidAcarsCategory(v)`: `typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v)`.
  Shape, not membership (§2.3). The pattern is also what makes the category safe
  to interpolate into a CSS class name (§7.3).
- `isAcarsDirection(v)`: membership in `ACARS_DIRECTIONS`.
- `validateAcarsBody(raw)`: rejects a non-string or a string that is empty after
  trimming with `INVALID_BODY`; rejects longer than `MAX_ACARS_BODY_LENGTH`
  (measured on the untrimmed string) with `BODY_TOO_LONG`; otherwise returns the
  trimmed string. It is the guard for *any* writer, including the server-side
  ones the sibling stories add; the canned-message route reaches it only via the
  canned entry, which always passes.

### 6.5 What `tests/acars.test.ts` must cover

Hermetic, in the conventions of `tests/simbrief.test.ts` — no `./db` and no
clock. One `describe` per export:

1. `isAcarsDirection`: `'uplink'` → true, `'downlink'` → true; `'UPLINK'`,
   `'up'`, `''`, `null`, `undefined`, `0`, `{}` → false.
2. `isValidAcarsCategory`: each of the six known categories → true; `'oooi'`
   asserted explicitly, with a comment that it is the category the
   message-center's own five omit; `'atis'` (an unknown but well-shaped one) →
   true; `'PDC'`, `'-pdc'`, `'pdc '`, `''`, a 33-character string, `null`, `12`
   → false.
3. `isKnownAcarsCategory`: true for the six, false for `'atis'` — proving it is
   a different question from validity.
4. `CANNED_MESSAGES`: exactly three entries, in the frozen order; each `id`,
   `label` and `body` asserted against the literal strings in §6.3; every entry
   `direction === 'downlink'` and `category === 'freetext'`; ids are unique.
5. `findCannedMessage`: each of the three ids returns the entry whose `body` is
   the exact expected text; `'WX-REQUEST'`, `'wx_request'`, `''`, `null`, `42`
   → `null`.
6. `findCannedMessageByBody`: `'WX REQUEST'`, `'  wx request  '`,
   `'wx\nrequest'`, `'WX  REQUEST'` all resolve to `wx-request`; `'WX REQUEST
   EGLL'`, `'PUSHBACK'`, `''`, `null` → `null`.
7. `normaliseCannedBody`: trims, collapses whitespace runs, uppercases; is
   idempotent (`f(f(x)) === f(x)`).
8. `validateAcarsBody`: a plain body passes and is returned trimmed; a body
   containing newlines passes **with its newlines intact** (the stored-body
   guarantee); `''` and `'   '` → `INVALID_BODY`; a 4097-character string →
   `BODY_TOO_LONG`; a 4096-character string passes; non-strings → `INVALID_BODY`.
9. `cannedMessageIdList()` equals `'wx-request, gate-request, request-pushback'`
   — the exact substring of the §5.4 error body, so the two cannot drift.

### 6.6 Alternatives considered

| Option | Why not |
|---|---|
| A closed `AcarsCategory` union with no string escape hatch | Would force `as AcarsCategory` at every future story's call site — a lie the compiler stops checking. `(string & {})` keeps autocomplete for the six and stays open. |
| Validating categories by membership in `KNOWN_ACARS_CATEGORIES` | Same failure as a SQL `CHECK`, just moved: the next story edits a validator and its test instead of shipping its feature. Shape validation is what actually protects the column. |
| Putting `CANNED_MESSAGES` in `src/routes/acars.ts` | The route would then be untestable without express, and the canned-set endpoint and the validator would read two different lists. |
| Uppercasing stored bodies | Would mangle a METAR and a PDC, both of which have meaningful case and line structure. |

## 7. Client contract

### 7.1 Files, route and entry point

| File | Change |
|---|---|
| `client/src/pages/AcarsMessages.tsx` | New. The page. Named export `AcarsMessages`, matching `FlightDetail`. |
| `client/src/App.tsx` | One route, inside `AppShell`'s `<Routes>`, after `/flight/:id`: `<Route path="/flight/:id/acars" element={<AcarsMessages />} />`. Inside `AppShell` so it keeps the header and sidebar; inside `RequireAuth` by construction (`client/src/App.tsx:56-63`). |
| `client/src/pages/FlightDetail.tsx` | One `<Link to={`/flight/${flight.id}/acars`} className="btn btn-ghost">ACARS Messages</Link>` added to the existing `.flight-actions` row. Nothing else in that file changes. |
| `client/src/types.ts` | The mirrored types (§7.2). |
| `client/src/index.css` | The ACARS block (§7.3). Appended; no existing rule is edited. |

The server's SPA catch-all (`src/server.ts:152`) already serves `index.html` for
any non-`/api` path, so a deep link to `/flight/81/acars` and a browser reload on
it both work with no server change.

### 7.2 Types

Mirrored by hand into `client/src/types.ts`, per the note at
`client/src/types.ts:1-4` — byte-identical to the server declarations in
`src/types.ts`, appended at the end of the file so no existing declaration
moves: `AcarsDirection`, `AcarsCategory`, `AcarsMessage`, `AcarsThread`,
`CannedAcarsMessage`, `CannedAcarsMessageList`, `SendCannedAcarsMessageRequest`.
Exact text in `contracts/types.acars.ts`.

`CreateAcarsMessage` and `AcarsErrorBody` are **not** mirrored: the client never
inserts a row, and it reads `error` off the parsed body through `apiFetch`,
which already surfaces it as `Error.message`
(`client/src/utils/api.ts:24-35`).

### 7.3 Making direction and category visibly distinguishable (AC2)

Reusing the `.badge` convention at `client/src/index.css:480-491` (uppercase,
0.65 rem, 700 weight, 4 px radius). Every message row carries **two badges**,
and the distinction is carried by the badge *text* first and colour second — so
it survives a monochrome print and a colour-blind reader.

```css
/* ── ACARS message center ── */
.acars-thread { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.5rem; }
.acars-msg {
  background: #151822;
  border: 1px solid #2d3148;
  border-left-width: 3px;
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
}
.acars-msg--uplink   { border-left-color: #38bdf8; }
.acars-msg--downlink { border-left-color: #34d399; }
.acars-msg-head { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
.acars-msg-time { margin-left: auto; font-size: 0.72rem; color: #64748b; }
.acars-msg-body {
  margin: 0.4rem 0 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  color: #e2e8f0;
  white-space: pre-wrap;   /* a PDC and a METAR are line-structured */
  word-break: break-word;
}
.badge-uplink   { color: #38bdf8; background: #0c2434; border: 1px solid #14405c; }
.badge-downlink { color: #34d399; background: #0f2a20; border: 1px solid #1c4a37; }
.badge-acars-pdc             { color: #a78bfa; background: #1e1b2e; border: 1px solid #332c52; }
.badge-acars-wx              { color: #38bdf8; background: #0c2434; border: 1px solid #14405c; }
.badge-acars-dispatch        { color: #fbbf24; background: #2d2410; border: 1px solid #4a3a12; }
.badge-acars-position-report { color: #34d399; background: #0f2a20; border: 1px solid #1c4a37; }
.badge-acars-oooi            { color: #f472b6; background: #2d1522; border: 1px solid #4a2033; }
.badge-acars-freetext        { color: #94a3b8; background: #1e2130; border: 1px solid #2d3148; }
.badge-acars-other           { color: #94a3b8; background: #1e2130; border: 1px solid #2d3148; }
.acars-send { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.6rem 0 0; }
.acars-empty { color: #64748b; font-style: italic; }
```

What renders:

- Direction: `<span className="badge badge-uplink">DISPATCH</span>` or
  `<span className="badge badge-downlink">COCKPIT</span>`. The words, not the
  jargon: "uplink"/"downlink" is exactly the pair a user has to look up, and the
  `direction` value is still in the DOM as the class.
- Category: `<span className={\`badge badge-acars-${cls}\`}>{category}</span>`,
  where `cls` is `category` when it is one of the six known ones and `other`
  otherwise. The interpolation is safe because §6.4 restricts a category to
  `[a-z][a-z0-9-]*`, but the client must still fall back through its own known
  list rather than trusting the string.
- The category text is the raw category (`pdc`, `position-report`), uppercased
  by the existing `.badge` rule.

### 7.4 Render order and the anatomy of a row

Page structure, following `FlightDetail`'s markup conventions
(`client/src/pages/FlightDetail.tsx:271-291`):

```
<main className="container">
  <Link to={`/flight/${id}`} className="back-link">← Flight #{id}</Link>
  <h2 className="flight-title">ACARS Messages — Flight #{id}</h2>
  <p  className="flight-subtitle">{n} messages{plannedLegId ? ` · including planned leg ${plannedLegId}` : ''}</p>

  <div className="notes-section">
    <div className="section-title">Send</div>
    <div className="acars-send"> … one button per canned message … </div>
    {sendError && <p className="edit-error">{sendError}</p>}
  </div>

  <div className="notes-section">
    <div className="section-title">Thread</div>
    <div className="acars-thread"> … one .acars-msg per message … </div>
  </div>
</main>
```

- **Order: newest first.** `[...messages].reverse()` at render — a copy, never
  `messages.reverse()`, which would mutate state. The API's order is ascending
  and stays ascending (§5.6); this is the single place it is flipped.
- Row anatomy, in DOM order: direction badge, category badge, `label` (or the
  category when `label` is null) in `.acars-msg-head`, the local-time timestamp
  via the existing `formatDate` (`client/src/utils/format.ts`) pushed right by
  `.acars-msg-time`, then `body` in a `<div className="acars-msg-body">` whose
  `white-space: pre-wrap` preserves the newlines a PDC depends on.
- `key` is `message.id`.
- Send buttons render in the order the canned endpoint returns (§6.3), each
  `<button className="btn btn-ghost">` labelled with `label`.
- `payload_json`, `correlation_id`, `dedup_key` and `read_at` are **not**
  rendered this run. They are in the type because they are on the wire; the
  page shows what a crew reads.

### 7.5 The no-reload update path (AC3)

Two paths are named; **path A is required**:

- **Path A — append the 201 body.** `POST` resolves with the created
  `AcarsMessage` (§5.3); the page does
  `setMessages(prev => [...prev, created])`. The thread re-renders with the new
  entry at the top (newest first) with no second request. One round trip, and
  the appended object is the row the server actually stored, not a guess.
- **Path B — refetch the thread after the 201 resolves.** Permitted only *in
  addition* to A (append, then reconcile in the background). **Never on its
  own**: B-only makes the new entry's appearance depend on a second request that
  can fail, which is precisely the reload AC3 forbids.

Ordering within state stays ascending (append at the end); the reversal is a
render-time concern only (§7.4), so a message that arrives out of clock order is
still placed correctly by the next full fetch.

### 7.6 Every state the page must render

| State | Rendering |
|---|---|
| Loading | `<p className="flight-plan-status">Loading messages…</p>` while the initial `Promise.all([thread, canned])` is in flight. Send buttons are not rendered yet. |
| Empty thread | `<p className="acars-empty">No ACARS messages for this flight yet.</p>` inside `.acars-thread`. The Send section still renders. |
| Send in flight | The clicked button is `disabled` and reads `Sending…`; the other two are `disabled` too, so two messages cannot race. Previous `sendError` is cleared on click. |
| Send rejected | The server's `error` string inline in `<p className="edit-error">`, the same treatment as `saveError`/`unlinkError` in `FlightDetail`. The thread is left exactly as it was — nothing optimistic was inserted. Buttons re-enable. |
| Flight not found | The initial fetch's 404 renders `<p className="edit-error">Flight not found</p>` plus the back link; no thread and no Send section. |
| 401 | Nothing bespoke. `apiFetch` throws `UnauthorizedError` and has already called the handler `RequireAuth` registered (`client/src/utils/api.ts:19-35`), which bounces to `/login`. The page must use `apiFetch` for all three calls and must not swallow the 401 — in particular, a `catch` that renders `err.message` must re-throw or ignore `UnauthorizedError` rather than showing "Authentication required" as an inline error. |
| Canned list failed but thread loaded | Thread renders; the Send section shows `<p className="edit-error">Canned messages unavailable</p>` instead of buttons. A read-only thread is still useful. |

Both fetches are issued once on mount with the `cancelled` flag idiom of
`FlightDetail`'s planned-leg effect (`client/src/pages/FlightDetail.tsx:91-111`).
There is **no polling**: the thread changes only when this page writes to it,
this run.

### 7.7 Alternatives considered

| Option | Why not |
|---|---|
| An ACARS section inside `FlightDetail` instead of a page | That file is already 473 lines with six sections; a thread plus a composer belongs on its own route, and a route is what the MCDU client's page maps onto. |
| Colour-only direction distinction (border tint, no badge) | AC2 asks for *visibly* distinguishable, which a colour-blind user would not get. The badge text is the guarantee; colour is reinforcement. |
| Optimistic insert before the POST resolves | The row's `id` and `sent_at` come from the server; a placeholder would have to be reconciled or de-duplicated, and the round trip here is local. |
| Polling the thread on an interval | Nothing but this page writes messages this run; a poll would be load with no payoff until the sibling stories land. |
| Rendering `payload_json` as a table | Speculative UI for data no story produces yet, and the shape differs per category. |

## 8. Verification recipe, invariants and risks

### 8.1 The scratch server, step by step

Never against the user's server on port 3000 or the live `flights.db`. Every
command is prefixed with the Node 20 activation, because shell state does not
survive between calls.

```bash
  # 0. Live database fingerprint, before anything.
  md5sum /home/guilherme/msfslogger/flights.db

  # 1. A scratch cwd with a copy of the database, its WAL and its SHM.
  export SCRATCH=/tmp/claude-1000/.../scratchpad/acars-verify     # session scratchpad
  mkdir -p "$SCRATCH"
  cd /home/guilherme/msfslogger
  cp flights.db flights.db-wal flights.db-shm "$SCRATCH/" 2>/dev/null

  # 2. The client build the SPA catch-all serves, read-only from the repo.
  #    Without it, any non-/api path answers with an ENOENT error page.
  ln -s /home/guilherme/msfslogger/client "$SCRATCH/client"

  # 3. Build. It overwrites dist/, which the live server already loaded — so the
  #    tree must be shippable at this moment, never mid-edit.
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
  npm run build

  # 4. An operator account in the SCRATCH database (its password is unknown).
  #    Piped stdin = non-interactive; minimum length is 12.
  cd "$SCRATCH"
  printf '%s\n' 'scratch-password-123' | node /home/guilherme/msfslogger/dist/setPassword.js --username scratchop

  # 5. Start on 3100, bound to loopback, and RECORD THE PID.
  PORT=3100 BIND_HOST=127.0.0.1 INGEST_TOKEN=scratch-ingest-token-0123456789 \
    node /home/guilherme/msfslogger/dist/index.js > "$SCRATCH/server.log" 2>&1 &
  echo $! > "$SCRATCH/server.pid"
  sleep 3; cat "$SCRATCH/server.log"

  # 6. A session, so requireAuth (src/server.ts:79) is satisfied by curl.
  #    curl sends no Origin, which requireSameOrigin explicitly allows.
  curl -s -c "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' \
    -d '{"username":"scratchop","password":"scratch-password-123"}' \
    http://127.0.0.1:3100/api/auth/login
  # → {"user":{"username":"scratchop"}}
```

Steps 4-6 are verified working against the current `dist/` — the login above
returned that exact body, and `GET /api/flights/81` with the cookie returned the
flight while the same request without it returned
`401 {"error":"Authentication required"}`.

Notes the recipe depends on: `INGEST_TOKEN` must be set or the server refuses to
start (`src/config.ts:166-172`); `BIND_HOST=127.0.0.1` keeps it plaintext-legal
(`src/config.ts:144-157`); the server creates `flight_plans/` and downloads
`airports.json` into the scratch cwd on first start, which is expected.

### 8.2 Exercising the endpoints

Every call carries `-b "$SCRATCH/cookies.txt"`. Pick a real flight id from the
copy (`GET /api/flights`), preferring one with `planned_leg_id` set, and use
`999999` for the unknown-id case.

```bash
F=81
curl -s -b "$SCRATCH/cookies.txt" http://127.0.0.1:3100/api/acars/canned-messages
curl -s -b "$SCRATCH/cookies.txt" http://127.0.0.1:3100/api/flights/$F/acars-messages
for ID in wx-request gate-request request-pushback; do
  curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' \
    -d "{\"canned_id\":\"$ID\"}" http://127.0.0.1:3100/api/flights/$F/acars-messages
done
curl -s -b "$SCRATCH/cookies.txt" http://127.0.0.1:3100/api/flights/$F/acars-messages
```

Then one call per rejection row of §5.4, each with `-o /dev/null -w '%{http_code}'`
plus the body, and a final list call proving the thread is unchanged by the
rejected calls:

```bash
curl -s -b "$SCRATCH/cookies.txt" http://127.0.0.1:3100/api/flights/abc/acars-messages          # 400 INVALID_ID
curl -s -b "$SCRATCH/cookies.txt" http://127.0.0.1:3100/api/flights/999999/acars-messages       # 404 FLIGHT_NOT_FOUND
curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' -d '[]'                  \
     http://127.0.0.1:3100/api/flights/$F/acars-messages                                        # 400 INVALID_BODY
curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' -d '{"canned_id":'       \
     http://127.0.0.1:3100/api/flights/$F/acars-messages                                        # 400 INVALID_BODY
curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' -d '{"canned_id":"nope"}' \
     http://127.0.0.1:3100/api/flights/$F/acars-messages                                        # 400 UNKNOWN_CANNED_MESSAGE
curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' -d '{"body":"HELLO DISPATCH"}' \
     http://127.0.0.1:3100/api/flights/$F/acars-messages                                        # 400 NOT_A_CANNED_MESSAGE
curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' \
     -d '{"canned_id":"wx-request","direction":"uplink"}' \
     http://127.0.0.1:3100/api/flights/$F/acars-messages                                        # 403 DIRECTION_NOT_PERMITTED
curl -s -b "$SCRATCH/cookies.txt" -H 'Content-Type: application/json' \
     -d '{"canned_id":"wx-request","category":"pdc"}' \
     http://127.0.0.1:3100/api/flights/$F/acars-messages                                        # 403 CATEGORY_NOT_PERMITTED
curl -s http://127.0.0.1:3100/api/flights/$F/acars-messages                                     # 401, no cookie
```

The AC4 evidence (§3.3) is a script or `src/inspect-acars.ts` that inserts the
eleven `contracts/samples/*.json` rows **through `src/db/acarsMessages.ts`**,
with `PRAGMA table_info(acars_messages)` dumped before and after and compared
byte for byte.

### 8.3 Restart persistence and teardown

```bash
  # Stop by the RECORDED PID. Never pkill, never by name, never by -f pattern.
  kill "$(cat "$SCRATCH/server.pid")"
  sleep 2
  ps -p "$(cat "$SCRATCH/server.pid")" -o pid=,cmd= || echo "stopped"
  tail -3 "$SCRATCH/server.log"      # expect "[Shutdown] SIGTERM ... [Shutdown] Clean."

  # Start again, same scratch cwd, same port, and list again: same ids, same
  # timestamps, same order. That is AC1.
```

The clean shutdown path checkpoints the WAL (`src/db/connection.ts:31-39`), so
after `kill` the scratch directory holds `flights.db` with no `-wal`/`-shm` — a
useful secondary check that the stop was graceful. Finish with `md5sum` of the
**live** `flights.db` and show it equals the value from step 0.

The whole recipe was rehearsed against the current build while writing this
section, including `kill "$(cat …/server.pid)"` → `pid is gone`,
`[Shutdown] Clean.`, and an unchanged live md5 of
`f6f9b399e241585c18f1a488f0976d29`.

### 8.4 Must-not-change list

The Reviewer checks these one by one. Each is a surface this design guarantees
is untouched.

| # | Surface | Guarantee |
|---|---|---|
| 1 | `src/db/schema.ts:248-297` — the column-migration tail and the two partial UNIQUE indexes | Not one line changes. The new table needs no `ALTER TABLE` (§2.2). `git diff -U0 src/db/schema.ts` must show a single hunk, inside the `db.exec` block. |
| 2 | Every existing `CREATE TABLE` in `applySchema` | No column added, removed, retyped or re-defaulted. `PRAGMA table_info` for `flights`, `trips`, `planned_legs`, `planned_waypoints`, `planned_alternates`, `flight_points`, `auth_user`, `auth_session`, `app_secret`, `app_setting` is identical before and after. |
| 3 | Existing row counts | `flights`, `trips`, `planned_legs`, `flight_points` counts identical on the scratch copy before and after opening it with the new code twice. |
| 4 | `src/server.ts:117-149` — the `/api` mount order | `flights`, `trips`, `settings`, `planned-legs`, `exports` stay in that order, in those positions. The ACARS mount is appended after `createExportsRouter()` and before the catch-all; the catch-all stays last. |
| 5 | `src/server.ts:75-79` — the auth gate | `/api/auth` before the gate, `app.use('/api', requireAuth)` unchanged, no per-route auth decoration added. Nothing under `src/auth/` is touched. |
| 6 | The app-level error handler's `/api/settings/` branch (`src/server.ts:156+`) | The existing predicate keeps producing `INVALID_BODY` for `/api/settings/*`. Extending it to cover the ACARS path is additive only (§5.4). |
| 7 | `GET /api/status` (`src/server.ts:81-115`) | Byte-identical response. No ACARS key is added to it. |
| 8 | `src/db.ts` | Exactly one line added. No function is defined in the barrel. |
| 9 | `src/db/flights.ts`, `src/db/trips.ts`, `src/db/plannedLegs.ts`, `src/flightManager.ts`, `src/ingest.ts` | Unmodified this run. The cascade in §1.6 is why `deleteFlight` needs no edit. |
| 10 | `client/src/pages/FlightDetail.tsx` | One `<Link>` added to the existing actions row. The stats grid, notes, planned-leg section, flight-plan section, edit form, map, altitude chart and export/delete actions are untouched (§7.1). |
| 11 | `client/src/App.tsx` | One `<Route>` added inside `AppShell`. `/login` and the two `/print/*` routes stay outside `AppShell` and outside `RequireAuth`. |
| 12 | `client/src/types.ts:1-60` and every existing type | Appended to only; no existing declaration edited or moved. |
| 13 | `client/src/index.css` existing rules | Appended to only. `.badge` and every `.badge-*` already defined keep their current declarations. |
| 14 | The existing Vitest suite | `tests/` files other than the new `tests/acars.test.ts` are unmodified, and `npm test` stays green. |
| 15 | The user's live `flights.db` and the server on port 3000 | Not written, not restarted, not reconfigured. Live md5 identical before and after every task. |

### 8.5 Risks

1. **`combineFlights()` cascades two threads away** (§1.6). Real but narrow:
   combine is a repair operation, it already drops the planned-leg link, and
   `src/db/flights.ts` is out of scope this run. Falsified by a user combining
   two flights that have messages and expecting them merged — the follow-up is
   to re-point `flight_id` inside that transaction before the deletes.
2. **Deleting a planned leg deletes its pre-flight messages** even when a linked
   flight's thread was showing them (§1.6). Accepted as the least-bad of three
   options; an orphan row would be worse.
3. **AC4 is a bet, not a proof.** §3 checks four stories as *written today*. If
   the weather story later wants a per-ICAO cache table, or the position-report
   story wants aggregates, those are new tables, not columns here — which is the
   intended shape. The bet fails only if a sibling story needs a new *column* on
   `acars_messages`; the five columns in §2.4 are the ones that would otherwise
   have been it.
4. **The `direction` semantics contradict `acars_weather_request.md`'s prose**
   (§3.2). Whoever implements that story reading only the story file will write
   the request as `uplink` and invert the thread. Mitigation: the reconciliation
   is stated in §3.2 and must be pasted into that story's envelope.
5. **No `CHECK` means a typo is storable.** `category: 'pdcc'` inserts happily
   and renders with the `badge-acars-other` class. Deliberate (§2.3); the
   guard is `isValidAcarsCategory` plus the tests in §6.5, not the database.
6. **The canned-set endpoint is a second request on page load.** If it fails
   while the thread succeeds, the page is read-only (§7.6). Judged better than a
   mirrored constant that can drift into a button which always 400s (§5.5).
7. **Unbounded thread reads** (§4.3). A long-haul with a dense position-report
   cadence could return hundreds of rows. The envelope shape leaves room for a
   cursor; nothing in this run's write paths can produce that volume.
8. **The migration is safe only if `applySchema` is the only writer of DDL.**
   That is true today. If an implementer introduces versioned-migration
   machinery, every guarantee in §2.7 and §8.4 is void — and the plan forbids
   it.
