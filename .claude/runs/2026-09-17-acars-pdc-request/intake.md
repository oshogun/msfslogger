# Intake — ACARS PDC (clearance) request

Run id: 2026-09-17-acars-pdc-request
Orchestrator: Claude (msfslogger session)
Source: user_stories/acars_pdc_request.md

## Goal (restated)

Add a server endpoint that synthesizes a simulated Pre-Departure Clearance
(PDC) for a planned leg — departure, destination, filed route, initial
altitude, squawk — and persists it as an ACARS message pair (downlink request
+ uplink clearance), so re-requesting the same leg returns the identical,
already-issued clearance instead of a new one. The MCDU client's "REQUEST
CLEARANCE" action (separate repo, see below) is out of scope for this repo;
this run ships the contract it will call.

## Success criteria (from the story's acceptance criteria)

1. A planned leg with a filed route returns a clearance containing departure,
   destination, route, initial altitude, and squawk.
2. Requesting twice for the same leg returns an identical clearance both times.
3. A planned leg with no filed route is rejected with a specific error
   ("NO FLIGHT PLAN ON FILE"), not a generic failure.
4. The clearance is retrievable later (after client restart) without
   re-requesting, via the persisted record.

## Scope split — this repo vs. the MCDU client

The story's "MCDU-style client's datalink page" and "REQUEST CLEARANCE"
button live in the Tauri/MCDU client, which per `CLAUDE.md` moved to
`https://github.com/oshogun/msfslogger_mcdu` and is not in this tree. This run
builds the server contract only. Once implemented and reviewed, the
Orchestrator sends the frozen request/response JSON to the `mcdu-tauri-client`
session (a peer Claude session, confirmed live via ListAgents) so it can wire
the button — per the `mcdu_client_coordination` memory: exact JSON, not a
paraphrase.

## Tier and steps taken

**Tier 2** (single seam, cross-cutting within one file pair) — one
implementer + one Reviewer, no Planner, no Designer. Reasoning:

- The codebase already has a near-identical, shipped precedent: the
  `/planned-legs/:legId/acars-messages/loadsheet` route in
  `src/routes/acars.ts`, backed by pure builders in `src/acars.ts`, using the
  same `acars_messages` table, the same `insertAcarsMessageOnce` dedup
  pattern, and the same `DispatchPayload` (SimBrief-derived) as its source of
  "filed route" data. `'pdc'` is already a pre-existing entry in
  `KNOWN_ACARS_CATEGORIES` (`src/acars.ts`), i.e. this feature was already
  anticipated by the existing contract.
- No schema change: `acars_messages` is already generic (flight- or
  leg-scoped, dedup_key, payload_json, correlation_id).
- The only genuinely new decisions are frozen below by the Orchestrator
  (mirroring the loadsheet precedent + the story's own explicit rules)
  rather than left to a Designer, since they are narrow and the story itself
  pins down almost every field.
- Skipping Planner: this is one task, not a graph — one implementer touching
  `src/acars.ts` + `src/routes/acars.ts` + `src/types.ts` + `src/auth/ingestScope.ts`
  + `tests/`, all one seam (the clearance feature), no parallel work possible.

## Frozen decisions (Orchestrator, mirroring the loadsheet precedent)

**"Filed route" gate.** Same gate as `/loadsheet`: a leg's filed route lives
in the `DispatchPayload` stored under `dispatchDedupKey(legId)` (written by
the SimBrief import) — `payload.route`, `payload.origin`, `payload.destination`,
`payload.cruise_alt_ft`. No payload on file (`parseDispatchPayload` returns
null) → reject. This reuses existing SimBrief parsing per the story's
non-functional note ("reuse existing `.lnmpln`/SimBrief parsing rather than
re-deriving flight-plan structure") instead of re-deriving a route string
from `planned_waypoints`.

**Endpoint.** `POST /api/planned-legs/:legId/acars-messages/clearance`. No
request body (same shape as `/loadsheet`).
- 404 unknown leg: `{ error: 'Planned leg <id> not found', code: 'PLANNED_LEG_NOT_FOUND' }`
  (existing helper, unchanged).
- 409 no dispatch data on file: `{ error: 'NO FLIGHT PLAN ON FILE', code: 'NO_FLIGHT_PLAN' }`
  — a new, PDC-specific message text (distinct from `NO_DISPATCH_DATA_MESSAGE`),
  matching AC3 and the story's exact wording.
- 200/201 success: `ClearanceRequestResponse` (201 when the pair was newly
  written, 200 when it already existed for this leg — same convention as
  `LoadsheetRequestResponse`).
- Add this route to `INGEST_SCOPED_ROUTES`
  (`src/auth/ingestScope.ts`), mirroring the `planned-leg-acars-loadsheet`
  entry, so the MCDU client can call it via `x-ingest-token`.

**Message pair, idempotent via `insertAcarsMessageOnce`** (same pattern as
loadsheet's request/reply):
- Downlink: category `'pdc'`, label `'REQUEST CLEARANCE'`, body
  `'REQUEST CLEARANCE'`, dedup key `clearance-req:leg:<legId>`.
- Uplink: category `'pdc'`, label `'PDC'`, body built by `buildClearanceBody`,
  `payload_json` = the `ClearanceDetails` below, `correlation_id` = the
  downlink message's id, dedup key `clearance:leg:<legId>`.
- Re-requesting an already-issued leg hits the dedup key on both inserts and
  returns the stored rows unchanged (AC2, AC4) — no new random squawk, no new
  timestamp.

**`ClearanceDetails` (new type, `src/types.ts`, stored as the uplink
message's `payload_json` and returned inline so no client parses the body
text):**
```ts
export interface ClearanceDetails {
  v: 1;
  departure_icao: string | null;   // payload.origin
  destination_icao: string | null; // payload.destination
  route: string | null;            // clampRoute(payload.route) — reuses the existing helper
  initial_altitude_ft: number;     // see below
  squawk: string;                  // 4-digit octal string, see below
}

export interface ClearanceRequestResponse {
  planned_leg_id: number;
  created: boolean;   // false when this leg already had a clearance
  request: AcarsMessage;  // direction 'downlink', label 'REQUEST CLEARANCE'
  reply: AcarsMessage;    // direction 'uplink', label 'PDC', correlation_id === request.id
  clearance: ClearanceDetails;
}
```

**Initial altitude.** No initial-climb-altitude field exists anywhere in the
planned-leg data (SID has no altitude column). Simulated default, deterministic
and mirroring the existing `levelText()` display convention: `min(5000,
cruise_alt_ft ?? 5000)`, i.e. 5000 ft unless the leg's cruise altitude is
lower. Body text uses the existing `levelText()` formatter.

**Squawk.** Deterministic per leg id (AC2 requires the same leg to always get
the same code), 4-digit octal (digits 0-7 only, real-world shape), excluding
the reserved codes `0000`, `7500`, `7600`, `7700`:
```ts
export function squawkForLeg(legId: number): string {
  const RESERVED = new Set(['0000', '7500', '7600', '7700']);
  let n = (Math.abs(Math.trunc(legId)) * 2654435761) % 4096; // 8^4 = 4096 combinations
  let code = n.toString(8).padStart(4, '0');
  while (RESERVED.has(code)) { n = (n + 1) % 4096; code = n.toString(8).padStart(4, '0'); }
  return code;
}
```

**Clearance body** (mirrors `buildDispatchReleaseBody`'s style — fixed lines,
ends with an unambiguous simulation disclaimer per the story's non-functional
note):
```
PDC
<departure> TO <destination>
CLEARED VIA <route>
CLIMB AND MAINTAIN <levelText(initial_altitude_ft)>
SQUAWK <squawk>
SIMULATED CLEARANCE - NOT FOR REAL WORLD USE
```
`route` uses `clampRoute()`; `'NIL'`/`'????'` fallbacks follow the same
conventions already used by `buildDispatchReleaseBody`.

## Amendment — this repo's own web client also gets a button (T-002)

After T-001 shipped, found that `client/src/pages/AcarsMessages.tsx` (the
existing browser datalink page for a planned leg, distinct from the MCDU
desktop client) already has a `handleRequestLoadsheet` + "REQUEST LOADSHEET"
button wired to `/loadsheet`. The story's "REQUEST CLEARANCE" action belongs
here too, mirroring that handler/button exactly against the now-approved
`/clearance` endpoint — single seam, one component, no new contract (T-001
already froze it). `frontend_jr`, `allowed_paths: client/src/**`.

## Out of scope / explicitly skipped

- MCDU (Tauri) desktop client UI — separate repo/session
  (`https://github.com/oshogun/msfslogger_mcdu`), handed off via the
  `mcdu-tauri-client` peer session after this run ships.
- DevOps/Ship step — no build, packaging or deploy change.
- Any change to `acars_messages` schema — the existing generic table already
  covers this.
