# Review — phase 1 (T-002): the frozen SayIntentions design

Reviewer, 2026-09-17. Verdict: **approve**, with 9 non-blocking findings.
Nothing blocking: no acceptance criterion of T-001 fails, no frozen-intake
decision is contradicted, no partner-key capability is assumed, and the
128-character bound holds under a sweep of my own.

Design review, not a diff review — no code exists. I read `design.md` (all 19
sections), every file in `contracts/`, both prototypes, `intake.md`,
`sayintentions-api-notes.md`, and the plan records for T-001, T-003, T-004,
T-006, T-007, T-009, T-010. I did **not** read the designer's report.

Live database untouched: I never opened `flights.db`. `md5sum flights.db` →
`d7b2a00eb72f9354dce759c3ccac9a3f`, mtime `2026-09-17_12:32:27` (before this
session). No scratch server, no scratch directory beyond the session
scratchpad, no build.

## T-001 acceptance criteria — 13 of 13 verified independently

| # | Criterion | Evidence |
|---|---|---|
| 1 | Sliceable `##` headings for all 12 keywords | `grep -n '^## ' design.md` → 19 sections; `ctx.sh map` lists them; every keyword present |
| 2 | Exact setting key, `getSetting`/`setSetting` verbatim, no new table | §4.1 `SAYINTENTIONS_API_KEY_SETTING = 'sayintentions_api_key'`; `src/db/settings.ts` read — `setSetting(name, null)` deletes the row, as §4.4 claims |
| 3 | Link storage + what it holds + scope + why, by analogy to wx/clearance | §3.3 (7 fields incl. `since_id`), §5.1 flight-scoped with the `src/routes/acars.ts` precedent, which I confirmed (wx on both scopes, loadsheet/clearance leg-only) |
| 4 | Explicit migration yes/no with `CREATE TABLE IF NOT EXISTS` DDL, ON DELETE, new `src/db/*.ts` | §6 + `contracts/schema.sql`; placement claim checked against `src/db/schema.ts:556-561` — `app_setting` CREATE ends at 560, template closes at 561 |
| 5 | Client signatures, `SayIntentionsFetchError`, closed code union incl. `NO_ACTIVE_SESSION` heuristic | §7.2/§7.4 + `contracts/sayIntentionsClient.stub.ts`; union has the 5 required codes plus `NO_ACTIVE_SESSION` and `BAD_KEY` |
| 6 | Pull routes, dedup_key incorporating upstream `id`, field mapping, `acars_messages` reused | §9.1/§9.5/§9.7 — `sayintentions:comm:<flight>:<comm_id>:<in\|out>`; `insertAcarsMessageOnce` + `idx_acars_messages_dedup` verified in `src/db/acarsMessages.ts` and `schema.ts` |
| 7 | Push route scope justified, locates `ClearanceDetails`, status codes, recording decision | §10; `clearanceDedupKey(legId)` + `payload_json = JSON.stringify(details)` confirmed at `src/routes/acars.ts:498-546` |
| 8 | Condensed template, truncation rule, ≥3 worked examples with counts | §11.2/§11.3 — 7 examples; reproduced byte for byte, see below |
| 9 | Trigger rationale, pull and push separately | §12 — button for both, three reasons for pull, side-effect argument for push |
| 10 | Ingest scope stated per route | §13 — seven per-route "no" with reasons; `contracts/routes.md` agrees |
| 11 | Failure table, one row per required condition, no 500 | §8.1 F1–F16; every required condition present, 500 reserved |
| 12 | Default-off statement naming what does not change | §15 + §18 |
| 13 | Per-task frozen contracts for T-003/4/6/7/9/10; no implementation code; no out-of-scope item | §16.1–§16.6; `grep -i 'importVAData\|va_api_key\|partner\|setFreq\|getWX\|getVATSIM\|getTFR'` over `design.md contracts/ prototypes/` → only the §2 exclusion list |

## The condensed-message claim — rerun, then stressed harder

`node prototypes/condense.js` (Node 20) reproduces §11.3 exactly: A=63, B=127,
C=41, D=41, E=40, F=128, G=127, and `boundary sweep: 1802 routes, longest
output 128 chars, cap 128`.

The script's own sweep only varies the route, at a fixed `AAAA`/`BBBB`/
`5000FT`/`7401` head and tail, so I ran my own over the *whole* input space —
10 departure × 10 destination × 13 route × 11 altitude × 6 squawk = **85 800
inputs**, including `null`, empty, whitespace-only, unicode (`Ü`), a
5 000-character route, a 200-character ICAO, a 120-character squawk and a null
altitude (`levelText` → `'UNKNOWN'`):

    cases run, worst length 128 fails 0 tail-loss(normal inputs) 0

The `<= 128` bound holds by construction (step 5's final slice), the three
named edge cases behave as documented, and for every realistic input the
tail (`CLB … SQ …`) survives. The one degenerate shape — an ICAO long enough
to overflow the head, which truncates away the squawk — is unreachable from
`buildClearanceDetails`, which sets `departure_icao: p.origin` from the parsed
SimBrief plan. `levelText` in the prototype is byte-identical to
`src/acars.ts:166-170`; `route` in a stored payload is always
`clampRoute(...)`, so case D is the realistic one and case C is defensive.

## §4's "server never returns the key" — holds everywhere

`grep -rn api_key contracts/samples/`: the raw key appears in exactly one
place, the `_request` body of `PUT /api/settings/sayintentions` (inbound, and
necessarily so). Every response sample carries `sayintentions_api_key_set` +
`sayintentions_api_key_masked` only; `si_1a2b3c4d5e6f7g8h9f2c` masks to
`si_1…9f2c`, which is what the samples show. §7.5 bans the key from URLs,
logs, `Error.message` and `userMessage`; §14.1 never populates the input;
§16.1's inspector reads `process.env.SAYINTENTIONS_API_KEY`, not the database.
No leak found.

## Pilot-key-only

Only two upstream endpoints are referenced anywhere in the design or
contracts: `getCommsHistory` (28 mentions) and `sayAs` (18). Both are
pilot-key in `sayintentions-api-notes.md`. No `va_api_key`, no `importVAData`,
no sim-control endpoint, and nothing that implicitly needs one (the `mission`
object is carried through unparsed and nothing branches on it).

## Must-not-change list and the four deviations

All 17 must-not-change lines are checkable claims and each one I spot-checked
is true of the repo today: `acars_messages`' 12 columns and its no-`CHECK`
`category` (`schema.ts:386-431`), `isValidAcarsCategory` = `/^[a-z][a-z0-9-]{0,31}$/`
so `'atc'` needs no migration, `listAcarsMessagesForFlight` already returns the
linked leg's rows, `apiFetch` discards `code` (`client/src/utils/api.ts:24-34`),
`.badge-acars-other` exists (`index.css:1046`) and `categoryClass` falls back
to it, the `SyntaxError` handler already covers `/api/settings/`
(`server.ts:207-213`), the mount point between `createAcarsRouter` and
`createGroundSessionsRouter` exists (`server.ts:171/177`), and no existing
router pattern can capture a 4-segment `…/sayintentions/…` path.

Deviations: (a) server-side masking instead of echoing the key — justified in
§4.3 by credential-vs-public-identifier, and named for T-004 in §16.2;
(b) the `app_setting` DDL comment edit — the current comment does say "Nothing
here is a credential" (`schema.ts:553`), so it genuinely stops being true, and
`src/db/schema.ts` is in T-003's `allowed_paths`; (c) `'atc'` not added to
`KNOWN_CATEGORIES` — justified concretely, since `client/src/index.css` is in
no task's paths and the `'other'` fallback renders correctly; (d) ingest-scope
N/A — T-006's criterion is conditional and §13 answers it per route. All four
are reasons, not assertions.

## Findings (all non-blocking)

1. **§9.4's guard is permanently disabled for a link whose `upstream_flight_id`
   is null.** F5 only fires when the response has *no* `flight_id` **and** no
   comms, so a response with comms but no `flight_id` produces a link row with
   `upstream_flight_id: null` — and §9.4 skips the guard whenever either side is
   null, forever. Every later import on that flight then files whatever session
   the key currently holds, silently, which is the exact failure §9.4 exists to
   prevent. Contingent on an undocumented upstream shape (§2.1/§19.1), and the
   fix is two lines: on import, when `link.upstream_flight_id === null` and the
   response's `flight_id !== null`, backfill it and guard from then on. Worth
   folding in before the freeze.
2. **§8.1 F1 and §15 disagree about R5 with no key saved.** F1 lists
   `R5(no-op)` under a 409 row; §15's table says R5 answers
   `200 { unlinked: false }`. §15's justification ("deleting a link that cannot
   exist") is also wrong — a link row can outlive a cleared key. One line either
   way; as written an implementer must guess.
3. **`MAX_ACARS_IN_CHARS` is declared in two modules.** §11 puts
   `export const MAX_ACARS_IN_CHARS = 128` in `src/acars.ts` (T-009);
   `contracts/sayIntentionsClient.stub.ts:54` declares the same name in
   `src/sayIntentionsClient.ts` (T-003, which ships first). Name which one is
   canonical and have the other import it, or they will drift.
4. **§16.1 does not name T-003's superseded acceptance criterion** the way
   §16.2 does for T-004. T-003 criterion 6 asks a phase-2 reviewer to `curl`
   for `{ sayintentions_api_key: null }`, which §4.3 deliberately never
   returns. One sentence in §16.1 prevents a false finding in T-005.
5. **`upsertSayIntentionsLink`'s contract is silent on `last_import_at` at
   re-link.** The stub omits it from the argument and says "every other field
   comes from the argument", so the implementer must guess preserve-vs-null.
6. **Re-link during an in-flight import can clobber a deliberate cursor
   rewind.** R6 reads the link, awaits the network, then writes
   `max(link.since_id ?? 0, maxSeen)`; an interleaved R4 (`?from=session_start`,
   which resets `since_id` to null so history re-imports) is overwritten when R6
   resumes. No duplicate rows result — the dedup key holds — but the operator's
   rewind silently does nothing until they press LINK again. A compare-and-set
   on `linked_at` in `advanceSayIntentionsCursor` closes it.
7. **Deleting a flight mid-import lands in the 500 branch.** R6 checks the
   flight at step 1 and inserts after an await; with `PRAGMA foreign_keys = ON`
   the insert raises a FK error and §8.3 sends `500 { error: String(err) }`.
   Defensible (the cursor is not advanced and nothing is lost) but it is an
   expected condition answered by the code path reserved for unexpected ones.
8. **Sample drift inside `contracts/samples/msfslogger.responses.json`.** The
   `GET …/link → 200 (linked)` entry uses `since_id: 51223` /
   `baseline_comm_id: 51220` / `imported_count: 4`, which cannot arise from the
   transcript in `upstream.getCommsHistory.json` that every other entry in the
   file is built from (`baseline` 51224, cursor 51224). Harmless as prose,
   confusing as a fixture.
9. **`pending_messages` counts entries; `imported` counts rows.** §14.2 renders
   both as "messages" ("{pending_messages} messages waiting", "Imported
   {imported} message(s)"), and one entry can produce two rows — in the sample
   the two numbers coincide at 4 only by accident. Worth one clarifying word in
   the UI copy.

## Follow-ups worth tracking (not findings)

- `badge-acars-atc` colour is a one-line CSS follow-up once a task owns
  `client/src/index.css` (§14.2 already says so).
- §19.7's thread-volume risk: a talkative session can add hundreds of rows to
  an unpaginated page. The envelope was built to take a cursor later.
