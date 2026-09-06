# Ship report — phase 5 (T-023)

**Task:** T-023 · devops · phase 5
**Scope:** `Dockerfile`, `docker-compose.yml`, `README.md`, plus one label fix in
`client/src/pages/TripDetail.tsx` (widened into this task's `allowed_paths` — see the corresponding
plan.json amendment — after the phase-5 review surfaced a phase-3-era string that contradicted this
report's own README claim).

---

## 1. Clean build from a clean checkout

```
npm ci               (root, Node 20.20.2 via nvm — the default Node 26 in this environment
                       cannot load better-sqlite3, same constraint the phase-1 report recorded)
npm run build         tsc (client) && vite build && tsc (server)
```

Result: exit 0, no TypeScript errors, `client/dist` and `dist/*.js` produced. Re-run at the end of
this task, after the README/label edits, with the same result.

`node .claude/runs/2026-09-04-lnmpln-trip-planner/tools/check-type-mirror.js .` — `No drift`
(`PlannedLeg`/`PlannedWaypoint`/`PlannedAlternate` all match between `src/types.ts` and
`client/src/types.ts`).

## 2. Database migration + backup/restore rehearsal

Against a **scratch** copy of the schema (never the live `flights.db`), built by importing a real
`.lnmpln` fixture into two trips (one plan-only, one with a flown flight):

```
npm run backup   ->  76 KB  1 flights, 2 points, 2 trips
```

Restoring that backup's `flights.db` into a scratch directory and reading it directly with
`better-sqlite3` (read-only) confirms:

- Tables present: `flight_points, flights, planned_alternates, planned_legs, planned_waypoints,
  sqlite_sequence, trips` — all three planned-leg tables survive the backup/restore round trip.
- `planned_legs` rows read back intact, including `approx_distance_nm`.
- `planned_waypoints` count matches what was imported (14 rows for the two legs).

**PASS.** No migration step is specific to phase 5 — the schema was frozen in phase 1 (T-003); this
phase adds no columns and no tables, only computed fields in API responses.

## 3. Docker image build + smoke test

One environment snag, unrelated to this repository: this sandbox's cached Docker Hub credential was
stale (`401 Unauthorized` pulling `node:20-alpine`), fixed with `docker logout`.

```
docker build -t msfslogger-phase5-check .    real 7m25s (cold npm/apk caches — three stages,
                                              two npm ci's compiling better-sqlite3's native
                                              binding), exit 0
```

No `Dockerfile`/`docker-compose.yml` change was needed: `fast-xml-parser` (phase 1) is pure JS with
no native bindings, and this feature adds no new directory the image or its bind mounts need to know
about — every planned-leg row lives inside `flights.db`, already bind-mounted.

**Smoke test**, container run from the built image with no bind mounts (a throwaway internal
`flights.db`, deliberately — this is a boot check, not a data test, which the backup/restore
rehearsal above already covers):

```
docker run -d --name msfslogger-phase5-smoketest -p 3998:3000 msfslogger-phase5-check
```

Container log:
```
[DB] Database ready
[Airports] Loaded 29549 airports from cache
[Ingest] Waiting for agent data on /api/ingest
[HTTP] Server running at http://localhost:3000
```

`curl http://127.0.0.1:3998/api/status` → `HTTP 200`,
`{"connected":false,"flightState":"IDLE","currentFlightId":null,"paused":false,"pauseFlags":0,"simRunning":0,"onGround":true,"aircraft":null,"frame":null}`
— byte-identical to the documented pre-feature shape, with no `plannedLeg` key, confirmed from
**inside the actual production image**, not just the dev build. `airports.json` (bundled at build
time via `COPY airports.json ./`) loaded correctly from the container's own cache.

One self-inflicted wrinkle, disclosed: the command that started the container and curled it took
long enough (image lookup + container boot) that the harness moved it to the background before its
own output was visible; I judged it stuck, `kill -9`'d the `docker run` process and removed the
container — only to have the background task's actual output land moments later showing it had
in fact succeeded end to end (the log and curl output above are from that late-arriving output, not
re-run). No repository state was affected either way. Image and the smoke-test container removed
afterward; `docker images`/`docker ps -a` show neither remains.

## 4. README

Added a **Trip plans (Little Navmap import)** section (after PDF export) covering: what an imported
route is and how it differs from the PDF flight-plan attachment, how multi-file import chain-sorts
(and when it falls back to upload order), the `approx.` distance caveat, the active-trip flag, and
the automatic vs. manual linking table. Cross-linked from the "How it works" intro (trip atlas
progress, live-panel destination/next-waypoint/remaining-distance) and from the Atlas paragraph.
Added `lnmpln.ts`, `legMatcher.ts` and `journey.ts` to the `src/` tree listing.

**One label fix, found while writing this section.** Confirming the README's central claim — that an
imported route is a different thing from the PDF flight-plan attachment — required checking that no
UI string says otherwise. `TripDetail.tsx`'s own LNMPLN import section was titled **"Import Flight
Plan(s)"** (phase 3, T-012), a direct collision with design.md §1's naming rule and with this
report's own paragraph two sentences later. Fixed to **"Import Planned Route (.lnmpln)"** — recorded
as an amendment to T-023's `allowed_paths` and detailed in `reviews/phase5.md`'s cross-cutting
checks. Every other "flight plan" string in the client (`FlightDetail.tsx`'s attachment section,
`TripDetail.tsx`'s "Include flight plans (N)" PDF checkbox, and the `flight-plan-*` CSS class names
reused for unrelated status text) was checked and correctly refers to the PDF feature — left alone.

## 5. Residual risk carried into production

1. **Docker + Puppeteer**, pre-existing and unchanged by this feature: the production image's
   `node:20-alpine` base cannot run Puppeteer's bundled Chromium (glibc vs musl) — documented already
   in the README's "Docker caveat" under PDF export, not something phase 5 introduces or fixes. A
   trip export with a planned-but-unflown route (this phase's new map case) hits the same caveat as
   every other export once Chromium itself is the blocker; it does not add a new failure mode. The
   §3 smoke test above only exercises `/api/status`, not PDF export, since that caveat is
   pre-existing and already documented.
2. **`crossTrackNm`'s flat-plane next-waypoint heuristic** (flagged F-1 in `reviews/phase5.md`) is
   unvalidated outside California-scale VFR/IFR fixtures — long-range or high-latitude legs could
   show a slightly early/late waypoint switch. Low severity: it only affects which waypoint is named
   "next," never a stored value.
3. **The 10 nm auto-match radius** and **`<Alternates>` fixture coverage** are unchanged, carried
   forward from the phase-4 review's residual risks.
4. One process-safety incident during the phase-5 review (a `cat` that briefly read the real
   production server's own log file rather than a scratch one) is disclosed in full in
   `reviews/phase5.md` — it was a read only, confirmed to have caused no write or signal to the real
   server or database, and every command after it was run with an explicit single-line/PID-captured
   discipline to make the ambiguity that caused it impossible to repeat silently.
