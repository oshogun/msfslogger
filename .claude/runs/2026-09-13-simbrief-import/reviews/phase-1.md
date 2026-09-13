# Phase 1 gate — settings persistence (T-002, T-003)

**Verdict: approve.** Phase 2 may proceed to `src/server.ts` / `TripDetail.tsx`.

Re-run independently by the reviewer on a scratch copy (`PORT=3100`, scratch cwd
with its own `flights.db` + `-wal` + `-shm`). No implementer report was read;
14/14 acceptance criteria across T-002 and T-003 were verified from the diff and
from live output. 0 criteria unverifiable.

| Task | Verdict |
|---|---|
| T-002 settings table, validation, endpoints | approve — 8/8 criteria verified |
| T-003 SimBrief User ID field | approve — 6/6 criteria verified |

## 1. Build and test gates (re-run here, Node 20.20.2)

| Command | Result |
|---|---|
| `npm test` | `Test Files 16 passed (16) / Tests 294 passed (294)`, incl. `✓ tests/simbrief.test.ts (16 tests)` |
| `npm run test:types` | `tsc -p tsconfig.test.json` — no output, exit 0 |
| `npx tsc --noEmit` | no output, `tsc exit=0` |
| `npm run build` | `✓ built in 2.04s` … `build:server > tsc`, `build exit=0`; tree shippable |

No test file other than the new `tests/simbrief.test.ts` is modified; `git diff
--stat -- tests/lnmpln.test.ts` is empty.

## 2. Schema change — additive and idempotent

`env -C <scratch> node open.js` (opens the scratch db with `dist/db.js`, then again):

    BEFORE  {"app_setting_table":0,"app_setting_rows":"n/a","planned_legs":21,"trips":1,"flights":53}
    OPEN#1  {"app_setting_table":1,"app_setting_rows":0,"planned_legs":21,"trips":1,"flights":53}
    OPEN#2  {"app_setting_table":1,"app_setting_rows":0,"planned_legs":21,"trips":1,"flights":53}

Second open: no error, no duplicate row. Resulting DDL matches § 2.1 verbatim:
`CREATE TABLE app_setting ( name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL )`.
`app_secret` row count unchanged (1) and its DDL untouched (`git diff -U0 src/db.ts`
hunks are `@@ -262,0 +263,14 @@` and `@@ -1478,0 +1493,24 @@` — the new table is
inserted immediately after `app_secret` ends at 262, per § 2.1).

## 3. The settings endpoints — full curl sequence

Auth gate (no cookie):

    GET  /api/settings/simbrief  → 401 {"error":"Authentication required"}
    PUT  /api/settings/simbrief  → 401 {"error":"Authentication required"}

Happy path (authenticated, scratch session):

    GET  → 200 {"simbrief_user_id":null}          (unset = null, no 404 — § 3.1)
    PUT  {"simbrief_user_id":"1099607"} → 200 {"simbrief_user_id":"1099607"}
    GET  → 200 {"simbrief_user_id":"1099607"}

Every rejection in § 3.4, each followed by a read-back showing the stored value
survived (`{"simbrief_user_id":"1099607"}` after all eleven):

| Request body | Status | Body |
|---|---|---|
| `"a string"` | 400 | `{"error":"Invalid request body","code":"INVALID_BODY"}` |
| `[1,2]` | 400 | same |
| `{oops` (unparseable) | 400 | same |
| `{"simbrief_user_id":123}` | 400 | `{"error":"SimBrief User ID must be text","code":"INVALID_ID"}` |
| `…:true` / `…:{"a":1}` | 400 | same |
| `…:"pilot123"` | 400 | `{"error":"SimBrief User ID must be digits only — it is the numeric Pilot ID from your SimBrief account page, not your username","code":"INVALID_ID"}` |
| `…:"12 34"` | 400 | same |
| `…:"1١٢"` (Arabic-Indic digits) | 400 | same |
| `…:"1'; DROP TABLE app_setting;--"` | 400 | same; table still present afterwards |
| `…:"123456789012345678901"` (21) | 400 | `{"error":"SimBrief User ID is too long","code":"INVALID_ID"}` |
| cross-origin `Origin: http://evil.example` | 403 | `{"error":"Cross-origin request rejected"}` |

Accept path, § 3.3 rules 2/3/5 and the leading-zero rule:

    "  1099607  "            → 200 {"simbrief_user_id":"1099607"}   (trimmed)
    "0012345"                → 200 {"simbrief_user_id":"0012345"}   (zeros preserved)
    "12345678901234567890"   → 200 (20 digits accepted — boundary)
    ""                       → 200 {"simbrief_user_id":null}        (clear)
    null                     → 200 {"simbrief_user_id":null}        (clear)

Concurrency: 20 parallel PUTs → all `200`; `select * from app_setting` afterwards
is exactly one row (`simbrief_user_id` / `1000020` / ISO `updated_at`). The upsert
holds under concurrent writes.

Scoping of the new `SyntaxError` branch in the error middleware: malformed JSON
to a non-settings route (`PUT /api/trips/1`) still produces the pre-existing HTML
`SyntaxError` page, unchanged.

## 4. Must-not-change list (§ 8)

`git diff --stat` is **empty** for `src/lnmpln.ts`, `src/config.ts`, `src/geo.ts`,
`client/src/App.tsx`, `tests/lnmpln.test.ts`, `samples/`.

Changed-hunk line ranges vs. the protected ranges — no overlap:

- `src/server.ts`: `6`, `25`, `+520..552`, `998`, `+1017..1023`. None inside
  45-67, 68-75, 523-643, 645-654, 656-718. The settings block is inserted
  immediately before the `── Planned legs ──` banner, as § 3 requires.
- `src/db.ts`: after 262, after 1478. None inside 90-192, 193-226, 767-851,
  871-945, 970-975, 256-262.
- `client/src/pages/TripDetail.tsx`: `9`, after 47, 85, 234, 430, 602. Outside
  189-233 (`handleImportPlannedLegs`) and 567-600 (the `.lnmpln` markup).
- `client/src/types.ts`: one hunk after line 77 — additive, above 206-258.

Behavioural guarantee 1, re-run end to end on the scratch server:

    POST /api/trips/1/planned-legs  -F lnmpln=@"samples/lnmpln/VFR Monterey Rgnl (KMRY) to San Francisco Intl (KSFO).lnmpln" -F allow_duplicates=1
    HTTP 201  keys: ['batch','imported','results']  results is array: True len 1
    result[0].status: imported  leg 30   imported[0]: KMRY -> KSFO

The same file without `allow_duplicates` returns `400` with
`status:"duplicate"` — sha256-of-bytes dedupe still in force.

## 5. Frontend (T-003), rendered in a real browser

Puppeteer against the scratch server, `/trip/1`, authenticated:

    RENDER {"inputValue":"1099607","inputDisabled":false,"label":"SimBrief User ID",
            "sectionTitle":"Import from SimBrief",
            "previousSectionTitle":"Import Planned Route (.lnmpln)",
            "saveDisabled":true,"lnmplnInputPresent":true}

Prefilled from `GET /api/settings/simbrief` (which returned
`{"simbrief_user_id":"1099607"}`), placed as a sibling **immediately after** the
`.lnmpln` section per § 7.2, Save disabled while unmodified. Rejection path —
typed `pilot123`, clicked Save:

    AFTER_REJECT {"inputValue":"1099607",
      "error":"SimBrief User ID must be digits only — it is the numeric Pilot ID from your SimBrief account page, not your username"}
    follow-up GET → {"simbrief_user_id":"1099607"}

Server message rendered inline in `.edit-error`, the stored value redisplayed,
server state unchanged. `grep -rn "simbrief.com" client/src` → nothing.
`grep -nE "^import|require\(" src/simbrief.ts` → no imports at all (pure).

## 6. Live database

| When | `md5sum flights.db` |
|---|---|
| review start, 14:49:49 | `8e520c7b1a8e9c4d6f4f79f9a86649f4` |
| 14:55:28 | `8e520c7b1a8e9c4d6f4f79f9a86649f4` |
| 14:55:48 → 14:56:10 (stable) | `490c03623cf55a8db18ccb66af62b629` |

The hash moved once near the end of the window and then held steady across three
samples with no reviewer process alive. **Not this run's doing**, on four
independent checks:

1. `app_setting` is **absent from the live database** — before (14:49) and after
   (14:56): `select count(*) from sqlite_master where name='app_setting'` → `0`.
   This run's migration has never executed against it.
2. `planned_legs` 21, `trips` 1, `flights` 53 — identical before and after.
3. The diff adds **no** `new Database(...)` / `better-sqlite3` call anywhere;
   the single open is the pre-existing `src/db.ts:38` on a cwd-relative path,
   and every reviewer process ran with cwd set to the scratch directory. All
   reviewer reads of the live file used `{ readonly: true }`.
4. The process holding `flights.db` read-write is pid 426680, cwd
   `/home/guilherme/msfslogger`, fds 17/18/19 on db/-wal/-shm, started 14:39 —
   the operator's own server, mid-ingest; `-wal` stayed 4124152 bytes while the
   main file changed, the signature of a passive WAL checkpoint.

Port 3000 was never started, stopped or rebuilt against: pid 426680 is the same
process at the start and end of the review. The scratch server (pid 518454, port
3100) was stopped by the reviewer and port 3100 is closed; the scratch directory
is deleted.

## Findings

**Blocking: none.**

## Non-blocking follow-ups

1. `PUT /api/settings/simbrief` with `{}` (field entirely absent) returns `200`
   and **clears** the setting — verified: `PUT {}` → `{"simbrief_user_id":null}`.
   Design § 3.3 rule 1 only covers a field that is "present"; full-replacement
   PUT semantics make this defensible and the client always sends the field, so
   it is not drift. Worth a line in the design if a future caller does a partial
   update. (`src/simbrief.ts:32`.)
2. `GET /api/settings/simbrief` has no `try/catch`, unlike the PUT. A database
   error there falls through to express's default handler and answers HTML
   rather than the `{ error }` JSON § 3.4 uses for the write. Cosmetic today.
   (`src/server.ts:521`.)
3. Pre-existing, untouched by this run: malformed JSON on a non-settings route
   returns an HTML page containing a stack trace with absolute filesystem paths.
   Candidate for its own run.
4. The new section renders the heading "Import from SimBrief" with only the ID
   field under it until phase 2 adds the Import button — expected mid-phase, but
   do not ship phase 1 alone.
5. `user_stories/simbrief_integration.md` is untracked and outside both tasks'
   `allowed_paths`. Its mtime (13:18) precedes implementation and `design.md`
   cites it, so it reads as the operator's own input rather than an implementer
   writing out of scope — flagged as a question for the Orchestrator, not a
   finding.
