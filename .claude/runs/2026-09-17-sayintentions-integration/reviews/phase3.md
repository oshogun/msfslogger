# Phase 3 review — T-006 (pull routes), T-007 (ACARS page link/import)

**Verdict: request_changes.** One blocking defect (B1), reproduced with a
minimal input, in `src/routes/sayIntentions.ts`. Everything else conforms:
the dedup, cursor, session guard, mapping and all eleven applicable failure
modes match the frozen contract byte for byte against the frozen response
samples.

Per-task: **T-006 request_changes** (B1), **T-007 approve**.

Criteria verified independently: **16 of 16** (T-006's 9, T-007's 7), all
re-run here; neither implementer report was read. Node 20.20.2 for every
command. Live `flights.db` untouched (structural check at the end).

---

## B1 — blocking: a `null` element in `comm_history` crashes both write routes with a raw `TypeError` in a 500

`src/routes/sayIntentions.ts:103` (R4 baseline scan) and
`src/routes/sayIntentions.ts:216` (R6 cursor scan) both do `entry.id` on an
element typed `CommHistoryEntry` but not runtime-guarded:

```ts
for (const entry of result.comm_history) {
  if (typeof entry.id === 'number' && Number.isFinite(entry.id) && entry.id > baseline) …
```

`mapCommEntryToRows` handles this correctly (`isRecord` → `[]` → `skipped`);
these two loops, which the route wrote itself, do not.

Reproduction (scratch server :3100, stubbed upstream on :3199 via
`SAYINTENTIONS_API_BASE_URL`):

```
# upstream body: {"flight_id":"8841207","comm_history":[null]}
POST /api/flights/86/sayintentions/link
  {"error":"TypeError: Cannot read properties of null (reading 'id')"}
  http 500

# linked, then upstream body:
#   {"flight_id":"8841207","comm_history":[{"id":2,…,"incoming_message":"second"},null]}
POST /api/flights/86/sayintentions/import
  {"error":"TypeError: Cannot read properties of null (reading 'id')"}
  http 500
  → 1 row written, cursor NOT advanced (since_id null, imported_count 0)
```

Why it is wrong: design § 9.5 freezes *"Drop the entry entirely (counted in
`skipped`) when it is not a plain object"*, and § 8.1 freezes *"Every row is a
non-crashing outcome. `500` appears nowhere in it: it stays reserved for a
genuinely unexpected throw."* A `null` in a JSON array from an undocumented,
preview-status API is exactly the case § 9.5 anticipated, not an unexpected
throw. The recovery posture is right (§ 8.3: cursor not advanced, the written
row dedups away next time) but the operator sees a raw exception string.

Fix is two lines: guard both loops with the same `isRecord`-style check
`mapCommEntryToRows` already uses. Only `null`/`undefined` elements trigger it —
`42` and `"str"` are harmless.

## B2 — blocking (style rule): design-section citations in shipped comments

- `client/src/pages/AcarsMessages.tsx:289` — `// Shared by both LINK and RELINK — it's the same route either way (§5.3).`
- `client/src/pages/AcarsMessages.tsx:332` — `// is a success (§9.3), not an error, and the merge below is then a no-op.`

`§`-numbered citations point at a document the next reader of `client/src/` has
no way to find. Drop the `(§5.3)` / `(§9.3)`; the sentences stand on their own.
(`grep -rnE '§|\.claude/runs|design\.md|plan\.json|T-0[0-9][0-9]|phase[0-9]'`
over the whole phase-3 diff returns only these two.)

---

## T-006 — request_changes

| # | Criterion | Evidence |
|---|---|---|
| 1 | Router created, mounted at `/api` after `createAcarsRouter`, before the catch-all; frozen paths | `src/server.ts:174-180`, `+8 -0`, one import + one mount. All four routes answer on :3100 behind the session cookie + `Origin` check; a request without them → 401. |
| 2 | Link route with no key → frozen 409, never 500 | `409 {"error":"No SayIntentions API key is saved. Add one under Prefiles → SayIntentions first.","code":"NO_API_KEY"}` — string-identical to `contracts/samples/msfslogger.responses.json`. Same on import. |
| 3 | Dedup: second import writes zero rows, counts distinguish new vs. seen | Import #1 → `201 {imported:4, already_seen:0, skipped:1, since_id:51224}`; thread `GET` count 2 → 6. Import #2 → `200 {imported:0,…}`; count still 6. Cursor hand-reset to `NULL`, re-import of the same window → `200 {imported:0, already_seen:4, skipped:1, since_id:51224}` — the exact frozen "re-import of the same window" sample. `select dedup_key,count(*) … having c>1` → **0 rows**. Keys are `sayintentions:comm:89:51221:out` per § 9.7. |
| 4 | Cursor advances and is used next call | Stub request log: `since_id=None`, `since_id=None`, `since_id=51224` across link/import/import. |
| 5 | Every applicable pull failure mode, frozen status/code, no stack trace | F1 409 NO_API_KEY · F2 409 BAD_API_KEY (401 **and** 403) · F3 409 NOT_LINKED · F4 409 SESSION_CHANGED · F5 409 NO_COMMS_TO_LINK · F8 502 UPSTREAM_UNREACHABLE (stub killed) · F9 504 UPSTREAM_TIMEOUT (10.014 s measured) · F10 502 UPSTREAM_ERROR (500 **and** 429) · F11 502 UPSTREAM_BAD_BODY · F12 400 INVALID_ID · F13 404 FLIGHT_NOT_FOUND. All 11 bodies string-identical to the frozen samples. **B1 is the one exception.** |
| 6 | `INGEST_SCOPED_ROUTES` | Design § 13: "No route in this design is added… That file and `tests/ingestScope.test.ts` are untouched by this run." Both are clean in `git status`. Correctly not applicable. |
| 7 | curl end-to-end, existing `AcarsThread` envelope unchanged | `GET /api/flights/86/acars-messages` top-level keys `['flight_id','messages','planned_leg_id']`; row keys are the same 12 columns. Imported rows arrive inside `messages[]` only. |
| 8 | `npm test` + `npx tsc --noEmit` | `Test Files 40 passed (40) / Tests 958 passed (958)`; `tsc --noEmit` and `npm run test:types` both silent. |
| 9 | No existing column / signature / response shape changed | `src/db/acarsMessages.ts`, `src/acars.ts`, `src/weatherClient.ts`, `src/index.ts`, `src/db.ts` all absent from `git status`. `src/db/schema.ts`'s only `acars_messages` mentions in the diff are three comment lines. `/api/flights` → 200, 36894 b — the same byte count phase 2 recorded pre-change. |

Also checked beyond the criteria, all clean:

- `?from=now` → `201 … since_id:51224, pending_messages:0`; `?from=bogus` →
  `200 created:false, since_id:null, pending_messages:4` (unknown value = the
  safe default, § 9.1). `DELETE` → `{unlinked:true}` then `{unlinked:false}`,
  no key read either time.
- Hostile/malformed upstream entries: a string `id` dropped; both-legs-blank
  skipped; a 5000-char body clamped to exactly 4096 ending `XXX...`; a 60-char
  `ident` truncated to 40; `stamp_zulu:"garbage"` → the import's fallback ISO;
  `stamp_zulu:1789654392` → `2026-09-17T14:13:12.000Z`, matching the § 9.6
  prototype table.
- SQL injection: a body of `'; DROP TABLE acars_messages; --` and a label of
  `o'brien\tapproach` stored verbatim (`O'BRIEN APPROACH`), `acars_messages`
  still present afterward.
- Concurrency: 5 simultaneous `POST …/import` on one flight → exactly 4 rows,
  zero duplicate `dedup_key`s, `imported_count = 4`.
- Secrets: no `console.*` in `src/routes/sayIntentions.ts`; the saved key
  appears **0 times** in the scratch server's stdout, and no line matching
  `Error:`/`at async` was logged across every failure above.

## T-007 — approve

| # | Criterion | Evidence |
|---|---|---|
| 1 | Link status + link control, existing sentinel pattern | `AcarsMessages.tsx:27-32` adds `SI_LINK_SENDING_ID`/`SI_UNLINK_SENDING_ID`/`SI_IMPORT_SENDING_ID` beside the three existing ones; mount fetch added as a third leg of the existing `Promise.all`, swallowed to `null` (`:124-131`). Flight scope only — `scope === 'flight' &&` at `:485`, per § 5.1/§ 14.2. |
| 2 | IMPORT enabled only when linked; repeat click = outcome, not error | `disabled={sendingId !== null \|\| !siLinkStatus.linked}` with a `title` explaining why; `imported === 0` → `'No new messages.'`. Test `shows "no new messages" rather than an error on a repeat import` passes. |
| 3 | Badge for the new category | Design § 14.2 freezes **"`KNOWN_CATEGORIES` is *not* extended"**; the array is untouched and `'atc'` falls through to `badge-acars-other`. Asserted at `AcarsMessages.test.tsx:178` and passing. (This overrides the plan's conditional wording — the freeze wins.) |
| 4 | No key → explained, never a broken control | `:487-489` renders only `SayIntentions: no API key saved (Prefiles → SayIntentions).` when `api_key_set` is false *or* the fetch failed. Test asserts neither LINK nor IMPORT is in the document. |
| 5 | New test file, 6 scenarios | no-key, link success, link error, import success (row + refreshed counter), no-new-messages, upstream import error — `mockFetchRoutes`/`renderWithProviders`, the `TripDetail.test.tsx` idiom. |
| 6 | `cd client && npm test` / `test:types` | `Test Files 7 passed (7) / Tests 24 passed (24)`; `tsc -p tsconfig.test.json` silent. |
| 7 | No existing flow changed | `git diff --numstat client/src/pages/AcarsMessages.tsx` → `+145 -1`; the single deletion is the `.then(([thread, cannedList])` destructuring line, widened to three. No existing handler, button or canned flow appears in the diff. |

## Must-not-change (design § 18)

1 ✓ (schema diff touches `acars_messages` only in comments) · 2 ✓ · 3 ✓
(envelope keys checked live) · 4 ✓ · 5 ✓ (not in diff) · 6 ✓ · 7 ✓ · 8 ✓ ·
9 ✓ (`+8 -0`, one import + one mount, no middleware moved) · 10 ✓ · 11 ✓ ·
12 ✓ · 13 ✓ (only `AcarsMessages.tsx`/`Prefiles.tsx`; every existing control
additive-only) · 14 ✓ (`client/src/index.css` mtime `09-16 20:08`, pre-dates
phase 3) · 15 ✓ · 16 ✓ · 17 ✓ (958 hermetic tests, no network).

Scope: every changed/created file is inside T-006's or T-007's `allowed_paths`.
`client/src/index.css` and `client/src/pages/Home.tsx` are dirty in the tree but
date from 09-16 — pre-existing, as phase 2 already recorded.

## Live-state check

`md5sum flights.db` — `d7b2a00eb72f9354dce759c3ccac9a3f` before and after.
Structural: the live DB still has **no `sayintentions_links` table**,
`max(flights.id) = 89`, and **0** `acars_messages` rows with a
`sayintentions:%` dedup key. `dist/index.js` (09-17 12:32) and
`client/dist/index.html` (09-17 18:46) unchanged — nothing was built in this
checkout; the scratch tree was built and run at `$SCRATCH/si3/tree` on ports
3100/3199 against a `better-sqlite3` `.backup()` snapshot. Both processes
killed by tracked PID, ports 3100/3199 clear, scratch directory removed. The
user's server on :3000 still answers (`401` to an unauthenticated
`/api/status`, over HTTPS, as before).

## Non-blocking follow-ups

1. `src/routes/sayIntentions.ts:101-104, 213-218` — the same "max finite id"
   scan is written twice. Once B1 is fixed, a single `maxCommId(entries)`
   helper in `src/sayIntentions.ts` would keep the two guards from drifting.
2. `src/sayIntentionsClient.ts:230` — the Orchestrator's post-phase-2 fold-in
   added a comment citing `§7.4`/`§7.3`. Same rule as B2, but outside this
   phase's diff, so not a phase-3 finding.
3. `AcarsMessages.tsx:337-352` — a successful import fires a second `GET …/link`
   to refresh `imported_count`/`last_import_at`. Correct, but the import
   response could carry the updated link instead and save a round trip; worth
   a design amendment rather than a client change.
4. Phase 2 follow-up 4 is now user-visible: re-linking resets `since_id` but
   keeps the previous session's `last_import_at`, so the page's
   *"Linked · last import …"* line can show a time that predates the link.
   Observed on :3100 — re-link returned `since_id:null` with
   `last_import_at:"2026-09-17T19:10:59.112Z"`.

---

# Follow-up verification (same reviewer, after the B1/B2 fixes)

**New verdict: approve.** Both blocking findings are closed, re-derived from
scratch — the fix's report was not read beyond its flagged risk. T-006 now
**approve**; T-007 was already approve. Node 20.20.2 throughout; nothing was
built in this checkout.

## B1 — closed

`maxCommId(entries, initial)` at `src/sayIntentions.ts:131-139` uses the same
`isRecord` guard as `mapCommEntryToRows`; both former inline loops now call it
(`src/routes/sayIntentions.ts:101` link, `:211` import).

Re-ran the original repro on a scratch tree (real HTTP both ways: router on
:3100, stub upstream on :3199 via `SAYINTENTIONS_API_BASE_URL`, scratch
`FLIGHTS_DB_PATH`), same two inputs as B1:

```
A  link,   upstream {"flight_id":"8841207","comm_history":[null]}
   → 201 {created:true, link:{since_id:null, baseline_comm_id:0,
          upstream_flight_id:"8841207"}, pending_messages:1}
B  import, [{id:51221, out+in},null]
   → 201 {imported:2, already_seen:0, skipped:1, since_id:51221}  (2 rows, out before in)
C  import, [null] only
   → 200 {imported:0, already_seen:0, skipped:1, since_id:51221}  (cursor held, not reset)
D  GET link → imported_count:2; thread keys ['flight_id','planned_leg_id','messages'], 2 messages
```

No 500, no `TypeError`, and the outcome is what § 9.5 + § 8.1 require: the null
entry is dropped and counted in `skipped`, the real entry still maps, the cursor
still advances (B) and is never rewound by a junk-only window (C).

## Are the new tests hollow? No — checked by reverting the fix

`tests/sayIntentions.test.ts` gained 5 tests, not 2: three unit tests for
`maxCommId` (`:143-156`) and two route-level regressions (`:506` link,
`:712` import) that assert the *specific* outcome (`201`, `baseline_comm_id:0`;
`imported:1, skipped:1, since_id:2` plus a one-row thread), not merely "not a
500". That accounts for the 958 → 963 delta.

Proof they pin the fix: in a scratch copy I restored the two pre-fix unguarded
loops verbatim and re-ran the file —

```
× a null element in comm_history is dropped … links successfully with a zero baseline
× a null element mixed into comm_history is dropped … the cursor still advances
Tests  2 failed | 79 passed (81)
```

Exactly those two fail, nothing else. Scratch copy discarded.

## B2 — closed

`grep -rn '§' client/src/pages/AcarsMessages.tsx src/sayIntentionsClient.ts
src/routes/sayIntentions.ts src/sayIntentions.ts` → **no matches (exit 1)**.
Widened to the whole run diff (17 files, `§|\.claude/runs|design\.md|plan\.json|T-0[0-9][0-9]|phase[0-9]|Amendment`)
→ also no matches. The three sentences (`AcarsMessages.tsx:289,332`,
`sayIntentionsClient.ts:228`) still read correctly without the citation; phase-2
follow-up 2 is closed along with them.

## Suites and shape

- `npm test` → `Test Files 40 passed (40) / Tests 963 passed (963)`.
- `cd client && npm test` → `Test Files 7 passed (7) / Tests 24 passed (24)` — unchanged.
- `npx tsc --noEmit`, `npm run test:types`, `client tsc -p tsconfig.test.json` — all silent.
- `git status` over `src/ tests/ client/src/` is the same 21 entries as before,
  and `git diff --numstat` is unchanged where it was tracked
  (`AcarsMessages.tsx +145 -1`, `src/server.ts +8 -0`). No file outside the two
  tasks' `allowed_paths` moved.

## The flagged risk (link on a `comm_history` of `[null]` only) — reasoning is sound

Checked against § 9.1/§ 9.2/§ 8.1 directly. It is not actually under-specified:
§ 9.2 step 4 fires F5 only when `flight_id === null` **and**
`comm_history.length === 0` — here `flight_id` is set and length is 1, so no F5;
step 5 is literally `baseline = max(comm_history[].id) or 0` → `0`; step 7 is
literally `pending_messages = comm_history.length` → `1`; and 201-vs-200 is
"no row existed before" → `201`. The observed `201 / baseline_comm_id:0 /
pending_messages:1` is what the frozen text says, so **no design amendment is
needed** — the conclusion was right, the premise ("not spelled out") is the only
thing I'd correct.

## Live state

`md5sum flights.db` = `d7b2a00eb72f9354dce759c3ccac9a3f` before *and* after —
identical to the value in the original review above. Structural: still **no
`sayintentions_links` table**, `max(flights.id) = 89`, **0** `sayintentions:%`
`acars_messages` rows. `dist/index.js` (09-17 12:32) and `client/dist/index.html`
(09-17 18:46) both unchanged. Scratch tree removed, ports 3100/3199 clear, the
user's server on :3000 still answers `401` to an unauthenticated `/api/status`.

## Non-blocking follow-ups (added; 1 and 2 above are now closed)

5. `pending_messages` counts raw `comm_history.length`, so a window whose
   entries will all be skipped advertises work that the next import reports as
   `imported:0, skipped:n` (observed: `pending_messages:1` for `[null]`). It
   matches § 9.2 step 7 exactly, so changing it is a design amendment, not a fix.
6. If upstream ever returns `flight_id: null` with a junk-only `comm_history`,
   F5 does not fire (length > 0) and the flight links to a session with
   `upstream_flight_id: null` and `baseline_comm_id: 0`. Harmless today — the
   next import backfills the id — but § 9.2 step 4's guard is length-based, not
   "has a usable entry"-based.
