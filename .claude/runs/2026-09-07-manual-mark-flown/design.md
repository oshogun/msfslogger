# Design freeze — mark a hand-linked planned leg flown by hand

Run: `2026-09-07-manual-mark-flown`
Covers: **T-001**. Freezes the contracts that T-002 (`src/plannedLegClose.ts` +
its inspector), T-003 (`src/db.ts` writer), T-004 (`src/server.ts` endpoint),
T-006 (`client/src/pages/FlightDetail.tsx`) and T-007 (`README.md`) execute
without a second architectural decision.

Amends, in place and with section numbering unchanged,
`.claude/runs/2026-09-04-lnmpln-trip-planner/design.md` §12.3, §14 and §15
(see its **Amendment D — 2026-09-07**). Read that document's §12, §14, §15 and
§20 alongside this one; this design narrows two of its rules and leaves
everything else standing.

Companion files:

- `contracts/plannedLegClose.d.ts` — the pure module's exported signatures.
- `contracts/db-additions.d.ts` — the two new `src/db.ts` exports.
- `contracts/api.http` — the endpoint's request/response shapes, every status
  code, with a real example body per case.
- `prototypes/deviation-recompute.js` — the load-bearing measurement (§2).
- `prototypes/haversine-parity.js` — the second load-bearing measurement (§3).

Contracts are reference artifacts. They are **not** wired into the build.

---

## Amendments

Convention, per the workflow: when reality contradicts a frozen section after
this point, the section is edited **in place** with its number unchanged, and a
row is added here naming the section, the change, and the evidence that forced
it.

| Amendment | Date | Section | Change | Evidence |
|---|---|---|---|---|
| A | 2026-09-07 | §0, M-10 | The must-not-change list named `src/types.ts` and `client/src/types.ts` as untouched. Both received a **comment-only** edit: the `PlannedLegStatus` doc-comment said "'flown' and 'diverted' are set by the system only", which this run made false. The union, the types and every other line are byte-identical. | phase-2 finding N-2; ship-gate F-1. Proof: stripping comment lines makes both files byte-identical to HEAD; `.claude/runs/2026-09-04-lnmpln-trip-planner/tools/check-type-mirror.js` reports `No drift.` (EXIT=0) (reviews/ship.md §2). |
| B | 2026-09-07 | §5.4 | The "normative" handler shape is departed from twice, both wire-invisible. (1) `res.json()` sits **inside** the `try`, because §5.4's `catch`→500 arm does not return and the literal shape would double-send; both neighbouring handlers already do it this way. (2) The leg is re-read into `saved` and a `console.log` emitted **between** steps 6 and 7. | ship-gate F-2 and phase-1 N-1. Neither changes a status code or a body: phase-1 verified the 500 arm sends once; ship-gate reproduced both log lines and 5 refusals emitting none (reviews/ship.md §3). |
| C | 2026-09-07 | §5.4, §6.4 | The handler emits one `console.log` on success. The design specified none, so the hand path was silent while its automatic twin (`flightManager.ts:465`) announces every close — a leg reading 'flown' with a deviation and no log line was unexplainable in the field. | DevOps ship report N-2; implemented by the Orchestrator, reviewed at the ship gate. Both directions reproduced verbatim; the §3.3 NULL-arrival branch prints '(arrival position unknown)' and does not throw (reviews/ship.md §3). |

---

## 0. What is frozen, in one paragraph

A new flight-scoped endpoint, `PUT /api/flights/:id/planned-leg-status`, accepts
`{"status": "flown"}` or `{"status": "planned"}`. It is allowed on exactly two
transitions and refuses everything else with a 409: a **manually** linked,
**ended** flight whose leg is `planned` may be marked `flown` (recording
`arrival_deviation_nm` measured from `flights.arrival_lat/arrival_lon` to the
leg's destination), and the same pair with the leg at `flown` may be returned to
`planned` (clearing `arrival_deviation_nm`, keeping the link). `diverted` and
`skipped` legs are refused in both directions; `auto` links are refused; flights
still in the air are refused. `PATCH /api/planned-legs/:legId` and
`setPlannedLegStatus()` are not touched at all, so finding F-1's 409 survives
byte-for-byte outside this gate. Prior design §15 gains a sixth state name,
**`unclosed`** (`status='planned'` + a linked flight that has ended), for the row
this feature moves — a state that already existed and had no name (§1.6).
No schema migration. No new dependency. No change to `src/types.ts` or
`client/src/types.ts`.

---

## 1. The gate

### 1.1 The predicate, both directions

Over four named columns — `flights.planned_leg_id`,
`flights.planned_leg_link_source`, `flights.end_time`, `planned_legs.status` —
where `leg` is the row `planned_legs.id = flights.planned_leg_id`:

```
LINKED       := flight.planned_leg_id IS NOT NULL AND leg EXISTS
HAND_LINKED  := LINKED AND flight.planned_leg_link_source = 'manual'
ENDED        := flight.end_time IS NOT NULL

allow(request = 'flown')   := HAND_LINKED AND ENDED AND leg.status = 'planned'
allow(request = 'planned') := HAND_LINKED AND ENDED AND leg.status = 'flown'
```

Nothing else is allowed. `arrival_lat` / `arrival_lon` are deliberately **not**
in the predicate: they decide the deviation (§3), never the permission.

### 1.2 Refusal order (normative)

Several refusals can apply to one request. The reason reported is the **first**
that matches, in this exact order. T-002's inspector and the 24-row table below
both depend on it.

1. `NOT LINKED` — `flight.planned_leg_id IS NULL` → **409**
2. *(leg row missing although `planned_leg_id` is set)* → **404** (see §1.5)
3. `LINK_NOT_MANUAL` — `planned_leg_link_source <> 'manual'` (i.e. `'auto'` or
   `NULL`) → **409**
4. `FLIGHT_NOT_ENDED` — `end_time IS NULL` → **409**
5. `LEG_NOT_PLANNED` — request is `'flown'` and `leg.status <> 'planned'` → **409**
   `LEG_NOT_FLOWN` — request is `'planned'` and `leg.status <> 'flown'` → **409**
6. otherwise **allow**.

So an `auto`-linked flight still in the air reports `LINK_NOT_MANUAL`, not
`FLIGHT_NOT_ENDED`. The order runs from the most structural fact to the most
mutable one, which is also the order that gives the most useful message.

### 1.3 The 24-row truth table

Every combination of link source `{manual, auto, null}` × flight
`{ended, in air}` × leg status `{planned, flown, diverted, skipped}`. All rows
assume `flights.planned_leg_id IS NOT NULL` and the leg row exists; the two
cases outside that assumption are §1.5. Each row gives the verdict for **both**
directions. Refusal codes are §1.2's; every refusal is HTTP **409**.

| # | link_source | flight | leg.status | → `'flown'` | → `'planned'` | reachable today? |
|---|---|---|---|---|---|---|
| 1 | manual | ended | planned | **ALLOW** (deviation per §3) | 409 `LEG_NOT_FLOWN` | yes — flight 56 → leg 12 |
| 2 | manual | ended | flown | 409 `LEG_NOT_PLANNED` | **ALLOW** (deviation → NULL) | yes — flights 47 → leg 4, 52 → leg 10 |
| 3 | manual | ended | diverted | 409 `LEG_NOT_PLANNED` | 409 `LEG_NOT_FLOWN` | yes (no live row) |
| 4 | manual | ended | skipped | 409 `LEG_NOT_PLANNED` | 409 `LEG_NOT_FLOWN` | yes (no live row) |
| 5 | manual | in air | planned | 409 `FLIGHT_NOT_ENDED` | 409 `FLIGHT_NOT_ENDED` | yes — hand-link while flying (§15) |
| 6 | manual | in air | flown | 409 `FLIGHT_NOT_ENDED` | 409 `FLIGHT_NOT_ENDED` | no (see §1.4) |
| 7 | manual | in air | diverted | 409 `FLIGHT_NOT_ENDED` | 409 `FLIGHT_NOT_ENDED` | no |
| 8 | manual | in air | skipped | 409 `FLIGHT_NOT_ENDED` | 409 `FLIGHT_NOT_ENDED` | yes — hand-link a skipped leg while flying |
| 9 | auto | ended | planned | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no (see §1.4) |
| 10 | auto | ended | flown | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | yes — flights 48–51, 53 |
| 11 | auto | ended | diverted | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | yes (no live row) |
| 12 | auto | ended | skipped | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 13 | auto | in air | planned | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | yes — every auto-matched flight in progress |
| 14 | auto | in air | flown | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 15 | auto | in air | diverted | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 16 | auto | in air | skipped | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 17 | null | ended | planned | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no (see §1.4) |
| 18 | null | ended | flown | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 19 | null | ended | diverted | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 20 | null | ended | skipped | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 21 | null | in air | planned | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 22 | null | in air | flown | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 23 | null | in air | diverted | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |
| 24 | null | in air | skipped | 409 `LINK_NOT_MANUAL` | 409 `LINK_NOT_MANUAL` | no |

**Two allow cells out of forty-eight.** That is the narrowing, stated as a
number: this feature adds exactly one forward transition and exactly one
reverse transition to the state machine, and refuses the other forty-six.

**On the `reachable today?` column.** It records whether ordinary use of the app
can produce the row; it is *not* part of the contract and T-002 must synthesize
and check every row regardless. Rows 17–24 (`link_source IS NULL` with a
non-null `planned_leg_id`) cannot arise, because `linkFlightToPlannedLeg()`
(`src/db.ts:1207`) always writes `source`, and every unlink path nulls the three
`planned_leg_*` columns together. They are in the table because
`client/src/pages/FlightDetail.tsx:290` already renders a `'Linked.'` fallback
for exactly that shape, so the codebase already concedes it is representable,
and a gate that crashed or allowed on it would be worse than one that refuses.

### 1.4 Rows the reader will want explained

- **Row 6/14/22 (`in air` + `flown`)** cannot arise: `status` only becomes
  `'flown'` in `recordArrivalOnPlannedLeg()`, which runs inside `endFlight()`
  after `closeFlight()` has written `end_time` (`src/flightManager.ts:284`,
  `:304`), and in the new writer of §4, whose gate demands `ENDED`.
- **Row 8 (`in air` + `skipped`)** is reachable: `linkFlightToPlannedLeg()` does
  not inspect `planned_legs.status`, so a `skipped` leg can be hand-linked to a
  flight in progress. Prior design §15 already calls that combination
  contradictory and refuses to fix it through status; this design does not
  change that.
- **Row 9 (`auto` + `ended` + `planned`)** cannot arise through the app: an
  auto-linked flight always passes through `endFlight()`, which sets `'flown'`
  or `'diverted'`. It is in the table because a crash between `closeFlight()`
  and `recordPlannedLegArrival()` would leave exactly this row, and the answer
  must not be "the user can now repair it by hand" — an `auto` link is out of
  scope in every direction, and the remedy stays Unlink.
- **Row 12/16/20 (`skipped` reached under an `auto` link)** cannot arise:
  `autoLinkPlannedLeg()` links only legs the matcher accepted, and step 5
  refuses `skipped` candidates.

### 1.5 The two cases outside the grid

| Case | → `'flown'` | → `'planned'` | Body |
|---|---|---|---|
| `flights.planned_leg_id IS NULL` | 409 `NOT_LINKED` | 409 `NOT_LINKED` | `{"error":"Flight 56 is not linked to a planned leg"}` |
| `planned_leg_id` set, `getPlannedLegById()` returns undefined | **404** | **404** | `{"error":"Planned leg not found"}` |

The second is unreachable — `flights.planned_leg_id` carries
`ON DELETE SET NULL` — but the handler must answer rather than dereference
`undefined`. 404 rather than 409 because the *named resource* genuinely does not
exist, which is the distinction `PUT /api/flights/:id/planned-leg` already draws
at `src/server.ts:637`.

### 1.6 The state the two allow cells move between has a name now

Prior design §15 listed five user-visible states and had **no name** for
`status='planned'` + a linked flight that has **ended** — which is precisely the
stuck row this feature exists for, and which has existed since the escape hatch
shipped. Amendment D adds it as **`unclosed`** (`status='planned'`, linked
flight with `end_time IS NOT NULL`), with the two transitions it was missing:

```
unclosed --[PUT … {status:'flown'}]--> flown --[PUT … {status:'planned'}]--> unclosed
```

Row 1 of §1.3 is `unclosed → flown`; row 2 is `flown → unclosed`. `unclosed` is
derived from three facts already stored (status, the link, `end_time`) and adds
no column — the same construction that keeps `linked` from drifting.

**Closure claim, for T-005's question.** No sequence of calls to this endpoint
can produce a state prior design §15's amended table does not define. The
endpoint writes only `planned_legs.status ∈ {'flown','planned'}` and
`arrival_deviation_nm`, and only on a row that is already linked to an ended,
hand-linked flight. The reachable states of such a row are exactly `unclosed`
(status `planned`) and `flown` (status `flown`), both defined. It never writes
`'diverted'` or `'skipped'`, never touches any column on `flights`, and cannot
run at all on an unlinked leg or an in-air flight (§1.3 rows 5–8, and the
writer's atomic re-check, §4.3).

### 1.7 Why `diverted` is excluded, in both directions

Prior design §14 is explicit that "Unlinking resets it to `planned` and clears
`arrival_deviation_nm`, which is how the user reopens it", and §15's transition
table names unlink as the only route out of `diverted`. This design does not
touch that.

Three reasons, in decreasing order of weight:

1. **`diverted` is a judgement, not just a number.** `flown` versus `diverted`
   is `deviation <= ARRIVAL_RADIUS_NM` evaluated at the real touchdown frame.
   Allowing the hand path to write `flown` over a `diverted` leg would let a
   one-click toggle launder a diversion into an on-plan arrival, erasing the one
   visible record that the flight did not arrive where it was planned to.
2. **The frozen user decision covers `flown` ↔ `planned` only.** The
   Orchestrator's envelope states `'diverted'` stays system-only. Designing a
   third transition here would be inventing scope.
3. **The round-trip identity of §2 does not hold for `diverted`.** Reopening a
   `diverted` leg and re-marking it would produce `flown` — because the hand
   path never writes `diverted` (§3, frozen) — so the round trip would *change*
   the record. Every transition this gate allows is one whose round trip is the
   identity. `diverted` is the only status where that would be false, and
   excluding it is what keeps the theorem true.

The user is not blocked: unlink is still there, still one click, still
documented. It is simply the operation that says out loud that the record is
being discarded.

### 1.8 Why `skipped` is excluded, and what happens to a skipped-and-hand-linked leg

**Nothing changes.** A `skipped` leg with a linked flight is refused today by
`setPlannedLegStatus()` with `PlannedLegHasLinkedFlightError` (409), and it is
refused by this gate too (rows 4, 8, 12, 16, 20, 24). The user's route is
unchanged and is the one prior design §15 already documents: unlink first, which
resets the leg to `planned`, then re-link, then mark flown.

This is the answer to `plan.json`'s open question 2. It was genuinely open —
allowing `skipped → flown` would resolve a state §15 itself calls contradictory,
using the same evidence the forward transition already uses, and would save the
user two clicks. It is refused because:

- Zero live rows are in it (`select status, count(*) from planned_legs group by
  status` returns `flown 7, planned 1` — §12, command E3), so it buys nothing
  today and costs a permanently wider gate.
- Every extra source status is another cell where the client predicate (§8) and
  the server gate can drift apart, and the client predicate has no compiler link
  to the server.
- The remedy that exists is not destructive for a `skipped` leg: there is no
  `arrival_deviation_nm` on it to lose, so unlink-then-relink loses exactly the
  `skipped` flag, which is the flag the user is trying to discard anyway.

---

## 2. The system-closed manual link — flights 47 and 52, resolved by name

### 2.1 The problem

`flights.planned_leg_link_source = 'manual'` does **not** mean "this leg was
closed by hand". Prior design §15 deliberately supports linking a flight to a
leg **while it is still in the air**, and `recordArrivalOnPlannedLeg()` reads the
link from the flight row at touchdown precisely so that works
(`src/flightManager.ts:437-443`, comment: *"The user can link or unlink a flight
from the UI while it is still in the air (§15), and the row is the only thing
that knows about it"*). Such a leg is then closed by `endFlight()` with a **real
touchdown measurement**.

The live logbook contains two of them:

```
flight 47 -> leg 4   manual, ended, leg 'flown', arrival_deviation_nm 0.4  (KSFO)
flight 52 -> leg 10  manual, ended, leg 'flown', arrival_deviation_nm 0.8  (CYVR)
```

Under the gate of §1, row 2, both become reversible by hand, and reversing them
sets `arrival_deviation_nm = NULL` — clearing a number the system measured.
Structurally that is the shape of finding F-1. It has to be justified or
excluded; it cannot be left implicit.

### 2.2 The resolution: accepted, because the reversal is provably lossless

**Accepted. No new column, no migration.** The justification is a specific claim
with a specific falsifier, proved in three parts.

**Lemma 1 — the stored arrival position is the same frame the deviation was
measured from.** In `endFlight(frame)` (`src/flightManager.ts:270-312`):

- line 284–296: `closeFlight(this.currentFlightId, endTime, frame.lat, frame.lon, …)`
  writes `flights.arrival_lat` / `arrival_lon` (`src/db.ts:321-345`);
- line 304: `this.recordArrivalOnPlannedLeg(this.currentFlightId, frame)` — the
  **same `frame` binding**, in the same synchronous block;
- line 458: `haversineNm(frame.lat, frame.lon, leg.destination_lat, leg.destination_lon)`.

`frame` is a parameter and is never reassigned in the body — verified,
§12 command E4. So `flights.arrival_lat/arrival_lon` are not an approximation of
the measurement input: they *are* the measurement input.

**Lemma 2 — the hand path can use byte-identical arithmetic.** The `haversineNm`
in `src/geo.ts:23-30` and the private copy at `src/flightManager.ts:19-26` have
byte-identical bodies (diff, §12 command E5: the only differing line is the
signature, `export` and the `// nautical miles` comment). Identical source is not
by itself identical doubles, so it was measured: `prototypes/haversine-parity.js`
evaluates both copies on the eight live linked pairs and eight adversarial pairs
(antimeridian, poles, antipodal, sub-nm, degenerate) and requires `Object.is()`
on the **raw double** and on the rounded value. **16 pairs, 0 divergences**
(§12 command E2). The rounding expression is fixed character-identically in §3.

**Lemma 3 — empirically, the recompute reproduces every stored value.**
`prototypes/deviation-recompute.js` recomputes
`Math.round(haversineNm(flights.arrival_lat, flights.arrival_lon,
planned_legs.destination_lat, planned_legs.destination_lon) * 10) / 10` for all
eight linked pairs in the live logbook and compares against the stored
`arrival_deviation_nm`. **7 of 7 closed legs match exactly**, including both
manual ones (0.4 and 0.8); the eighth, the stuck case, has no stored value and
would recompute to **0.3**. Actual output in §12, command E1. Exit code 0.

**The theorem.** For every row the gate admits, the round trip is the identity on
`(planned_legs.status, planned_legs.arrival_deviation_nm)`:

```
(flown, d) --[→planned]--> (planned, NULL) --[→flown]--> (flown, d')   and d' = d
```

`d' = d` because the leg's `destination_lat/lon` are immutable for the leg's
lifetime and the flight's `arrival_lat/lon` are immutable once `end_time` is set
(the only writer of those columns is `closeFlight()`, which runs once per
flight; `updateFlight()` permits only `aircraft` and `notes` —
`src/db.ts:350-361`). Lemmas 1–3 then give bit-equality, not approximate
equality. The status side is the identity because `flown` is the only reopenable
status (§1.7) and the forward transition always writes exactly the requested
status (§3.4).

**Therefore F-1's rationale does not apply inside this gate.** F-1's argument, in
prior design §15, is that the only route out of `flown`/`diverted` is unlink
"which clears the deviation precisely because the link is going away with it" —
i.e. the deviation may only be destroyed together with the thing that gives it
meaning. Inside this gate the deviation is not destroyed; it is *derivable*, from
columns on rows this operation does not touch, by an expression this design
fixes character for character. Outside this gate — every `auto` link, every
unlinked leg, every `diverted` or `skipped` leg — `setPlannedLegStatus()` and its
409 are untouched and F-1 stands exactly as written.

### 2.3 What would falsify this

Named here so the Reviewer can check for it rather than re-derive it:

- Any future writer of `flights.arrival_lat` / `arrival_lon` after `end_time` is
  set. `updateFlight()`'s two-field allowlist is the current guarantee; it is
  must-not-change item M-7.
- Any future writer of `planned_legs.destination_lat` / `destination_lon`
  (re-import is an INSERT of new legs, not an UPDATE of these — prior design
  §9.1). Must-not-change item M-8.
- The hand path diverging from `Math.round(x * 10) / 10` or from
  `haversineNm` (§3.2, must-not-change item M-6).
- `combineFlights()` producing a flight whose `arrival_lat` is NULL while
  `end_time` is set (§3.3). This does **not** break the theorem — the round trip
  on such a row is `(flown, NULL) → (planned, NULL) → (flown, NULL)`, still the
  identity — but it is the one row where the recompute yields NULL rather than a
  number, and it is why §3.3 exists.

### 2.4 The alternative that was rejected, and its price

Excluding rows like flights 47 and 52 requires distinguishing "closed by
`endFlight()`" from "closed by hand", which is a fact the schema does not record.
It needs a new column (e.g. `planned_legs.close_source TEXT CHECK (close_source
IN ('system','hand'))`, nullable, backfilled `'system'` for every non-null
`arrival_deviation_nm`). That converts a no-migration run into a migration on
the user's live logbook, and it buys protection against a loss that §2.2 shows
does not occur. Rejected on that ratio. Recorded here so that if §2.3's
falsifier ever fires, the fix is already specified rather than rediscovered.

---

## 3. Deviation

### 3.1 Source columns

`flights.arrival_lat` and `flights.arrival_lon` — **never** the last
`flight_points` row, and never a fresh `SimFrame`. Reason: those two columns are
written by `closeFlight()` (`src/db.ts:321`) from exactly the frame
`recordArrivalOnPlannedLeg()` measures from (§2.2, Lemma 1), which is what makes
the hand value and the system value the same number. The last `flight_points`
row is a *different* sample — points are written at most every 5 s
(`RECORD_INTERVAL_MS`, `src/flightManager.ts:11`) and `endFlight()` explicitly
accounts for the tail interval between the last point and touchdown — so reading
it would produce a deviation that disagrees with the one an auto-close produced
for the same flight.

Destination: `planned_legs.destination_lat` / `destination_lon`, both
`REAL NOT NULL`.

### 3.2 The expression, frozen character for character

```ts
Math.round(haversineNm(flight.arrival_lat, flight.arrival_lon,
                       leg.destination_lat, leg.destination_lon) * 10) / 10
```

`haversineNm` is the export of `src/geo.ts`. The rounding is
`Math.round(deviationNm * 10) / 10` — character-identical to
`src/flightManager.ts:463`. Not `toFixed(1)`, not `Number(x.toFixed(1))`, not a
`round(x, 1)` helper. Argument order is `(arrivalLat, arrivalLon, destLat,
destLon)`, matching `src/flightManager.ts:458`.

`src/plannedLegClose.ts` must **not** import or reference `ARRIVAL_RADIUS_NM`.
A grep for it in that file returning nothing is part of the review (M-5).

### 3.3 When `arrival_lat` or `arrival_lon` is NULL

**Policy: store `arrival_deviation_nm = NULL` and still set the requested
status.** The status is the fact; the deviation is a measurement attached to it.

Concretely, `handCloseDeviationNm()` returns `null` when either coordinate is
`NULL`, and the endpoint writes `NULL`. The leg reads `Flown` with no
"N nm from plan" note, because `plannedLegLandingNote()` returns `null` when
`arrival_deviation_nm == null` (`client/src/components/PlannedLegRows.tsx:44`) —
which is exactly how every leg imported before the planned-leg phase already
renders. No client change is needed for this branch.

Why not refuse: a refusal would create a leg that can never be closed by any
route at all — unlink does not help, since the arrival position is a property of
the flight. And refusing would contradict the frozen decision that the status the
user asked for is always the status that gets stored.

**Reachability, stated honestly.** Zero live rows exercise it:
`select count(*) from flights where end_time is not null and arrival_lat is null`
returns **0** (§12, command E3). But it is **not** code-only. `combineFlights()`
(`src/db.ts:670-688`) inserts the combined flight with
`arrival_lat = second.arrival_lat` and
`end_time = second.end_time ?? <last point ts> ?? …`, so combining an ended
flight with one that was never closed produces an **ended flight with a NULL
arrival position**. That flight has no leg link (`combineFlights` calls
`clearPlannedLegLink()` on both sources and does not carry the link over — prior
design §16), so the user's next move is exactly the hand link this feature
serves. T-002's inspector must cover it with a synthetic row; the design does not
claim it is unreachable.

### 3.4 The status is always the one requested — verbatim from the frozen decisions

> **DEVIATION**: compute `arrival_deviation_nm` from the linked flight's arrival
> position against the planned destination, store it, and ALWAYS set the status
> the user asked for. A hand-mark beyond `ARRIVAL_RADIUS_NM` is still `'flown'`,
> never `'diverted'`.

So a hand-mark whose recomputed deviation is 120 nm stores
`status = 'flown', arrival_deviation_nm = 120.1`. The touchdown rule of prior
design §14 is deliberately **not** mirrored here, and `'diverted'` never appears
as an output of any function this design adds. `ARRIVAL_RADIUS_NM` appears
nowhere in the new code (M-5).

On the reverse direction the deviation is not recomputed and not preserved: it is
written to `NULL`, unconditionally, in the same UPDATE as the status.

---

## 4. Persistence

### 4.1 No migration

`planned_legs.status` already carries
`CHECK (status IN ('planned','flown','diverted','skipped'))` (`src/db.ts:101-102`)
and `arrival_deviation_nm` already exists and is already nullable. This feature
writes only values the existing constraint already admits, into columns that
already exist. **The DDL and the `ALTER TABLE` block in `initDb()` are not
touched**, which is must-not-change item M-1 and is checkable as a diff.

Nothing in this run is destructive on a database holding real rows: the only
writes are one UPDATE of two columns on one `planned_legs` row, both of which
already change under `endFlight()` and `unlinkFlightFromPlannedLeg()` today.

### 4.2 The writer

One new function in `src/db.ts`, additive:

```ts
export function setPlannedLegHandOutcome(
  legId: number,
  status: 'planned' | 'flown',
  deviationNm: number | null
): boolean;
```

Body shape (normative):

```
db.transaction(() => {
  row := SELECT l.id,
                (SELECT f.id                      FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id,
                (SELECT f.planned_leg_link_source FROM flights f WHERE f.planned_leg_id = l.id) AS link_source,
                (SELECT f.end_time                FROM flights f WHERE f.planned_leg_id = l.id) AS end_time
           FROM planned_legs l WHERE l.id = ?
  if !row                          -> return false
  if row.linked_flight_id IS NULL  -> throw PlannedLegHandCloseConflictError(legId, 'it has no linked flight')
  if row.link_source <> 'manual'   -> throw PlannedLegHandCloseConflictError(legId, 'its flight was not linked by hand')
  if row.end_time IS NULL          -> throw PlannedLegHandCloseConflictError(legId, 'its flight has not ended')
  result := UPDATE planned_legs SET status = ?, arrival_deviation_nm = ? WHERE id = ?
  return result.changes > 0
})()
```

Both columns move in **one** UPDATE inside **one** `db.transaction()`. The
function re-reads nothing else and returns nothing else; the endpoint fetches the
payload it wants afterwards.

New error class in `src/db.ts`, alongside the two that exist:

```ts
export class PlannedLegHandCloseConflictError extends Error {
  constructor(readonly legId: number, readonly detail: string) {
    super(`Planned leg ${legId} cannot be closed by hand: ${detail}`);
    this.name = 'PlannedLegHandCloseConflictError';
  }
}
```

### 4.3 Why the writer re-checks three things the endpoint already checked

This is not a duplicated gate; it is an **atomic re-assertion of the persistent
invariants**, and it exists for two reasons.

*Amendment C's rule* in the prior design says a guard belongs at the layer every
caller passes through, and cites F-2 going into `linkFlightToPlannedLeg()`
because `FlightManager` calls it directly. Here the caller set is exactly one —
the endpoint — and `FlightManager` will never call this function (it closes legs
through `recordPlannedLegArrival()`). But "one caller" is a fact about today, and
the cheap part of the gate is three columns this transaction has to read anyway.

*The race it closes*: the endpoint reads the flight and the leg, decides, then
writes. Between the read and the write, a concurrent
`PUT /api/flights/:id/planned-leg {plannedLegId: null}` could unlink the flight.
The write would then land `status = 'flown'` on a leg with no linked flight — a
state prior design §15 does not define and that nothing else in the codebase can
produce. Re-reading inside the transaction removes the window.

What the writer deliberately does **not** re-check is the leg's own current
status. That is the policy half of the decision, it lives in
`src/plannedLegClose.ts`, and re-checking it here would duplicate the one part of
the gate that is a judgement rather than an invariant. The consequence is that a
double-click can write `flown` over `flown` with the same deviation — idempotent,
harmless, and preferable to two copies of the transition rule.

### 4.4 What is not touched in `src/db.ts`

`setPlannedLegStatus()` (`:1088-1106`), `PlannedLegHasLinkedFlightError`
(`:1006-1012`), `recordPlannedLegArrival()` (`:1318-1322`),
`unlinkFlightFromPlannedLeg()` (`:1259+`), `clearPlannedLegLink()` (`:1284+`),
`linkFlightToPlannedLeg()` (`:1207+`) and the `planned_legs` DDL. Zero lines.
M-1 through M-4.

---

## 5. API

### 5.1 The surface

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `PUT /api/flights/:id/planned-leg-status` | `{ "status": "flown" \| "planned" }` | `200` — the updated `PlannedLegWithChildren`, i.e. `getPlannedLegById(legId)`, matching `PATCH /api/planned-legs/:legId`'s payload | see §5.3 |

### 5.2 Why flight-scoped, not a widened leg PATCH

This answers `plan.json`'s open question 3. Both were viable.

1. **The gate's subject is the flight.** Three of the four gate columns
   (`planned_leg_link_source`, `end_time`, and — for the deviation —
   `arrival_lat`/`arrival_lon`) live on `flights`. A leg-scoped route would have
   to walk the link backwards (`SELECT f.* FROM flights f WHERE
   f.planned_leg_id = ?`) just to find its own inputs, and prior design §12.1 is
   explicit that the leg's side of the link is derived, never stored. The URL
   should name the row that decides the answer.
2. **It leaves `PATCH /api/planned-legs/:legId` byte-for-byte unchanged.** That
   is the strongest possible evidence that F-1 did not regress: the handler's
   source is identical, so T-004's four differential requests cannot diverge for
   any reason internal to this run. Widening the PATCH would put the new gate
   inside the exact handler F-1 was found in, and every review from here on would
   have to re-derive that the old paths still work rather than diff them.
3. **It matches the existing vocabulary.** `PUT /api/flights/:id/planned-leg`
   (prior design §12.3) is already the flight-scoped mutation of *which* leg a
   flight claims. This is the flight-scoped mutation of *how that leg turned
   out*. Same subject, adjacent path, same `PUT`-with-a-complete-value shape as
   `PUT /api/active-trip`.
4. **`PUT`, not `PATCH`.** The body carries the complete new value of a single
   named sub-resource and the operation is idempotent (`{"status":"flown"}` twice
   leaves the same row). Both neighbours that behave this way are `PUT`.

### 5.3 Status codes and exact error bodies

Every error body is `{"error": "<text>"}` — the shape every handler in
`src/server.ts` already uses. Message texts are frozen; T-002's inspector and
T-004's curl matrix both assert them.

| Case | Code | `error` text (`${}` = interpolated) |
|---|---|---|
| `:id` not an integer | 400 | `Invalid id` |
| body `status` is absent, or not `'flown'` / `'planned'` | 400 | `status must be 'flown' or 'planned'` |
| flight id not found | 404 | `Flight not found` |
| leg row missing although `planned_leg_id` is set (§1.5) | 404 | `Planned leg not found` |
| `NOT_LINKED` | 409 | `Flight ${flightId} is not linked to a planned leg` |
| `LINK_NOT_MANUAL` | 409 | `Flight ${flightId} was not linked to its planned leg by hand: only a hand-linked flight's leg can be closed by hand` |
| `FLIGHT_NOT_ENDED` | 409 | `Flight ${flightId} has not ended: its planned leg is closed at touchdown` |
| `LEG_NOT_PLANNED` | 409 | `Planned leg ${legId} is '${legStatus}', not 'planned': only a planned leg can be marked flown by hand` |
| `LEG_NOT_FLOWN` | 409 | `Planned leg ${legId} is '${legStatus}', not 'flown': only a flown leg can be returned to planned` |
| `PlannedLegHandCloseConflictError` (the §4.3 race) | 409 | `Planned leg ${legId} cannot be closed by hand: ${detail}` |
| the writer returned `false` (leg vanished between decision and UPDATE) | 404 | `Planned leg not found` |
| anything else thrown | 500 | `String(err)` |

Note the message texts do **not** contain the reason codes. The codes are an
internal contract between `src/plannedLegClose.ts` and its inspector; the wire
carries only prose, as every other endpoint here does.

### 5.4 Handler shape (normative)

```
app.put('/api/flights/:id/planned-leg-status', (req, res) => {
  1. id := parseInt(req.params.id, 10);  isNaN -> 400 'Invalid id'
  2. status := req.body.status;  not 'flown' and not 'planned' -> 400
  3. flight := getFlightById(id);  !flight -> 404 'Flight not found'
  4. leg := flight.planned_leg_id == null ? null : getPlannedLegById(flight.planned_leg_id)
     if flight.planned_leg_id != null && !leg -> 404 'Planned leg not found'
  5. decision := decideHandClose(status, flight, leg)
     if !decision.allowed -> 409 { error: decision.message }
  6. try { ok := setPlannedLegHandOutcome(decision.legId, decision.status, decision.deviationNm) }
     catch PlannedLegHandCloseConflictError -> 409 { error: err.message }
     catch -> 500 { error: String(err) }
     if !ok -> 404 'Planned leg not found'
  7. res.json(getPlannedLegById(decision.legId))
})
```

Step 2 before step 3: a malformed body is a 400 regardless of whether the flight
exists, matching `PATCH /api/planned-legs/:legId`, which validates `status`
(`src/server.ts:602-606`) before the 404 check (`:608`).

### 5.5 Registration order

Register immediately **after** `app.put('/api/flights/:id/planned-leg', …)`
(which ends at `src/server.ts:659`), inside the same
`// ── Flight ↔ planned-leg link ──` block, before the `// ── PDF export ──`
block at `:661` and therefore far before `app.get('*')` at `:708`. Prior design
§7.3.

No shadowing risk: the only other four-segment route under `/api/flights` is the
literal `planned-leg`, Express 4 matches literal segments exactly, and
`app.get('*')` is GET-only so it cannot swallow a `PUT`. T-004 still proves the
route is reached by observing JSON rather than `index.html`.

### 5.6 What does **not** change in `src/server.ts`

`app.patch('/api/planned-legs/:legId', …)` at `src/server.ts:597-619`: **not one
line**. Specifically the `status !== 'planned' && status !== 'skipped'` guard
(`:602-606`), the 404 (`:608`), the `setPlannedLegStatus()` call (`:611`) and the
`PlannedLegHasLinkedFlightError → 409` catch (`:613-616`) all stay exactly as
they are. On an **unlinked** leg its three behaviours are preserved
byte-for-byte:

| Request | Before this run | After this run |
|---|---|---|
| `PATCH /api/planned-legs/<unlinked> {"status":"planned"}` | 200, the leg | identical |
| `PATCH /api/planned-legs/<unlinked> {"status":"skipped"}` | 200, the leg | identical |
| `PATCH /api/planned-legs/<unlinked> {"status":"flown"}` | 400 `status must be 'planned' or 'skipped'` | identical |
| `PATCH /api/planned-legs/<linked>  {"status":"planned"}` | 409 `Planned leg N cannot have its status changed: linked to flight M` | identical |

The fourth row is the one that matters: **every** linked leg, including the two
this feature's gate admits, still gets F-1's 409 from the leg endpoint. The new
capability exists only at the new path.

### 5.7 `flightManager.refreshPlannedLegForFlight(id)` is **not** called

`PUT /api/flights/:id/planned-leg` calls it at `src/server.ts:653` because a
manual link can be made to the flight **in progress**, and `FlightManager`'s
`plannedLegCache` (the `/api/status` live panel) is otherwise stale.

The new endpoint does not call it, because it cannot ever be a non-no-op:
`refreshPlannedLegForFlight()` returns immediately unless
`flightId === this.currentFlightId` (`src/flightManager.ts:363`), and this gate
requires `end_time IS NOT NULL`. A flight with `end_time` set is never
`currentFlightId`: `endFlight()` writes `end_time` via `closeFlight()` and clears
`this.currentFlightId` in the same synchronous block (`:284`, `:307`), and
`currentFlightId` is `null` after a restart. Calling it would be dead code that
asserts a relationship between this endpoint and the live flight that does not
exist.

**Falsifier, for the Reviewer and for anyone changing `FlightManager`:** if a
flight can ever have `end_time` set while it is still `currentFlightId`, §5.7 is
wrong and the call must be added. Recorded as risk R-3.

---

## 6. Modules

### 6.1 Ownership map

| File | Owner task | New / changed |
|---|---|---|
| `src/plannedLegClose.ts` | T-002 | **new** — the whole gate and the deviation, pure |
| `src/inspect-manual-mark.ts` | T-002 | **new** — CLI inspector over §1.3 |
| `src/db.ts` | T-003 | **changed, additive** — one function, one error class |
| `src/server.ts` | T-004 | **changed, additive** — one route |
| `client/src/pages/FlightDetail.tsx` | T-006 | **changed** — the control |
| `README.md` | T-007 | **changed** — two named regions |
| `src/types.ts` | — | **not changed** |
| `client/src/types.ts` | — | **not changed** |
| `client/src/components/PlannedLegRows.tsx` | — | **not changed** |
| `client/src/pages/TripDetail.tsx` | — | **not changed** |
| `src/flightManager.ts`, `src/legMatcher.ts`, `src/geo.ts` | — | **not changed** |

**Neither `src/types.ts` nor `client/src/types.ts` changes, because the feature
adds no field to any payload.** The request body is two literals; the response is
the existing `PlannedLegWithChildren`. The gate's input types live in
`src/plannedLegClose.ts` as local structural types (§6.2), so no shared type file
is touched and no two tasks collide in one file.

**`src/db.ts` does NOT import `src/plannedLegClose.ts`, and
`src/plannedLegClose.ts` does not import `./db`; the composition happens in the
endpoint.** That is what lets T-002 and T-003 be written in parallel on disjoint
paths.

### 6.2 `src/plannedLegClose.ts` — full signatures

Imports **only** `./geo`. No `./db`, no `./server`, no `./flightManager`, no
`./types`, no `./legMatcher`, no `fs`, no `http`. (T-002 asserts this with a
grep; M-5.)

```ts
import { haversineNm } from './geo';

export type HandCloseRequest = 'flown' | 'planned';

export type HandCloseRefusal =
  | 'NOT_LINKED'
  | 'LINK_NOT_MANUAL'
  | 'FLIGHT_NOT_ENDED'
  | 'LEG_NOT_PLANNED'
  | 'LEG_NOT_FLOWN';

export interface HandCloseFlight {
  id: number;
  end_time: string | null;
  planned_leg_id: number | null;
  planned_leg_link_source: 'auto' | 'manual' | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
}

export interface HandCloseLeg {
  id: number;
  status: 'planned' | 'flown' | 'diverted' | 'skipped';
  destination_lat: number;
  destination_lon: number;
}

export type HandCloseDecision =
  | { allowed: true;  legId: number; status: HandCloseRequest; deviationNm: number | null }
  | { allowed: false; reason: HandCloseRefusal; message: string };

/** §1.2 refusal order, §1.3 truth table, §3 deviation. Pure. */
export function decideHandClose(
  requested: HandCloseRequest,
  flight: HandCloseFlight,
  leg: HandCloseLeg | null
): HandCloseDecision;

/** §3.2 verbatim; null when either arrival coordinate is null (§3.3). Pure. */
export function handCloseDeviationNm(
  flight: Pick<HandCloseFlight, 'arrival_lat' | 'arrival_lon'>,
  leg: Pick<HandCloseLeg, 'destination_lat' | 'destination_lon'>
): number | null;
```

`HandCloseFlight` and `HandCloseLeg` are deliberately **structural subsets** of
`src/types.ts`'s `Flight` and `PlannedLegWithChildren` (field for field, same
names, same nullability — verified against `src/types.ts:27-53` and `:121, :146-147`).
The endpoint therefore passes `getFlightById(id)` and `getPlannedLegById(legId)`
straight in and TypeScript accepts them, with no import of `./types` and no
mapping layer. If a Dispatcher finds it does not compile, the design is wrong and
that is a `blocked`, not a cast.

No other exports. No `ARRIVAL_RADIUS_NM`, no `'diverted'` anywhere in the file.

### 6.3 `src/db.ts` — the two new exports

```ts
export class PlannedLegHandCloseConflictError extends Error {
  constructor(readonly legId: number, readonly detail: string);
}

export function setPlannedLegHandOutcome(
  legId: number,
  status: 'planned' | 'flown',
  deviationNm: number | null
): boolean;
```

Behaviour is §4.2. Place them next to `recordPlannedLegArrival()` (the function
they are the hand-driven sibling of), not next to `setPlannedLegStatus()`, so a
future reader does not mistake them for a variant of the F-1-guarded path.

### 6.4 `src/server.ts` — no new export

One route, §5.4, importing `decideHandClose` from `./plannedLegClose` and
`setPlannedLegHandOutcome` + `PlannedLegHandCloseConflictError` from `./db`.

### 6.5 `src/inspect-manual-mark.ts` — the inspector's contract

A `ts-node` CLI with no arguments and no database access: it constructs synthetic
`HandCloseFlight` / `HandCloseLeg` values, calls `decideHandClose()` and prints
one row per row of §1.3 (48 verdicts) plus §1.5's two cases, with the design's
verdict as the expected column. Exit 0 iff every row agrees. It must additionally
carry the six named rows of T-002's acceptance criteria; the two prototypes in
this run supply their expected values:

| Row | Input | Expected |
|---|---|---|
| (a) live stuck case | flight 56's real `arrival_lat/lon` (58.35728796183394, -134.58627965717702) vs leg 12's PAJN (58.354721, -134.578491), manual, ended, leg `planned`, request `flown` | allowed, `deviationNm === 0.3` |
| (b) auto link | same, `link_source = 'auto'` | refused, `LINK_NOT_MANUAL` |
| (c) `end_time` null | same, manual, `end_time = null` | refused, `FLIGHT_NOT_ENDED` |
| (d) arrival null | manual, ended, `arrival_lat = null`, request `flown` | allowed, `status === 'flown'`, `deviationNm === null` |
| (e) antimeridian | arrival (0, 179) vs destination (0, -179) | allowed, `deviationNm === 120.1` — 2° of longitude, not 358° |
| (f) far diversion | arrival (58.354721, -134.578491) vs destination (56.3, -134.0) | allowed, `status === 'flown'` (never `'diverted'`), `deviationNm === 124.8` |

Rows (e) and (f) are the same measurement in two guises and both values come from
`prototypes/haversine-parity.js`'s actual output (§12, command E2), not from a
hand calculation.

---

## 7. Client contract

Shared types live on each side of the wire as they already do and **do not
move**: `src/types.ts` owns the server's `Flight` / `PlannedLegWithChildren`;
`client/src/types.ts` hand-mirrors them; `src/plannedLegClose.ts` owns the gate's
own local input types and shares them with nobody. The client consumes
`PlannedLegWithChildren` from the new endpoint's 200 and nothing else.

The flight row is deliberately **not** returned by the endpoint, because no
column on `flights` changes in either direction — including on the reverse, which
must not unlink (frozen decision 3). A payload containing the flight would invite
a Dispatcher to believe something on it moves.

---

## 8. UI — phase 2, frozen

Only `client/src/pages/FlightDetail.tsx` changes.
`client/src/components/PlannedLegRows.tsx` and
`client/src/pages/TripDetail.tsx` are **not touched**: `plannedLegBadge()`
already maps `'flown'` to the `Flown` badge (`PlannedLegRows.tsx:14`) and
`plannedLegLandingNote()` already renders `flown, N nm from plan`
(`PlannedLegRows.tsx:46`) for every consumer, so both pages read correctly the
moment the row changes.

### 8.1 The visibility predicate — the one place it is written

**This is a deliberate duplicate of §1's server gate with no compiler link**, and
it is this run's named "predicate drift" risk. `client/` cannot import from
`src/`, there is no shared package, and this design does not create one for two
booleans. The mitigation is that the predicate is written **once**, here, in a
form the client restates literally, and that the Reviewer (T-008) diffs the two
over all 24 rows of §1.3.

Inside the `{plannedLeg && (…)}` branch of the Planned Leg section
(`FlightDetail.tsx:257`), where `flight: Flight` and `plannedLeg:
PlannedLegWithChildren` are both non-null and in scope:

```ts
// design.md §8.1 — a hand-copy of the server gate in design.md §1.1. The client
// cannot import src/plannedLegClose.ts; if these two ever disagree, the server
// wins and the user sees a 409.
const handCloseEligible =
  flight.planned_leg_link_source === 'manual' &&
  flight.end_time !== null &&
  (plannedLeg.status === 'planned' || plannedLeg.status === 'flown');

const handCloseTarget: 'flown' | 'planned' =
  plannedLeg.status === 'flown' ? 'planned' : 'flown';
```

`flight.planned_leg_id != null` and "the leg exists" are already guaranteed by
the enclosing `{flight.planned_leg_id != null && …}` at `:252` and
`{plannedLeg && …}` at `:257`, so they are not restated. Every field used —
`planned_leg_link_source`, `end_time`, `status` — is already present on the
client's `Flight` (`client/src/types.ts:12, 32`) and `PlannedLeg`
(`client/src/types.ts:72`). No new field, no new fetch.

Row-by-row, this predicate produces exactly §1.3's two ALLOW cells and nothing
else. T-008 verifies that claim rather than trusting it.

### 8.2 Labels, exact

| Direction | Idle label | Busy label |
|---|---|---|
| `handCloseTarget === 'flown'` | `Mark flown` | `Marking…` |
| `handCloseTarget === 'planned'` | `Back to planned` | `Reopening…` |

The ellipsis is the single character `…` (U+2026), matching `Unlinking…` at
`FlightDetail.tsx:297`.

### 8.3 No confirm dialog, in either direction

Explicitly: **no `confirm()`**. `Unlink` keeps its confirm
(`FlightDetail.tsx:111`) and that line is not touched.

Reason: both directions of this control are exactly reversible by the next click
— §2.2's round-trip theorem says the reverse of the reverse restores the
identical `(status, arrival_deviation_nm)` pair, bit for bit. Confirming a
reversible one-click action is how users learn to dismiss confirms without
reading them, which then costs them on `Unlink`, where the confirm is load-bearing
(unlink moves the flight's `trip_id` and drops the link, and is not undone by
clicking again).

### 8.4 Placement, busy state, errors

- The button goes in the existing `<div className="flight-actions">` at
  `FlightDetail.tsx:295-300`, **before** the `Unlink` button — affirmative action
  first, destructive last — using the same `className="btn btn-ghost"`.
- State: two hooks declared beside `unlinkBusy` / `unlinkError`
  (`FlightDetail.tsx:118-119`), named `markBusy` / `markError`, same
  `useState(false)` / `useState('')` idiom.
- The handler mirrors `handleUnlinkPlannedLeg()` (`:110-128`): set busy, clear
  error, `apiFetch<PlannedLegWithChildren>('/api/flights/${id}/planned-leg-status',
  { method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: handCloseTarget }) })`, then
  `setPlannedLeg(updated)` in the success path, `setMarkError('Mark failed: ' +
  (err as Error).message)` in the catch, busy cleared in `finally`.
- **`setPlannedLeg`, not `setFlight`.** The flight row does not change (§7), and
  the leg-loading effect keys on `flight?.planned_leg_id` (`:108`), which is
  unchanged — so setting the leg state directly re-renders the badge and the
  landing note with no refetch and no reload. **No `window.location.reload()`.**
- `markError` renders as `<span className="edit-error">{markError}</span>` in the
  same `flight-actions` row, beside `unlinkError` at `:299`. A 409 therefore
  renders the server's message verbatim, because `apiFetch` throws
  `new Error(body.error)` (`client/src/utils/api.ts:5`).

### 8.5 What the user sees, in the two live cases

- `/flight/56` (manual, ended, leg 12 `planned`): badge `Planned`, text
  `Linked by hand.`, buttons `Mark flown` and `Unlink`. After the click: badge
  `Flown`, a new line `flown, 0.3 nm from plan`, buttons `Back to planned` and
  `Unlink`. After clicking again: back to the first state exactly.
- `/flight/48` (auto, ended, leg 5 `flown`): badge `Flown`,
  `flown, 0.1 nm from plan`, text `Linked automatically, at takeoff.`, and
  **only** `Unlink`. No mark control at all.

---

## 9. Algorithms

The only decision in this feature is `decideHandClose()`, and it is fully
specified by §1.1 (predicate), §1.2 (refusal order), §1.3 (verdict per input),
§3.2 (deviation expression) and §5.3 (message text). Written as a procedure,
precise enough to implement twice and get the same answer:

```
decideHandClose(requested, flight, leg):
  1. if flight.planned_leg_id == null or leg == null:
        refuse NOT_LINKED, "Flight {flight.id} is not linked to a planned leg"
  2. if flight.planned_leg_link_source != 'manual':
        refuse LINK_NOT_MANUAL,
          "Flight {flight.id} was not linked to its planned leg by hand: only a
           hand-linked flight's leg can be closed by hand"
  3. if flight.end_time == null:
        refuse FLIGHT_NOT_ENDED,
          "Flight {flight.id} has not ended: its planned leg is closed at touchdown"
  4. if requested == 'flown' and leg.status != 'planned':
        refuse LEG_NOT_PLANNED,
          "Planned leg {leg.id} is '{leg.status}', not 'planned': only a planned
           leg can be marked flown by hand"
     if requested == 'planned' and leg.status != 'flown':
        refuse LEG_NOT_FLOWN,
          "Planned leg {leg.id} is '{leg.status}', not 'flown': only a flown leg
           can be returned to planned"
  5. allow:
        legId       = leg.id
        status      = requested                       -- ALWAYS, never 'diverted'
        deviationNm = requested == 'planned'
                        ? null
                        : handCloseDeviationNm(flight, leg)

handCloseDeviationNm(flight, leg):
  if flight.arrival_lat == null or flight.arrival_lon == null: return null
  return Math.round(haversineNm(flight.arrival_lat, flight.arrival_lon,
                                leg.destination_lat, leg.destination_lon) * 10) / 10
```

Message strings are single-line in the code; they are wrapped here for reading
only. The exact one-line forms are §5.3's table.

---

## 10. Alternatives considered

| # | Decision | Options | Chosen, and why |
|---|---|---|---|
| A | The gate on system-closed manual links (flights 47, 52) | (i) accept: manual + ended + `flown` is reversible; (ii) exclude with a new `close_source` column and a migration | **(i)**, on the proof in §2.2: the reversal is provably lossless because the deviation is recomputable bit-for-bit from immutable columns. (ii) costs a migration on the user's live logbook to prevent a loss that does not occur. §2.4 keeps (ii) specified in case §2.3's falsifier fires. |
| B | Which statuses the toggle spans | (i) `planned ↔ flown` only; (ii) also `skipped → flown`; (iii) also `diverted → flown` | **(i)**. (ii) saves two clicks in a state with zero live rows and permanently widens the gate (§1.8). (iii) would let a one-click toggle erase a diversion and would break the round-trip identity (§1.7). |
| C | The API surface | (i) `PUT /api/flights/:id/planned-leg-status`; (ii) widen `PATCH /api/planned-legs/:legId` to accept `'flown'` under the gate | **(i)**, §5.2: the gate's inputs live on `flights`, and leaving the PATCH handler untouched turns "F-1 did not regress" from an argument into a diff. |
| D | Success payload | (i) the updated leg; (ii) the flight; (iii) both | **(i)**, §7: no column on `flights` changes, and returning it would misrepresent that. |
| E | Where the gate lives | (i) whole gate in the endpoint via a pure module; (ii) whole gate in `src/db.ts`, per Amendment C's "guard at the layer every caller passes through" | **(i) plus a narrow invariant re-check in the writer** (§4.3). The full gate needs the flight's arrival position and link source, which the writer would have to re-query; the writer re-asserts only the three persistent invariants it reads anyway, which closes the unlink race atomically without duplicating the transition rule. |
| F | NULL arrival position | (i) mark flown, store `NULL`; (ii) refuse with 409 | **(i)**, §3.3: (ii) creates a leg no route can ever close, and contradicts the frozen "always set the status the user asked for". |
| G | `refreshPlannedLegForFlight()` | (i) call it, defensively; (ii) do not | **(ii)**, §5.7: it is a provable no-op under this gate, and calling it would assert a relationship to the live flight that does not exist. Falsifier recorded as R-3. |
| H | Confirm dialog | (i) confirm on both; (ii) confirm on reopen only; (iii) neither | **(iii)**, §8.3: both directions are exactly reversible by the next click; a confirm here would devalue `Unlink`'s, which is not. |
| I | Reason codes on the wire | (i) prose only; (ii) prose + a machine code field | **(i)**, §5.3: no other endpoint here carries a code, the client shows the prose verbatim, and adding a field would change a payload shape this run promised not to change. |

---

## 11. Must-not-change list

The Reviewer checks these one by one.

- **M-1** The `planned_legs` DDL and the `ALTER TABLE` migration block in
  `initDb()` are unchanged. No migration in this run. (`git diff src/db.ts`)
- **M-2** `setPlannedLegStatus()` (`src/db.ts:1088-1106`) and
  `PlannedLegHasLinkedFlightError` (`:1006-1012`) are unchanged, line for line.
  Every linked leg still gets the F-1 409 from `PATCH /api/planned-legs/:legId`,
  including the two legs this feature's gate admits.
- **M-3** `recordPlannedLegArrival()` (`:1318-1322`),
  `unlinkFlightFromPlannedLeg()` (`:1259+`), `clearPlannedLegLink()` (`:1284+`)
  and `linkFlightToPlannedLeg()` (`:1207+`) are unchanged. The reverse
  transition **must not unlink**: after it, `flights.planned_leg_id` and
  `planned_leg_link_source` for the flight are exactly what they were.
- **M-4** `app.patch('/api/planned-legs/:legId')` (`src/server.ts:597-619`) is
  unchanged, and its four documented behaviours (§5.6) are byte-identical
  against a `git archive HEAD` build.
- **M-5** `src/plannedLegClose.ts` imports only `./geo`, and contains neither
  `ARRIVAL_RADIUS_NM` nor the string `'diverted'` as an output. `src/db.ts` does
  not import `src/plannedLegClose.ts`.
- **M-6** The deviation expression and its rounding stay character-identical to
  `src/flightManager.ts:458` and `:463`.
- **M-7** `updateFlight()`'s allowlist stays `['aircraft', 'notes']`
  (`src/db.ts:351`). Nothing gains the ability to write
  `flights.arrival_lat/arrival_lon` after `end_time` is set. §2.3.
- **M-8** Nothing writes `planned_legs.destination_lat/destination_lon` after
  import. §2.3.
- **M-9** `src/flightManager.ts`, `src/legMatcher.ts` and `src/geo.ts` are not
  modified at all. Auto-match, the touchdown rule and what `diverted` means are
  out of scope.
- **M-10** `src/types.ts`, `client/src/types.ts`,
  `client/src/components/PlannedLegRows.tsx` and `client/src/pages/TripDetail.tsx`
  are not modified. No payload gains a field; the trip page gains no control
  (frozen decision 1).
- **M-11** No sequence of calls to the new endpoint can produce a leg state
  prior design §15's amended table does not define (§1.6, closure claim).
- **M-12** Existing planned-leg behaviour is untouched: auto-match at takeoff,
  skip/unskip on unlinked legs, unlink, delete leg, delete flight, delete trip,
  combine, re-import and ordering.
- **M-13** The live `flights.db` is never written by any task in this run
  (md5 before and after in every report), and the user's server on port 3000 is
  never stopped, restarted or rebuilt over mid-edit.

---

## 12. Evidence log

Every empirical claim above traces to one of these. All were run read-only; the
live `flights.db` md5 was `717061074332a3a9cd4f190345dd5a58` before and after.

**E1 — the deviation recompute (§2.2 Lemma 3).**

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
node .claude/runs/2026-09-07-manual-mark-flown/prototypes/deviation-recompute.js flights.db
```

```
┌─────────┬────────┬─────┬─────────────┬───────┬────────────┬────────┬─────────┬────────────┬────────────────┬────────────────────────────────┐
│ (index) │ flight │ leg │ link_source │ ended │ leg_status │ dest   │ arrived │ stored_dev │ recomputed_dev │ verdict                        │
├─────────┼────────┼─────┼─────────────┼───────┼────────────┼────────┼─────────┼────────────┼────────────────┼────────────────────────────────┤
│ 0       │ 47     │ 4   │ 'manual'    │ true  │ 'flown'    │ 'KSFO' │ 'KSFO'  │ 0.4        │ 0.4            │ 'match'                        │
│ 1       │ 48     │ 5   │ 'auto'      │ true  │ 'flown'    │ 'KCIC' │ 'KCIC'  │ 0.1        │ 0.1            │ 'match'                        │
│ 2       │ 49     │ 6   │ 'auto'      │ true  │ 'flown'    │ 'KMFR' │ 'KMFR'  │ 0.1        │ 0.1            │ 'match'                        │
│ 3       │ 50     │ 8   │ 'auto'      │ true  │ 'flown'    │ 'KRBG' │ 'KRBG'  │ 0.2        │ 0.2            │ 'match'                        │
│ 4       │ 51     │ 9   │ 'auto'      │ true  │ 'flown'    │ 'KPDX' │ 'KPDX'  │ 0.4        │ 0.4            │ 'match'                        │
│ 5       │ 52     │ 10  │ 'manual'    │ true  │ 'flown'    │ 'CYVR' │ 'CYVR'  │ 0.8        │ 0.8            │ 'match'                        │
│ 6       │ 53     │ 11  │ 'auto'      │ true  │ 'flown'    │ 'CYXS' │ 'CYXS'  │ 0.2        │ 0.2            │ 'match'                        │
│ 7       │ 56     │ 12  │ 'manual'    │ true  │ 'planned'  │ 'PAJN' │ null    │ null       │ 0.3            │ 'no stored dev (would be 0.3)' │
└─────────┴────────┴─────┴─────────────┴───────┴────────────┴────────┴─────────┴────────────┴────────────────┴────────────────────────────────┘
8 linked pair(s); 0 mismatch(es).
EXIT=0
```

**What it implies.** All seven closed legs — including both manual ones, rows 0
and 5 — reproduce their stored `arrival_deviation_nm` exactly from
`flights.arrival_lat/arrival_lon`. Reopening such a leg therefore destroys
nothing that re-marking cannot restore, which is §2.2's justification for
accepting the wider gate rather than adding a column. Row 7 confirms the stuck
case the feature exists for and fixes T-002's expected value at **0.3 nm**.
Note row 7's `arrived` is `null`: `findNearestAirport()` did not resolve an ICAO
for flight 56, which is exactly why the deviation must be measured from the
coordinates and not from `arrival_icao`.

**E2 — haversine parity (§2.2 Lemma 2, §6.5 rows (e) and (f)).**

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
node .claude/runs/2026-09-07-manual-mark-flown/prototypes/haversine-parity.js flights.db
```

16 pairs, 0 divergences, exit 0. `Object.is()` held on both the raw double and
the rounded value for every pair. Values fixed by this run:

```
live flight 56 -> PAJN        0.28973267179568996  -> 0.3
antimeridian 179E -> 179W   120.08092146523697     -> 120.1
far diversion ~120 nm       124.78189156058473     -> 124.8
sub-nm                        0.03457052751215423  -> 0
```

**E3 — live shape queries (§1.8, §3.3).**

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
node -e "const D=require('better-sqlite3');const db=new D('flights.db',{readonly:true}); …"
```

```
ended-with-null-arrival:  { c: 0 }
open flights:             []
leg status counts:        [ { status: 'flown', c: 7 }, { status: 'planned', c: 1 } ]
flight 56: end_time 2026-09-07T17:06:00.726Z, arrival_lat 58.35728796183394,
           arrival_lon -134.58627965717702, arrival_icao null,
           planned_leg_id 12, planned_leg_link_source 'manual',
           trip_id 1, planned_leg_prev_trip_id 1
leg 12:    trip_id 1, seq 8, status 'planned', destination PAJN
           58.354721 / -134.578491, arrival_deviation_nm null
```

**E4 — `frame` is not reassigned in `endFlight()` (§2.2 Lemma 1).**

```
awk 'NR>=270 && NR<=312' src/flightManager.ts | grep -nE '^\s*frame\s*='
```

No output. `frame` is used at `:284` (`closeFlight`, lat/lon) and `:304`
(`recordArrivalOnPlannedLeg`) and nowhere assigned.

**E5 — the two `haversineNm` bodies are byte-identical (§2.2 Lemma 2).**

```
diff <(sed -n '23,30p' src/geo.ts) <(sed -n '19,26p' src/flightManager.ts | sed 's|; // nautical miles|;|')
```

```
1c1
< export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
---
> function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
```

Only the signature line differs (the `export` keyword). All seven body lines are
identical.

**E6 — route-shadowing check (§5.5).**

```
grep -n "app\.\(get\|put\|post\|patch\|delete\)('/api/flights" src/server.ts
```

The only four-segment routes under `/api/flights` are `/:id/flight-plan`,
`/:id/planned-leg` and `/:id/export.pdf`, all literal in the last segment.
`app.get('*')` is at `:708`, after every API route.

**E7 — the structural-subset claim compiles (§6.2).** The design asserts that
`src/types.ts`'s `Flight` and `PlannedLegWithChildren` satisfy
`HandCloseFlight` / `HandCloseLeg` structurally, so the endpoint can pass
`getFlightById()` / `getPlannedLegById()` straight into `decideHandClose()` with
no import of `./types` and no cast. Checked, in the scratch directory (nothing
written into the repo), with the contract stub and a five-line assignment file:

```
tsc --noEmit --strict --target es2020 --moduleResolution node --module commonjs \
    check.ts db-additions.d.ts
```

```
TSC EXIT=0
```

where `check.ts` is `const hf: HandCloseFlight = f; const hl: HandCloseLeg = l;`
over `declare const f: Flight; declare const l: PlannedLegWithChildren;`. If a
Dispatcher finds this does not compile in `src/`, the design is wrong and that
is a `blocked`, not a cast.

---

## 13. Risks

- **R-1 — predicate drift (§8.1).** The client's visibility predicate is a
  hand-copy of the server gate with no compiler link. A later change to §1 that
  updates only one side gives a button that 409s, or a capability the user cannot
  reach. Mitigation: the predicate is written once, here; T-008 diffs it against
  the 24-row table. Falsified by any §1.3 row where the two disagree.
- **R-2 — the gate accepts system-closed manual legs (§2).** Justified by the
  round-trip theorem, which rests on the deviation being recomputable. Falsified
  by anything in §2.3 — a new writer of `flights.arrival_lat/lon` after
  `end_time`, a writer of `planned_legs.destination_*`, or a divergence in the
  rounding.
- **R-3 — the `refreshPlannedLegForFlight()` no-op argument (§5.7)** depends on
  `FlightManager` clearing `currentFlightId` in the same synchronous block that
  sets `end_time`. Falsified by any change that lets an ended flight remain
  `currentFlightId` — e.g. async work inside `endFlight()`.
- **R-4 — the NULL-arrival branch has no live data (§3.3).** It is reachable
  only through `combineFlights()` with an unclosed second flight, and it will
  only ever have been exercised by T-002's synthetic inspector row before it runs
  for a real user.
- **R-5 — the writer's invariant re-check (§4.3) is not the full gate.** A future
  second caller of `setPlannedLegHandOutcome()` that skips `decideHandClose()`
  could write a status transition the table forbids. Mitigation: the caller set
  is pinned by grep in T-003's and T-005's evidence, and the doc comment says so.
- **R-6 — the restart window.** `npm run build:client` publishes the new button
  to the user's already-running server as a static file the instant it finishes,
  while the endpoint it calls does not exist in the running `dist/` until the
  user restarts. That is a shipping fact, not a design flaw; T-009 states it and
  the Orchestrator relays it.
- **R-7 — `arrival_deviation_nm = 0`.** A sub-0.05 nm arrival rounds to `0`,
  which is not null, so the leg reads `flown, 0 nm from plan`. This is existing
  behaviour on the auto path (§12, E2, `sub-nm` row) and is not changed here; it
  is noted so a Reviewer does not read it as a bug this run introduced.

---

## 14. DoD traceability (T-001)

| Acceptance criterion | Satisfied by |
|---|---|
| §1 "The gate": predicate for both directions over the four named columns, 24-row table, no gaps | §1.1, §1.2, §1.3 (24 rows × 2 directions), §1.5 (the two cases outside the grid) |
| Resolves the system-closed manual link explicitly, by name | §2 in full — flights 47 → leg 4 and 52 → leg 10 named, accepted, with the proof and the rejected alternative (§2.4) |
| `prototypes/deviation-recompute.js` exists, runs read-only, exits non-zero on disagreement; actual output quoted; implication stated | `prototypes/deviation-recompute.js`; output and implication in §12 E1 |
| §"Deviation": source columns, rounding expression, NULL policy, frozen "always the requested status" | §3.1, §3.2, §3.3, §3.4 |
| §"API": table with method/path/body/payload, one row per error case, surface rationale, which PATCH lines change (none), unlinked-leg behaviour preserved | §5.1–§5.6 |
| §"Modules": every export with its signature and file, `src/db.ts` does not import the pure module, no type-file changes | §6.1–§6.5, `contracts/plannedLegClose.d.ts`, `contracts/db-additions.d.ts` |
| Whether the endpoint calls `refreshPlannedLegForFlight()` and why | §5.7 (does not), falsifier R-3 |
| §"UI" freezes phase 2: predicate over client-held fields, labels, confirm policy, busy/409 rendering, files not touched | §8.1–§8.5 |
| Prior design gains Amendment D; §12.3, §14, §15 amended in place (§15's state table gains `unclosed`, its transition table gains the two hand rows with actor `user (hand-linked, ended flight)`, and the F-1 bullet is narrowed rather than deleted) | `.claude/runs/2026-09-04-lnmpln-trip-planner/design.md` Amendment D and those three sections |
| No implementation code | `git status --porcelain src client README.md` prints nothing |
