# Review — 2026-09-17-docs-overhaul

**Final verdict (round 2): `approve`.** The one blocking finding from round 1
is fixed and re-verified mechanically; all five non-blocking follow-ups were
also fixed. 6/6 acceptance criteria now pass, each checked independently.

Scope: `docs/` (13 new files, 1462 lines) + `README.md` (147 lines). No file
under `src/`, `client/`, `agent/` or `tests/` was touched by this run.

Safety: read-only review, both rounds. `md5sum flights.db` =
`d7b2a00eb72f9354dce759c3ccac9a3f` at every checkpoint. No server started, no
port used, no `npm run build`/`npm start`, nothing written outside this file
and the session scratchpad.

## Round 2 — re-verification

### B-1 (blocking, round 1) — fixed

`docs/api.md`'s Auth column now carries exactly three literal values. I did not
take the fix report's word for it: I parsed every table row out of `api.md` and
diffed the label against the compiled allow-list.

```
$ node -e '<parse api.md rows; compare each to isIngestScopedRoute() from dist/auth/ingestScope>'
rows checked: 52 mismatches: 0
```

All 13 `INGEST_SCOPED_ROUTES` entries (`src/auth/ingestScope.ts:15-29`) are
accounted for and nothing else claims token access:

| Allow-list entry | Where documented |
|---|---|
| `status` | `api.md:29` (prose, not a table row) |
| `acars-canned-messages` + 8 flight/leg ACARS entries | `api.md:110-118` (all 9 rows `session or token`, with `:104-106` stating the whole router is allow-listed) |
| `ground-session-current` | `api.md:125` |
| `settings-simbrief-read` | `api.md:132`, with `:133` noting the PUT is not |
| `planned-leg-simbrief-import` | `api.md:77`, with the asymmetry callout at `:87-90` |

The 35 previously-mislabelled rows (Flights 8, Trips 10, Planned legs 11,
Exports 5, `PUT /api/settings/simbrief`) now read `session`, which matches
`requireAuth` (`src/auth/middleware.ts:18-38`) — an off-list route never has
its `x-ingest-token` header read at all (`ingestScope.ts:71`).

### Non-blocking follow-ups 1–5 — all fixed

1. `docs/development.md:43-48` — no longer claims "every `src/db/*.ts` module";
   names the 7 modules `tests/db/` actually covers and calls out
   `groundSessions.ts` as having only indirect coverage. Matches `ls tests/db/`
   (7 files) against `ls src/db/` (8 modules).
2. `docs/development.md` — the stale "thinner coverage" line is gone, replaced
   by the `groundSessions.ts` gap at `:67-68`. No longer contradicts `:43`.
3. `docs/usage.md:96-99` — now lists all 11 prefixes emitted by `src/`
   (`[Config] [DB] [Auth] [HTTP] [Ingest] [FlightManager] [ACARS] [PDF] [KML]
   [Shutdown] [Airports]`, verified by grep over `src/**/*.ts`) and hedges with
   "among others".
4. `docs/glossary.md:14` — now links `architecture.md#leg-matching-and-closing`.
5. `README.md:98-104`, `:117-127` — Docker and Backups trimmed to the gotcha
   (`touch flights.db`; don't copy an open DB) plus links to
   `docs/setup.md#docker` / `docs/operations.md#backups`. README 156 → 147
   lines, still inside the 120–250 target.

Link checker re-run after the edits: `checked 111 internal links, bad: 0`
(relative paths **and** GitHub-slug anchors, including the two new deep links
in README and the corrected glossary anchor).

## Acceptance criteria — final

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | README concise, onboarding + links only | pass | 147 lines; every section quickstart-scale; §Documentation links 11 pages; duplicated command blocks removed in round 2 |
| 2 | `docs/index.md` links all pages | pass | Contents table lists all 12 siblings; `ls docs/*.md` = 13 files incl. index |
| 3 | Covers architecture/setup/configuration/usage/development/troubleshooting | pass | All six are full pages (198/155/76/116/101/107 lines) |
| 4 | Commands/examples verified against current behavior | pass | Round-1 source audit (below) plus the round-2 `api.md` diff: 52/52 rows correct |
| 5 | Internal links resolve | pass | Own checker, run before and after the fixes: 112 → 111 links, 0 bad both times |
| 6 | Contributor can set up from README + setup.md | pass | setup.md covers clone → nvm → install (root + client) → `npm run build` → `npm run set-password` → TLS/dev → agent → validate; order is correct since `set-password` is `node dist/setPassword.js` (`package.json:17`) and must follow `build` |

Commands I ran myself (Node 20 via nvm, round 1): `npx tsc --noEmit` →
`TSC_OK`; `npm run test:types` → clean; `npm test` → `Test Files 38 passed
(38) / Tests 850 passed (850)`. Not re-run in round 2 — the fixes touched only
`docs/` and `README.md`, which no build or test input reads. Per the envelope I
did not run `npm run build`, `npm start`, or anything writing `dist/`.

## Round-1 source audit (unchanged by the fixes, recorded for the next reader)

- **Route inventory** — every route in `src/routes/*.ts`, `src/ingest.ts`,
  `src/auth/routes.ts` is documented, in mount order, with none invented
  (`grep -nE "router\.(get|post|put|patch|delete)\("` = 56 routes = api.md's
  tables). Details confirmed: `201 {id}` on combine (`flights.ts:62`) and trip
  create (`trips.ts:32`); 20MB/PDF-magic attachment cap (`flights.ts:123`,
  `uploads.ts:13`); 512KB × 25 `.lnmpln` (`uploads.ts:31-32`); KML flight-set
  cap 100 (`kmlExport.ts:52`); `409` on `PATCH /planned-legs/:legId` with a
  linked flight (`plannedLegs.ts:598-603`); `404 NO_OPEN_GROUND_SESSION`
  (`groundSessions.ts:117`); `INVALID_BODY` path list (`server.ts:207-213`);
  `coui://html_ui` CORS confined to ingest (`ingest.ts:131-138`);
  `/api/status`'s conditional `plannedLeg`/`groundSession`/`traffic` spreads
  (`server.ts:126-128`).
- **configuration.md** — verified independently against `src/config.ts:97-219`
  (TLS pairing, loopback list, `ALLOW_PLAINTEXT_HTTP` truthy set,
  `INGEST_TOKEN` ≥16 *warns*, `SESSION_SECRET` ≥16 is *fatal*) and every
  out-of-config reader: `db/connection.ts:20`, `pdfExport.ts:28`,
  `ingest.ts:19-21`, `acars.ts:523-524/718-728`, `simbriefClient.ts:68/84`,
  `weatherClient.ts:108-110`, `agent/traffic.js:19-34`. Compose passthrough
  list matches `docker-compose.yml` exactly; no undocumented env var exists
  (`grep -roE "process\.env\.[A-Z_]+" src/ agent/`).
- **data-model.md** — verified independently: all 12 tables in
  `src/db/schema.ts` documented, none invented; `auth_user` `CHECK (id = 1)`
  (`:521`), partial unique indexes for open ground session (`:514`) and active
  trip (`:616`), `status` CHECK set (`:248`), `read_at` genuinely unwritten,
  `flights.trip_id` genuinely FK-less (`:569`).
- **architecture.md** — 5/3/10-frame debounces (`groundState.ts:21`,
  `flightManager.ts:25-26`), `<1kt` / `>30kt` / `<5kt` (`groundState.ts:29`,
  `flightManager.ts:339`, `:305`), 10nm radii (`legMatcher.ts:102/110`,
  `groundState.ts:38`), `MAX_COUNTED_GAP_MS = 60_000` + `interrupted` gating
  (`flightManager.ts:24`, `:940`), startup steps 1-7 in order (`index.ts`),
  middleware order (`server.ts:33-87`), client pages/hooks/poll intervals
  (`useStatus.ts:19`).
- **security.md** — scrypt `N=16384,r=8,p=1,keylen=32,saltlen=16`
  (`password.ts:14`), SHA-256 + `timingSafeEqual` (`ingestToken.ts:6,24`),
  `regenerate()` before login (`auth/routes.ts:73`), 10/15min throttle
  (`middleware.ts:89-91`), `trust proxy` unset, 6-hour sweep (`index.ts:54`).
- **operations.md** — `backup.ts:70,77,106-109`;
  `backfill-durations.ts:18,29,72` (dry-run default, `MIN_DIFF_SEC = 120`).
- **release.md** — `git tag` empty, no `CHANGELOG.md`, `package.json` version
  `1.0.0`, CI builds/tests only. Spec §3.2's omission rule is satisfied the
  stronger way: the file exists and `docs/index.md:50-53` states why it's short.
- **README ↔ docs consistency** — port 3000, the `BIND_HOST=127.0.0.1` +
  `devtoken1234567890` dev recipe, the TLS-before-non-loopback rule, the Docker
  `touch flights.db` prerequisite and the command set are stated consistently
  across README, setup.md, configuration.md, usage.md and development.md.

## Note for the committer (not a finding)

`git status` also shows ` M client/src/index.css` and
` M client/src/pages/Home.tsx`. Both were last written 2026-09-16, before this
run's docs edits (2026-09-17 13:0x), so they are pre-existing uncommitted work,
not part of this change. Keep them out of the docs commit.
