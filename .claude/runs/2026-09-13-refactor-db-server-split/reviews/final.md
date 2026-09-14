# Final review — T-010 — refactor: split `db.ts` and `server.ts`

**Verdict: APPROVE.** No blocking findings. 7 non-blocking follow-ups.

All evidence below was produced by me. I did not read the implementer reports or the
phase reviews as evidence (only phase-2's `risks` / "not verified" list, to target my
own checks). Node 20 via nvm for every command.

## Safety

- Snapshot: `npm run backup` → `backups/20260914-043328`. Both scratch trees ran off
  copies of it.
- Live `flights.db` md5 `280c54ea…` → `e35799c9…`. **The file changed; the user's data
  did not.** Row counts identical across all 9 tables, and an md5 over the full contents
  of `flights`, `trips`, `planned_legs`, `planned_waypoints`, `planned_alternates`,
  `flight_points`, `app_setting` is `20eb54c7fe0f34f5c5a781d45f80687d` on both the live
  file and the pre-work snapshot → `USER DATA UNCHANGED: true`. `lsof` shows the only
  writer is the user's own server (pid 626442); the delta is its WAL churn.
- Scratch servers 3111/3112 started and killed by tracked PID. `3111/3112 free`;
  no process left with a scratchpad cwd. Port 3000 never touched.

## Acceptance criteria — `user_stories/refactor.md`

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `db.ts` no longer holds all DB responsibilities | **met** | `wc -l src/db.ts` = **11** (a pure `export *` barrel). `grep -c 'prepare(' src/db.ts` = **0**; statements now `flights.ts:18 trips.ts:14 plannedLegs.ts:35 settings.ts:12 schema.ts:2`. All four required files exist, plus `connection.ts`/`schema.ts`. |
| 2 | `server.ts` no longer holds all route handlers | **met** | `wc -l src/server.ts` = **186**. Only 2 `app.<verb>(` remain (`:81` `/api/status`, `:152` SPA `*`); 34 routes moved into 5 routers (`flights 8, trips 10, settings 2, plannedLegs 9, exports 5`), all required concerns present. |
| 3 | `FlightManager` remains the domain boundary | **met** | `git diff --stat HEAD -- src/flightManager.ts client/` → empty. Routers take `flightManager` as a parameter, never a module singleton (`routes/flights.ts:19`). |
| 4 | No ORM added | **met** | `git diff HEAD -- package.json package-lock.json` → empty. Deps unchanged: `better-sqlite3 express express-session fast-xml-parser multer pdf-lib puppeteer`. No prisma/typeorm/sequelize/drizzle/knex/objection. |
| 5 | Behaviour functionally equivalent | **met** | Five independent proofs, below. |

## Criterion 5 — the evidence I produced

Two trees: `before` = `git archive HEAD`, `after` = the worktree; identical
`node_modules`, identical DB copies, servers on 3111/3112.

1. **Route table.** Regenerated both with `src/inspect-routes.ts`; both match the
   committed baselines byte-for-byte. Ordered diff shows only the known phase-2
   deviation (the six `/api/flights/:id*` routes move above the `/api/trips*` block).
   **Sorted route set: `IDENTICAL-SORTED`.** The moved routes cross only `/api/trips*`
   and `/api/active-trip` — a different literal first segment, so no shadowing. Settled.
2. **Full middleware stack.** A scratch inspector dumped every top-level layer.
   Positions 1–10 (json, static, `/api/ingest`, session, `requireSameOrigin`,
   `/api/auth`, `/api` `requireAuth`, `/api/status`) and everything after the routers
   (SPA catch-all, error handler) are **identical**; only the 34 route layers collapse
   into 5 routers all mounted at `/api`. The auth gate still precedes every route.
3. **Differential HTTP, 60 requests** (`resp.before` vs `resp.after`): 15×200, 21×400,
   24×404 — **byte-identical**, including a 15.9 MB `/api/trips/1/journey`. The only
   diff is my own scratch path inside an SPA-catch-all ENOENT (no `client/dist` built).
4. **Differential mutation, 17 steps** — create trip, 2-file `.lnmpln` import,
   cross-batch duplicate, reorder, patch leg, assign/remove flight, active trip, patch
   flight, link/unlink planned leg, leg-status, delete leg, settings, delete trip:
   responses **identical after timestamp normalisation (`diff-exit=0`)**, same generated
   ids (trip 2, legs 30/31). Resulting DBs dumped (53,029 rows) and diffed: **the only
   differing row is the `auth_user` password hash my own setup script randomised.**
5. **Failure paths.** All four `MulterError` branches now fire from inside mounted
   routers up to the app-level handler, identically on both:
   `File too large (max 20MB)` / `File too large (max 512KB)` (field-discriminated),
   `Too many files (max 25)`, `Too many fields`; plus `No file uploaded`,
   `No files uploaded`, `{"error":"Invalid request body","code":"INVALID_BODY"}` for a
   malformed `/api/settings/` body, `401 Authentication required` (matched and unmatched
   `/api`), `403 Cross-origin request rejected`, unauth ingest. **All identical.**

**Closing phase-2's "not verified" list.** PDF exports: re-run on both. They initially
differed (`%PDF-1.4/9961` vs `%PDF-1.7/11872090`) — **my harness, not the code**: the
`before` tree came from `git archive` and had no `flight_plans/` (untracked), so nothing
was appended. With `flight_plans/` present in both, both return `%PDF-1.7`, 11,872,095 vs
11,872,090 bytes. The residual delta is the scratch path embedded in a rendered ENOENT:
I inflated both content streams (10,962 bytes each, same length) and decoded the one
differing glyph run to `…/scratchpad/before/client/…` vs `…/after/client/…`. Rendering is
otherwise identical, and `Content-Type`/`Content-Disposition` match — including
`trip-circumnavegacao-2026-08-17.pdf`, which exercises the diacritics slug. **In-batch
`.lnmpln` duplicate**: same file twice in one request → identical `201` on both.
**Repo `dist/`**: `npx tsc --outDir` to scratch, then `diff -r` against `dist/` →
**`diff-exit=0`**. `dist/` is a clean build of the current source; the tree is shippable.

**Provenance of the move itself.** Normalising `getDb()`→`db`, the entire db-layer delta
over 969 code lines is 4 lines: `applySchema(db);`, the `applySchema` signature, and
`./types`→`../types`. Every SQL string is unchanged. The server-layer delta is router
scaffolding and re-pathed imports only.

## Static checks

`npx tsc --noEmit` exit 0 · `npm run test:types` clean · `npm test` **17 files, 327
tests passed** · `npm run build:server` exit 0 in scratch (emits `dist/db/*`,
`dist/routes/*`).

**Scope:** every changed or created path maps exactly to a task's `allowed_paths`
(`src/db.ts`, `src/server.ts`, `src/db/*`, `src/routes/*`, `src/inspect-routes.ts`,
`tests/lnmpln.test.ts`). No violation. **Comment hygiene:** no new `.claude/runs`,
run-id, `design.md`, `plan.json`, `T-NNN`, `§` or phase citations in `src/`,
`client/src/`, `tests/`. (`client/src/types.ts:261` "phase-1 review finding F-3"
pre-dates this run; `client/` is untouched.) **Security:** the two dynamic `SET` clauses
(`db/flights.ts:74`, `db/trips.ts:87`) are built from hard-coded `allowed` whitelists,
unchanged; every value is a bound parameter. No new fs/path handling.

## Are they still catch-all files?

No. `src/db.ts` is an 11-line barrel whose comment tells the next author to add to the
owning module, not to it. `src/server.ts` reads as one thing — wiring: middleware in a
frozen, commented order, five `app.use('/api', …)` mounts, the SPA catch-all, the error
handler. The only handler left inline is `/api/status`, which assembles `AppState` from
`flightManager` and `trafficStore` and belongs there. A reader arriving fresh gets the
request lifecycle on one screen.

## Non-blocking follow-ups

1. `src/routes/exports.ts:17` — the diacritics regex is now written with **raw combining
   characters** where `src/server.ts:97` (HEAD) had `/[̀-ͯ]/g`. I proved the
   two identical (same `.source` after unescaping; both yield `Circumnavegacao`), so this
   is not a defect — but U+0300 and U+036F are invisible marks that bind to the
   surrounding `[` and `-` in most editors. Restore the escapes.
2. `src/inspect-kml.ts:17` — "src/db.ts:9 freezes DB_PATH" is now stale; line 9 of
   `db.ts` is `export * from './db/plannedLegs';`. DB_PATH is `src/db/connection.ts:11`.
3. `src/plannedLegClose.ts:10-11` — "happens in the endpoint (src/server.ts)". That
   endpoint is now `src/routes/plannedLegs.ts`.
4. Import style splits: `routes/settings.ts:2` and `routes/exports.ts:2` import from the
   `'../db'` barrel; `flights`, `trips`, `plannedLegs` import concrete modules. Pick one.
5. `src/db/plannedLegs.ts` is 669 lines — the largest survivor — and owns `setActiveTrip`
   / `getActiveTripId`, which `routes/trips.ts:7` imports from it. The active-trip pair
   probably belongs in `db/trips.ts`; a later pass could split leg-matching out.
6. `src/geo.ts` is still dead code: `haversineNm` is redefined privately in
   `db/flights.ts:11`, `airports.ts:19` and `flightManager.ts:19`. Pre-existing.
7. Phase-2's note that `INVALID_BODY` is scoped to `/api/settings/` still stands as a
   deliberate narrowing, unchanged by this run.

## For the user (no agent may edit these)

- **`CLAUDE.md:124`** — "`src/trafficStore.ts`, `src/db.ts` and `src/ingest.ts` have no
  unit coverage yet". `src/db.ts` is now an 11-line barrel; the uncovered logic lives in
  `src/db/flights.ts`, `trips.ts`, `plannedLegs.ts`, `settings.ts`. The line should name
  `src/db/` so the follow-up run it points at targets the right files.
- **`dist/` now contains the refactor** (verified a clean build of current source). The
  user's next server restart picks it up. That is the intent, and it is functionally
  equivalent by the evidence above — but it is a restart-visible change, so it is worth
  saying out loud rather than letting them discover it.
