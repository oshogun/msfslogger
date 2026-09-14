# Design freeze — ACARS dispatch release and load sheet

Run `2026-09-14-acars-dispatch-loadsheet`, task T-001.
Implemented by T-002 (`backend_sr`, `src/**`) and T-003 (`frontend_sr`, `client/**`).

Every section below is self-contained and is meant to be delivered on its own
with `.claude/tools/ctx.sh design 2026-09-14-acars-dispatch-loadsheet <n>`.
Cross-references are by number. **Section numbers are stable** — an amendment
edits a section in place and keeps its number, and records itself in the
amendment table directly below.

None of this numbering, and none of the words "design.md", "amendment",
"plan.json", "T-001" or "§" ever appear in `src/`, `client/src/` or `tests/`.
Where a rule below needs to survive in the code, the code comment states the
reasoning, not a pointer to this file.

## Amendments

| # | Date | Sections | What forced it |
|---|---|---|---|
| — | — | — | None yet. |

## 0. Suggested reading order per task

| Task | Pull |
|---|---|
| T-002 backend | `ctx.sh design <run> 2 3 4 5 6 7 10` |
| T-003 frontend | `ctx.sh design <run> 6.1 6.2 6.5 7.2 8 10` |
| T-004 reviewer | `ctx.sh design <run> 10 11 12` first, then whatever a finding touches |

Copyable artifacts live beside this file in `contracts/` — type stubs that
typecheck standalone, and sample payloads generated from the real OFP rather
than written by hand. `contracts/README.md` indexes them. Nothing there is wired
into the build.

| Need | File |
|---|---|
| declarations for `src/simbrief.ts`, `src/types.ts`, `src/acars.ts` | `contracts/types.server.ts` |
| declarations for `client/src/types.ts` | `contracts/types.client.ts` |
| the stored `payload_json` blob | `contracts/dispatch-payload.sample.json` |
| the whole dispatch-release row, every column | `contracts/dispatch-message.sample.json` |
| a full `201` from the load-sheet endpoint | `contracts/loadsheet-response.sample.json` |
| every rejection body | `contracts/loadsheet-errors.sample.json` |

---

## 1. Scope, vocabulary, and the three rows this run creates

This run files **three ACARS message rows**, all scoped to a **planned leg** and
never to a flight:

| # | When | direction | category | label | Written by |
|---|---|---|---|---|---|
| 1 | Automatically, on a successful SimBrief import | `uplink` | `dispatch` | `DISPATCH RELEASE` | `POST /api/trips/:id/planned-legs/simbrief` — see §4.1 |
| 2 | When the pilot asks for a load sheet | `downlink` | `dispatch` | `REQUEST LOADSHEET` | the load-sheet endpoint — see §6.1 |
| 3 | Immediately after #2, in the same handler | `uplink` | `dispatch` | `LOADSHEET` | the load-sheet endpoint — see §6.1 |

**Direction convention (frozen upstream, restated so this section stands alone):**
the pilot's request is `downlink` (it comes from the cockpit), the generated
reply is `uplink` (it comes from dispatch). This matches `src/acars.ts`'s
`CLIENT_DIRECTION = 'downlink'` and the `acars_messages.direction` column
comment. `user_stories/acars_weather_request.md` says the opposite; that is a
documentation slip in the story and is not followed.

**All three rows use `category: 'dispatch'`.** No new category is introduced —
see §9.3 for why. The three are told apart by `label`, which the web client
already renders (`client/src/pages/AcarsMessages.tsx`, `AcarsRow`).

**Units are SimBrief's, never converted.** The OFP declares `params.units`
(`"kgs"` in the real capture; `"lbs"` is the other value SimBrief emits). Every
weight and fuel figure in this design is carried and rendered in whatever unit
that field names. Nothing in this run multiplies a weight by anything.

**What this run is not.** Not a performance calculation, not a weight-and-balance
tool, not a second SimBrief fetch, and not a schema change. The figures are
SimBrief's own planning numbers copied forward; the message bodies say so in
plain text (§5.2, §6.4).

---

## 2. Data model and persistence

### 2.1 No migration. Nothing is added, dropped or repurposed

`acars_messages` (`src/db/schema.ts`) already carries every column this run
needs — `planned_leg_id`, `payload_json`, `correlation_id`, `dedup_key`,
`label` — and the partial unique index `idx_acars_messages_dedup ON
acars_messages(dedup_key) WHERE dedup_key IS NOT NULL` already exists.

**Frozen: this run adds no table, no column, no index, and no `initDb()`
statement.** It is therefore trivially safe on the user's live `flights.db`,
which is already at this schema: the only writes are `INSERT`s into an existing
table by an existing function. No `UPDATE`, no `DELETE`, no `ALTER`.

`planned_legs` gains nothing either. Fuel/payload/ZFW live in the dispatch
message's `payload_json` (§4.2) and nowhere else; a leg with no dispatch message
simply has no dispatch data, which is exactly the condition §6.2 rejects on.

### 2.2 The three rows, column by column

Written through `insertAcarsMessageOnce` (`src/db/acarsMessages.ts`) in all
three cases. `<legId>` is the `planned_legs.id` the import created.

| Column | Row 1 — dispatch release | Row 2 — loadsheet request | Row 3 — loadsheet reply |
|---|---|---|---|
| `flight_id` | `null` | `null` | `null` |
| `planned_leg_id` | `<legId>` | `<legId>` | `<legId>` |
| `direction` | `'uplink'` | `'downlink'` | `'uplink'` |
| `category` | `'dispatch'` | `'dispatch'` | `'dispatch'` |
| `label` | `'DISPATCH RELEASE'` | `'REQUEST LOADSHEET'` | `'LOADSHEET'` |
| `body` | §5.2 | §6.4 | §6.4 |
| `payload_json` | `JSON.stringify(DispatchPayload)` — §4.2 | `null` | `JSON.stringify(LoadsheetFigures)` — §6.3 |
| `correlation_id` | `null` | `null` | row 2's `id`, as returned by the insert |
| `dedup_key` | §2.3 | §2.3 | §2.3 |
| `sent_at` | the caller's single `issuedAt` — §2.4 | the caller's single `issuedAt` | the same `issuedAt` |
| `read_at` | `null` (nothing writes it) | `null` | `null` |

`flight_id` stays `null` on purpose: the whole point of `planned_leg_id` is that
these messages exist before a `flights` row does. `listAcarsMessagesForFlight`
already pulls leg-scoped rows into a flight's thread via its
`planned_leg_id = (SELECT planned_leg_id FROM flights WHERE id = ?)` branch, so
a leg-scoped row appears in the flight's thread automatically once the link
exists — which is the story's AC4. Setting `flight_id` as well would be a second
source of truth for the same fact.

`correlation_id` on row 3 must be read from the row that `insertAcarsMessageOnce`
actually returns for row 2. It is **not** `row3.id - 1`: SQLite's AUTOINCREMENT
consumes a rowid on an `ON CONFLICT … DO NOTHING` that did nothing, so ids are
not contiguous (verified — see §12.2).

### 2.3 `dedup_key` formulas

Frozen, one per row, all keyed on the **planned leg id**:

```
row 1  dispatch release    `dispatch:leg:${legId}`
row 2  loadsheet request   `loadsheet-req:leg:${legId}`
row 3  loadsheet reply     `loadsheet:leg:${legId}`
```

These are the literal strings. They live as three exported helper functions in
`src/acars.ts` (§7.3) so the emitter and the reader cannot drift apart.

Why the **leg** id and not the OFP request id, which is what the `dedup_key`
column comment offers as an example (`'dispatch:ofp:<request_id>'`):
importing the same OFP twice with `allow_duplicates: true` legitimately produces
**two** planned legs, and each one needs its own dispatch release — otherwise the
second leg has no dispatch data on file and its load sheet is rejected by §6.2
for a reason the user cannot act on. `planned_legs.id` is a fresh autoincrement
per successful import, so it is unique per import by construction and a repeat
emission for the same leg is a no-op. That satisfies AC1 ("exactly one
dispatch-release message per successful import") as a database guarantee, not as
a code convention.

`insertAcarsMessageOnce` semantics, confirmed against SQLite 3.45.3 (§12.2): the
second insert with the same `dedup_key` reports `changes === 0`, writes no row,
and the function returns the **already-stored** row with `created: false`. So a
second emission is a no-op returning the original, never a second row and never
a throw. Leg deletion cascades (`planned_leg_id … ON DELETE CASCADE`), so the
keys go away with the leg and a re-import under a new leg id is unobstructed.

### 2.4 One clock read per handler

Each handler computes `const issuedAt = new Date().toISOString()` **once** and
passes that same string both to the body builders (which take it as a parameter)
and as `sent_at` on every row it writes. Two consequences, both frozen:

- `src/acars.ts` stays clock-free, as its header comment promises. Every builder
  in §5 and §6.4 is a pure function of its arguments.
- Rows 2 and 3 share a `sent_at`. Thread order therefore falls to the reads'
  `ORDER BY sent_at ASC, id ASC` tie-break, and since row 2 is inserted first its
  id is lower — request always renders before reply. Verified in §12.2.

---

## 3. The SimBrief contract change

### 3.1 Decision: `ParsedSimbriefPlan` gains a `dispatch` node. The route does not retain the raw body

**Frozen.** `src/simbrief.ts` grows one new exported interface and one new
property on `ParsedSimbriefPlan`. `src/routes/plannedLegs.ts` keeps calling
`parseSimbriefPlan(await fetchSimbriefPlan(userId))` on one line and never sees
the decoded body.

Why, against the alternative of keeping the raw body in the route (§9.1):

- The three quirks the parser exists to absorb — every scalar is a string, an
  empty element is `{}`, a once-repeated element collapses to a bare object —
  apply to `fuel`, `times` and `weights` exactly as they apply to `navlog`. A
  route reading `body.fuel.plan_ramp` would need its own copy of `num()`/`str()`
  or would silently coerce `{}` to `NaN`.
- `ParsedSimbriefPlan` **already carries a node that `CreatePlannedLegPlan` does
  not want** — `ofp`, documented as "Not part of CreatePlannedLegPlan; read by
  the import route." `dispatch` is the same seam, one node over.
- Adding properties is additive for the `plan → CreatePlannedLegPlan` assignment:
  the route passes `plan` as a variable, not as an object literal, so TypeScript's
  excess-property check does not apply and `createPlannedLeg` is unaffected.
- `src/simbrief.ts` is pure and unit-tested; a route handler is neither.

```ts
// src/simbrief.ts — OWNER of this type. Exported.
/**
 * The dispatch/load-planning figures, in whatever unit `units` names. SimBrief
 * plans in one unit system per OFP and this carries its numbers forward
 * unconverted — nothing downstream multiplies a weight by anything.
 */
export interface SimbriefDispatchFigures {
  /** params.units, verbatim: 'kgs' or 'lbs'. null when absent. */
  units: string | null;
  /** aircraft.reg, e.g. 'N201SB'. */
  aircraftReg: string | null;

  // fuel.* — all in `units`
  /** fuel.plan_ramp — block/ramp fuel, the load sheet's headline figure. */
  planRamp: number | null;
  planTakeoff: number | null;
  planLanding: number | null;
  taxi: number | null;
  enrouteBurn: number | null;
  contingency: number | null;
  reserve: number | null;
  alternateBurn: number | null;

  // times.* — SECONDS, not minutes
  /** times.est_time_enroute, seconds. */
  estTimeEnrouteSec: number | null;
  /** times.est_block, seconds, gate to gate. */
  estBlockSec: number | null;

  // weights.* — all in `units` except paxCount, which is a count
  oew: number | null;
  payload: number | null;
  estZfw: number | null;
  maxZfw: number | null;
  estTow: number | null;
  estLdw: number | null;
  /** weights.pax_count — a head count, not a weight. */
  paxCount: number | null;
  cargo: number | null;
}
```

and on `ParsedSimbriefPlan`, as a sibling of `ofp`:

```ts
  /**
   * Fuel, time and weight planning figures. Not part of CreatePlannedLegPlan;
   * read by the import route when it files the dispatch release. Every member
   * is nullable: an OFP with no `fuel` node is still a usable route.
   */
  dispatch: SimbriefDispatchFigures;
```

### 3.2 Source fields — every one verified against the real capture

Read from `samples/simbrief/simbrief.userid.json` (333 KB, captured 2026-09-13,
UHPP→UHSS, King Air 200, no alternate). Command and full output in §12.1.

| `SimbriefDispatchFigures` field | SimBrief JSON path | Value in the capture |
|---|---|---|
| `units` | `params.units` | `"kgs"` |
| `aircraftReg` | `aircraft.reg` | `"N201SB"` |
| `planRamp` | `fuel.plan_ramp` | `"1241"` |
| `planTakeoff` | `fuel.plan_takeoff` | `"1159"` |
| `planLanding` | `fuel.plan_landing` | `"287"` |
| `taxi` | `fuel.taxi` | `"82"` |
| `enrouteBurn` | `fuel.enroute_burn` | `"872"` |
| `contingency` | `fuel.contingency` | `"65"` |
| `reserve` | `fuel.reserve` | `"222"` |
| `alternateBurn` | `fuel.alternate_burn` | `"0"` |
| `estTimeEnrouteSec` | `times.est_time_enroute` | `"12033"` (3 h 20 m 33 s) |
| `estBlockSec` | `times.est_block` | `"13713"` |
| `oew` | `weights.oew` | `"3869"` |
| `payload` | `weights.payload` | `"642"` |
| `estZfw` | `weights.est_zfw` | `"4511"` |
| `maxZfw` | `weights.max_zfw` | `"4990"` |
| `estTow` | `weights.est_tow` | `"5670"` |
| `estLdw` | `weights.est_ldw` | `"4798"` |
| `paxCount` | `weights.pax_count` | `"7"` |
| `cargo` | `weights.cargo` | `"86"` |

Fields the dispatch release also needs, **already** on `ParsedSimbriefPlan` — do
not re-read them from the raw body:

| Needed for | Existing field | Source path |
|---|---|---|
| filed route text | `plan.ofp.routeString` | `general.route` |
| cruise altitude | `plan.cruiseAltFt` | `general.initial_altitude` |
| flight number | `plan.ofp.flightNumber` | `general.flight_number` |
| aircraft type | `plan.aircraftType` | `aircraft.icao_code` |
| origin / destination | `plan.departure.ident` / `plan.destination.ident` | `origin.icao_code` / `destination.icao_code` |
| alternates | `plan.alternates[].ident` | `alternate[].icao_code` |
| OFP identity | `plan.ofp.requestId` / `.sequenceId` / `.timeGenerated` | `params.*` |

Note on alternates: in the real capture `alternate` is `{}` — the plan was filed
with **no** alternate — and `arr()` correctly yields `[]`. The dispatch body must
therefore render an empty alternate list, not crash and not print `undefined`
(§5.2 prints `ALTN NONE`). This is the common case in the one real fixture we
have, so it is the case to get right first.

### 3.3 Parser rules for the new node

Built with the parser's existing helpers, no new ones:

```
const params  = rec(root['params']);      // already read for ofp
const fuelNode    = rec(root['fuel']);
const timesNode   = rec(root['times']);
const weightsNode = rec(root['weights']);
const aircraftNode = rec(root['aircraft']);

units:  str(params?.['units'])            // NOT lowercased here; §5.1 normalises for display
every numeric field: num(<node>?.['<key>'])
```

Frozen rules:

1. **Nothing in the dispatch node can reject a plan.** No `reject()` call is
   added. A missing `fuel`/`times`/`weights` node yields a node of all-`null`
   members and the import still succeeds — the route is what a planned leg is
   for, and the OFP's route is intact.
2. **No unit conversion, no rounding, no derivation in the parser.** `num()`
   output verbatim. Derivation (block fuel fallbacks, payload fallbacks) happens
   once, in `src/acars.ts` (§6.3), where it is testable as a rule rather than
   twice in two files.
3. **One new warning code**, `'NO_DISPATCH_FIGURES'`, added to
   `SimbriefWarningCode`. Emitted **only** when `fuel.plan_ramp` and
   `weights.est_zfw` are *both* null, with the message
   `SimBrief returned no fuel or weight figures; the dispatch release will carry no load data`.
   Not emitted for individual missing fields — a warning per null field would
   turn a normal OFP into a wall of noise in the trip page's import result.
   `client/src/pages/TripDetail.tsx` renders warnings by `message` only and never
   switches on `code`, so a new code needs no client change.
4. `params.units` is already read for `ofp`; read the node once and use it twice.

### 3.4 `src/inspect-simbrief.ts`

Add one block to the per-file print, after the existing `ofp` line, so the
inspector stays the fastest way to eyeball a real OFP:

```
   dispatch     units=kgs  block=1241  trip=872  resv=222  ete=12033s
   weights      oew=3869  payload=642  zfw=4511/4990  tow=5670  ldw=4798  pax=7
```

Null renders as the inspector's existing `—` via its `nullable()` helper. No
other change to that file.

---

## 4. The dispatch release: where it is written, and what happens when it fails

### 4.1 Insertion point in `src/routes/plannedLegs.ts`

The SimBrief import route is `POST /trips/:id/planned-legs/simbrief`
(currently lines 201–288). Its structure, unchanged, is:

```
  … trip lookup → settings read → fetch → parse → label/ofpId/sha256 …

  if (!allowDuplicates) {
    const existing = findPlannedLegBySource(tripId, sha256);
    if (existing) { …; res.json({ imported: [], result: { status: 'duplicate', … } }); return; }
  }                                    ← A. the duplicate short-circuit. RETURNS.

  try {
    const legId = createPlannedLeg({ … });          ← B. the only write to planned_legs
    console.log(`[SIMBRIEF] import ok: …`);          ← C. existing log line, unmoved
                                                     ← D. THE DISPATCH BLOCK GOES HERE
    res.status(201).json({ imported: [ … ], result: { status: 'imported', … } });  ← E.
  } catch (err) { … 500 DB_ERROR … }                 ← F.
```

**Frozen: the dispatch block is inserted at D — after the existing
`console.log` at C, before the `res.status(201).json(...)` at E, inside the
existing `try`, and wrapped in a `try/catch` of its own.**

```ts
      // Files the dispatch release into the new leg's ACARS thread. Its own
      // try/catch, and deliberately so: the leg is already committed by the
      // time this runs, so a failure here must not turn a successful import
      // into an error response — the user's leg exists either way, and a
      // missing message is recoverable while a 500 on a committed insert is
      // not. The key is the leg id, so running this twice for one leg is a
      // no-op rather than a second release.
      try {
        const issuedAt = new Date().toISOString();
        const payload = buildDispatchPayload(plan);
        insertAcarsMessageOnce({
          planned_leg_id: legId,
          direction: 'uplink',
          category: 'dispatch',
          label: DISPATCH_RELEASE_LABEL,
          body: buildDispatchReleaseBody(payload, issuedAt),
          payload_json: JSON.stringify(payload),
          dedup_key: dispatchDedupKey(legId),
          sent_at: issuedAt,
        });
      } catch (err) {
        console.error(`[SIMBRIEF] dispatch release not filed: leg ${legId} ofp ${ofpId} (${String(err)})`);
      }
```

Properties this placement guarantees, each one a Reviewer check (§10):

- **Unreachable from the duplicate path.** A is a `return` inside
  `if (!allowDuplicates) { … }`, above B. Nothing after it runs. AC1's "every
  *successful* import" is therefore exactly the set of executions that reach D.
- **Cannot change the response.** The inner `catch` swallows; control always
  reaches E. The 201 status and the `{ imported, result }` body are byte-for-byte
  what they are today — the dispatch message is **not** added to the import
  response (§9.4).
- **Cannot reach the outer catch at F**, so it can never produce the `DB_ERROR`
  500 that path is for.
- **Runs before the response is sent**, not after, so a client that navigates
  straight to the thread sees the release already filed. (Sending first and
  writing after would be a race for no benefit; the write is one local SQLite
  insert.)
- **Leaves `planned_legs` untouched on every failure path.** The route's header
  comment (lines ~195–200) currently ends "Do not introduce a second write, and
  do not move one earlier." That sentence is protecting a real invariant — *no
  failure in this handler may alter the trip's existing planned legs* — and this
  change does not violate it: the new write is after the only `planned_legs`
  write, into a different table, and is swallowed. **T-002 must update that
  comment** so the next reader is not told a rule the code no longer obeys.
  Frozen replacement for its last sentence:

  > Do not move `createPlannedLeg` earlier, and do not add a second write to
  > `planned_legs`. The ACARS dispatch release written after it is the one
  > permitted extra write: it targets a different table, it runs only after the
  > leg is committed, and its own try/catch keeps a message failure from
  > changing this route's response.

### 4.2 `payload_json` on the dispatch release

This is the **only** thing that carries SimBrief's figures forward. The
load-sheet endpoint reads it back — possibly days later, certainly in another
request — and must be able to produce block fuel, payload and ZFW from it alone,
with no SimBrief call and no re-derivation from a raw OFP body. It is therefore
self-contained: everything the load sheet or a future PDC needs is in it, and
nothing in it is a pointer to something else.

Shape (snake_case, matching the wire and column conventions; **every** scalar
nullable except `v`, `source` and `alternates`):

```ts
// src/types.ts — OWNER. §7.1 lists it with the rest.
export interface DispatchPayload {
  /** Schema version of this blob. 1 for this run. A reader that does not know
   *  the version treats the payload as absent (see §6.2). */
  v: 1;
  /** Which upstream produced the figures. 'simbrief' is the only value today. */
  source: 'simbrief';
  ofp: {
    request_id: string | null;
    sequence_id: string | null;
    /** Epoch seconds, as a string, exactly as SimBrief sent it. */
    time_generated: string | null;
  };
  flight_number: string | null;
  aircraft_type: string | null;
  aircraft_reg: string | null;
  origin: string | null;
  destination: string | null;
  /** ICAO idents in plan order. [] when the plan was filed with none. */
  alternates: string[];
  /** The filed route string, untruncated. Truncation is a display rule (§5.1). */
  route: string | null;
  cruise_alt_ft: number | null;
  /** 'kgs' | 'lbs' as SimBrief spelled it. Every weight below is in this unit. */
  units: string | null;
  ete_sec: number | null;
  block_time_sec: number | null;
  fuel: {
    ramp: number | null;
    takeoff: number | null;
    landing: number | null;
    taxi: number | null;
    enroute_burn: number | null;
    contingency: number | null;
    reserve: number | null;
    alternate_burn: number | null;
  };
  weights: {
    oew: number | null;
    payload: number | null;
    est_zfw: number | null;
    max_zfw: number | null;
    est_tow: number | null;
    est_ldw: number | null;
    pax_count: number | null;
    cargo: number | null;
  };
}
```

Built by `buildDispatchPayload(plan: ParsedSimbriefPlan): DispatchPayload` in
`src/acars.ts` (§7.3) — a straight field copy, no arithmetic. Stored as
`JSON.stringify(payload)`; `payload_json` is `TEXT` and this run never pretty-prints it.

**Real output**, produced by the prototype against the real capture (651 chars —
nowhere near any limit; the column is unbounded `TEXT`):

```json
{"v":1,"source":"simbrief","ofp":{"request_id":"186182026","sequence_id":"60bafd06304e","time_generated":"1789306516"},"flight_number":"SHG037","aircraft_type":"BE20","aircraft_reg":"N201SB","origin":"UHPP","destination":"UHSS","alternates":[],"route":"SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V","cruise_alt_ft":28000,"units":"kgs","ete_sec":12033,"block_time_sec":13713,"fuel":{"ramp":1241,"takeoff":1159,"landing":287,"taxi":82,"enroute_burn":872,"contingency":65,"reserve":222,"alternate_burn":0},"weights":{"oew":3869,"payload":642,"est_zfw":4511,"max_zfw":4990,"est_tow":5670,"est_ldw":4798,"pax_count":7,"cargo":86}}
```

Also saved as `contracts/dispatch-payload.sample.json` (pretty-printed there for
reading; the stored form is the single line above).

### 4.3 How the dispatch payload is read back

**Frozen: by `dedup_key`, not by scanning the thread.**

```ts
const stored = findAcarsMessageByDedupKey(dispatchDedupKey(legId));   // src/db/acarsMessages.ts
const payload = parseDispatchPayload(stored?.payload_json ?? null);   // src/acars.ts, §7.3
```

`findAcarsMessageByDedupKey` already exists and is served by the unique index, so
the lookup is exact and O(log n). The alternative — `listAcarsMessagesForPlannedLeg(legId)`
then `.find(m => m.category === 'dispatch')` — reads the whole thread (which by
then contains the load-sheet pair, also `category: 'dispatch'`) and has to pick
one of several matches. The dedup key is the identity of *the* release; use it.
**No new function is added to `src/db/acarsMessages.ts`.**

`parseDispatchPayload(raw: string | null): DispatchPayload | null` is pure and
total — it never throws:

1. `raw === null` or `''` → `null`.
2. `JSON.parse` throws → `null`.
3. result is not an object, or `v !== 1`, or `source !== 'simbrief'` → `null`.
4. otherwise, coerce: every scalar is `typeof === 'number' ? value : null`
   (a string that looks like a number is **not** accepted — this blob is written
   by us, in one place, and a string there means the data is not what we wrote);
   `alternates` is `Array.isArray(x) ? x.filter(s => typeof s === 'string') : []`;
   a missing `fuel`/`weights` object becomes one with all-`null` members.

`null` from this function is the "no dispatch data on file" condition of §6.2.

---

## 5. Message body formatting

All bodies are uppercase, newline-separated, monospace-friendly fixed fields.
`client/src/pages/AcarsMessages.tsx` renders `.acars-msg-body` with
`white-space: pre-wrap` and a monospace family, so the column alignment below
survives to the screen unchanged.

### 5.1 Shared formatters (frozen rules, `src/acars.ts`)

Each of these is a pure function, exported, and used by both §5.2 and §6.4 so the
two messages cannot disagree about how a number looks.

| Helper | Rule | Examples |
|---|---|---|
| `hhmm(sec)` | `null`, non-finite or negative → `'----'`. Otherwise `floor(sec/3600)` padded to 2 + `floor((sec%3600)/60)` padded to 2, no separator. Seconds are discarded, never rounded up. | `12033 → '0320'`, `13713 → '0348'`, `null → '----'` |
| `levelText(ft)` | `null` → `'UNKNOWN'`. `round(ft) >= 18000` → `'FL' + round(ft/100)` padded to 3. Otherwise `round(ft) + 'FT'`. | `28000 → 'FL280'`, `8000 → '8000FT'`, `null → 'UNKNOWN'` |
| `qty(v)` | `null` → `'----'`. Otherwise `String(Math.round(v))`. No thousands separator, no unit suffix — the unit is stated once per message. | `1241 → '1241'`, `0 → '0'`, `null → '----'` |
| `unitText(units)` | lowercased: `'kgs'`/`'kg'` → `'KG'`; `'lbs'`/`'lb'` → `'LB'`; anything else including `null` → `'UNITS UNKNOWN'`. | `'kgs' → 'KG'` |
| `clampRoute(route)` | `null` → `'NIL'`. Length ≤ 900 → verbatim. Otherwise first 897 chars + `'...'`. | see below |
| `field(label, value)` | `label.padEnd(14, ' ') + value.padStart(6, ' ')`. The whole fixed-field grid of §6.4 is this one rule. | `field('TRIP FUEL','872') → 'TRIP FUEL        872'` |

`clampRoute`'s ceiling exists because `validateAcarsBody` refuses a body over
`MAX_ACARS_BODY_LENGTH` (4096) and the route string is the only unbounded input
in either message. With the route capped at 900, every other line of §5.2 bounded
by its own field widths, and §6.4 carrying no route at all, both bodies are
structurally under 1200 characters. The real capture produces 316 and 389
(§12.1) — the cap is a guard against a pathological oceanic route, not a
routine truncation.

### 5.2 The dispatch-release body

Ten lines, in this order, joined with `\n`:

```
DISPATCH RELEASE
FLT <flight_number | UNKNOWN>
<origin | ????> <destination | ????> ALTN <alternates joined by ' ' | NONE>
ACFT <aircraft_type | UNKNOWN> <aircraft_reg | NOREG>
CRZ <levelText(cruise_alt_ft)>
ETE <hhmm(ete_sec)>
FUEL <unitText(units)> BLOCK <qty(fuel.ramp)> TRIP <qty(fuel.enroute_burn)> RESV <qty(fuel.reserve)> ALTN <qty(fuel.alternate_burn)> CONT <qty(fuel.contingency)> TAXI <qty(fuel.taxi)>
RTE <clampRoute(route)>
OFP <ofp.request_id | UNKNOWN> ISSUED <issuedAt>
SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE
```

Signature: `buildDispatchReleaseBody(payload: DispatchPayload, issuedAt: string): string`.
Pure — `issuedAt` is the caller's single clock read (§2.4), and is the same ISO
string stored in `sent_at`.

The last line is not decoration: the story's non-functional note requires the
figures not be presented as authoritative, and this message is the one a user
might screenshot.

**Real output** (prototype, real capture, `issuedAt = '2026-09-14T09:22:01.000Z'`,
316 chars):

```
DISPATCH RELEASE
FLT SHG037
UHPP UHSS ALTN NONE
ACFT BE20 N201SB
CRZ FL280
ETE 0320
FUEL KG BLOCK 1241 TRIP 872 RESV 222 ALTN 0 CONT 65 TAXI 82
RTE SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V
OFP 186182026 ISSUED 2026-09-14T09:22:01.000Z
SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE
```

Every element the story's first functional requirement names is present and
labelled: route (`RTE`), cruise altitude (`CRZ`), planned fuel (`FUEL …`),
alternates (`ALTN`), estimated time enroute (`ETE`).

---

## 6. The load sheet

### 6.1 Endpoint

```
POST /api/planned-legs/:legId/acars-messages/loadsheet
```

**Frozen.** Registered in **`src/routes/acars.ts`**, inside `createAcarsRouter()`,
after the existing `POST /flights/:id/acars-messages` handler. It needs
`getPlannedLegById` from `../db/plannedLegs` and `findAcarsMessageByDedupKey` /
`insertAcarsMessageOnce` from `../db/acarsMessages`.

- **Why `src/routes/acars.ts` and not `src/routes/plannedLegs.ts`:** the resource
  created is ACARS messages, not a planned leg. `createAcarsRouter()` already
  owns every ACARS route, takes no `flightManager`, and is described in its own
  header as the transport half of the ACARS vocabulary. `plannedLegs.ts` is 475
  lines and its SimBrief handler carries a write-ordering contract in its header
  comment that a second unrelated write concept would muddy.
- **Why this path:** it is the leg-scoped mirror of the existing
  `/flights/:id/acars-messages`, with the generated-message kind as a trailing
  segment. It leaves room for `POST /api/planned-legs/:legId/acars-messages/pdc`
  and `GET /api/planned-legs/:legId/acars-messages` without another naming
  argument. Router mount order is safe: `createPlannedLegsRouter` is mounted
  first and owns `GET`/`PATCH`/`DELETE /planned-legs/:legId` — two segments,
  different methods — so a three-segment `POST` cannot be captured by it.
- **Request body: none.** The leg id in the path is the only input. A body, if
  sent, is ignored — no `Content-Type` requirement, no validation, no 400 for a
  malformed body. There is nothing a caller could legitimately vary.

Success response — `201 Created` when the pair was written, `200 OK` when it
already existed (§6.5):

```ts
// src/types.ts — OWNER. Mirrored by hand in client/src/types.ts (§7.2).
export interface LoadsheetRequestResponse {
  planned_leg_id: number;
  /** false when this leg already had a load sheet and these are the stored rows. */
  created: boolean;
  /** direction 'downlink', label 'REQUEST LOADSHEET'. */
  request: AcarsMessage;
  /** direction 'uplink', label 'LOADSHEET'. correlation_id === request.id. */
  reply: AcarsMessage;
  /** The figures, already parsed, so no client has to scrape the body text. */
  sheet: LoadsheetFigures;
}
```

`request` and `reply` are full `AcarsMessage` rows exactly as the thread read
returns them, so a client can append them to its thread without a refetch — the
same contract `POST /flights/:id/acars-messages` already has. A full worked
response is in `contracts/loadsheet-response.sample.json`.

Handler order of operations, frozen:

1. `const legId = parseInt(req.params.legId, 10)` — `NaN` → 400 (§6.2).
2. `getPlannedLegById(legId)` — missing → 404 (§6.2).
3. `parseDispatchPayload(findAcarsMessageByDedupKey(dispatchDedupKey(legId))?.payload_json ?? null)`
   — `null` → 409 (§6.2).
4. `buildLoadsheetFigures(payload)` (§6.3) — all three headline figures `null` →
   409 (§6.2). **No row is written before this point.**
5. `const issuedAt = new Date().toISOString()` (§2.4).
6. Insert the request row (§2.2) via `insertAcarsMessageOnce`; keep its
   `{ message, created }`.
7. Insert the reply row via `insertAcarsMessageOnce`, with
   `correlation_id: requestResult.message.id`.
8. `res.status(replyResult.created ? 201 : 200).json({ planned_leg_id: legId, created: replyResult.created, request: requestResult.message, reply: replyResult.message, sheet })`.
9. Everything wrapped in one `try/catch` → `500 { error: String(err) }`, matching
   the rest of `src/routes/acars.ts`. Unlike §4.1 there is nothing to protect
   here: the messages *are* the response.

`created` is read from the **reply** insert, which is the one that carries the
sheet. (The two can only disagree if a previous call was interrupted between
steps 6 and 7, which leaves a request with no reply; taking the reply's value
means the next call reports `created: true` and completes the pair. That is the
correct repair.)

### 6.2 Rejections

| Condition | Status | Body |
|---|---|---|
| `:legId` is not an integer | `400` | `{ "error": "Invalid id", "code": "INVALID_ID" }` |
| no `planned_legs` row with that id | `404` | `{ "error": "Planned leg <legId> not found", "code": "PLANNED_LEG_NOT_FOUND" }` |
| **no usable dispatch data on the leg** | `409` | `{ "error": "NO DISPATCH DATA ON FILE", "code": "NO_DISPATCH_DATA" }` |
| anything thrown | `500` | `{ "error": "<String(err)>" }` |

**The rejection text is the literal string `NO DISPATCH DATA ON FILE`** — the
whole value of `error`, with no prefix, no suffix, no trailing period, no leg id
interpolated. It is written once, as an exported constant
`NO_DISPATCH_DATA_MESSAGE` in `src/acars.ts` (§7.3), so a reviewer grepping for
the story's phrase finds exactly one definition. `client/src/utils/api.ts`'s
`apiFetch` throws `new Error(body.error)` on a non-2xx, so this string arrives at
the client's error state verbatim with no client-side mapping (§8).

"No usable dispatch data" is precisely three cases, all reaching the same 409:

1. No row with `dedup_key = dispatch:leg:<legId>` — e.g. a leg imported from a
   `.lnmpln` file, which never files a release.
2. The row exists but `parseDispatchPayload` returns `null` (absent, unparseable,
   or a version this build does not know — §4.3).
3. The payload parses but `block_fuel`, `payload` **and** `zero_fuel_weight` all
   resolve to `null` after §6.3's fallbacks. A sheet of three dashes is not the
   "fuel, payload and ZFW figures" the story's AC2 requires, so it is refused
   rather than filed. Partial data — any one of the three present — is filed, with
   the missing fields rendered `----`.

**No row is written on any rejection path.** All four checks precede step 6 of
§6.1. This is directly checkable: `listAcarsMessagesForPlannedLeg(legId).length`
is identical before and after a rejected request.

Status `409` rather than 404 or 422: 404 would assert the leg does not exist,
which is false and would collide with the client's genuine not-found handling;
`422` appears nowhere in this codebase; `409` is already this codebase's "the
named resource exists and its state forbids what you asked" code, used seven
times across `src/routes/`. The `code` field is what a machine branches on; the
status is what a log reader sees.

### 6.3 Deriving the figures

`buildLoadsheetFigures(payload: DispatchPayload): LoadsheetFigures` — pure,
`src/acars.ts`. Written as rules because two implementations must agree.

**Block fuel** (the story's "block fuel from the SimBrief plan"):

1. `fuel.ramp` if non-null. *(SimBrief's `plan_ramp` is ramp/block fuel.)*
2. else `fuel.takeoff + fuel.taxi` if **both** non-null.
3. else `null`.

**Payload** (the story's "placeholder/estimated payload figure"):

1. `weights.payload` if non-null → `payload_source: 'simbrief'`.
2. else `weights.est_zfw - weights.oew` if both non-null → `payload_source: 'derived'`.
3. else `null` → `payload_source: 'unavailable'`.

**Zero-fuel weight:**

1. `weights.est_zfw` if non-null → `zfw_source: 'simbrief'`.
2. else `weights.oew + <payload resolved above>` if both non-null → `zfw_source: 'derived'`.
3. else `null` → `zfw_source: 'unavailable'`.

Payload is resolved **before** ZFW, and ZFW's fallback consumes the already-resolved
payload. The two fallbacks can therefore never both fire on the same plan (rule 2
of each requires the other's input), so there is no circular derivation.

Straight copies, no fallback: `taxi_fuel ← fuel.taxi`, `takeoff_fuel ← fuel.takeoff`,
`trip_fuel ← fuel.enroute_burn`, `max_zero_fuel_weight ← weights.max_zfw`,
`dry_operating_weight ← weights.oew`, `takeoff_weight ← weights.est_tow`,
`landing_weight ← weights.est_ldw`, `pax_count ← weights.pax_count`,
`cargo ← weights.cargo`, `units ← units`.

No rounding here — `qty()` rounds at render time (§5.1) and the JSON carries the
unrounded value. `estimated` is the constant `true`; it exists so a consumer of
the JSON cannot read these as authoritative without seeing the flag.

```ts
// src/types.ts — OWNER. §7.1.
export interface LoadsheetFigures {
  /** 'kgs' | 'lbs' as SimBrief spelled it, or null. Every weight is in this unit. */
  units: string | null;
  block_fuel: number | null;
  taxi_fuel: number | null;
  takeoff_fuel: number | null;
  trip_fuel: number | null;
  payload: number | null;
  payload_source: 'simbrief' | 'derived' | 'unavailable';
  zero_fuel_weight: number | null;
  zfw_source: 'simbrief' | 'derived' | 'unavailable';
  max_zero_fuel_weight: number | null;
  dry_operating_weight: number | null;
  takeoff_weight: number | null;
  landing_weight: number | null;
  pax_count: number | null;
  cargo: number | null;
  /** Always true: these are SimBrief planning figures, not a loading calculation. */
  estimated: boolean;
}
```

The same object is `JSON.stringify`'d into the reply row's `payload_json` and
returned as `LoadsheetRequestResponse.sheet`, so the row and the response can
never disagree.

**Real output** (prototype, real capture):

```json
{"units":"kgs","block_fuel":1241,"taxi_fuel":82,"takeoff_fuel":1159,"trip_fuel":872,"payload":642,"payload_source":"simbrief","zero_fuel_weight":4511,"zfw_source":"simbrief","max_zero_fuel_weight":4990,"dry_operating_weight":3869,"takeoff_weight":5670,"landing_weight":4798,"pax_count":7,"cargo":86,"estimated":true}
```

### 6.4 Request and reply bodies

`buildLoadsheetRequestBody(payload: DispatchPayload): string` — two lines:

```
REQUEST LOADSHEET
<origin | ????> <destination | ????>[ FLT <flight_number>]
```

The ` FLT …` clause is omitted entirely when `flight_number` is null (no dangling
`FLT`). Real output:

```
REQUEST LOADSHEET
UHPP UHSS FLT SHG037
```

`buildLoadsheetReplyBody(payload: DispatchPayload, sheet: LoadsheetFigures, issuedAt: string): string`
— seventeen lines, joined with `\n`. Lines 5–15 are `field(label, value)` from
§5.1, which is what produces the aligned right-hand column:

```
LOADSHEET
FLT <flight_number | UNKNOWN> <origin | ????> <destination | ????>
ACFT <aircraft_type | UNKNOWN> <aircraft_reg | NOREG>
UNITS <unitText(units)>
field('BLOCK FUEL',   qty(block_fuel))
field('TAXI FUEL',    qty(taxi_fuel))
field('TAKEOFF FUEL', qty(takeoff_fuel))
field('TRIP FUEL',    qty(trip_fuel))
field('PAX',          qty(pax_count))
field('CARGO',        qty(cargo))
field('PAYLOAD',      qty(payload))
field('DRY OPER WT',  qty(dry_operating_weight))
field('ZERO FUEL WT', qty(zero_fuel_weight))[ + ' MAX ' + qty(max_zero_fuel_weight)]
field('TAKEOFF WT',   qty(takeoff_weight))
field('LANDING WT',   qty(landing_weight))
ISSUED <issuedAt>
ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING
```

The ` MAX <n>` suffix on the ZFW line is appended only when
`max_zero_fuel_weight` is non-null; otherwise that line is a plain `field(...)`.
`issuedAt` is the caller's single clock read (§2.4) and equals both rows' `sent_at`.

The last line is required by the story's non-functional note and is not optional.

**Real output** (389 chars):

```
LOADSHEET
FLT SHG037 UHPP UHSS
ACFT BE20 N201SB
UNITS KG
BLOCK FUEL      1241
TAXI FUEL         82
TAKEOFF FUEL    1159
TRIP FUEL        872
PAX                7
CARGO             86
PAYLOAD          642
DRY OPER WT     3869
ZERO FUEL WT    4511 MAX 4990
TAKEOFF WT      5670
LANDING WT      4798
ISSUED 2026-09-14T09:22:01.000Z
ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING
```

### 6.5 Re-request semantics: idempotent, one pair per leg

**Frozen: re-requesting a load sheet for a leg returns the same two rows. It
does not file a second pair.** Both rows are written with
`insertAcarsMessageOnce` under the leg-keyed dedup keys of §2.3; the second call
writes nothing, returns the stored rows, and answers `200` with
`created: false`.

Why, given the codebase has a precedent each way:

- The existing canned-message route deliberately has **no** dedup — "pressing the
  button twice files two messages, exactly as it would on a real MCDU". That is
  right for `REQUEST PUSHBACK`, which is a *speech act*: the second one means
  something (you are asking again).
- The PDC story requires the opposite — "persist issued PDCs so a re-request
  returns the existing clearance instead of reissuing one" — and
  `insertAcarsMessageOnce`'s own doc comment names that case as its reason to
  exist.

The load sheet is the PDC case, not the pushback case, and for a reason specific
to this run rather than by analogy: **a second request is guaranteed to produce a
byte-identical sheet.** The figures come from `payload_json`, which is written
once at import and never updated (§4.2), through a pure function with no clock
and no randomness (§6.3). A second pair would be an exact duplicate of the first,
differing only in `sent_at` — noise in a thread whose whole purpose is to be read
in order. And because the content cannot change, nothing is lost by returning the
original.

Consistency with the PDC feature (not part of this run) is a bonus, not the
argument: if PDC lands on the same `insertAcarsMessageOnce` + leg-keyed-dedup
pattern, the two read the same way.

**Consequence the client must handle (§8):** on a `created: false` response the
returned rows are already in the thread. Appending them blindly duplicates them
in the list and produces two React children with the same `key`. T-003 merges by
`id`, it does not push.

**Getting a fresh sheet** means importing a fresh OFP, which creates a new leg
with a new id and therefore new keys. There is no endpoint to invalidate a sheet
in place, and none is wanted: the leg's dispatch data is immutable.

---

## 7. Type ownership

Shared types are mirrored by hand across the wire, as `AcarsMessage`,
`AcarsThread` and `SimFrame` already are. **Every type below belongs to exactly
one file; no file is edited by both T-002 and T-003.**

### 7.1 `src/types.ts` — T-002 owns

Append to the existing `── ACARS ──` block, after `SendCannedAcarsMessageRequest`
and before `AcarsErrorBody`:

- `DispatchPayload` — full definition in §4.2.
- `LoadsheetFigures` — full definition in §6.3.
- `LoadsheetRequestResponse` — full definition in §6.1.

And **extend** the existing `AcarsErrorBody.code` union, which is the one edit to
an existing type in this file:

```ts
  code:
    | 'INVALID_ID' | 'FLIGHT_NOT_FOUND' | 'INVALID_BODY'
    | 'UNKNOWN_CANNED_MESSAGE' | 'NOT_A_CANNED_MESSAGE'
    | 'DIRECTION_NOT_PERMITTED' | 'CATEGORY_NOT_PERMITTED'
    | 'PLANNED_LEG_NOT_FOUND' | 'NO_DISPATCH_DATA';
```

`SimbriefDispatchFigures` does **not** live here — it belongs to `src/simbrief.ts`
(§3.1), alongside `ParsedSimbriefPlan`, which is where every other SimBrief
parser type lives.

Machine-readable stubs of all of the above: `contracts/types.server.ts`.

### 7.2 `client/src/types.ts` — T-003 owns

Append to the client's `── ACARS ──` block, mirroring §7.1 **verbatim except for
the doc comments**, which may be shortened:

- `LoadsheetFigures`
- `LoadsheetRequestResponse`

`DispatchPayload` is **not** mirrored: no client parses `payload_json` in this
run — the web page renders `body`, and the figures it needs arrive pre-parsed as
`LoadsheetRequestResponse.sheet`. Mirroring a type nobody reads is a maintenance
cost with no consumer. If a later run renders the dispatch payload structurally,
it mirrors it then.

`AcarsErrorBody` does not exist client-side and is not added; `apiFetch` surfaces
`error` as an `Error.message` and the client never branches on `code` (§8).

Machine-readable stub: `contracts/types.client.ts`.

### 7.3 `src/acars.ts` — T-002 owns. New pure functions and constants

`src/acars.ts` is the rules half: no database, no express, no I/O, **no clock**.
Everything below honours that — `issuedAt` is always a parameter.

```ts
export const DISPATCH_RELEASE_LABEL = 'DISPATCH RELEASE';
export const LOADSHEET_REQUEST_LABEL = 'REQUEST LOADSHEET';
export const LOADSHEET_LABEL = 'LOADSHEET';
/** The one definition of the story's rejection phrase. See §6.2. */
export const NO_DISPATCH_DATA_MESSAGE = 'NO DISPATCH DATA ON FILE';
/** Ceiling on the filed route inside a message body. See §5.1. */
export const MAX_ROUTE_BODY_CHARS = 900;

export function dispatchDedupKey(legId: number): string;          // §2.3
export function loadsheetRequestDedupKey(legId: number): string;  // §2.3
export function loadsheetReplyDedupKey(legId: number): string;    // §2.3

export function buildDispatchPayload(plan: ParsedSimbriefPlan): DispatchPayload;   // §4.2
export function parseDispatchPayload(raw: string | null): DispatchPayload | null;  // §4.3
export function buildDispatchReleaseBody(p: DispatchPayload, issuedAt: string): string;  // §5.2
export function buildLoadsheetFigures(p: DispatchPayload): LoadsheetFigures;       // §6.3
export function buildLoadsheetRequestBody(p: DispatchPayload): string;             // §6.4
export function buildLoadsheetReplyBody(
  p: DispatchPayload, sheet: LoadsheetFigures, issuedAt: string): string;          // §6.4
```

The §5.1 formatters (`hhmm`, `levelText`, `qty`, `unitText`, `clampRoute`,
`field`) also live here. Export them — they are the natural unit-test surface for
`tests/` and are cheap to assert on.

`buildDispatchPayload` is the one function here that imports from
`src/simbrief.ts` (`type ParsedSimbriefPlan` only, `import type`). That is a
type-only edge and keeps `src/acars.ts` free of runtime dependencies.

Nothing is added to `KNOWN_ACARS_CATEGORIES`, `CANNED_MESSAGES`, or
`ACARS_DIRECTIONS` (§9.3).

---

## 8. Client contract — `client/src/pages/AcarsMessages.tsx`

T-003's whole surface. The page is keyed by **flight** id and already reads
`thread.planned_leg_id` into `plannedLegId` state; that value is the `:legId` the
endpoint needs. Only this repo's web client is in scope — the MCDU client lives
in `oshogun/msfslogger_mcdu` and is not touched.

Frozen behaviour:

1. **Placement.** A `REQUEST LOADSHEET` button in the existing `Send` section's
   `.acars-send` row, after the canned-message buttons. Same `btn btn-ghost`
   class; no new CSS.
2. **Gating.** `disabled` when `plannedLegId === null` (the flight is not linked
   to a planned leg, so there is no leg to ask about) or while any send is in
   flight. Rendered, not hidden — a missing button is a mystery, a disabled one
   is an explanation. A `title` naming the reason is welcome.
3. **Request.**
   `apiFetch<LoadsheetRequestResponse>('/api/planned-legs/' + plannedLegId + '/acars-messages/loadsheet', { method: 'POST' })`.
   No body, no `Content-Type` header — the server ignores both (§6.1).
4. **Success.** Merge `response.request` and `response.reply` into the
   `messages` state **by `id`**: replace an entry with the same `id`, append
   otherwise, then keep the array in `sent_at ASC, id ASC` order (the order the
   API returns and the order the existing `[...messages].reverse()` render
   depends on). A blind `push` is wrong here — a re-request returns
   `created: false` with rows already in the list, which would duplicate them and
   collide their React keys (§6.5). This is the one place the load-sheet action
   differs from the existing `handleSend`.
5. **Failure.** `apiFetch` throws `Error(body.error)`, so the 409 arrives as an
   `Error` whose `message` is exactly `NO DISPATCH DATA ON FILE`. Put it in the
   existing `sendError` state and render it through the existing
   `{sendError && <p className="edit-error">…</p>}`. **No client-side mapping,
   no rewording, no prefix** — the user sees the server's phrase. `UnauthorizedError`
   is swallowed exactly as `handleSend` already does.
6. **Busy state.** Reuse the `sendingId` pattern with a sentinel id
   (`'loadsheet'` is fine — it cannot collide with a canned id, which comes from
   the server's fixed set) so the button reads `Requesting…` and every send
   button is disabled while it is in flight.
7. **Rendering the new rows needs nothing new.** Both are `category: 'dispatch'`,
   which `KNOWN_CATEGORIES` in that file already lists and `.badge-acars-dispatch`
   already styles; both directions already map through `directionLabel`
   (`uplink → 'Dispatch'`, `downlink → 'Cockpit'`); and `.acars-msg-body` is
   already `white-space: pre-wrap` + monospace, which is what makes the fixed-field
   columns of §6.4 line up. **T-003 adds no CSS.**

Explicitly **not** in scope for T-003: the trip page's SimBrief import UI. The
import response is unchanged (§9.4, §10), so `TripDetail.tsx` needs no edit.

---

## 9. Alternatives considered

### 9.1 Raw SimBrief body retained in the route, instead of new parser fields

Rejected. The route would need `num()`/`str()` — the coercion that absorbs
SimBrief's string scalars and `{}`-for-empty — either duplicated or exported out
of the parser, and the resulting logic would sit in an express handler where it
cannot be unit-tested. `ParsedSimbriefPlan` already carries an `ofp` node that
`CreatePlannedLegPlan` does not want, so a second such node is a seam the file
already has rather than a new one. Chosen: §3.1.

*What would change this:* if `ParsedSimbriefPlan` were ever consumed somewhere
that rejects unknown properties. It is not — the only consumer is
`createPlannedLeg`, structurally, via a variable.

### 9.2 `dedup_key` keyed on the OFP request id

Rejected. The `dedup_key` column comment offers `'dispatch:ofp:<request_id>'` as
an example, but importing one OFP twice with `allow_duplicates: true` is a
supported action that produces two distinct legs, and an OFP-keyed dedup would
give the second leg no dispatch release — and therefore a load sheet permanently
rejected by §6.2, for a reason the user cannot see or fix. The leg id is unique
per successful import by construction. Chosen: §2.3.

### 9.3 A new `loadsheet` ACARS category

Rejected; all three rows are `category: 'dispatch'`. A new category would mean
coordinated edits in five places — `KNOWN_ACARS_CATEGORIES` (`src/acars.ts`), the
`AcarsCategory` union in **both** `src/types.ts` and `client/src/types.ts`,
`KNOWN_CATEGORIES` in `AcarsMessages.tsx`, and a `.badge-acars-loadsheet` rule in
`index.css` — to buy one badge colour, and it would put the frontend and backend
tasks in each other's files. `label` already distinguishes the three rows and is
already rendered. The category column is open (no `CHECK`), so a later run can
still split them out without a migration if the badge turns out to be wanted.

### 9.4 Returning the dispatch message in the import response

Rejected. `POST /trips/:id/planned-legs/simbrief`'s 201 body stays byte-for-byte
`{ imported, result }`. Adding a key would extend a contract
`client/src/pages/TripDetail.tsx` already types, for a consumer that does not
exist — the user reads the release in the ACARS thread, not in the import
toast — and it would couple the import response's shape to whether a *swallowed*
side-effect happened to succeed (§4.1).

### 9.5 Emitting the release after the response is sent

Rejected. Writing after `res.status(201).json(...)` would create a window where a
client that navigates straight to the thread sees no release. The write is one
local SQLite insert with no network in it; doing it before the response costs
nothing measurable and removes the race. It also keeps the failure path simple:
by the time the 201 is sent, the outcome is already decided and logged.

### 9.6 A `GET` load-sheet endpoint, or one that filed nothing

Rejected. `POST` is correct: the request creates two durable rows. A `GET` that
writes would be a lie to every cache and proxy between the client and the server,
and a read-only load sheet would not satisfy the story, which requires the pair to
appear in the thread. The idempotence of §6.5 is achieved with a dedup key, not by
choosing a safe method.

---

## 10. Must-not-change list

The Reviewer (T-004) checks these one at a time. Each is stated so it can be
falsified.

1. **`POST /api/trips/:id/planned-legs/simbrief`'s success response is
   unchanged** — still `201`, still `{ imported: [<PlannedLegWithChildren>], result: { status: 'imported', planned_leg_id, label, warnings } }`.
   No new key. (§4.1, §9.4)
2. **Its duplicate response is unchanged** — still `200`,
   `{ imported: [], result: { status: 'duplicate', … } }`, and **no ACARS message
   is filed on that path**. Re-running an identical import must add zero
   `acars_messages` rows. (§4.1)
3. **A failure filing the dispatch release cannot change the import's outcome.**
   Force the emission to throw and the import still answers `201` with the created
   leg; only a `console.error` line differs. (§4.1)
4. **`planned_legs`, `planned_waypoints` and `planned_alternates` are written by
   exactly one statement path in that route — `createPlannedLeg` — and nothing is
   moved before it.** (§4.1)
5. **No schema change.** No new table, column, index, or `initDb()` statement; no
   `ALTER`, `UPDATE` or `DELETE` anywhere in this run. The live `flights.db` is
   already at the required schema. (§2.1)
6. **`POST /api/flights/:id/acars-messages` and `GET /api/flights/:id/acars-messages`
   are untouched** — same canned-only validation, same no-dedup behaviour, same
   `AcarsThread` envelope. (§6.1)
7. **`insertAcarsMessage`, `insertAcarsMessageOnce`, `findAcarsMessageByDedupKey`,
   `listAcarsMessagesForFlight` and `listAcarsMessagesForPlannedLeg` are used
   as-is.** No function is added to or changed in `src/db/acarsMessages.ts`. (§4.3)
8. **`ParsedSimbriefPlan` changes are additive only.** No existing field is
   renamed, retyped or removed; `createPlannedLeg` still accepts a
   `ParsedSimbriefPlan` unchanged; the `.lnmpln` import path is untouched. (§3.1)
9. **No unit conversion anywhere.** Every weight and fuel figure is SimBrief's
   own number in SimBrief's own unit. (§1)
10. **`src/acars.ts` still reads no clock, no database, no environment and no
    file.** Every new function there is pure and takes `issuedAt` as a parameter.
    (§2.4, §7.3)
11. **The rejection phrase is exactly `NO DISPATCH DATA ON FILE`**, defined once,
    reaching the user's screen unmodified. (§6.2, §8)
12. **No new CSS class and no change to `client/src/index.css`.** (§8)
13. **No `§`, run id, `design.md`, `plan.json`, task id or amendment reference
    appears in `src/`, `client/src/` or `tests/`.** Where a rule here needs to
    survive in the code, the comment states the reasoning itself. (preamble)
14. **The user's running server on port 3000 and the live `flights.db` are not
    touched.** All verification runs on a scratch port against a copy. (`.claude/ENVIRONMENT.md`)

---

## 11. Risks

1. **One real OFP.** Every field path in §3.2 is verified against exactly one
   captured plan — a King Air 200, `units: "kgs"`, **no alternate**, one pilot's
   account. A jet OFP, an OFP in `lbs`, or one with two alternates exercises paths
   no fixture covers. *Mitigated by:* every field nullable, no field able to reject
   a plan (§3.3 rule 1), `arr()` already handling the one-vs-many collapse, and the
   `ALTN NONE` / `----` / `UNITS UNKNOWN` fallbacks. *Falsified by:* an OFP where a
   fuel or weight field is a nested object rather than a scalar string.
2. **`weights.payload` is SimBrief's, not the sim's.** It reflects what the user
   configured on simbrief.com, which may bear no relation to what they load in
   MSFS. The story explicitly accepts this ("placeholder/estimated payload"), and
   both bodies say so in their last line — but a user who reads the sheet as
   authoritative is a real support question. *Falsified by:* the user asking why
   the load sheet disagrees with the aircraft's payload manager.
3. **Legs imported before this run have no dispatch release**, so their load-sheet
   request is rejected with `NO DISPATCH DATA ON FILE` — correctly, but possibly
   surprisingly, since the leg visibly *has* an imported SimBrief plan. No
   backfill is possible: the figures were never stored and re-fetching is
   forbidden. *Mitigated by:* the rejection phrase being about *dispatch data*,
   not about the plan.
4. **`payload_json` is a schema with no migration story.** `v: 1` and the strict
   version check in §4.3 mean a future shape change makes old rows read as "no
   dispatch data" rather than crash — acceptable, and better than a silent
   misparse, but it is a real behaviour change for old legs. Any future version
   bump must decide whether to read v1 as well.
5. **Idempotence is a product decision** (§6.5). If the user expects a second
   press to file a second sheet the way `REQUEST PUSHBACK` does, this is wrong —
   but it is cheaply reversible: drop the two `loadsheet*DedupKey` calls and
   switch to `insertAcarsMessage`. Nothing else in the design depends on it except
   §8's merge-by-id, which is harmless either way.
6. **Route-length guard is untested against a real long route.** `clampRoute`'s
   900-character cap is arithmetic, not measurement — the one real route is 73
   characters. *Falsified by:* a 4096-character body rejection in production,
   which would mean some other line is unbounded.

---

## 12. What was verified, and how

### 12.1 SimBrief field paths, against the real capture

```
$ python3 -c "import json; d=json.load(open('samples/simbrief/simbrief.userid.json')); print(d['fuel'], d['times'], d['weights'])"
```

Confirmed present, all as **strings** (there is not one JSON number in the
document): `fuel.taxi=82`, `enroute_burn=872`, `contingency=65`,
`alternate_burn=0`, `reserve=222`, `plan_takeoff=1159`, `plan_ramp=1241`,
`plan_landing=287`; `times.est_time_enroute=12033`, `est_block=13713`;
`weights.oew=3869`, `pax_count=7`, `cargo=86`, `payload=642`, `est_zfw=4511`,
`max_zfw=4990`, `est_tow=5670`, `est_ldw=4798`. Also `params.units="kgs"`,
`aircraft.reg="N201SB"`, `general.initial_altitude="28000"`,
`general.route="SAMI4L SAMIK T577 UB P176 NAMUL P175 ROMUK R810 BELNA DCT LEKPA LEKP4V"`,
and `alternate = {}` — the plan was filed with **no** alternate.

Every rule in §3.2, §4.2, §5.2, §6.3 and §6.4 was then run end to end against
that file, using `str`/`num` copied verbatim from `src/simbrief.ts`:

```
$ export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
$ npx ts-node --compiler-options '{"module":"commonjs"}' \
    .claude/runs/2026-09-14-acars-dispatch-loadsheet/prototypes/dispatch-loadsheet.ts
```

Full output saved at `prototypes/output.txt`. Results: `payload_json` 651 chars,
dispatch body 316 chars, load-sheet reply 389 chars — all far under the 4096
`MAX_ACARS_BODY_LENGTH` ceiling. The rendered bodies in §5.2 and §6.4 are that
run's literal output, not hand-written examples. **No network call was made; the
fixture is read read-only.**

### 12.2 `insertAcarsMessageOnce` dedup semantics, against SQLite 3.45.3

The load-bearing assumption behind §2.3 and §6.5 was checked against a real
in-memory database carrying the real DDL and the real partial unique index — not
against the function's doc comment:

```
$ node -e "…INSERT … ON CONFLICT(dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING…"
first changes= 1   second changes= 0
rows: [ { id: 1, body: 'BODY A', dedup_key: 'dispatch:leg:42' } ]
thread order: [ '1:DISPATCH', '3:REQ', '4:LOADSHEET' ]
sqlite { v: '3.45.3' }
```

Three facts this establishes:

1. A second insert under the same key writes **nothing** and reports
   `changes === 0` — no throw, no second row. `insertAcarsMessageOnce` then
   re-reads by key and returns the original with `created: false`. AC1 holds as a
   database guarantee.
2. **Ids are not contiguous**: the suppressed insert consumed rowid 2, so the
   request/reply pair came back as 3 and 4. The reply's `correlation_id` must be
   taken from the row the request insert returns (§2.2), never computed.
3. With both rows sharing a `sent_at`, `ORDER BY sent_at ASC, id ASC` still puts
   the request before the reply (§2.4).

### 12.3 Client rendering assumptions

Read directly from the checked-in files rather than assumed:
`client/src/index.css:976` — `.acars-msg-body { white-space: pre-wrap; …
font-family: ui-monospace… }`, so §6.4's fixed-field columns render aligned;
`:983` — `.badge-acars-dispatch` exists, so §9.3's "no new CSS" holds;
`client/src/utils/api.ts:32` — `throw new Error(body.error || res.statusText)`,
so §6.2's `error` string reaches `sendError` verbatim;
`client/src/pages/TripDetail.tsx:729` — import warnings render by `message` only
and never switch on `code`, so §3.3's new warning code needs no client change.

### 12.4 What was not prototyped

- The endpoint itself. No scratch server was started for this freeze — the route
  does not exist yet, and every contract it depends on (dedup semantics, field
  paths, body lengths, client error surfacing) was verified independently above.
  T-002's acceptance criteria cover it against a scratch server on a non-3000
  port with a copied database.
- An OFP in `lbs`, a jet OFP, or one with two alternates. No such fixture exists
  in this repo. See §11 risk 1.
