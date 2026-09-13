# Phase 2 gate — SimBrief import (T-005, T-006, T-007) — reviewed as T-008

## Verdict: APPROVE

Independently re-run evidence below matches the frozen design and every
acceptance criterion. Both flagged open items resolve as non-blocking
design-doc notes, not defects (§5).

## 1. Static checks (re-run here)

```
$ npm test            → 17 files, 327 tests passed, incl. simbrief.test.ts (32),
                         simbriefClient.test.ts (17); lnmpln.test.ts untouched, 29 green
$ npm run test:types  → no output, exit 0
$ npx tsc --noEmit    → no output, exit 0
$ npm run build       → client (vite) + server (tsc) both succeeded, dist/ rebuilt
$ git diff --stat -- package.json package-lock.json   → empty
$ grep -rn "simbrief.com" client/src                  → no matches
$ grep -n "fetch\|https\?\|from './db'\|require('fs')\|from 'fs'" src/simbrief.ts → no match
```

## 2. Inspector re-run over every fixture (AC4/T-005)

```
$ npx ts-node src/inspect-simbrief.ts samples/simbrief/simbrief.userid.json
   departure UHPP  destination UHSS  waypoints=18  alternates=0  cruise 28000ft
   approx. 755.3 nm  warnings: PSEUDO_WAYPOINTS, NO_ALTERNATES        EXIT=0
```
Hand check: origin UHPP not first in navlog (first is PP003, a SID wpt);
destination UHSS is the last fix (`"type":"apt"`) → 17 navlog fixes + 1
prepended origin = 18. Matches §1.4/§4.2.

```
$ for f in samples/simbrief/synthetic/*; do npx ts-node src/inspect-simbrief.ts "$f"; done
bad-lat-91.json   → BAD_POSITION: fix BADLAT has pos_lat=91.5, outside ±90    EXIT=1
bad-no-plan.json  → NOT_AN_OFP: response carries no origin/destination …     EXIT=1
bad-no-route.json → NO_ROUTE: response has no navlog fixes                   EXIT=1
bad-not-json.txt  → NOT_JSON: body is not valid JSON (Unexpected token…)     EXIT=1
```
All four reject, one-line reason, non-zero exit.

## 3. Scratch server — end to end (AC4, AC5, AC6, log lines)

Scratch db + `-wal`/`-shm` copied from live into a mktemp dir; `node
dist/setPassword.js` run with that dir as cwd only (confirmed after: the new
`reviewer` auth row exists in the **scratch** copy, never the live one).
Server run `PORT=3100 ALLOW_PLAINTEXT_HTTP=1 INGEST_TOKEN=… SIMBRIEF_API_BASE_URL=http://127.0.0.1:3101/...`
with cwd = scratch dir. A local Node stub served the real captured fixture or
a synthesized error per user id — no call ever left the box. `$!` captured for
app and stub; both killed by that exact PID only.

**AC4 — waypoints read back via better-sqlite3, Node 20, in order:**
```
SELECT seq, ident, type FROM planned_waypoints WHERE planned_leg_id=29 ORDER BY seq
1:UHPP:AIRPORT 2:PP003:WAYPOINT 3:SAMIK:WAYPOINT 4:TOC:USER 5:UB:NDB 6:LEDRU:WAYPOINT
7:NAMUL:WAYPOINT 8:ROMUK:WAYPOINT 9:NATUN:WAYPOINT 10:RUDOS:WAYPOINT 11:TOD:USER
12:AGITA:WAYPOINT 13:BELNA:WAYPOINT 14:LEKPA:WAYPOINT 15:BAPMA:WAYPOINT 16:FARAT:WAYPOINT
17:CF19:WAYPOINT 18:UHSS:AIRPORT   count=18
```
Same order as the fixture's route; matches the inspector's independent read. **Confirmed.**

**Success (201) and duplicate (200)** both matched design §6.3/§6.4 shape
exactly: singular `result`, `imported` array of exactly one leg on success,
`imported:[]` + `result.error` naming the existing leg number on duplicate.

**AC5 — every failure case, GET planned-legs diffed before/after (empty = pass):**

| Case | Forced by | Status | code | diff |
|---|---|---|---|---|
| NO_USER_ID | setting cleared | 400 | NO_USER_ID | empty |
| UNKNOWN_USER | stub 400 "Unknown UserID" | 400 | UNKNOWN_USER | empty |
| NO_PLAN | stub replayed real `userid=2` 400 body | 404 | NO_PLAN | empty |
| BAD_BODY | stub returned `<html>...` on 200 | 502 | BAD_BODY | empty |
| NETWORK | stub process killed | 502 | NETWORK | empty |
| TIMEOUT | stub held connection 30s | 504 | TIMEOUT | empty, `time curl`=20.26s |

Also checked: invalid `:id` → 400 INVALID_TRIP; unknown trip → 404 NOT_FOUND;
unauthenticated POST → 401. All correct.

**Log lines, read from the scratch server's own stdout:**
```
[SIMBRIEF] import ok: trip 1 leg 29 UHPP->UHSS 18 wpts 755.3nm ofp 186182026
[SIMBRIEF] import duplicate: trip 1 leg 29 UHPP->UHSS ofp 186182026
[SIMBRIEF] import failed: NO_USER_ID (trip 1)
[SIMBRIEF] import failed: UNKNOWN_USER (http 400, upstream "Error: Unknown UserID")
[SIMBRIEF] import failed: NO_PLAN (http 400, upstream "Error: No flight plan on file for the specified user")
[SIMBRIEF] import failed: BAD_BODY (http 200, first 200 chars: <html>not json, simbrief outage page</html>)
[SIMBRIEF] import failed: NETWORK (fetch failed)
[SIMBRIEF] import failed: TIMEOUT (20000ms)
```
Matches §5.4's frozen format exactly.

**AC6 — `.lnmpln` path untouched:**
```
$ curl -F "lnmpln=@samples/lnmpln/IFR ... KSFO ... KLAX.lnmpln" /api/trips/1/planned-legs
  → HTTP 201, {"imported":[{"id":30,...,"waypoint_count":3,...}]}
$ git diff --stat -- src/lnmpln.ts   → empty
```
`git diff -- src/server.ts` hunks land only at: imports (top); a new
`SIMBRIEF_FAILURE_STATUS` const after `looksLikeXml`; a new `── Settings ──`
block before `── Planned legs ──`; a new route inserted right after the
existing POST handler's closing brace and before `GET /planned-legs`; and one
`req.path.startsWith('/api/settings/')`-scoped branch added to the bottom
error middleware. No line inside the existing `POST /api/trips/:id/planned-legs`
handler body is touched. **AC6 measured, confirmed.**

## 4. Design conformance spot-checks

- `src/db.ts`: `app_setting` DDL + `getSetting`/`setSetting` match §2.1/§2.4
  verbatim; no existing table/index/`CreatePlannedLeg*` interface touched.
- `client/src/types.ts`: new interfaces match §7.1 field-for-field, additive
  only, `LnmplnWarning` untouched.
- `client/src/pages/TripDetail.tsx`: `simbrief-import-section` div sits
  immediately after the untouched `planned-legs-import-section`; reuses
  existing CSS classes per §7.3 (verified by reading the JSX — no headless
  browser available this session, see Follow-ups).
- `client/src/index.css`: only new `+` rules, nothing existing edited.
- Route order (`grep "── Settings ──\|── Planned legs ──"`) matches §3/§6.1.
- No new/edited comment cites a run-id, design.md, a §-section, or a task id
  (checked every new comment in the touched files).

## 5. Open items from the envelope

1. **File split** (`fetchSimbriefPlan` in `src/simbriefClient.ts` vs. the
   design's literal `fetchLatestOfp` in `src/simbrief.ts`). Behavior matches
   the frozen contract exactly: signature shape, `fetchImpl` parameter
   defaulting to global `fetch`, 20 000 ms `AbortSignal.timeout`, the §5.3
   7-step verdict order, and every §5.4 user-message/log-line string
   (confirmed live in §3). Necessary given T-005's own AC that
   `src/simbrief.ts` have zero network imports. **Sound — record as a
   design.md §5 amendment, not a defect.**
2. **`DB_PATH` unread.** Confirmed `src/db.ts:9` resolves `flights.db` from
   `process.cwd()` only; no `DB_PATH` anywhere in `src/`. Verification-recipe
   detail only (§7.5), not production behavior. **Recommend correcting
   design.md §7.5** to say "run from a directory containing flights.db."

## 6. Process safety / live server

Live `flights.db` md5 changed on its own between reads
(`f818146d…` → `22f32476…` → `c6e61c6b…`) because the live server holds it
open in WAL mode and is actively recording a real flight — not from anything
this review did (all writes went through the mktemp scratch copy; its
`reviewer` auth row is absent from the live db). Live server PID `537867`
unchanged before and after, still listening on `0.0.0.0:3000` at the end.
Scratch server and stub were each killed by their own captured `$!` PID only —
no `pkill`/`killall`/name match used anywhere. Scratch directory removed.

## Follow-ups (non-blocking, not sent back)

- design.md §5: record the file/export-name split as an amendment.
- design.md §7.5: fix the verification recipe's `DB_PATH` reference.
- T-007's rendering states were verified by reading the diff against §7.3's
  table plus live API checks, not a rendered browser DOM (no headless browser
  tool available). A manual click-through is worth doing before release if
  that matters.
- No test currently pins the exact `[SIMBRIEF]` log line formats emitted by
  `src/server.ts`; consider one.
