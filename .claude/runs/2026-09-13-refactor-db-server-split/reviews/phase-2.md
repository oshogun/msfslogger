# Phase 2 gate — route layer split (T-005, T-006, T-007)

**Verdict: APPROVE.** No blocking findings. 2 non-blocking follow-ups.

Everything below was re-run by me against a scratch copy and a `git worktree` of
`8fcf3638c9496dc284cca246e1da880d178e0f2b`. The implementer reports were not read
as evidence (only their `risks` sections).

- Live `flights.db` md5 **before** `31ee33032c6d2a334af3323f74217f40`,
  **after** `31ee33032c6d2a334af3323f74217f40` — unchanged.
- User's server still listening on 3000 (`ss -ltnp` → `pid=626442`). Never touched.
- Scratch servers on 3101/3102, killed by tracked PID (693658, 693659), both confirmed down.
  Worktree removed, scratch trees deleted. `git status -- src/ dist/ client/ tests/ package.json`
  shows only the phase's own changes.

## Per-task verdicts

| Task | Verdict |
|---|---|
| T-005 (uploads/exports/settings extraction, server.ts slim-down) | approve |
| T-006 (flights + trips routers) | approve |
| T-007 (planned-legs router) | approve |

## Criteria verified independently

**AC1 — every claim backed by a command I ran.** Yes; commands inline below.

**AC2 — four moved handlers vs. the pre-run `src/server.ts`.** Extracted each
block from `git show 8fcf363:src/server.ts` and from the router, normalised only
`app.<verb>('/api…` → `router.<verb>('…`, then `diff`:

| Handler | Result |
|---|---|
| `GET /api/flights/:id/export.kml` → `src/routes/exports.ts` | **verbatim** (15/15 lines) |
| `DELETE /api/flights/:id` → `src/routes/flights.ts` | **verbatim** (7/7 lines) |
| `POST /api/trips/:id/planned-legs` (.lnmpln) → `src/routes/plannedLegs.ts` | **verbatim** (121/121 lines) |
| `POST /api/trips/:id/planned-legs/simbrief` → `src/routes/plannedLegs.ts` | **verbatim** (88/88 lines) |

Widened beyond the four: sorted multiset diff of the entire moved region (853
base lines) against all six router files (1106 lines). **Zero code lines differ.**
The only differences are section comments about registration order (legitimately
rewritten into the mount comments in `server.ts:117-149`) and one re-wrap at
`src/routes/trips.ts:98`, `(db.ts)` → `(db/trips.ts)`, which is correct after phase 1.

**AC3 — ordering.** From my own inspector run:

```
9:POST	/api/flights/combine
10:GET	/api/flights/:id          ← combine still precedes /:id
42:GET	*                         ← last line of 42
```
No `/api` route appears after the catch-all. `src/server.ts:152` is the last
`app.get`, after all five `app.use('/api', …)` mounts (lines 125-149).

**Route table.** Rebuilt with `tsc --outDir <scratch>` and ran
`src/inspect-routes.ts` from a scratch cwd holding a DB copy. 42 routes.
`diff <(sort before) <(sort after)` → **empty**: no route added, dropped or renamed.

**Middleware / server.ts core, byte-identical to baseline:**
```
createServer prologue (auth, session, ingest, static): IDENTICAL (59 lines)
GET /api/status handler:                               IDENTICAL (35 lines)
app-level error handler (multer + INVALID_BODY):       IDENTICAL (31 lines)
```

**Router ownership** — the five spec-named routers exist and own a disjoint,
complete partition: flights 8, trips 10, settings 2, plannedLegs 9, exports 5 = 34,
plus `/api/status` 1 + ingest 3 + auth 3 + catch-all 1 = 42. `uploads.ts` is shared
multer config, not a sixth router; the only cross-router imports are
`flights.ts:7` and `plannedLegs.ts:19` pointing at it. No helper is duplicated.

**Gates:** `npm test` → `Test Files 17 passed (17) / Tests 327 passed (327)`.
`npx tsc --noEmit` → exit 0, no output. `npm run test:types` → no output.

**Untouched:** `git diff --stat -- src/flightManager.ts package.json package-lock.json client/ tests/` is empty.

## The route-table reorder — my judgment: accept

The raw ordered diff is **not** empty. My own run reproduces exactly what T-006
described: the six `/api/flights/:id*` routes move from table positions 19-24 to
10-15. Nothing else moves.

I did not accept the "different prefixes can't collide" argument on its face —
I mechanically checked the property that actually matters, that no request can
reach a different handler. Using express's own `path-to-regexp`, I built the
matcher for all 42 patterns in both orders and compared the **first match** for
495 method×path combinations (99 probe paths: every pattern with `:id`
substituted by `123`, `combine`, `export.kml`, `order`, `simbrief`, plus the
adversarial literals `/api/flights/combine`, `/api/flights/export.kml`,
`/api/trips/1/planned-legs/order`, `/api/flights/1/planned-leg-status`, `/api/nope`, `/`):

```
probe paths: 99 | combos checked: 495
NO DIVERGENCE — first matching handler identical in both orders for every probe
```

That is a proof, not an assertion, and the differential curl below confirms it
end-to-end. Requiring a literal byte-identical table would force splitting
`createFlightsRouter` into two mounts purely to preserve a line ordering that
provably has no effect — worse code for no behavioural gain. **Not a finding.**
The criterion as worded is stale; the property it was protecting holds.

## Differential curl — both trees, identical DB copies, identical env

Full response bodies compared with `cmp` (not previews), plus status codes.

| Case | base 3101 | new 3102 | |
|---|---|---|---|
| `GET /api/flights/1/export.kml` | 200, 25841 B | 200, 25841 B | byte-identical, incl. Content-Type/Disposition/Length |
| `GET /api/trips/1/export.kml` | 200, 2068578 B | 200, 2068578 B | byte-identical + headers |
| `POST /api/flights/export.kml` `{"ids":[1,2,3]}` | 200, 88742 B | 200, 88742 B | byte-identical + headers |
| `DELETE /api/flights/9` | 200 `{"deleted":true}` | same | match |
| `DELETE /api/flights/999999` | 404 `{"error":"Not found"}` | same | match |
| `DELETE /api/flights/notanumber` | 400 `{"error":"Invalid id"}` | same | match |
| `PATCH /api/flights/7` `{"notes":…}` | 200 full row | same | match |
| `PATCH /api/flights/999999` | 404 `{"error":"Not found"}` | same | match |
| `PATCH /api/flights/7` `{}` | 400 `{"error":"No valid fields to update"}` | same | match |
| 26 × `lnmpln` files | 400 `{"error":"Too many files (max 25)"}` | same | match |
| 600 KB `lnmpln` | 400 `{"error":"File too large (max 512KB)"}` | same | match |
| 25 MB `file` PDF | 400 `{"error":"File too large (max 20MB)"}` | same | match |
| unexpected multer field | 400 `{"error":"Unexpected field"}` | same | match |
| malformed JSON → `PUT /api/settings/simbrief` | 400 `{"error":"Invalid request body","code":"INVALID_BODY"}` | same | match |
| malformed JSON → `PATCH /api/flights/7` | 400 express default HTML | same | match (scoping preserved) |
| non-PDF upload | 400 `{"error":"File must be a PDF"}` | same | match |
| filename `../../../../tmp/pwned.pdf` | 200, no escape | same | no file written outside the store, both trees |

Both multer branches and both `SyntaxError` branches therefore still reach the
app-level handler after moving inside a mounted router — T-005 risk 5 is closed
behaviourally, not just structurally.

GET sweep, whole body byte-compared: `/api/status`, `/api/flights`, `/api/trips`,
`/api/trips/1` (15.7 MB), `/api/active-trip`, `/api/settings/simbrief`,
`/api/trips/1/journey`, `/api/trips/1/planned-legs`, `/api/planned-legs/4`,
`/api/flights/1`, `/api/flights/1/flight-plan` (404), `/api/planned-legs/999999`
(404), `/api/trips/999999` (404), `/api/flights/1/export.kml`, `/somespa/route`
→ **15 paths compared, 0 divergent.** Unauthenticated `GET /api/status` is 401 on both.

## Findings

**F-1 (non-blocking) — run citations in source comments.**
`src/db/flights.ts:5` and `src/db/trips.ts:4` both contain:
```
// at module load (see .claude/runs/2026-09-13-refactor-db-server-split/reviews/phase-1.md).
```
A comment in `src/` must not point at a run artifact — the next reader has no way
to know that document exists. Repro: `grep -rn '\.claude/runs' src/`.
Two notes on ownership: these are phase-1 files, outside phase 2's
`allowed_paths`, and their mtimes (…3522/…3523) fall *after* the phase-1 review
was written (…3399) — so they were added in a post-gate fix round and have never
been reviewed. Not phase 2's defect and not blocking; the fix is to drop the
parenthetical, keeping the surrounding explanation, which stands on its own.

**F-2 (non-blocking, pre-existing) — stack trace leaked to the client.**
Malformed JSON on any non-`/api/settings/` route returns express's default HTML
error page containing a `SyntaxError` stack. Identical on the base tree, so this
phase neither caused nor worsened it. Repro:
`curl -X PATCH -H 'Content-Type: application/json' --data-binary '{"notes": ' …/api/flights/7`.
Worth a follow-up run to extend the `INVALID_BODY` branch to all `/api` paths.

## Not verified by me (stated, not assumed)

- **PDF exports** (`export.pdf`, `appendPdfs`) — not re-run; the KML pair covers the
  same handler shape but the PDF render path is only covered by T-005's own evidence.
- **SimBrief network branch** — `SIMBRIEF_FAILURE_STATUS` and the `SimbriefParseError`
  → 502 arm need a stub; verified verbatim in the diff, never executed. (T-007 risk 1.)
- **`refreshPlannedLegForFlight` effect** — call sites are verbatim and reached, but a
  scratch server has no flight in progress, so it is a no-op by construction.
- **In-batch `.lnmpln` duplicate branch** (`seenInBatch`) — verbatim in the diff, no
  differential curl behind it. (T-007 risk 4.)
- **Repo `dist/`** holds unmerged refactor output from the phase's builds (I built only
  to scratch `--outDir`). Standing flag from T-005/006/007; the user's next restart
  picks it up. Worth resolving at ship time.
