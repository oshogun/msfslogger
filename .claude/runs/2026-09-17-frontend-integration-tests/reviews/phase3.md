# Phase 3 review — journey coverage (T-006, T-007, T-008)

**Verdict: approve.**

18/18 Playwright tests and 14/14 client Vitest/RTL tests re-run independently by
the Reviewer, both green. 13 of the 13 acceptance criteria across the three
tasks verified by hand; none taken from the implementer's report. Live
`flights.db` and `client/dist/index.html` byte-identical before and after;
nothing bound port 3000.

## Per-task verdicts

| Task | Verdict | Criteria verified |
| --- | --- | --- |
| T-006 auth journey | approve | 4/4 |
| T-007 data-viz + error-states journeys | approve | 4/4 |
| T-008 RTL component tests | approve | 4/4 (one criterion names a script that does not exist — see F-3) |

## Independent re-runs

Playwright, full suite, all 4 spec files, my own scratch root and the frozen
port 3210 (design §4.2), Node 20.20.2:

```
cd client && export MSFSLOGGER_E2E_SCRATCH=<session scratchpad>/e2e-review && npx playwright test
[WebServer] <scratch>/e2e.db
[WebServer] {"db":"<scratch>/e2e.db","tripId":1,"flightIds":[1,2],"plannedLegIds":[1,2]}
[WebServer] No TLS configured — serving plaintext HTTP on loopback only.
[WebServer] [HTTP] Server running at http://127.0.0.1:3210
Running 18 tests using 1 worker
  ✓ 1–6  auth.spec.ts        ✓ 7–11  data-viz.spec.ts
  ✓ 12–17 error-states.spec.ts ✓ 18  smoke.spec.ts
  18 passed (24.2s)
```

Component suite, real checkout (no server, no DB):

```
cd client && npm test
 ✓ src/pages/{AllFlights,Home,FlightDetail,TripDetail}.test.tsx (2 tests each)
 ✓ src/pages/Login.test.tsx (6 tests)
 Test Files  5 passed (5)   Tests  14 passed (14)   Duration  2.50s
```

`cd client && npm run test:types` → clean (no output, exit 0).

## The two flagged claims

**1. Logout isolation — confirmed true.** `client/e2e/specs/auth.spec.ts:75-81`
puts the logout test in its own `describe` with
`test.use({ storageState: { cookies: [], origins: [] } })` and logs in inside
the test body (`:84-87`), so the shared `e2e/.auth/operator.json` session is
never the one logged out. The full-suite run is the evidence, not the source
read: the logout test ran 6th, and the 12 tests after it (all of data-viz,
error-states and `smoke.spec.ts`, every one of them on the default shared
`storageState`) passed. A regression here would cascade as ~12 redirect-to-login
failures.

**2. Design §3.4's FlightDetail claim is wrong; the implementer was right to
ignore it.** `client/src/pages/FlightDetail.tsx:289` renders the planned-leg
section only under `flight.planned_leg_id != null` — there is no picker to link
an *unlinked* leg anywhere in that file. The "Link to leg" control lives in
`client/src/pages/TripDetail.tsx:873,891`. Fixture flight 1 has no
`planned_leg_id`, so nothing of the kind can render at `/flight/1`. Design §3.4's
line "an unlinked planned-leg picker offering leg 1" is a stale design claim, not
a missing implementation; T-007's FlightDetail assertions (aircraft, route,
`Points` = 3, `Distance` 152.4, 2 map markers) match what actually renders.
No action needed beyond recording the design erratum.

## Isolation and must-not-change checks

| Check | Result |
| --- | --- |
| `md5sum client/dist/index.html` before / after | `2bc39f5b…` / `2bc39f5b…`, mtime still 12:32:35 |
| `md5sum flights.db` before / after | `d7b2a00e…` / `d7b2a00e…`, mtime still 12:32:27 |
| Live DB content | `max(flights.id)=89, count=56` before and after; `app_setting name='e2e_seed'` → 0 rows (the seed never ran here) |
| Port 3000 | same listener throughout, pid 1143167, never touched |
| Scratch server | 3210, loopback, `FLIGHTS_DB_PATH=<scratch>/e2e.db`; no listener on 3210 after the run, no leaked process |
| Teardown | Playwright killed its own `webServer` PID; nothing killed by name/pattern. My scratch root deleted. |
| §MNC 7 — no app source changed to make tests pass | No `data-testid`, no test-only branch. `client/src/pages/Home.tsx` and `index.css` are modified in the working tree but dated 2026-09-16 19:33/20:08, i.e. the user's own WIP predating this phase's first file (15:52) — not phase-3 edits. |
| Scope / `allowed_paths` | Every phase-3 file is inside its task's list: `e2e/specs/auth.spec.ts` (T-006), `e2e/specs/{data-viz,error-states}.spec.ts` (T-007), `src/pages/*.test.tsx` + `src/test/{mockFetch,fixtures,renderWithProviders}` (T-008). Nothing outside. |
| No run citations in comments | `grep -rnE '\.claude/runs\|design\.md\|plan\.json\|T-0[0-9][0-9]\|§\|phase[0-9]\|Amendment' client/e2e client/src/test client/src/pages/*.test.tsx` → no matches. |
| §1.8 locators | Every page assertion scoped to `getByRole('main')`; decorated text matched by substring (`🚗 E2E Baltic Hop`); no wall-clock-derived string asserted (`2h 17m` derives from the pinned `duration_sec` 8220). |

## Journey coverage vs. the intake

| Intake journey | Playwright | RTL |
| --- | --- | --- |
| Authentication | 6 passing (`auth.spec.ts`): login success, wrong password → real 401 `Invalid username or password`, unknown username, unauthenticated `/flights` → `/login`, session survives reload, logout clears server-side state | 6 passing (`Login.test.tsx`): 401 + 429 messages, three empty-field cases |
| Core data visualization / interaction | 5 passing (`data-viz.spec.ts`): Home stats 2/1/2h 17m/248.5 + both recent rows in `start_time` DESC + both leg-picker options, AllFlights trip grouping with `toHaveCount(5)`, `/flight/1` and `/flight/2` asserted distinctly, `/trip/1` ghost leg + loose leg absent + empty SimBrief panel | 8 passing (`Home/AllFlights/FlightDetail/TripDetail.test.tsx`) |
| Error handling and loading states | 6 passing (`error-states.spec.ts`): real 404 on `/flight/999999` and `/trip/999999`, `Loading...` observed then replaced on both detail pages, aborted request on FlightDetail, inline error on AllFlights with the page still rendering | 8 passing: loading/pre-resolve state and error state for each of the four pages |

Failure paths probed beyond the specs' own: the 401 and 429 paths are asserted
from the real server (401) and a mocked status (429); abort/`connectionfailed`,
non-existent ids and a 500 with an error body are all covered. `mockFetchRoutes`
throws on any undeclared URL/method (`client/src/test/mockFetch.ts:66-72`), so a
component reaching an endpoint a test did not declare fails loudly rather than
hanging — good.

## Findings (non-blocking follow-ups)

- **F-1 — design erratum, §3.4.** "FlightDetail `/flight/1` … an unlinked
  planned-leg picker offering leg 1" describes a control that exists only on
  TripDetail. Correct the line in an amendment so the next reader does not treat
  it as missing coverage. No code change.
- **F-2 — root `package.json` never got design §1.5's two scripts.**
  `test:client` (`cd client && npm test`) and `test:e2e`
  (`cd client && npm run test:e2e`) are frozen in §1.5 but absent from the root
  `scripts` block. This is nobody's failure in phase 3 — root `package.json` is
  in no task's `allowed_paths` (T-004's list stops at `client/package.json`) —
  but it is an unassigned frozen item. CI (§5.1/§5.2) uses the `cd client` form,
  so phase 4 is unaffected; suggest folding it into T-010.
- **F-3 — T-008 criterion 1 names `npm run test:unit`, which does not exist.**
  Design §1.5 froze the script as `test`. Verified with `cd client && npm test`,
  which is the same suite; recording the wording mismatch rather than failing a
  criterion over a name the design itself overrode.
- **F-4 — Home/AllFlights "loading" assertions are empty-state assertions.**
  Neither page has a loading indicator (`grep -n Loading client/src/pages/{Home,AllFlights}.tsx`
  → no matches), so `Home.test.tsx:26` / `AllFlights.test.tsx:22` assert
  `No flights recorded yet.` before the fetch resolves. That is the honest
  pre-resolve state and the test comment says so; if a spinner is ever added,
  these two assertions should move to it.
- **F-5 — `plannedLegFixture` / `plannedLegListItemFixture` are unused.**
  `client/src/test/fixtures.ts:57,113` are exported but imported by no test
  today. Harmless (they are shared-helper surface for the next test), worth a
  glance if they drift from `client/src/types`.
- **F-6 — no click-through interaction in `data-viz.spec.ts`.** The intake's
  journey is "data visualization/interaction"; the specs assert rendering only
  (navigation-by-click, trip-group expand, row → detail). T-007's own criteria
  do not ask for it and the plan scoped it to rendering, so this is a coverage
  idea for a later run, not a defect.
