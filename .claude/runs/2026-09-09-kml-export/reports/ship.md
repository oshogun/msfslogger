# Ship report — T-010, run 2026-09-09-kml-export

All commands run under `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20`.

## 0. Baseline (before any work)

- `md5sum flights.db` → `7a6651ecfa30fab34ce52340b7f7f5cb  flights.db`
- Live server: `lsof -i :3000 -sTCP:LISTEN` → `node 560059 guilherme ... TCP *:3000 (LISTEN)`

## 1. Clean build

`rm -rf dist client/dist` then `npm run build` → **exit 0**. Full log:
`/tmp/claude-1000/-home-guilherme-msfslogger/a0cfcd99-3efa-47e5-8bb3-07f6cc088833/scratchpad/build.log`.
Deciding lines: `vite build ... ✓ built in 2.05s` (client), `tsc` with no output (server, clean). Produced:
`dist/index.js` (1753 bytes), `client/dist/index.html`. **The tree is left in a
shippable state** — the user's next restart of the live server on port 3000
would load this `dist/` with no further action.

## 2. Tests and types

- `npm test` → `Test Files 11 passed (11)` / `Tests 211 passed (211)` — exit 0.
- `npm run test:types` → `tsc -p tsconfig.test.json` with no output — exit 0.

## 3. Scratch server

Set up per the exact recipe against a copy of `flights.db` (+ wal/shm) in
`$SCRATCH/app`, started on `PORT=3100`:
```
[DB] Database ready
[HTTP] Server running at http://localhost:3100
```
PID 663317, confirmed listening via `lsof -i :3100`. Shut down at end with
`kill 663317`; `lsof -i :3100` afterward returned nothing (port free). Port
3000's PID (560059) unchanged throughout, confirmed by `lsof -i :3000` again
after shutdown. Repo `flights.db` md5 unchanged after (`7a6651ecfa30fab34ce52340b7f7f5cb`,
matches §0). The scratch copy at `$SCRATCH/app/flights.db` was a real file
copy, not a symlink.

## 4. Export path sweep (against scratch server, port 3100)

| Request | Status | Content-Type | Bytes | Containers | XML valid |
|---|---|---|---|---|---|
| `GET /api/flights/63/export.kml` | 200 | `application/vnd.google-earth.kml+xml; charset=utf-8` | 45802 | 0 Folder / 1 Placemark | `true` |
| `GET /api/trips/1/export.kml` | 200 | same | 1668796 | 45 Folder / 45 Placemark | `true` |
| `POST /api/flights/export.kml {"ids":[63,59,57]}` | 200 | same | 175193 | 3 Folder / 3 Placemark | `true` |

Byte counts (`wc -c`) match each response's `Content-Length` header exactly.
Trip 1 has 45 flights; folder/placemark counts match. Validation command:
`node -e "const {XMLValidator}=require('fast-xml-parser');console.log(JSON.stringify(XMLValidator.validate(fs.readFileSync(f,'utf8'))))"`
run from the repo root (so `fast-xml-parser` resolves) against each saved body
→ `true` for all three.

Error-path spot checks: invalid id → 400, unknown flight id → 404, unknown
trip id → 404, empty `ids` array → 400 `{"error":"ids must contain at least
one flight id"}` — all match §2.4.

Regression:
- `GET /api/flights/63/export.pdf` → `200`, `Content-Type: application/pdf`.
- `GET /api/trips/1/export.pdf` → `200`, `Content-Type: application/pdf`.
- `GET /flights/1` → returns `index.html` (`<!DOCTYPE html>...msfslogger...`),
  SPA catch-all unregressed.

## 5. Packaging diff

`git diff --stat package.json package-lock.json Dockerfile* client/package.json`
→ **empty**. No dependency, build-script, or Dockerfile change in this run —
this is why no Docker image rebuild or deploy-story change is needed to ship
this feature; the existing image/build pipeline covers it unchanged.

## 6. Live database / live server integrity

- `md5sum flights.db` before: `7a6651ecfa30fab34ce52340b7f7f5cb`; after:
  `7a6651ecfa30fab34ce52340b7f7f5cb` — **identical**.
- Live PID on port 3000: `560059` before and after — **unchanged**, never
  stopped/restarted/reconfigured.

## 7. Working-tree check

`git status --porcelain` after all work:
```
 M README.md
 M client/src/pages/FlightDetail.tsx
 M client/src/pages/Home.tsx
 M client/src/pages/TripDetail.tsx
 M client/src/utils/api.ts
 M src/server.ts
?? .claude/runs/2026-09-07-gpx-import/
?? .claude/runs/2026-09-08-docker-pdf-export/
?? .claude/runs/2026-09-09-kml-export/
?? src/inspect-kml.ts
?? src/kmlExport.ts
?? tests/kmlExport.test.ts
```
These are the accumulated, uncommitted changes from the four prior phases of
this run (generator, routes, tests, client UI, and a README update
documenting the "KML export" section — verified against `git diff README.md`,
its content accurately describes the three endpoints and behavior just
exercised above). **This task (T-010) issued no `Write`/`Edit` call and used
only `Bash` read/build/test/curl commands** — no source file was modified by
me. `.claude/runs/2026-09-09-kml-export/` and this report are the only paths
this task added.

## Summary of what was NOT re-verified

Per §8.6 of the design: no KML viewer exists in this environment, so "opens
correctly in Google Earth" is not proven here — only well-formedness, byte
sizes, and container counts were checked, matching the design's stated limits.
