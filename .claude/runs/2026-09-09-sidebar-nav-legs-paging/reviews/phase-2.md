# Review — phase 2 (T-003, sidebar + AppShell layout)

**Verdict: request_changes**

Re-ran all 12 of T-003's acceptance criteria plus this task's own (a)/(b)/(c)
independently, on my own scratch server (`:3100`, my own fixture db with 2
trips/9 flights and flight_points so Leaflet actually renders), a baseline
server (`:3101`, `git worktree` at commit `4a1f823`, pre-phase-1/2) and a
third server (`:3102`) using T-003's own `seed-many-legs.mjs` (45-flight trip)
for pagination/large-list checks. T-003's report was not opened; only its
`risks` list was used to target checks.

## T-003 criteria, re-verified

1. **Scope.** `git diff --name-only` → `client/src/App.tsx`, `client/src/index.css`,
   `client/src/pages/TripDetail.tsx`; no `src/`, no `Home.tsx`. `git status --porcelain`
   → those three + untracked `Sidebar.tsx` and three run dirs (two pre-date this
   run per phase-1's review, ignored per risk #4) — PASS.
2. **Sidebar fetches.** `grep -n "apiFetch\|fetch(" client/src/components/Sidebar.tsx`
   → 3 hits, only `/api/flights` and `/api/trips` — PASS.
3. **App.tsx print-route diff.** `git diff client/src/App.tsx` — the hunk touches only
   lines 1-31 (imports + AppShell body); `/device`, `/override`, both `/print/*`
   routes and their comment (lines 33-49) are outside the diff, byte-identical — PASS.
4. **Print/device/override mount neither.** Puppeteer, 1280x900: `/print/trip/1`,
   `/print/flight/9`, `/device`, `/override` → `.sidebar === null` and
   `.header === null` on all four — PASS.
5. **Exactly one `.sidebar`.** `/`, `/trip/1`, `/flight/9` → `1` each — PASS.
6. **Counts.** Ground truth: 2 trips, 9 flights, 4 ungrouped (computed from
   `GET /api/trips` + `/api/flights`). Sidebar: trip rows = 2, expanding
   trip[0] → 3 sub-items (== `flights.length`), standalone section → 4 items — PASS,
   all three numbers match.
7. **Active state.** `/trip/2`: exactly one `.sidebar-trip-link.is-active`, href
   `/trip/2` — PASS. `/flight/:id` for a flight in trip 2: `.sidebar-leg.is-active`
   present and the parent's `aria-expanded="true"` with **no click** — PASS.
8. **Navigation.** Click trip link: URL `http://localhost:3100/` → `.../trip/1` —
   PASS. Click disclosure: URL unchanged before/after — PASS.
9. **Collapse.** Click `.sidebar-toggle` → `localStorage.sidebarCollapsed === '1'`;
   `page.reload()` → still `.is-collapsed`; toggle bbox `{w:40,h:35.19}` — PASS.
10. **Layout, 1280x900.** `/trip/1`: `#map` width 1052px (≥500), `.leaflet-container`
    height 418px (>0). `scrollWidth<=innerWidth+1` on `/`, `/trip/1`, `/flight/9` all
    exactly `1280<=1281` — PASS.
11. **Home unchanged.** `#flights-table tbody tr` count: candidate `:3100` = 12,
    baseline `:3101` (pre-phase-1/2, same fixture db) = 12, and
    `outerHTML.length` identical (6865 both) — PASS, byte-identical rendering.
12. **Build/test/db.** `cd client && npx tsc --noEmit` → exit 0. `npm run build:client`
    → exit 0 (`✓ built in 1.99s`). `npm test` → `Test Files 11 passed, Tests 211
    passed (211)`. Live `flights.db` md5 before any scratch work and after:
    `baa65e925f29784e21ac6c8d9f85c42e` both times — PASS.

## This task's own (a)/(b)/(c)

- **(a) PDF export.** `curl .../api/trips/1/export.pdf` → `HTTP:200 SIZE:749963`.
  `file trip1.pdf` → `PDF document, version 1.4, 4 page(s)`. Server log shows
  `[PDF] Rendering http://127.0.0.1:3100/print/trip/1` with no readiness-timeout
  warning. Combined with criterion 4 above (DOM-asserted, not diff-read), the
  print route is confirmed clean and the export succeeds — PASS.
- **(b) Leaflet in the flex layout, 1280x900 and 800x900.** `/flight/9`,
  `/trip/1`, `/trip/1?view=atlas`: at both viewports, `#map`/`#atlas-map` and
  `.leaflet-container` are non-zero (e.g. 1280: 1050x418 / 800: 710x418; atlas
  1280: 1050x518 / 800: 710x518) — PASS for all six map checks. **Horizontal
  scroll fails at 800px on plain `/trip/1`** — see Finding 1.
- **(c) Home identical.** Covered by criterion 11 above — byte-identical
  `#flights-table` markup pre- and post-diff — PASS.

## Findings

**1. [BLOCKING] `/trip/:id` (default legs view) scrolls horizontally at 800px,
made worse by the sidebar.** `client/src/index.css` (`.app-body`/`.sidebar`
rules, ~L672-793); `client/src/pages/TripDetail.tsx` legs table has no
horizontal-scroll wrapper.
  - Baseline (commit `4a1f823`, no sidebar): `/trip/1` at 800x900 →
    `documentElement.scrollWidth = 820` (already 20px over `innerWidth=800`,
    pre-existing and not this task's fault — the unwrapped 8-column table has
    a wider intrinsic min-width than 800px allows).
  - Candidate (this diff): same page, same viewport → `scrollWidth = 860`,
    **40px worse** — exactly the width of `.sidebar-toggle`, which at ≤900px
    defaults to visible-and-collapsed (`window.innerWidth <= 900` seeds
    `collapsed = true`) and sits in normal flex flow, not absolutely
    positioned, so it adds to total document width on top of the table's
    existing overflow instead of being absorbed by `.app-main`'s
    `min-width:0`.
  - Reproduced independently with T-003's own `seed-many-legs.mjs` 45-flight
    fixture on a separate server: `scrollWidth = 848` at 800x900 (still over).
  - Not present on `/trip/1?view=atlas` (`scrollWidth = 800`, exact) or
    `/flight/9` (`scrollWidth = 800`, exact) at the same viewport — isolated to
    the plain legs-table view, whose fixed-width table has no accommodation
    for narrow viewports.
  - This directly fails the goal's own explicitly-required check ("the page
    must not scroll horizontally... at 800px" for `/trip/:id`) and confirms
    T-003's self-reported risk #3: the ≤900px behavior was only indirectly
    checked and the one client acceptance criterion that covered scrollWidth
    (#10) never exercised a narrow viewport.
  - Repro: `puppeteer` → `page.setViewport({width:800,height:900})`, navigate
    to `/trip/<id>` with `localStorage.sidebarCollapsed` unset (default),
    read `document.documentElement.scrollWidth`.

No other blocking findings. Design conformance (structure, active-state rules,
collapse persistence, disclosure `stopPropagation`, CSS scoped to new
selectors, no `.header` edits) all matched T-003's task record.

## Self-reported risks, checked

1. TripDetail.tsx/index.css still carrying T-001's diff — confirmed consistent,
   not a merge issue: pagination text (`Page 1 of 3 · legs 1–20 of 45`) and
   page-1 row count (20) both correct against the 45-flight fixture, coexisting
   correctly with the sidebar's own fetch/render cycle.
2. `top: 61px` measured constant — confirmed present, non-blocking as stated.
3. ≤900px / 800px behavior — **confirmed broken**, see Finding 1. Not a
   non-blocking note; it fails an explicit numeric criterion.
4. Pre-existing untracked run dirs — confirmed unrelated, ignored.

## Housekeeping

All scratch servers (`:3100`, `:3101`, `:3102`) killed; `git worktree remove`
run; scratch dirs and my own `_scratch` review-helper files deleted. Live
server (pid unchanged throughout, started 19:16) never touched. Live
`flights.db` md5 unchanged: `baa65e925f29784e21ac6c8d9f85c42e` (before and
after).

---

# Fix round 1 (T-003-fix1) — re-review of Finding 1

**Verdict: approve**

Re-verified independently on two of my own scratch servers, neither on :3000:
`:3105` (a copy of the live `flights.db`, real trip id 1 "Circumnavegação",
50 legs) and `:3106` (`tools/seed-many-legs.mjs` 45-flight fixture). T-003's
fix1 report and its own `verify-T-003-fix1.mjs` were not opened; the diff and
this envelope's description of the claim were the only inputs, and the claim
itself was independently re-tested, not trusted.

## Diff actually applied (independent read, not the report)

`git diff --name-only` → `client/src/App.tsx`, `client/src/index.css`,
`client/src/pages/TripDetail.tsx` — same three files as before this round.
`git diff -- client/src/App.tsx` is byte-identical to what phase-2's original
review already approved (same 15-line hunk, lines 1-31). `git diff --
client/src/index.css` has two hunks: the pre-existing 127-line "App
layout/Sidebar" hunk (unchanged in size/content from the original review —
the `@media (max-width: 900px)` overlay rule in it predates this fix round,
it is not new) and a 14-line hunk at L364 adding `.legs-table-wrap { overflow-x:
auto; }` plus a comment and the (already-approved, T-001) `.legs-pagination`
rule. `git diff -- client/src/pages/TripDetail.tsx` shows exactly one new
`<div className="legs-table-wrap">...</div>` wrapping the `<table>`, no other
structural change. `client/src/components/Sidebar.tsx` (untracked, unreviewable
via `git diff`) has no table/wrap-related content and is not implicated.
Scope confirmed: no file outside `TripDetail.tsx`/`index.css` changed this
round; no `src/` file touched.

## Verification, independent

1. **The exact repro from Finding 1, both fixtures, 800x900, default
   (collapsed) sidebar state.** Puppeteer:
   - Real trip (`:3105/trip/1`): `scrollWidth: 800, innerWidth: 800` — **PASS**
     (was 860 before the fix).
   - 45-leg fixture (`:3106/trip/1`): `scrollWidth: 800, innerWidth: 800` —
     **PASS** (was 848 before the fix).
2. **No regression on `/trip/:id?view=atlas` and `/flight/:id`, 800x900.**
   Atlas (`:3105/trip/1?view=atlas`): `scrollWidth: 800`, `#map` 712×520,
   `.leaflet-container` 710×518 — PASS. Flight detail (`:3105/flight/65`):
   `scrollWidth: 800`, `#map` 712×420, `.leaflet-container` 710×418 — PASS.
   Both non-zero, map unaffected by the CSS change.
3. **No regression at 1280x900 on `/trip/:id`.** `:3105/trip/1`:
   `scrollWidth: 1280 == innerWidth`, `#map` width 972px (≥500) — PASS. Also
   re-checked `/` (1280) and `/flight/65` (1280): both `scrollWidth ==
   innerWidth == 1280` — consistent with the original criterion 10 result
   (no shift from this round; the earlier review's differing map-width number,
   1052px, came from a different fixture db, not a regression).
4. **Overflow moved into the wrapper, not clipped.** 45-leg fixture, 800x900:
   `.legs-table-wrap` `scrollWidth 784 > clientWidth 712` — genuinely
   scrollable, not just visually cut off. Confirmed the last (8th) header
   cell is off-screen relative to the wrapper before scrolling
   (`lastHeadVisibleBefore: false`) and fully on-screen after setting
   `wrap.scrollLeft = wrap.scrollWidth` (`lastHeadVisibleAfter: true`,
   applied `scrollLeft: 72`) — no data made unreachable.
5. `cd client && npx tsc --noEmit` → exit 0. `npm run build:client` → exit 0
   (`✓ built in 2.11s`). `npm test` → `Test Files 11 passed (11)`, `Tests 211
   passed (211)` — same count as the original phase-2 review.
6. Live `flights.db` md5 before this round's work and after:
   `baa65e925f29784e21ac6c8d9f85c42e` both times — unchanged.
7. Scope — see "Diff actually applied" above: only `TripDetail.tsx`/
   `index.css` changed this round; `App.tsx`, `Home.tsx`,
   `PlannedLegRows.tsx`, everything under `src/` untouched.

## Spot-checks of prior passing criteria most likely affected by this change

- **Criterion 10 (1280x900 layout numbers).** Re-run above (#3): `#map` width
  972px (≥500 threshold, same fixture db as this round's `:3105`), no
  horizontal scroll on `/`, `/trip/1`, `/flight/65` — unchanged conclusion,
  no shift caused by the wrapper div (which only takes effect when the table
  is wider than its container, not the case at 1280px on this fixture).
- **Legs-pagination controls (phase 1) inside the new wrapper.** 45-leg
  fixture, 1280x900: initial `Page 1 of 3 · legs 1–20 of 45`; clicked Next →
  `Page 2 of 3 · legs 21–40 of 45`, URL `?page=2`, 20 rows rendered; clicked
  Prev → back to `Page 1 of 3 · legs 1–20 of 45`, URL cleared (`?page=` gone)
  — pagination fully functional inside `.legs-table-wrap`, no interference
  from the new wrapper or its scrollbar.

## Findings

None blocking. Finding 1 from the original review is resolved and verified
independently on both required fixtures.

## Housekeeping

Scratch servers `:3105`/`:3106` killed (confirmed via `ps aux` — only the
live server, pid `667954`, started `19:16`, remains). Scratch cwd dirs and
scripts injected into the repo root for ESM module resolution
(`_reviewer_scratch_verify*.mjs`) deleted after use. Live server never
touched. Live `flights.db` md5 unchanged: `baa65e925f29784e21ac6c8d9f85c42e`
(before and after this round).
