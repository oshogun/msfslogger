# Phase 2 review — T-003, T-004 (+ the one-line `tests/db/schema.test.ts` fix)

**Verdict: request_changes.** One blocking finding, and it is *not* a code
defect: the live checkout's `client/dist/` was rebuilt with this phase's
unmerged frontend, so the user's running server on :3000 is serving a UI that
calls an endpoint its own `dist/` does not have. The code of T-003 and T-004
is otherwise correct and conforms to the freeze.

Per-task: **T-003 approve**, **T-004 approve**, **schema.test.ts one-liner
approve**, **phase blocked on B1** (Orchestrator/user remediation, no
re-implementation).

Criteria verified independently: 14 of 14 (T-003's 8, T-004's 6), all re-run
here; the implementer reports were not read. Live DB untouched (structural
check below). Node 20.20.2 for every command.

## Blocking

### B1 — the live `client/dist/` was rebuilt with phase-2 code; the running server serves it
`client/dist/assets/index-DmUcV8ir.js` (mtime **18:23**, referenced by
`client/dist/index.html`) contains the string `sayintentions`; the live
server's `dist/routes/settings.js` (mtime **12:32**) does not.

```
$ grep -rl sayintentions client/dist/          → client/dist/assets/index-DmUcV8ir.js
$ grep -l  sayintentions dist/routes/settings.js → (no match)
$ ls --time-style=+%H:%M dist/index.js client/dist/index.html
  12:32 dist/index.js      18:23 client/dist/index.html
```

`src/server.ts:34` serves `client/dist` with `express.static` on every request,
so this is already live. Reproduction of the effect, on the pre-phase scratch
server (port 3100, built from `git archive HEAD`, the same server code the live
process is running):

```
$ curl -s -b cookies -H 'Origin: …' http://127.0.0.1:3100/api/settings/sayintentions
  http 404  type=text/html
```

The route does not exist, so the request falls through to the SPA catch-all
(`src/server.ts:181`, `sendFile(index.html)` — HTML, not JSON). `apiFetch`
throws, `Prefiles.tsx` sets `sayintentionsSettingsError`, and because
`sayintentionsSaved` stays `undefined` the new block is stuck on "Loading…"
with a permanently disabled input (`client/src/pages/Prefiles.tsx:399-435`).
The user's Prefiles page shows an error line right now.

`.claude/ENVIRONMENT.md` classes a build in this checkout as "a live action
against the running server, the same class of mistake as writing to the live
database", so my criterion *"the running server on port 3000 was never
touched"* fails. **Remediation is not an implementer change**: either restore
`client/dist` from pre-phase sources (built in scratch, copied in), or leave it
and merge the server side, then have the *user* run `./start.sh -r -d`. I did
not touch `client/dist` myself; mtimes are unchanged from 18:23 at the end of
this review.

## T-003 — approve

| # | Criterion | Evidence |
|---|---|---|
| 1 | GET/PUT `/api/settings/sayintentions` per the frozen shape | scratch :3101 — GET → `{"sayintentions_api_key_set":false,"sayintentions_api_key_masked":null}`; PUT `si_abcdefgh12345678` → `200 {"…_set":true,"…_masked":"si_a…5678"}`; PUT `null`/`{}` → `…_set:false`. Matches design §4.3/§4.4 (masked, never the key), not the plan's older `{sayintentions_api_key}` wording — the design deviation is explicit and is what was built. |
| 2 | Client surface + isolation | `getCommsHistory`/`sayAs`/`SayIntentionsFetchError`/7-code union present; `grep -nE '^import\|require\(' src/sayIntentionsClient.ts` → **no output at all** (no `db`, no express, no import of anything). |
| 3 | New table, exact DDL, idempotent | `applySchema()` x3 on a scratch copy: no error. `PRAGMA table_info` → `flight_id PK / upstream_flight_id TEXT / since_id INTEGER / baseline_comm_id INTEGER NOT NULL DEFAULT 0 / linked_at TEXT NOT NULL / last_import_at TEXT / imported_count INTEGER NOT NULL DEFAULT 0` — §6 verbatim. `foreign_key_list` → `flights(id) ON DELETE CASCADE`; deleting the flight removed the link row (1 → 0); an orphan insert was rejected. Fresh copy: 0 rows. |
| 4 | Inspector, one-line non-stack errors | against a local stub on :3199: `--comms` printed `flight_id: 4242`, 2 entries sorted ascending (first id 3); `--say` printed `ok: true`. Errors, one line each, no stack, no key: `✗ getCommsHistory BAD_KEY: BAD_KEY (http 401)`, `BAD_STATUS (http 500)`, `BAD_BODY (http 200, first 200 chars: <<not json>>)`, `NETWORK (fetch failed)`, `✗ sayAs NO_ACTIVE_SESSION: NO_ACTIVE_SESSION (http 200)`; no key → usage line. |
| 5 | Both test files pass, hermetic, cover every code | `npm test` → **40 files, 903 tests passed**, incl. `sayIntentionsClient.test.ts (30)` and `sayIntentions.test.ts (21)`. Names cover all four NO_ACTIVE_SESSION paths, NETWORK/TIMEOUT/BAD_STATUS/BAD_BODY/NO_KEY/BAD_KEY, and "never puts the key in message/userMessage". `fetchImpl` injected per call. |
| 6 | curl on a scratch server | see row 1 (port 3101, copy of `flights.db`). |
| 7 | `tsc --noEmit`, `test:types` | both clean, no output. |
| 8 | No other route touches the key; existing shapes unchanged | `grep -rn SAYINTENTIONS_API_KEY_SETTING src/` → only `src/sayIntentions.ts` and `src/routes/settings.ts`. Pre (HEAD) vs post server, logged in on both: `/api/status`, `/api/flights` (36894 b), `/api/settings/simbrief` — **byte-identical** (`diff` on all three). |

Failure paths exercised beyond the criteria (all on :3101): 7-char key → `400
INVALID_API_KEY`; embedded space → `400`; number → `400 "must be text"`; array
body → `400 INVALID_BODY`; malformed JSON `{oops` → `400 INVALID_BODY`
(existing handler, unchanged) — matches F15/F16. SQL-shaped key
`abc');DROP_TABLE_app_setting;--` stored and masked as `abc'…g;--`, and
`/api/settings/simbrief` still answered `{"simbrief_user_id":"1099607"}`
afterwards: every statement in `src/db/sayIntentionsLinks.ts` is `?`-bound (the
only interpolation is the module-constant `COLUMNS` list).

Link module semantics match `contracts/sayIntentionsLinks.stub.ts` exactly:
re-link kept `imported_count: 5` while resetting `since_id` to null,
`COALESCE` backfill did not overwrite `777` with `888`, advance on a missing
flight → `null`, second delete → `false`.

Security: no `console.*`/logger anywhere in the new server files; the key is
never in `message`/`userMessage`/`detail` (detail strings are `http <status>`
or a *response* excerpt); §4.1's credential comment was rewritten as frozen.

## T-004 — approve

| # | Criterion | Evidence |
|---|---|---|
| 1 | State quartet + mount load + PUT, SimBrief idiom | `Prefiles.tsx:44-50`, `:87-89`, `:154-186` — names and shape match design §14.1 exactly. |
| 2 | Masked / never plainly rendered | `type="password"`, `id="prefiles-sayintentions-api-key"`, input starts empty even when a key is saved; the server never sends the raw key. Comment at `:44-45` states it. |
| 3 | `SayIntentionsSettings` in `client/src/types.ts` | `:85-89`, mirrors the server type field for field. |
| 4 | New test file, 4 scenarios | `Prefiles.test.tsx` — not-set, masked value, save→masked, PUT error without crashing. |
| 5 | Client suite + types | `cd client && npm test` → **6 files, 18 tests passed** (incl. the 4 new). `tsc --noEmit` clean. |
| 6 | Nothing else changes | `git diff --numstat client/src/pages/Prefiles.tsx` → `+83 -0`; block inserted directly after `simbrief-import-section` (`:397`), before `legs-section`. |

Scope: every changed path is inside the two tasks' `allowed_paths`.
`client/src/index.css` and `client/src/pages/Home.tsx` are modified in the tree
but date from 2026-09-16 (19:33 / 20:08) — pre-existing, out of scope as the
envelope says. No run-id, `design.md`, `§`, `T-NNN` or phase citation appears
in any new or edited comment (grepped).

## Must-not-change (design §18) — spot checks

6 ✓ (byte-identical simbrief diff), 7/8/9/10/11 ✓ (not in the diff at all),
12 ✓ (`src/db/schema.ts` = one `CREATE TABLE` + the §4.1 comment, `+33 -3`,
the 3 deletions being that comment), 13 ✓ (`+83 -0` on Prefiles, no other page
in the diff), 14 ✓ (`client/src/index.css` untouched *by this phase*), 15 ✓,
17 ✓ (suite hermetic, 903 pass, no network).

## Live-state check

`md5sum flights.db` — `d7b2a00eb72f9354dce759c3ccac9a3f` before and after.
Structural (the check that actually rules out contamination): the live DB has
**no `sayintentions_links` table**, `max(flights.id) = 89`, `app_setting` names
= `simbrief_user_id` only. Server on :3000 still answering (`401` to an
unauthenticated `/api/status`, as before). Scratch trees, DB copies and both
scratch servers (ports 3100/3101, killed by tracked PID) removed; nothing is
listening on 3100/3101/3199. Repo root has no stray artifacts — the only
untracked non-run files are `user_stories/*.md`, all dated 14:06 or earlier.

## Non-blocking follow-ups

1. `src/sayIntentionsClient.ts:228` — an empty 200 body is coerced to `{}` and
   returns `{flight_id:null, comm_history:[]}`; design §7.3 step 4 says a body
   not parseable as JSON is `BAD_BODY`. Lenient and arguably right, but a
   deviation from the freeze the Designer should ratify or the implementer
   tighten.
2. `client/src/pages/Prefiles.tsx:415` — the button reads **"Set"** while the
   adjacent SimBrief button reads "Save" and design §14.1 calls it the Save
   button.
3. `client/src/pages/Prefiles.tsx:399-435` — if the mount GET fails,
   `sayintentionsSaved` stays `undefined` for the page's life: input disabled,
   status line stuck on "Loading…", no retry. Only reachable today via B1.
4. `src/db/sayIntentionsLinks.ts:46-55` — a re-link resets `since_id` but keeps
   `last_import_at` from the *previous* session, so phase-3 UI could show a
   "last imported" time that predates the current link.
5. `tests/helpers/db.ts:95` (`ALL_TABLES`) and `src/testSeed.ts:37`
   (`RESET_TABLES`) do not list `sayintentions_links` (nor, already,
   `ground_sessions` in the former). Both are outside T-003's `allowed_paths`
   and correctly untouched; phase 3 will want them updated before any test or
   e2e seed writes a link row.

---

## Orchestrator resolution (2026-09-17, after this review)

**B1 (live `client/dist` contamination) — fixed.** Rebuilt the pre-phase
frontend in a detached `git worktree` at HEAD (commit `998bea9`, containing
none of this run's changes), confirmed via `grep` it contained no
`sayintentions` references, then swapped it into `client/dist` (user
confirmed via `AskUserQuestion` before the overwrite, since it's the live
server's actively-served directory). Verified afterward: bundle hash matches
the pre-phase build, no `sayintentions` strings in the restored `dist/`, site
answers over HTTPS (the running server has `TLS_CERT_FILE`/`TLS_KEY_FILE`
set — a plain-HTTP curl during diagnosis returned an empty reply, which is
expected TLS-only behavior, not a break). Scratch worktree removed
afterward. Root cause: T-004's `npm run build` verification step ran inside
the live checkout instead of a scratch copy — noting for future task
envelopes in this workflow to explicitly forbid building inside the live
checkout, the same way starting a dev server against it is already forbidden.

Two of the five non-blocking findings folded in directly (both small,
well-specified, no re-review needed):
- **`src/sayIntentionsClient.ts` empty-body coercion** (finding 1): removed
  the `text === '' ? {} : …` special case in `getCommsHistory` so an empty
  body now correctly throws `BAD_BODY` per design §7.3 step 4, instead of
  being silently treated as `{ comm_history: undefined } → []`. Left
  `sayAs`'s equivalent (`text === '' ? null : …`) unchanged — an empty 2xx
  body there is a legitimate, spec-intended success case per §7.4 step 8's
  fallback, and the reviewer's finding cited only §7.3, not §7.4.
- **Button label inconsistency** (finding 2): `Prefiles.tsx`'s SayIntentions
  save button now reads "Save" (was "Set"), matching the SimBrief field's
  button and design §14.1. Updated the two `Prefiles.test.tsx` assertions
  that queried the old label, scoping both to the SayIntentions section via
  `within()` since two identically-labelled "Save" buttons now exist on the
  page.

Also applied ahead of T-006 (finding 5): added `'sayintentions_links'` to
`tests/helpers/db.ts`'s `ALL_TABLES` and `src/testSeed.ts`'s `RESET_TABLES` —
both were correctly outside T-003's `allowed_paths` (same reasoning as the
`schema.test.ts` fix) but would otherwise leak link rows across scratch-db
resets and e2e reseeds once T-006 starts writing them. No `SEQUENCE_TABLES`
entry needed: the table's primary key is `flight_id`, not an autoincrement
surrogate.

Findings 3 (no-retry on a failed settings-load) and 4 (`last_import_at` not
reset on re-link) left as-is — both are minor UX/cosmetic, neither affects
correctness or the default-off guarantee, and fixing them isn't warranted
ahead of Phase 3 actually needing them.

Re-verified after all of the above: `npm test` (903/903), `cd client && npm
test` (18/18), `npx tsc --noEmit`, `npm run test:types` (both root and
client) — all clean under Node 20.20.2. **Phase 2 is cleared; proceeding to
Phase 3.**
