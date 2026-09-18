# Review — 2026-09-18-update-docs (docs targeted refresh)

**Verdict: approve** (round 2). Round 1 was `request_changes` — 2 blocking
findings in `docs/api.md`, 1 in `docs/development.md`. All three fixed and
re-verified against source, along with both non-blocking nits. Everything
else in the diff was verified correct in round 1 and is byte-unchanged.

Lens: documentation accuracy. Diff is docs-only (`git diff --stat -- docs` →
8 files, 134 insertions, 17 deletions); no application code changed.

## Verification summary

19 factual claim-groups checked independently against source; 16 correct, 3
wrong. No implementer report was read. Commands and outputs below.

| Area | Result |
|---|---|
| Ingest allow-list count (19) | correct |
| 6 new SayIntentions routes' auth column | correct (all 6, method+path, executed against the real matcher) |
| `PUT /api/settings/sayintentions` not allow-listed | correct |
| `sayintentions_links` schema | correct (7/7 columns, types, PK/FK) |
| `acars_messages.category` known-vs-open-set note | correct |
| SayIntentions route paths/methods | correct (5/5) |
| SayIntentions error codes + 10s timeout | correct (11/11 codes) |
| CI two-job structure / scripts | correct except one artifact-condition nit |
| `SAYINTENTIONS_API_BASE_URL` | correct |
| architecture / security / glossary / usage additions | correct except usage nits |
| Internal links + anchors | 0 broken |
| `tsc` / `test:types` / `npm test` | pass |

## Round-2 re-verification (2026-09-18)

Re-checked only what changed; the other 16 claim-groups are untouched
(`git diff --stat -- docs`: api.md 47→49, development.md 55→59, usage.md
12→14 insertions; architecture/configuration/data-model/glossary/security
identical to round 1, and the api.md route table at `:154-158` is byte-for-byte
what I already verified).

- **B1 fixed** — `docs/api.md:142-145` now reads "The link/import/clearance
  routes require a saved key (`409 NO_API_KEY` otherwise) — the link-status GET
  and the DELETE do not". Matches source exactly: `NO_API_KEY` is raised only
  at `src/routes/sayIntentions.ts:81` (POST link), `:158` (import), `:259`
  (clearance); `:47-67` (GET) and `:131-144` (DELETE) have no key check.
  "None of them ever returns the raw key" still holds — the GET returns the
  `api_key_set` boolean only (`:61`).
- **B2 fixed** — `docs/api.md:145-146` "Every route in this table is
  allow-listed (six, counting the settings GET above)". Table has 5 rows, all
  5 verified `true` against `isIngestScopedRoute` in round 1, + `GET
  /api/settings/sayintentions` = 6. Count and scope now both correct.
- **B3 fixed** — `docs/development.md:12` "most with a *.test.tsx beside it",
  and the new line at `:85-87` names the exceptions. Verified: 7 of 11 page
  components have tests; the four named are exactly `Device`, `Override`,
  `PrintFlight`, `PrintTrip`. Their characterisation also checks out —
  `Device.tsx:6` ("Deterministic drift, so the readouts move without ever
  meaning anything") and `Override.tsx` are easter eggs on `/device` and
  `/override` (`client/src/App.tsx:36-37`), and `PrintFlight`/`PrintTrip` are
  the `/print/flight/:id` and `/print/trip/:id` targets headless Chromium
  renders for PDF export (`src/routes/exports.ts:104,124`).
- **Nit 1 fixed** — "on success and failure both (skipped only if the job is
  cancelled)" is an exact reading of `if: ${{ !cancelled() }}`
  (`.github/workflows/ci.yml`).
- **Nit 2 fixed** — `docs/usage.md:79-86` now scopes the controls correctly
  (link/import flight-only, send in both scopes: `AcarsMessages.tsx:544`
  gates the link section on `scope === 'flight'`, while the SEND button at
  `:485-500` renders in both) and replaces "nothing else changes" with the
  disabled-section behaviour actually rendered at `:546-547`.
- Link + anchor checkers re-run after the edits: `LINKS OK`, `ALL ANCHORS OK`.

No new findings. Remaining follow-ups: items 3 and 4 below (both pre-existing,
neither introduced by this run).

## Blocking findings (round 1 — all now fixed)

### B1 — `docs/api.md:142-143`: "Every route here requires a saved key (`409 NO_API_KEY` otherwise)" is false for 2 of 5 routes

`GET /api/flights/:id/sayintentions/link` (`src/routes/sayIntentions.ts:47-67`)
and `DELETE .../link` (`:131-144`) perform **no** API-key check — neither can
return `NO_API_KEY`. The GET's whole purpose is to report key presence, which
the same page's own table row contradicts the prose with
(`api.md:152` — `{flight_id, linked, link, api_key_set}`).

Reproduction: the only `NO_API_KEY` responses in the router are at
`src/routes/sayIntentions.ts:79` (POST link), `:156` (POST import), `:256`
(POST clearance):

```
$ grep -n "NO_API_KEY" src/routes/sayIntentions.ts
81:          code: 'NO_API_KEY',
158:          code: 'NO_API_KEY',
259:          code: 'NO_API_KEY',
```

Fix: scope the sentence to the three write/pull routes, or say "the link,
import and clearance routes require a saved key; the link-status GET and the
DELETE do not."

### B2 — `docs/api.md:143`: "All six are allow-listed" — the section documents five routes

The `## SayIntentions` table (`api.md:152-156`) has 5 rows; the sentence's
subject two clauses earlier is "Every route **here**". Six is the count of
SayIntentions-related *allow-list entries* only if
`GET /api/settings/sayintentions` (documented in the Settings section above,
`api.md:134`) is folded in. As written the number does not match the table it
introduces. Fix: "All five are allow-listed (six, counting the settings GET
above)" or just "Every route in this table is allow-listed."

### B3 — `docs/development.md:12`: "One component per route, each with a `*.test.tsx` beside it" — false for 4 of 11 pages

```
$ ls client/src/pages/*.tsx | grep -v test | wc -l   # 11
$ for f in client/src/pages/*.tsx; do case $f in *test*) ;; *) [ -f "${f%.tsx}.test.tsx" ] || echo "no test: $f";; esac; done
no test: client/src/pages/Device.tsx
no test: client/src/pages/Override.tsx
no test: client/src/pages/PrintFlight.tsx
no test: client/src/pages/PrintTrip.tsx
```
Fix: "most with a `*.test.tsx` beside it" (7 of 11), which is also what the
Frontend component tests section at `:79` should reflect.

## Criteria verified independently (with the evidence that decided each)

**Allow-list count = 19** — parsed the array, not grepped:
```
$ npx ts-node -T -e "import {INGEST_SCOPED_ROUTES} from './src/auth/ingestScope'; console.log(INGEST_SCOPED_ROUTES.length)"
19
```
Entries 14-19 (`src/auth/ingestScope.ts:29-34`) are the SayIntentions ones.

**Every new auth column**, executed against the real gating function
`isIngestScopedRoute` (Node 20, `ts-node -T`):
```
true  GET /api/settings/sayintentions              (doc: session or token — allow-listed) ✓
false PUT /api/settings/sayintentions              (doc: session)                         ✓
true  GET /api/flights/42/sayintentions/link                                              ✓
true  POST /api/flights/42/sayintentions/link                                             ✓
true  DELETE /api/flights/42/sayintentions/link                                           ✓
true  POST /api/flights/42/sayintentions/import                                           ✓
true  POST /api/planned-legs/7/sayintentions/clearance                                    ✓
false PUT /api/settings/simbrief   (control — matches api.md:133)                          ✓
false DELETE /api/flights/42/sayintentions/import  (control — off-list variant)           ✓
```
Method *and* path pattern match for all six; `PUT /api/settings/sayintentions`
appears nowhere in `src/auth/ingestScope.ts` (no `PUT` entry exists at all).
`docs/api.md:18`'s "19 method+path pairs" is therefore exact, and no stale
"13" remains anywhere in `docs/` or `README.md`.

**Schema** — `docs/data-model.md:141-148` vs `src/db/schema.ts:570-590`: all 7
columns match name, type, nullability and default, including
`flight_id INTEGER PRIMARY KEY REFERENCES flights(id) ON DELETE CASCADE`,
`baseline_comm_id INTEGER NOT NULL DEFAULT 0`, `imported_count INTEGER NOT
NULL DEFAULT 0`. ER line `flights (1) ── (0..1) sayintentions_links` correct
(PK on `flight_id`). `sayIntentionsLinks.ts` row in the db-module table
matches its four exports (get/upsert/advance cursor/delete).

**`acars_messages.category`** — `KNOWN_ACARS_CATEGORIES` (`src/acars.ts:24-26`)
is exactly the six listed; `isValidAcarsCategory` is `/^[a-z][a-z0-9-]{0,31}$/`
(`:67-69`) → up to 32 chars, shape-only, no `CHECK` constraint ✓. `'atc'` is
written by the importer (`src/sayIntentions.ts:234,249`) and renders through
`badge-acars-other` — asserted by `client/src/pages/AcarsMessages.test.tsx:199`
(`expect(screen.getByText('atc')).toHaveClass('badge-acars-other')`), and each
of the six known categories has its own class (`client/src/index.css:1040-1045`).

**Error codes / timeout** — all 11 doc'd codes and statuses match
`ERROR_STATUS`/`ERROR_RESPONSE_CODE` (`src/sayIntentions.ts:79-97`) and the
route-local 409s (`NOT_LINKED` :168, `SESSION_CHANGED` :187,
`NO_COMMS_TO_LINK` :103, `NO_CLEARANCE` :268).
`SAYINTENTIONS_TIMEOUT_MS = 10_000` (`src/sayIntentionsClient.ts:57`) ✓.
`?from=now` semantics (`:86-90`, unknown value → session start, never an
error) ✓; DELETE never errors on a missing link (`:139-140`) ✓; clearance is
leg-scoped and needs no link, 128-char cap = `MAX_ACARS_IN_CHARS = 128`
(`src/acars.ts:511`) ✓.

**CI** — `.github/workflows/ci.yml`: `on: push` + `pull_request` no filter ✓;
`node-version-file: .nvmrc` (`.nvmrc` = 20) ✓; two jobs `build-and-test` and
`e2e` with `needs: build-and-test` ✓; step order and both `test:types`/`test`
pairs ✓; Playwright chromium install ✓; `MSFSLOGGER_E2E_SCRATCH: ${{ runner.temp }}/…` ✓;
`test-results/` on `if: failure()` ✓. Scripts `test:e2e`/`test:e2e:ui` exist in
`client/package.json` ✓. `client/e2e/scratch-server.sh` guards verified
literally: port 3000 refusal (`:11-12`), in-repo scratch refusal (`:19-21`),
default port 3210 (`:8`), build-in-scratch (`:69`), `node dist/testSeed.js`
with `FLIGHTS_DB_PATH` (`:71-72`); `src/testSeed.ts:85,110` refuses an unset
path and a non-fixture database. All four named spec files exist, as does
`user_stories/frontend_testing.md`.

**`SAYINTENTIONS_API_BASE_URL`** — read only at
`src/sayIntentionsClient.ts:82` (`process.env.… ?? 'https://apipri.sayintentions.ai/sapi'`),
never in `src/config.ts` — exactly the seam shape of `WEATHER_API_BASE_URL`
(`src/weatherClient.ts:110`) and `SIMBRIEF_API_BASE_URL`
(`src/simbriefClient.ts:84`) it is tabled with. Doc's default string matches ✓.

**Security row** — key lives in `app_setting` (`src/db/settings.ts:64,78`) ✓;
`maskApiKey` returns a fixed `'••••••••'` with no length leak
(`src/sayIntentions.ts:67-73`) and both GET and PUT return only
`{set, masked}` (`src/routes/settings.ts:52,70`) ✓; sent upstream as a query
parameter (`url.searchParams.set('api_key', apiKey)`,
`src/sayIntentionsClient.ts:210,343`) ✓.

**Links** — the brief's checker over `README.md` + `docs/*.md`: no output
(0 broken). Additionally resolved every `#anchor`, including the two new ones
(`api.md#sayintentions--srcroutessayintentionsts`,
`architecture.md#external-integration-points`): `ALL ANCHORS OK`.

**ASCII box** — measured right-border column per line, new vs `HEAD`: identical
line-for-line (71/72/73 pattern unchanged). The changed line
(`architecture.md:22`, "outbound: …") sits at column 72, the same column as its
unchanged siblings `:19-20`. No new alignment defect.

**Build/test** — Node 20.20.2, no emit, live server untouched:
`npx tsc --noEmit` → clean; `npm run test:types` → clean;
`npm test` → `Test Files 40 passed (40) / Tests 1004 passed (1004)`.

## Non-blocking follow-ups

1. `docs/development.md:89` — "uploads Playwright's HTML report … always" is
   `if: ${{ !cancelled() }}`, which skips a cancelled run. "on success and
   failure both" would be exact.
2. `docs/usage.md:79-84` — "Off by default; nothing else changes if you never
   set a key" overstates: with no key the flight ACARS page still renders a
   "SayIntentions" section reading "no API key saved (Prefiles → SayIntentions)"
   and a disabled SEND TO SAYINTENTIONS button
   (`client/src/pages/AcarsMessages.tsx:489,544-548`). Also "two more actions
   on a flight's ACARS page" — the push button also renders in the planned-leg
   scope, and the flight scope gains three controls (link/unlink, import, send).
3. `docs/architecture.md:14-23` — the component-map box is ragged by 1-2
   columns (borders at 71/72/73). Pre-existing, not introduced here; worth one
   cleanup pass someday.
4. Working tree carries unrelated uncommitted changes to
   `client/src/index.css` and `client/src/pages/Home.tsx` (collapsible ground
   section, `localStorage` key `msfslogger.groundSectionCollapsed`). Not part
   of this run and not described by any doc — the commit for this run should
   be path-scoped to `docs/`.

## Safety

Read-only review: no scratch server, no scratch database, no build. Only
`tsc --noEmit`, `test:types` and the hermetic Vitest suite were run. Live
`flights.db` md5 `054a13b48be4933b25fd902c8ca34a51` (unchanged; nothing in
this review opened it for write). `client/dist/index.html` and `dist/index.js`
mtimes still `2026-09-18 00:30:52` / `00:30:55` — no build output overwritten.
No file outside this review document was written.
