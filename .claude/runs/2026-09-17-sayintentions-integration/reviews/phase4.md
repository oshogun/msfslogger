# Phase 4 review — T-009 (push endpoint) and T-010 (push button)

**Verdict: request_changes.** Two blocking findings, both cheap: one style-rule
violation (third recurrence this run) and one test that passes vacuously and
asserts the opposite of the shipped — and correct — behaviour. The push
contract itself is right: all 14 acceptance criteria that concern behaviour were
re-derived independently and hold, including the 128-char cap (31 829 inputs)
and the no-active-session outcome (zero rows written on every failure path).

Per-task: **T-009 request_changes** (B1) · **T-010 request_changes** (B2).

Verified independently: 14 of 14 behavioural criteria re-executed here from the
diff and the frozen contract; the implementer reports were not read. Live
`flights.db` md5 `d7b2a00eb72f9354dce759c3ccac9a3f` before and after, unchanged;
it still has no `sayintentions_*` table and `max(acars_messages.id) = 16`, so
nothing from this review reached it. `client/dist/index.html` (18:46:43) and
`dist/index.js` (12:32:38) mtimes unchanged; nothing was built in this checkout.
Scratch server ran on 3117 and is gone; the user's 3000 was never touched.

---

## B1 — blocking (style rule): run-artifact citations in a shipped comment

`tests/acars.test.ts:1245-1246`

```ts
  // The seven worked examples in design.md §11.3, computed by
  // prototypes/condense.js and reproduced here byte for byte.
```

Cites `design.md`, a `§`-numbered section, and a `.claude/runs/…/prototypes/`
file. Same rule as phase 3's B2 (and its own follow-up #2), which was blocking
then. Reproduction:

```
$ grep -rn '§\|\.claude/runs\|design\.md\|plan\.json\|T-0[0-9][0-9]\|phase[0-9]' \
    <phase-4 added lines + the two untracked phase-4 test files>
tests/acars.test.ts:1245:  // The seven worked examples in design.md §11.3, computed by
```

One match in the whole phase-4 diff; everything else is clean. Fix: say what the
vectors are ("seven worked examples, byte-for-byte") without naming a document
`tests/` cannot see.

## B2 — blocking: the "no API key" push-button test passes vacuously and asserts the wrong thing

`client/src/pages/AcarsMessages.test.tsx:251-263`

```ts
  it('hides the push button when no API key is saved', async () => {
    …
    await waitFor(() => expect(screen.queryByRole('button', { name: 'SEND TO SAYINTENTIONS' })).not.toBeInTheDocument());
```

`waitFor` retries *until the callback stops throwing* — and it does not throw on
the first tick, while the page is still in its loading state and renders no
buttons at all. The assertion is satisfied before any fetch resolves, so the
test never observes the state it names. The actual post-load DOM is the opposite,
and is what the frozen contract asks for (disabled with a `title`, not hidden).

Reproduction — scratch copy of `client/`, same harness, waiting for the page to
finish loading first (`await screen.findByRole('button', { name: 'REQUEST CLEARANCE' })`)
with the identical mocked routes:

```
PROBE1 push button present after load: true | disabled: true
       | title: No SayIntentions key saved (Prefiles → SayIntentions)
```

So T-010's criterion 4 ("button hidden/disabled with no key") has no real
coverage: the case that exists asserts absence and would keep passing if the
button were enabled. Fix: wait for load, then assert `toBeDisabled()` and the
title, and rename the test to "disables".

---

## Criteria verified, T-009

| # | Criterion | Evidence |
|---|---|---|
| 1 | `buildCondensedClearanceMessage`, design vectors, never > 128 | Own fuzz harness against the real export: design examples **A–F reproduce byte-for-byte**; 31 829 inputs (sweep 0–900 tokens × separator/no-separator, 30 000 random routes incl. non-ASCII/control chars, plus 300-char ICAOs, 500-char squawks, `NaN`/`Infinity` altitudes) → `longest output 128 chars; cap 128`, zero overruns. F reaches exactly 128, so the `<=` in the final slice is load-bearing and correct. |
| 2 | Route finds the PDC row, parses, 409s, never crashes | `F7 no clearance on file :: http 409 NO_CLEARANCE`; truncated `payload_json` (`{"v":2,"squawk":"nope"`) → `409 NO_CLEARANCE`, **no upstream call**, no throw. `F12 :: 400 INVALID_ID`, `F14 :: 404 PLANNED_LEG_NOT_FOUND`. |
| 3 | `sayAs(channel=ACARS_IN)` + row records the exact text | Captured upstream URL: `/sapi/sayAs?api_key,channel,message,from,message_type,rephrase` with `channel=ACARS_IN`, `message_type=cpdlc`, `rephrase=0`, `from=KSFO`. Stored row: `direction=uplink category=pdc label='PDC SENT' dedup_key=null flight_id=null`, `correlation_id=1` = the stored PDC row's id, `body === sent_text === 'PDC KSFO KLAX CLRD SSTIK3 BSR Q13 RZS KWANG2 CLB 5000FT SQ 2451'`, `payload_json` carries all 8 `SayIntentionsPushPayload` fields incl. `upstream_excerpt`. |
| 4 | `NO_ACTIVE_SESSION` → frozen status/code, **no false 'sent' row** | All three upstream detection paths (HTTP 409, HTTP 404, 200 + failure marker + hint) → `409 NO_ACTIVE_SESSION` with the frozen sentence, and `rows 2->2` each time. Row count is unchanged on **every** failure path (F1, F2, F7, F8, F9, F10, F11 as well), so no failed send can leave a row claiming delivery. |
| 5 | Every push failure mode, frozen status/code | F1 409 NO_API_KEY (and no upstream call) · F2 409 BAD_API_KEY · F6 409 NO_ACTIVE_SESSION ×3 · F7 409 NO_CLEARANCE ×2 · F8 502 UPSTREAM_UNREACHABLE · F9 504 UPSTREAM_TIMEOUT · F10 502 UPSTREAM_ERROR (500 **and** 429) · F11 502 UPSTREAM_BAD_BODY · F12 400 · F14 404. 24/24 harness checks passed. |
| 6 | Full cycle against a stubbed `sayAs`, text round-trips through GET | Scratch express server on **3117**, scratch db, stub intercepting only `sayintentions.ai`: `201` → `GET /api/planned-legs/1/acars-messages` returns the `PDC SENT` row with the identical body. Repeat send files a second row (`rows 3->4`); two concurrent pushes file two rows, no crash, no 500. |
| 7 | `npm test` + `npx tsc --noEmit` | `Test Files 40 passed (40) · Tests 990 passed (990)`; `tsc --noEmit` and `npm run test:types` both silent. |
| 8 | No change to `buildClearanceBody` / `buildClearanceDetails` / `clampRoute` | Byte-compared against `git show HEAD:src/acars.ts`: `buildClearanceBody IDENTICAL (416 bytes)`, `buildClearanceDetails IDENTICAL (320)`, `clampRoute IDENTICAL (203)`, `levelText IDENTICAL (208)`, `clearanceDedupKey IDENTICAL (96)`. `git diff --stat` = **111 insertions, 0 deletions**; every HEAD line still present in order. |

## Criteria verified, T-010

| # | Criterion | Evidence |
|---|---|---|
| 1 | Button gated on key + leg + PDC row, sentinel pattern | `SI_PUSH_SENDING_ID` beside the existing sentinels; enable predicate matches the frozen one exactly (`AcarsMessages.tsx:486-491`); probe confirms the disabled title text per branch. |
| 2 | Success shows the sent text | Flight scope: yes. Planned-leg scope: only via the appended thread row — see N1. |
| 3 | `NO_ACTIVE_SESSION` shows the specific sentence | Probe in the **planned-leg** scope: the 409's `error` renders verbatim in `edit-error`, distinct from a generic failure. Server sentence confirmed identical to the frozen text. |
| 4 | Tests for no-key / no-PDC / success / NO_ACTIVE_SESSION / generic error | 4 of 5 genuine; the no-key case is **B2**. |
| 5 | `cd client && npm test` + type-check | `Test Files 7 passed (7) · Tests 29 passed (29)`; `tsc --noEmit -p tsconfig.json` and `npm run test:types` silent. |
| 6 | No existing flow changes | `handleRequestClearance`, `handleRequestWx`, `handleSend`, `handleRequestLoadsheet` byte-identical to HEAD; the only HEAD line replaced is the mount-effect destructure it had to extend. |

## No test touches the network

`npm test` re-run under a scratch vitest config that keeps `tests/setup.ts` and
adds a guard throwing on any `fetch` or raw socket connect to a non-local host:

```
Test Files  40 passed (40)
      Tests  990 passed (990)
```

Every `sayIntentionsClient` call in the suite is `fetchImpl`-injected; the one
test naming `apipri.sayintentions.ai` only asserts the URL string built for a
stub. The client suite's `src/test/setup.ts` rejects any unstubbed `fetch`, and
no client source references an absolute SayIntentions URL.

## Non-blocking follow-ups

1. **The success confirmation is dead in the planned-leg scope.**
   `AcarsMessages.tsx:393` sets `siMessage`, but line 576 renders it inside the
   `scope === 'flight'` SayIntentions section (line 540), while the push button
   is rendered in **both** scopes. Probe: after a successful planned-leg push,
   `"Sent to SayIntentions:" rendered: false`, though the appended thread row
   does show the sent body (1 node) — which the criterion allows, so this is not
   blocking. One-line fix: render `{siMessage && …}` next to `{sendError && …}`
   in the Send block (line 537), which covers both scopes.
2. **`client/src/types.ts` `SayIntentionsPushResponse` omits `sent_text`**,
   which the server type carries; the mirror is supposed to drop nothing. No
   behavioural effect today (the page uses `response.message.body`, identical
   bytes), but the mirror will drift.
3. **Question, not a finding:** `normaliseRoute` (`src/acars.ts:519`) throws on
   an `undefined` route. Unreachable through any real path — `parseClearancePayload`
   is total and yields `string | null` — and only reproducible via a cast, so
   `route == null` would be belt-and-braces rather than a fix.

---

## Orchestrator resolution (2026-09-17, after this review)

Both blocking findings fixed directly (comment/test-only, no production
logic changed):

- **B1**: removed the `design.md §11.3`/`prototypes/condense.js` citation
  from `tests/acars.test.ts`'s `buildCondensedClearanceMessage` describe
  block comment — third recurrence of this rule this run (after phase 3's B2
  and its own non-blocking follow-up), now fixed at all four known sites.
- **B2**: rewrote `client/src/pages/AcarsMessages.test.tsx`'s "hides the push
  button when no API key is saved" test, which passed vacuously against the
  pre-load DOM. Renamed to "disables the push button..." and now uses
  `screen.findByRole` to wait for the real post-load state, asserting the
  button is present-but-disabled with the exact `title` text
  (`'No SayIntentions key saved (Prefiles → SayIntentions)'`) the component
  actually renders — matching the disabled-not-hidden behavior T-010 built,
  which the old test never observed.

Also folded in risk #1 (the dead push-confirmation line in planned-leg
scope): `siMessage`'s render moved from inside the flight-only
`scope === 'flight'` block to the shared section next to `sendError`, so a
planned-leg push now shows "Sent to SayIntentions: …" the same way a
flight-scoped one does — previously it only ever rendered in flight scope,
even though the push button itself renders in both. And risk #2 (type
drift): added the missing `sent_text` field to `client/src/types.ts`'s
`SayIntentionsPushResponse` to match the server type in `src/types.ts`.

Re-verified after all four fixes: `npm test` (990/990), `cd client && npm
test` (29/29, including the rewritten test passing under its new name and
assertions), `npx tsc --noEmit`, `npm run test:types` (both root and
client) — all clean under Node 20.20.2. Citation grep clean across every
file this run has touched. **Phase 4 fixes applied; awaiting final
confirmation review.**

---

## Follow-up verification (2026-09-17, after the Orchestrator's fixes)

**Verdict: approve.** All four fixes re-derived independently — the fix
summary was not taken as evidence. T-009 **approve**, T-010 **approve**;
phase 4 and, with it, the whole run's implementation is complete.

### 1. B1 — citation rule, whole run diff (not just phase 4)

```
$ git diff -U0 -- src client tests agent | grep '^+' \
  | grep '§\|\.claude/runs\|design\.md\|plan\.json\|T-0[0-9][0-9]\|phase[0-9]'   # no output
$ grep -rn <same pattern> <the 9 untracked run files>                            # no output
```

Widened to `Amendment|reviews/|condense\.js|prototypes/|2026-09-17` over all
23 run-touched files (whole file, not just added lines): the only hits are
test-fixture ISO timestamps (`'2026-09-17T14:31:02.000Z'` &c.). Zero citations
anywhere in the run. The fixed site now reads
`tests/acars.test.ts:1245: // Seven worked examples, reproduced here byte for byte.`
— the fact without the document.

### 2. B2 — the rewritten test pins real behaviour

Component read first (`AcarsMessages.tsx:485-502`): the button is always
rendered, `disabled={!isEnabled}` with `isEnabled = siKeySet && plannedLegId
!== null && hasPdcUplink && sendingId === null`, and `!siKeySet` takes first
place in the `disabledReason` chain — so **present-but-disabled**, title
`'No SayIntentions key saved (Prefiles → SayIntentions)'`. The test's fixtures
(`threadWithPdc`, leg 1) leave the missing key as the *only* disabled reason,
so the assertion is isolated; `findByRole` means it cannot pass pre-load.

Non-vacuity proved by mutation, in a scratch copy of `client/`
(`node_modules` symlinked, nothing in the checkout touched) — baseline 11/11:

| Mutation in the scratch component | Result |
|---|---|
| `if (!siKeySet) return null;` (hide instead of disable) | **fails** — `Unable to find role="button" and name "SEND TO SAYINTENTIONS"` |
| drop `siKeySet` from `isEnabled` (enabled with no key) | **fails** |
| title → `'No SayIntentions key saved'` | **fails** |

The old test survived all three; this one kills each.

### 3. Planned-leg push confirmation actually renders

Traced: `handleSiPush` (`:393`) sets `siMessage`; it is now rendered at
`:541`, inside the shared `Send` block next to `sendError`, above the
`scope === 'flight'` gate at `:544`. Exercised rather than only read — a
throwaway test in the scratch copy renders the component at
`/planned-leg/1/acars` with a stubbed `201`:

```
✓ scratch: planned-leg scope push confirmation (1 test)
```

It asserts the button is enabled, the flight-only SayIntentions section is
absent, and `Sent to SayIntentions: CLEARED AS FILED RUNWAY 24R …` appears.
Restoring the pre-fix placement (render back inside the flight-only block)
makes that same test fail — `Unable to find an element with the text: Sent to
SayIntentions: …` — so the one-line move is load-bearing, not cosmetic.

### 4. Type mirror

`client/src/types.ts:722-728` vs `src/types.ts:900-906`: field-for-field
identical — `planned_leg_id: number`, `sent_text: string`, `message:
AcarsMessage`. Only the doc comment on `message` differs in wording. The
server does send the field: `src/routes/sayIntentions.ts:312`
`const body: SayIntentionsPushResponse = { planned_leg_id: legId, sent_text: sentText, message };`

### 5. Suites, scope, and safety

```
npm test                   → Test Files 40 passed (40) · Tests 990 passed (990)
cd client && npm test      → Test Files  7 passed (7)  · Tests  29 passed (29)
npx tsc --noEmit (root)    → clean      npm run test:types (root)   → clean
npx tsc --noEmit (client)  → clean      npm run test:types (client) → clean
```

Counts match the pre-fix review exactly, so no test was dropped to make the
rewrite pass. Only four files carry a post-review mtime (19:53) —
`tests/acars.test.ts`, `client/src/pages/AcarsMessages.{tsx,test.tsx}`,
`client/src/types.ts` — the four fixes and nothing else. Byte-compared against
`HEAD` again: `handleSend`, `handleRequestLoadsheet`, `handleRequestClearance`,
`handleRequestWx`, `buildClearanceBody`, `buildClearanceDetails`, `clampRoute`,
`levelText`, `clearanceDedupKey` all still IDENTICAL.

Live `flights.db` md5 `d7b2a00eb72f9354dce759c3ccac9a3f` before and after —
same value as the first review; still 0 `sayintentions*` tables and
`max(acars_messages.id) = 16`. `client/dist/index.html` 18:46:43 and
`dist/index.js` 12:32:38 unchanged: nothing was built in this checkout. No
server was started this round; the user's 3000 was never touched. Scratch
client copy deleted.

### Non-blocking follow-ups (new)

1. The committed client suite still covers the push only in the **flight**
   scope; the planned-leg path (button enabled, confirmation line) is verified
   here but untested in-repo. The scratch test above is ~40 lines and drops
   into `AcarsMessages.test.tsx` as-is.
2. `AcarsMessages.tsx:496` — when the only disabled reason is an in-flight
   send (`sendingId !== null`), `disabledReason` is `''`, so the button
   renders `title=""`. Harmless, but `title={disabledReason || undefined}`
   says it better.
