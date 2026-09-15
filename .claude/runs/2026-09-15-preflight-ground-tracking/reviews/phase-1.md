# approve

Phase 1 (T-002 backend, T-003 frontend). All 12 acceptance criteria re-run by me
against a scratch server (`PORT=3100`, `BIND_HOST=127.0.0.1`) on a copy of
`flights.db` under Node 20.20.2; no implementer report was read. No blocking
findings; 4 non-blocking follow-ups at the end.

**Scope.** Changed files: `src/db/schema.ts`, `src/db/groundSessions.ts` (new),
`src/routes/groundSessions.ts` (new), `src/routes/acars.ts`, `src/server.ts`,
`src/types.ts`, `client/src/{App.tsx,types.ts}`,
`client/src/pages/{Home,AcarsMessages}.tsx`,
`client/src/components/PlannedLegRows.tsx` — every one inside T-002's or
T-003's `allowed_paths`. (`tests/db/schema.test.ts` is the Orchestrator's fix,
out of scope; suite green.)

## T-002 — backend

| # | Criterion | Verdict |
|---|---|---|
| 1 | `initDb()` creates `ground_sessions`; second run a no-op | **pass** |
| 2 | `src/db/groundSessions.ts` surface; no express/http | **pass** |
| 3 | Manual-entry endpoint + current read match §5 | **pass** |
| 4 | Leg-scoped ACARS GET/POST/wx, reuse, mount order | **pass** |
| 5 | Leg thread works with no `flights` row | **pass** (loadsheet clause n/a) |
| 6 | `npx tsc` and `npm run build` clean | **pass** |
| 7 | Live `flights.db` not written by this review | **pass** |

**1.** Two `initDb()` calls on the scratch copy, `FLIGHTS_DB_PATH` exported:

```
PASS1 cols(17): id,source,airport_icao,airport_name,lat,lon,parking_position,parking_position_source,planned_leg_id,planned_leg_link_source,aircraft,started_at,ended_at,ended_reason,flight_id,created_at,updated_at
PASS1 indexes: idx_ground_sessions_leg,idx_ground_sessions_open,idx_ground_sessions_started
IDEMPOTENT: true
```

Columns and index names are §3.1's, in §3.1's order. The partial unique index
bites: a hand-inserted second open row is refused,
`second open row refused: SQLITE_CONSTRAINT_UNIQUE`.

**2.** `grep -n "express\|require('http')\|from 'http'" src/db/groundSessions.ts`
→ exit 1 (no match). Exports: `insertGroundSession`, `insertManualGroundSession`,
`getOpenGroundSession`, `closeOpenGroundSession`,
`updateOpenGroundSessionParking` — insert (auto + manual), close,
get-current-open, update-parking, nothing unrelated.

**3.** Ten curls; statuses and bodies exactly as §5.2/§5.3:

```
GET  /current (none open) -> 200 {"session":null}
POST {"icao":"rjck","parking_position":"  Stand 231  ","planned_leg_id":30} -> 201
     {"id":1,"source":"manual","airport_icao":"RJCK","parking_position":"Stand 231",
      "parking_position_source":"manual","planned_leg_id":30,"planned_leg_link_source":"manual",
      "lat":null,"lon":null,"aircraft":null,…}        (icao normalised, stand trimmed)
GET  /current -> 200 that row inside {"session":…}
POST {"icao":"EGLL"} over the open manual row -> 201 new row; old one ended_reason='superseded'
POST {"icao":"TOOLONG"} -> 400 INVALID_ICAO        POST {"parking_position":"A1"} -> 400 INVALID_BODY
POST '{' (malformed) -> 400 INVALID_BODY           POST '[]' -> 400 INVALID_BODY
POST {"icao":"EGLL","planned_leg_id":99999} -> 404 PLANNED_LEG_NOT_FOUND
POST parking_position of 121 chars -> 400 INVALID_BODY (max 120)
```

§7.3's two branches, against a hand-seeded open `source='auto'` row at RJCK:

```
POST {"icao":"RJCK","parking_position":"Gate 5"} -> 200 id=3 source="auto"
     parking_position="Gate 5" parking_position_source="manual" (created_at kept, updated_at bumped)
POST {"icao":"RJCB"}                             -> 201 new id=4 source="manual"; id=3 closed 'corrected'
```

**4/5.** Leg 30 (`RJCK→RJCB`, status `planned`, no `flights` row references it):

```
GET  /api/planned-legs/30/acars-messages -> 200 {"planned_leg_id":30,"messages":[]}
POST {"canned_id":"request-pushback"} -> 201 {"id":3,"flight_id":null,"planned_leg_id":30,
                                              "label":"REQUEST PUSHBACK",…}
POST {"body":"GATE REQUEST"} -> 201 id=4 ;  GET -> 200 both messages, sent_at ASC
POST {"body":"HELLO OPS"} -> 400 NOT_A_CANNED_MESSAGE
POST {"canned_id":"wx-request","direction":"uplink"}  -> 403 DIRECTION_NOT_PERMITTED
POST {"canned_id":"wx-request","category":"dispatch"} -> 403 CATEGORY_NOT_PERMITTED
GET  /planned-legs/abc/…   -> 400 INVALID_ID ;  /planned-legs/99999/… -> 404 PLANNED_LEG_NOT_FOUND
POST …/wx {"icao":"rjck"}  -> 201 available=true, request id=5 + reply id=6 correlation_id=5,
                              label "METAR RJCK", weather payload present
POST …/wx {"icao":"XX"} -> 400 INVALID_ICAO ;  …/wx {} -> 400 INVALID_BODY
```

The read is `listAcarsMessagesForPlannedLeg(legId)` (`src/routes/acars.ts:255`);
validation is `findCannedMessage` / `findCannedMessageByBody` /
`cannedMessageIdList` / `CLIENT_DIRECTION` / `normaliseIcao` /
`isValidIcaoShape` from `src/acars.ts`, no rules duplicated. All three routes
live in `createAcarsRouter()`, mounted `src/server.ts:158`, above the
`app.get('*')` catch-all at :161. Criterion 5's loadsheet clause is **not
applicable**: no leg in the database carries a dispatch payload, and the
pre-existing route answered leg 30 with its documented `409 NO_DISPATCH_DATA`
(follow-up 4).

**6.** `npx tsc --noEmit` exit 0; `npm run build` → `✓ built in 2.32s` then
`tsc`, `build-exit=0`. Also `npm test` → `Test Files 35 passed (35) / Tests 668
passed (668)`; `npm run test:types` clean.

**7.** Live `flights.db` never written by this review. Its md5 is **not** a
stable invariant while the user's server runs — I watched it move on its own,
with nothing of mine writing anywhere: `166c1d28…` (17:32) → `1eb16663…`
(17:45, held across my whole scratch pass, 17:47 and 17:56) → `06b2f274…`
(17:58), the 5-hour-old server (PID 889188) checkpointing its 4.1 MB WAL. The
invariants that do hold, read-only against the live file after teardown:
`ground_sessions` **absent** from `sqlite_master`; `acars_messages` 0 rows;
`flights` 55; `planned_legs` 22; `auth_user` still `operator`, not the
`reviewer` account my `setPassword` created (run with `FLIGHTS_DB_PATH`
exported, per ENVIRONMENT's pipe rule) — which is the sharpest proof that every
write of mine landed on the copy.

## T-003 — frontend

| # | Criterion | Verdict |
|---|---|---|
| 1 | Leg-scoped thread route, reachable from every unflown row | **pass** |
| 2 | Home manual form + card, §7.6 wording verbatim | **pass** |
| 3 | `client/src/types.ts` mirrors §5/§6, no `src/types.ts` import | **pass** |
| 4 | Client typecheck clean | **pass** |
| 5 | Scratch-server click-through | **pass** |

**1/5.** Headless click-through (puppeteer) against the scratch server:

```
leg ACARS links on trip page: ["/planned-leg/30/acars","/planned-leg/32/acars"]  (both unflown legs)
url after clicking ACARS on unflown leg 32: http://localhost:3100/planned-leg/32/acars
title: ACARS Messages — Planned leg #32
thread before: "No ACARS messages for this planned leg yet."
canned buttons: ["WX REQUEST","GATE REQUEST","REQUEST PUSHBACK","REQUEST LOADSHEET","REQUEST WX"]
thread after send: "COCKPIT | FREETEXT | GATE REQUEST | Sep 15, 2026, 5:54 PM | GATE REQUEST"
```

`GhostLegRow` is the only renderer of a planned row (`TripDetail.tsx:776`) and
the `<Link to={/planned-leg/${leg.id}/acars}>` is inside it, so "every unflown
row" holds structurally as well as in the two rendered instances.

**2.** Same run, text read out of the rendered DOM, not the source:

```
home heading: "Manual entry (fallback)"
home helper : "msfslogger detects your airport and stand automatically. Use this only when detection could not resolve your position."
after submit, card: "MANUAL ENTRYRJCK — Unknown airportStand 7RJCK → RJCBSince Sep 15, 2026, 5:52 PM"
```

Both §7.6 strings are **literal**, not paraphrased (`Home.tsx:226`, `:228`);
submit reads `Set ground position` (`:273`); the chip reads `Detected` /
`Manual entry` (`:204`). Card above, form below and labelled fallback — §7.5
holds.

**3.** No import of `src/types.ts` in `client/src/types.ts` (grep: no match).
Field-by-field diff against `src/types.ts`: `GroundSession`,
`CreateGroundSessionRequest`, `CurrentGroundSessionResponse`,
`PlannedLegAcarsThread`, `PlannedLegWxRequestResponse` all identical;
`groundSession?` sits between `plannedLeg` and `traffic` per §6.1.

**4.** `cd client && npx tsc --noEmit` → exit 0 (the `tsc` half of client `build`).

## Must-not-change

* `GET /api/status` in `IDLE` byte-identical to before, no `groundSession` key:
  `{"connected":false,"flightState":"IDLE","currentFlightId":null,"paused":false,"pauseFlags":0,"simRunning":0,"onGround":true,"aircraft":null,"frame":null}`
* Flight-scoped ACARS unchanged: `GET /api/flights/47/acars-messages` → 200
  `{"flight_id":47,"planned_leg_id":4,"messages":[]}`; missing flight still
  `404 {"error":"Flight 99999 not found","code":"FLIGHT_NOT_FOUND"}` (the exact
  string `AcarsMessages.tsx` matches on).
* SPA catch-all still serves the new route: `/planned-leg/30/acars` → 200.
* Unit suite 668/668.

## Non-blocking follow-ups

1. **Run citations in comments.** `client/src/pages/Home.tsx:23` ("§6.4"), `:41`,
   `:128` ("design §6.4"), `:176` ("design §6.5"), `src/db/groundSessions.ts:136`
   ("§7.3"). They point at a document no reader of `client/src/` or `src/` can
   open — state the rule instead of citing it.
2. **A blank Ramp/gate erases a detected stand.** `Home.tsx:165` always sends the
   key (`parking_position: manualStand.trim() || null`) and the server
   distinguishes absent from null. Reproduced against an open `auto` row holding
   `parking_position='Stand 12'`: `POST {"icao":"RJCK"}` keeps
   `"Stand 12"`/`auto`; `POST {"icao":"RJCK","parking_position":null}` — what the
   form sends when the field is blank — yields `null`/`manual`. Harmless now
   (nothing creates `auto` sessions yet), but it becomes a §7.3 "only what the
   operator supplied changes" data-loss path the moment the ground-state machine
   lands. Omit the key when the input is untouched.
3. **Server-side §6.1/§5.4 surface still open.** `src/types.ts` has no
   `GroundSessionLiveStatus`, no `UpdateGroundSessionRequest`, no
   `Status.groundSession` though the client declares all three; `PATCH`/`DELETE
   /api/ground-sessions/current` and §3.3's `getGroundSessionById`,
   `fillOpenGroundSessionGaps`, `listGroundSessions` do not exist yet. None is
   required by T-002's or T-003's criteria and all belong with §5.5's
   flightManager wiring — Phase 2 should close them together.
4. **Loadsheet round-trip unverified for want of data** — no planned leg carries a
   dispatch release, so only the `409` path was exercisable. A fixture would
   close it.

Teardown: scratch server (PID 918361, port 3100) stopped by tracked PID,
`port3100=000` after; my scratch directory removed. The user's server on 3000
was never contacted, stopped or restarted (PID 889188, uptime 05:12:55 at the
end), and it is the only node process still listening.
