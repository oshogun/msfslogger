# T-006 — Build, dependency and migration rehearsal (phase 1)

Environment: Node 20.20.2 via nvm (default node v26 cannot load `better-sqlite3`).
All work done against copies; the live `flights.db` was never opened for writes.

## 1. Clean install + build (in a scratch copy, not the working tree)

Repo copied (rsync, excluding `node_modules`, `client/node_modules`, `flights.db*`,
`backups/`, `dist/`, `client/dist/`, `.git`) to a scratch dir — 14 MB copied.

```
npm install (root)     15.0s   → added 277 packages, resolved fast-xml-parser@5.11.1
npm install (client)     2.8s   → added 76 packages
npm run build            9.0s   → build:client (tsc + vite) then build:server (tsc), exit 0
```

`node_modules` after install: 181 MB (root) + 76 MB (client). No TypeScript errors
in either step; `client/dist` and `dist/*.js` produced correctly. **PASS.**

## 2. Migration against a copy of the live database

Live db backed up in place with `npm run backup` (online backup API, safe while
live) → `backups/20260904-225251/flights.db`, 3.1 MB, reported 33 flights / 1 trip.
That file was copied into the scratch repo as `flights.db`.

Before starting the built server: tables = `flight_points, flights, sqlite_sequence, trips`; 33 flights, 1 trip.

Started `node dist/index.js` (PORT=3999) against it — logged `[DB] Database ready`,
no errors. After startup: tables = `flight_points, flights, planned_alternates,
planned_legs, planned_waypoints, sqlite_sequence, trips`; **33 flights, 1 trip — unchanged.** **PASS.**

## 3. End-to-end scenario (real fixtures, alphabetical upload order)

`POST /api/trips` → trip id 2. Imported the three VFR files from `samples/lnmpln/`
via `POST /api/trips/2/planned-legs` (field `lnmpln`), alphabetical order:
`VFR ... KSTS to ... KACV`, `VFR ... KMRY to ... KSTS`, `VFR ... KSBA to ... KMRY`.

Response: `"batch": {"ordering": "chain", "reason": "CHAINED"}`. `GET /api/trips/2/planned-legs` read-back:

```
seq=1 KSBA -> KMRY
seq=2 KMRY -> KSTS
seq=3 KSTS -> KACV
```

Matches the expected reverse-of-upload-order result exactly. **PASS.**

## 4. Backup + tables after schema change

`npm run backup` in the scratch repo (post-migration, post-import) succeeded:
`3.1 MB  33 flights, 28820 points, 2 trips`. Backup file's tables (via better-sqlite3,
no `sqlite3` CLI on this machine): `flight_points, flights, planned_alternates,
planned_legs, planned_waypoints, sqlite_sequence, trips` — all three new tables present. **PASS.**

## 5. fast-xml-parser footprint / Docker impact

Installed size 1.4 MB (package alone), 2.2 MB total with its 6 transitive deps
(`@nodable/entities`, `fast-xml-builder`, `is-unsafe`, `path-expression-matcher`,
`strnum`, `xml-naming`) — all pure JS, no native bindings, no compile step.
`npm ls fast-xml-parser --all` resolves cleanly to `fast-xml-parser@5.11.1`.

**Dockerfile / docker-compose.yml: no change needed.** `npm ci` already installs
whatever `package.json`/`package-lock.json` list; nothing here needs a system
package, a build tool, or an env var. This dependency does not touch the existing
PDF-export/Alpine caveat at all — that failure is about Puppeteer's glibc
Chromium on musl, unrelated to XML parsing; PDF export remains broken as-shipped
in the provided image regardless of this feature.

## 6. Restore check

Copied the post-schema-change backup (`backups/20260904-225341/flights.db`, made
in step 4) into a fresh scratch dir and queried it directly (no server): 33
flights, 2 trips, and `planned_legs` for trip 2 read back as
`seq 1 KSBA→KMRY, 2 KMRY→KSTS, 3 KSTS→KACV` — identical to step 3, confirming the
three planned legs survive a backup/restore cycle in correct route order. **PASS.**

## Live database re-verification

After all rehearsal: `flights.db` in the working tree still shows tables
`flight_points, flights, sqlite_sequence, trips` (no `planned_legs`), 33 flights,
1 trip. **Untouched**, as required.

## Summary

All 7 DoD items pass. No blockers. No source file, `package.json`, `Dockerfile`
or `docker-compose.yml` was modified by this task — all rehearsal happened in
`/tmp/.../scratchpad/t006-rehearsal/` and the pre-existing `backups/` snapshot
in the live repo.
