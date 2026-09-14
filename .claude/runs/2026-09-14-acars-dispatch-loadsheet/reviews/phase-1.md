# Review — phase 1 (T-002 backend, T-003 web client)

**Verdict: approve.** 11/11 acceptance criteria (6 on T-002, 5 on T-003) re-run
independently and passing. No blocking findings. Two non-blocking follow-ups.

Scope: changed files are exactly `src/{acars,simbrief,types,inspect-simbrief}.ts`,
`src/routes/{acars,plannedLegs}.ts` (T-002 allowed_paths) and
`client/src/pages/AcarsMessages.tsx`, `client/src/types.ts` (T-003). Nothing
outside. `src/db/acarsMessages.ts`, `src/db/schema.ts` and `client/src/index.css`
are untouched (`git status --short`).

## How this was verified

Scratch only. A copy of `flights.db` (+ `-wal`, `-shm`) in the session
scratchpad, the server compiled with `npx tsc --outDir <scratch>/build`, and
three throwaway harnesses launched with cwd = scratch dir (so
`src/db/connection.ts`'s `process.cwd()/flights.db` resolves to the copy):
port 3100 = both routers, 3101 = same with `insertAcarsMessageOnce` stubbed to
throw, 3102 = routers + `client/dist` + a session stub for the headless client
run. SimBrief was stubbed locally via `SIMBRIEF_API_BASE_URL` serving
`samples/simbrief/simbrief.userid.json`. All killed by tracked PID at the end;
`ss -ltnp` → "all scratch listeners down". The user's server on :3000 was never
touched.

**Live `flights.db`:** md5 `66b76aaa6ceda3ef31830905e7f52604` before →
`680e846bd133d7922ca3299f801a0fa7` after. The change is the user's own running
server (pid 769344) checkpointing its WAL — same file size, and the live db
contains **none** of this review's writes: `select count(*) from acars_messages`
→ `0`, rows with `dedup_key like 'dispatch:leg:%' or 'loadsheet%'` → `0`,
`planned_legs id in (30,31,32)` → `0`, trips named `REVIEW SCRATCH` → `0`.

## T-002 criteria

1. **One dispatch row per import.** `POST /api/trips/2/planned-legs/simbrief` →
   `HTTP 201`; scratch db query gives one row: `id 2 | planned_leg_id 30 |
   uplink | dispatch | 'DISPATCH RELEASE' | dedup_key 'dispatch:leg:30' |
   flight_id null`. Body carries all five story elements
   (`RTE …`, `CRZ FL280`, `FUEL KG BLOCK 1241 …`, `ALTN NONE`, `ETE 0320`) and
   matches design §5.2's prototype line for line. `payload_json` is byte-identical
   to §4.2's sample apart from nothing. **PASS**
2. **Duplicate short-circuit files nothing.** Second identical import →
   `HTTP 200 {"imported":[],"result":{"status":"duplicate",…}}`, `acars_messages`
   count unchanged at 1. A third import with `allow_duplicates:true` created leg
   31 and its own release (`dispatch:leg:31`) — the §9.2 behaviour, not a bug. **PASS**
3. **`npx tsc --noEmit`** → clean (`TSC_NOEMIT_OK`). **PASS**
4. **Load sheet success.** `POST /api/planned-legs/30/acars-messages/loadsheet`
   → `HTTP 201`, `created true`, `request 4 downlink 'REQUEST LOADSHEET'`,
   `reply 5 uplink 'LOADSHEET' correlation_id 4`, sheet
   `block_fuel 1241 / payload 642 (simbrief) / zero_fuel_weight 4511 (simbrief)`.
   `listAcarsMessagesForPlannedLeg(30)` returns release → request → reply in
   `sent_at ASC, id ASC`. Reply body matches §6.4's prototype exactly, including
   `ZERO FUEL WT    4511 MAX 4990`. Request row `payload_json` is `null`, reply's
   equals the returned `sheet` (§2.2). **PASS**
5. **Rejection.** Leg 32 (inserted with no release, the `.lnmpln` shape) →
   `HTTP 409 {"error":"NO DISPATCH DATA ON FILE","code":"NO_DISPATCH_DATA"}`,
   `b.error === 'NO DISPATCH DATA ON FILE'` → `true`. All three §6.2 conditions
   checked: all-null payload (leg 33), unparseable `payload_json` (34), `v: 7`
   (35) — all `409` with the same literal. Row count 4 before and 4 after every
   rejection: **no row written on any rejection path**. Also `404
   PLANNED_LEG_NOT_FOUND` for leg 999999 and `400 INVALID_ID` for `abc`. **PASS**
6. **Emission failure cannot change the import.** Harness on 3101 with
   `insertAcarsMessageOnce` replaced by a thrower: import → `HTTP 201`, keys
   `[imported, result]`, `status imported`, leg 36, `imported.length 1`, zero
   acars rows for that leg, and one log line
   `[SIMBRIEF] dispatch release not filed: leg 36 ofp 186182026 (Error: FORCED FAILURE)`.
   **PASS**

## T-003 criteria (re-run against T-002's real endpoint, not a mock)

1. **`npm run build:client`** → `✓ built in 2.18s` (`tsc && vite build`). **PASS**
2. **Click files and appends without refetch.** Flight 87 → leg 31 (release on
   file, no sheet): thread rows 1 → 3 after the click; network trace for the
   click is exactly `["POST http://127.0.0.1:3102/api/planned-legs/31/acars-messages/loadsheet"]`
   — one POST, no GET refetch. Screenshot:
   `.claude/runs/2026-09-14-acars-dispatch-loadsheet/reports/ui-loadsheet-created.png`. **PASS**
3. **Rejection rendered verbatim.** Flight 85 → leg 32: `.edit-error` text is
   `NO DISPATCH DATA ON FILE`, strict equality `true`, no thrown error, thread
   still rendered. `reports/ui-loadsheet-rejected.png`. **PASS**
4. **Gating.** Flight 86 (`planned_leg_id` null): button present,
   `disabled: true`, `title: "No planned leg linked to this flight"`.
   `reports/ui-loadsheet-disabled.png`. **PASS**
5. **Existing styling only.** Rendered badge classes on the new rows are
   `badge badge-uplink`, `badge badge-downlink`, `badge badge-acars-dispatch` —
   all pre-existing; `client/src/index.css` unmodified. Fixed-field columns line
   up in the screenshot (`.acars-msg-body` pre-wrap + monospace). **PASS**

Also checked beyond the criteria: a second click returns `HTTP 200 created:false`
and the thread stays at 3 rows — the merge-by-id of §6.5/§8.4 works, no duplicate
React keys.

## Specific checks the envelope asked for

- **(a) exactly one release, duplicate path never adds a second** — criteria 1–2 above.
- **(b) no second SimBrief fetch** — `grep -rn "fetchSimbriefPlan\|simbriefClient" src/ client/src/` returns
  one import and one call, both in `src/routes/plannedLegs.ts:18,231` (the pre-existing
  import route). `src/routes/acars.ts` and `src/acars.ts` reference neither.
- **(c) literal wording** — server: exact-string assertion `true`; client: exact-string
  assertion `true`. Defined once, `src/acars.ts:NO_DISPATCH_DATA_MESSAGE`.
- **(d) directions** — release `uplink`, request `downlink`, reply `uplink`, as frozen
  in intake.md and design §2.2 (table above from the scratch db).
- **(e) one thread, chronological** — flight 84 linked to leg 30, plus a canned
  `wx-request` (category `freetext`, flight-scoped): `GET /api/flights/84/acars-messages`
  returns all four rows, `flight_id`/`planned_leg_id` mixed, `sent_at` non-decreasing
  (`chronological: true`).

## Design conformance (§10 must-not-change, one by one)

1 import success response unchanged (keys `[imported, result]`, 201) ✓ · 2 duplicate
response unchanged, zero rows ✓ · 3 swallowed failure ✓ (T-002 crit. 6) · 4 single
`createPlannedLeg` write path, nothing moved earlier ✓ (diff) · 5 no schema change —
`git diff` adds no `CREATE/ALTER/UPDATE/DELETE` anywhere ✓ · 6 flight-scoped ACARS
routes untouched (canned send still 201/400 as before) ✓ · 7 `src/db/acarsMessages.ts`
unmodified ✓ · 8 `ParsedSimbriefPlan` additive only (`dispatch` node + one warning
code) ✓ · 9 no unit conversion — stored figures equal the capture's strings as numbers
(1241/872/4511) ✓ · 10 `src/acars.ts` still pure: grep for `new Date|Date.now|require(|
process.env|readFile|from './db` → none ✓ · 11 phrase defined once, reaches the screen
unmodified ✓ · 12 no CSS change ✓ · 13 no run/design/task citations in `src/`,
`client/src/` (grep for `.claude/runs|design.md|plan.json|T-00N|§|Amendment`) ✓ ·
14 live db and :3000 untouched ✓ (above).

§9 alternatives: no re-fetch reintroduced (§9.1), dedup keyed on leg id not OFP
(§9.2), no new `loadsheet` category — all three rows are `dispatch` (§9.3), import
response gained no key (§9.4), emission before the response (§9.5), `POST` (§9.6).

Security: the new route is registered after `requireSameOrigin` and
`app.use('/api', requireAuth)` (`src/server.ts:73,80,157`), takes no body, and its
only input is `parseInt(req.params.legId)` guarded by `isNaN`; all SQL goes through
the existing prepared statements. No filesystem access, nothing new logged.

`npm test` → **19 files, 355 passed** (unchanged from T-002's claim).
`npm run test:types` → clean.

## Story acceptance criteria

- **AC1** exactly one dispatch-release per successful import → T-002 crit. 1 + 2.
- **AC2** figures derived from that plan's data → T-002 crit. 4; block 1241 / payload
  642 / ZFW 4511 are SimBrief's own numbers from the capture, via `payload_json`, no refetch.
- **AC3** rejection with the specified message, no server error → T-002 crit. 5 (409,
  not 500) and T-003 crit. 3.
- **AC4** same per-flight thread, chronological → check (e).

## Non-blocking follow-ups

1. `client/src/pages/AcarsMessages.tsx:184-207` — REQUEST LOADSHEET sits inside the
   `cannedError ? … : …` branch, so a failure of `GET /api/acars/canned-messages`
   hides an action that does not depend on it. This follows the frozen placement
   (design §8.1), so it is not a defect of T-003; worth revisiting when the canned
   list and the generated actions next share that row. Owner if picked up: frontend.
2. Design §6.1 says a body sent to the load-sheet endpoint is ignored with "no 400 for
   a malformed body". True of the handler, but app-level `express.json()` answers 400
   before it (reproduced: `curl -d '{"legId":"x"' -H 'Content-Type: application/json'`
   → 400). Pre-existing app-wide behaviour and the client sends no body; a doc-level
   nuance, not a code change.
