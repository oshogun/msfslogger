# T-009 — end-to-end acceptance against `user_stories/refactor.md`

All commands run from `/home/guilherme/msfslogger` under Node 20.20.2
(`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20`).

Baseline commit referred to below as `$B` = `8fcf3638c9496dc284cca246e1da880d178e0f2b`.
**`HEAD` is still `$B`** — the whole refactor is uncommitted working tree, so every
`git diff $B..HEAD` is trivially empty. Where a criterion asks for such a diff, the
working tree is checked too (`git status --porcelain -- <paths>`); both are pasted.

Live `flights.db` md5 **before** `75e2a874dd79c0930e20cab93eff7ec5`,
**after** `75e2a874dd79c0930e20cab93eff7ec5` — unchanged. User's server still on
3000 (`ss -ltnp` → `pid=626442`, elapsed 15211 s, never restarted, never touched).

---

## Criterion 1 — `db.ts` no longer contains all DB responsibilities

`wc -l src/db.ts src/db/*.ts`:

```
   11 src/db.ts          43 src/db/connection.ts     273 src/db/flights.ts
  669 src/db/plannedLegs.ts   298 src/db/schema.ts    110 src/db/settings.ts
  176 src/db/trips.ts    1580 total
```

`src/db.ts` is 11 lines (≤ 40) and is a pure re-export barrel.
`grep -c 'prepare(' src/db.ts` → **`0`**: no SQL left in it.

The four spec-named files exist: `src/db/flights.ts`, `src/db/trips.ts`,
`src/db/plannedLegs.ts`, `src/db/settings.ts` (plus `connection.ts` and
`schema.ts`, which the frozen design added for the handle and the DDL).

**PASS.** (~1400 lines → 11.)

## Criterion 2 — `server.ts` no longer contains all route handlers

`wc -l src/server.ts src/routes/*.ts`:

```
  186 src/server.ts      219 src/routes/exports.ts   158 src/routes/flights.ts
  474 src/routes/plannedLegs.ts    47 src/routes/settings.ts
  166 src/routes/trips.ts    42 src/routes/uploads.ts   1292 total
```

`grep -n "app\.\(get\|post\|put\|patch\|delete\|all\)(" src/server.ts` →
exactly two lines:

```
81:  app.get('/api/status', ...)
152:  app.get('*', ...)          ← SPA catch-all
```

All five spec-named routers exist and carry the handlers
(`grep -c "router\.(get|post|put|patch|delete)("`):
flights 8, trips 10, settings 2, plannedLegs 9, exports 5 = 34.
`uploads.ts` is shared multer config, not a sixth router.
34 + `/api/status` 1 + ingest 3 + auth 3 + catch-all 1 = **42** — matches the
route table below exactly.

**PASS.** (~1000 lines → 186, of which the remainder is middleware wiring,
`/api/status`, the catch-all and the app-level error handler.)

## Criterion 3 — `FlightManager` remains the domain/state-machine boundary

```
$ git diff --stat $B..HEAD -- src/flightManager.ts
(empty)
$ git diff $B..HEAD -- src/legMatcher.ts src/plannedLegClose.ts src/ingest.ts src/types.ts
(empty)
$ git status --porcelain -- src/flightManager.ts src/legMatcher.ts src/plannedLegClose.ts src/ingest.ts src/types.ts
(empty)
```

Both the committed diff and the working tree are clean: the five domain modules
are byte-identical to the pre-refactor tree. The routers call into
`flightManager` exactly as `server.ts` did.

**PASS.**

## Criterion 4 — No ORM added

```
$ git diff $B..HEAD -- package.json package-lock.json
(empty)
$ git status --porcelain -- package.json package-lock.json
(empty)
```

Runtime dependencies, read out of `package.json`, are still exactly:
`better-sqlite3, express, express-session, fast-xml-parser, multer, pdf-lib, puppeteer`.
A scan of dependencies *and* devDependencies for
`prisma, @prisma/client, typeorm, sequelize, knex, drizzle-orm, objection, mikro-orm, bookshelf`
→ **`orm present: none`**. Every `src/db/*.ts` module still writes raw SQL
through `getDb().prepare(...)`.

**PASS.**

## Criterion 5 — Application behavior remains functionally equivalent

### Route table

`routes.after.txt` regenerated with `src/inspect-routes.ts` from a scratch cwd
holding a `flights.db` copy (`NODE_PATH`/`TS_NODE_PROJECT`/`TS_NODE_FILES=true`
as T-001 documented). **42 routes**, same as baseline.

- Sorted-set comparison — `diff <(sort routes.before.txt) <(sort routes.after.txt)`
  → **empty, exit 0**. No route added, dropped or renamed.
- Ordered comparison is *not* empty, and reproduces exactly the one known,
  already-approved deviation: the six `/api/flights/:id*` patterns move from
  table positions 19-24 to 10-15, because `createFlightsRouter` mounts as one
  contiguous block where the original interleaved four blocks. Nothing else
  moves. The phase-2 review proved with `path-to-regexp` over 495 method×path
  combinations that first-match is identical in both orders, and approved it.

### db public surface

`node -e "Object.keys(require('./dist/db')).sort()"` → 51 names.
`diff db-exports.before.txt db-exports.after.txt` → **empty, exit 0**.
The `./db` import surface is unchanged name-for-name.

### Gates

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run test:types` | exit 0, no output |
| `npm test` | `Test Files 17 passed (17)` / `Tests 327 passed (327)` |
| `npm run build:server` | exit 0; `dist/db/` and `dist/routes/` emitted, tree shippable |

### Smoke pass — scratch server, port 3100, copy of `flights.db`

Scratch cwd with `flights.db` copy, `dist`/`client`/`node_modules` symlinked;
password set on the copy with `node dist/setPassword.js --username smoke`;
`PORT=3100 BIND_HOST=127.0.0.1 SESSION_SECRET=… INGEST_TOKEN=…`; cookie jar.

| # | Request | Response |
|---|---|---|
| 0 | `GET /api/status` (no cookie) | 401 |
| 1 | `POST /api/auth/login` | 200 `{"user":{"username":"smoke"}}` |
| 2 | `GET /api/auth/session` | 200 `{"authenticated":true,"user":{"username":"smoke"}}` |
| 3 | `GET /api/flights` | 200, 36251 B, **55 flights** |
| 4 | `GET /api/flights/83` | 200, 8734 B, 23 keys incl. `planned_leg_id`, `points` |
| 5 | `GET /api/trips` | 200, 36687 B, 1 trip — `Circumnavegação` |
| 6 | `GET /api/trips/1` | 200, 15.9 MB, `flights: 54`, `planned_legs: 20` |
| 7 | `GET /api/trips/1/planned-legs` | 200, 60251 B, 20 legs, first `id:4 seq:1 KMRY status:flown` |
| 8 | `GET /api/trips/1/journey` | 200, 364974 B, `legCount 54`, `legs[] 54`, `airports 55`, `13388.8 nm` |
| 9 | `GET /api/active-trip` | 200 `{"tripId":1,"name":"Circumnavegação"}` |
| 10 | `GET /api/flights/83/export.kml` | 200, 2542 B, `Content-Type: application/vnd.google-earth.kml+xml`, `filename="flight-83-2026-09-14.kml"` |
| 11 | `GET /api/trips/1/export.kml` | 200, 2068578 B — byte count matches the phase-2 differential run |
| 12 | `GET /api/flights/83/export.pdf` | 200, 394185 B, `Content-Type: application/pdf`; `file` → `PDF document, version 1.4, 1 page(s)` |
| 13 | `POST /api/flights/export.kml` `{"ids":[83,81,80]}` | 200, 126510 B, 3 `<Placemark>` |
| 14 | `GET /api/settings/simbrief` | 200 `{"simbrief_user_id":"1099607"}` |
| 15 | `GET /api/planned-legs/4` | 200, 4774 B |
| 16 | `GET /api/status` (authed) | 200 `{"connected":false,"flightState":"IDLE",…}` — no `plannedLeg`/`traffic` keys, as before |
| 17 | `GET /api/flights/999999` | 404 `{"error":"Not found"}` |
| 18 | `GET /api/flights/notanumber` | 400 `{"error":"Invalid id"}` |
| 19 | `GET /api/trips/999999` | 404 `{"error":"Not found"}` |
| 20 | `GET /api/planned-legs/999999` | 404 `{"error":"Not found"}` |
| 21 | `PUT /api/settings/simbrief` malformed JSON | 400 `{"error":"Invalid request body","code":"INVALID_BODY"}` — app-level handler still reached from inside a mounted router |
| 22 | `GET /trips/1` | 200 `text/html` — SPA catch-all still last |
| 23 | `GET /api/flights` (no cookie) | 401 `{"error":"Authentication required"}` — the `app.use('/api', requireAuth)` gate still covers routers mounted after it |

**PASS.** Case 12 (`POST /api/flights/export.kml` with id 82) initially returned
404 `{"error":"Flight 82 not found"}`; 82 is genuinely absent from the copy, and
the retry with three real ids is row 13. Correct behaviour, not a regression.

## Client untouched

```
$ git diff --stat $B..HEAD -- client/
(empty)
$ git status --porcelain -- client/
(empty)
```

**PASS.**

## Housekeeping

- Live `flights.db` md5 identical before and after (above). Never opened by any
  command here: every server and inspector ran from a scratch cwd holding a copy,
  and `src/db/connection.ts` only opens a handle inside `initDb()`.
- Scratch server stopped **by tracked PID**, never by pattern. `$!` recorded
  700765; `ss -ltnp` showed the listener on `127.0.0.1:3100` was in fact its
  child 700767 (`/proc/700767/cwd` → the scratch dir), killed by that exact pid.
  Both gone; `ss` → `port 3100 free`. Port 3000 listener untouched.
- Scratch dirs deleted; the `airports.json` the scratch server cached was written
  into the scratch cwd and went with it.
- No run-artifact citation anywhere in shipped code:
  `grep -rn '\.claude/runs\|design\.md\|T-0[0-9][0-9]\|ctx\.sh' src/ tests/` →
  only two false positives, the fixture filenames `bad-no-plan.json`.
- `git status --porcelain`: the only file this task changed is
  `tests/lnmpln.test.ts`. Everything else listed (`src/db.ts`, `src/server.ts`,
  `src/db/`, `src/routes/`, `src/inspect-routes.ts`) is the run's earlier,
  already-reviewed work, still uncommitted because the Orchestrator owns commits.
  `user_stories/*.md` and `windows-client/.claude/` were untracked before this run.

## Cleanup done

`tests/lnmpln.test.ts:180` cited `src/server.ts:481` for the `file.buffer` call
site. `grep -rn 'parseLnmpln' src/` puts the real call at
**`src/routes/plannedLegs.ts:110`** (`plan = parseLnmpln(file.buffer)`), not
`src/routes/flights.ts` as the task envelope guessed. The comment now reads
`src/routes/plannedLegs.ts passes file.buffer`, with the line number dropped so
it cannot go stale again. `npm test` after the edit: 327 passed.

## Verdict

All five acceptance criteria in `user_stories/refactor.md` **PASS**, plus the two
extra guards (client untouched, live DB untouched).
