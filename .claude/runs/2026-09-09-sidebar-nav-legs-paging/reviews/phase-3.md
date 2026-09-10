# Review — phase 3 (T-005: Home retirement, `/flights`, README)

**Verdict: `request_changes`** — one blocking finding (F1, README accuracy). Every
interactive control of the pre-run Home page survives and works; every cross-phase
regression check passes. The only defect is a documentation claim the code does not
support, which the T-006 goal names explicitly.

Reviewed independently against my own scratch server (`:3100`, scratch cwd
`…/scratchpad/rev3/ui`) and a second empty-db server (`:3101`). The T-005 report was
not opened. **Live `flights.db` md5 `8fc4f703bb8197b2b432ddd4ce31d4d7` before and
`8fc4f703bb8197b2b432ddd4ce31d4d7` after** — unchanged. Both scratch servers killed;
only the user's `:3000` (cwd `/home/guilherme/msfslogger`) still runs.

Baseline = `git show HEAD:client/src/pages/Home.tsx` (HEAD is pre-run; nothing in this
run is committed). Fixtures added to the *scratch* db: trip 2 = 45 legs
(`tools/seed-many-legs.mjs`), trip 3 empty, flights 111–114 ungrouped with 30 points,
flight 115 ungrouped with `point_count = 0`.

## Control-by-control: pre-run Home → where it lives now

| Pre-run Home control | Now | Proof |
|---|---|---|
| `#flights-table` combined table | `/flights` | `/flights` → 1 `#flights-table`, 96 `tr[data-id]`; `/` → 0 |
| Row checkbox `input.row-check` | `/flights` | click on `tr[data-id=111]`+`112` → `#combine-info` = `Flights #111 and #112 selected` |
| Disabled checkbox, no-points flight | `/flights` | `tr[data-id=115] input.row-check` → `{disabled:true, title:"No recorded points", checked:false}`; clicking it leaves 0 `.combine-toolbar` |
| Select-all header checkbox | `/flights` | `title="Select all completed flights"`; click → `95 flights selected` (95 of 96 combinable), flight 115 still `checked:false`; second click → toolbar gone |
| Trip collapse / expand header | `/flights` | click `tr.tr-trip-header` for the 45-leg trip: rows 96 → 51 → 96 (Δ = 45) |
| "View Trip" link (stopPropagation) | `/flights` | 4 links `/trip/{4,3,2,1}`; click → URL `…/trip/4`, no collapse toggle |
| Per-row "View" button | `/flights` | 95 `td.td-actions a.btn` after the combine |
| `#combine-info` 1 / 2 / n wording | `/flights` | `1 flight selected` … `Flights #111 and #112 selected` … `95 flights selected` |
| **New Trip** (prompt) | `/flights` | prompt `Trip name:` → `POST /api/trips {"name":"REV Trip From Selection"}` then `POST /api/trips/4/flights {"flightId":114}`; `GET /api/trips` → trip 4, 1 leg, flights `[114]` |
| **Add to Trip** + picker `<select>` + Add | `/flights` | picker options = all 3 trips, defaults to `trips[0]`; select `3`, Add → `POST /api/trips/3/flights {"flightId":113}`; trip 3 now 1 leg `[113]`; toolbar clears |
| **Combine Selected** (disabled ≠ 2) | `/flights` | disabled with 1 selected = `true`, with 2 = `false`; confirm dialog text verbatim (`Combine flights #111 and #112 into one? Both originals will be deleted.`) → `POST /api/flights/combine {"id1":111,"id2":112}` → URL `…/flight/116`, page `Flight #116 — REV C172 alpha`, `duration_sec 3600` (1800+1800), 68 points, old 111/112 → HTTP 404 |
| **Export KML** (set) | `/flights` | click → `POST /api/flights/export.kml` 200, `content-type: application/vnd.google-earth.kml+xml`; same request via curl = 4 765 bytes, `Content-Disposition: …flights-2-2026-09-06.kml`, body starts `<?xml …<kml …<name>Selected flights (2)` |
| KML >100-flight guard | `/flights` | not reachable in my 95-flight fixture; covered by the move-proof below (line present verbatim) |
| Empty state | `/` **and** `/flights` | `:3101` empty db, both routes render `.empty-state` = `✈ \| No flights recorded yet. \| Start MSFS 2024 and take off to begin logging.`, 0 `#flights-table`, 0 pageerrors |
| Error `<p>` | `/flights` | verbatim move (below) |
| `LivePanel` when `FLYING` | `/` (Home) | line byte-identical to HEAD:Home.tsx:205 |
| 10s poll + `visibilitychange` + stale-selection prune | `/flights` | verbatim move (below) |
| "Ungrouped Flights" header, leg colour swatch, Active badge, `.td-route` | `/flights` | 1 `tr.tr-ungrouped-header`, 93 `.leg-color-swatch`, 1 `.badge-active-trip`, 94 `.td-route` |

**Move-proof (not a rewrite):** whitespace-insensitive line-set comparison of
`HEAD:client/src/pages/Home.tsx` vs `client/src/pages/AllFlights.tsx` — the only lines
dropped are the 6 `LivePanel`/`Props`/`Status` wrapper lines, the only lines added are
`import type { Flight, Trip }` and `export function AllFlights() {`. Every handler,
guard and JSX node moved intact.

## Cross-phase regression checks (all on `:3100`)

| Check | Result |
|---|---|
| Legs paging, 45-leg trip | no param → 20 rows, `Page 1 of 3 · legs 1–20 of 45`, Prev disabled; `?page=2` → 20 rows, `Page 2 of 3`; **`?page=3` → 5 rows, `Page 3 of 3 · legs 41–45 of 45`, Next disabled** |
| Paging bad input | `?page=99` → clamps to page 3; `?page=0`, `?page=abc`, `?page=-1` → clamp to page 1; URL never rewritten |
| Next / Prev buttons | Next → URL `/trip/2?page=2` + `Page 2 of 3`; Prev → URL `/trip/2` (param dropped) + `Page 1 of 3` |
| ≤20-leg trip | `/trip/3` (1 leg) → 0 `.legs-pagination` |
| Print page not paginated | `/print/trip/2` → 45 `tbody tr`, 0 `.legs-pagination` |
| Sidebar active state | `/` → `.is-active` on `href="/"`; `/flights` → on `href="/flights"`; `/trip/2` → on `href="/trip/2"` with that trip auto-expanded (`aria-expanded="true"`, 45 legs shown, other 3 trips collapsed); `/flight/114` → active on `href="/flight/114"`, parent trip 4 auto-expanded; `/flight/115` (ungrouped) → active on the standalone item, no trip expanded |
| No Header/Sidebar off-shell | `/print/trip/2`, `/print/flight/116`, `/device`, `/override` → `.header` 0, `.sidebar` 0, `.app-body` 0 on all four (`.header` is Header.tsx's real root class, verified) |
| Trip PDF | `GET /api/trips/2/export.pdf` → 200, `application/pdf`, **166 547 bytes, 3 pages**, magic `%PDF-1.4`, 4.7 s |
| Build / tests | `npm run build` (client+server) exit 0; `npm test` 211 passed / 11 files; `npm run test:types` exit 0 |
| Scope | `git status --porcelain` lists only `README.md`, `client/src/{App.tsx,index.css,pages/{Home,AllFlights,TripDetail,FlightDetail}.tsx,components/Sidebar.tsx}` + run dirs. No `src/`. All inside T-005 `allowed_paths`. CSS diff is `158 insertions, 0 deletions`, all new selectors. |
| Back-links | `back-link` → `/flights` in both detail pages; `← Back` → `/` in both, as T-005 §5 specified |
| Console | 0 `pageerror`, 0 `console.error` across every page driven |

## Findings

### F1 — blocking — `README.md:7`: the overview attributes four flight-detail capabilities to `/flights`

The rewritten sentence reads:

> **All Flights** (`/flights`) is where you browse flights, view GPS tracks and altitude
> charts, group flights into trips, edit or delete records, attach a PDF flight plan to
> each flight (stored in `flight_plans/`), and export a flight or a whole trip as a PDF.

The pre-run subject was "The web UI lets you …", which was true of the app as a whole.
Narrowing the subject to `/flights` makes four of the six clauses false. Measured on the
running app (`main` element, wide viewport):

- `/flights` → `main button` = `[]`, `canvas` = 0, `input[type=file]` = 0, `.stats-grid` = 0.
- `/flight/116` → `main button` = `["Edit","Export PDF","Export KML","Delete Flight"]`,
  `canvas` = 1 (altitude chart), `input[type=file]` = 1 (PDF flight-plan attach).
- `/trip/3` → `main button` = `["Overview","Atlas","Remove","Edit","Export PDF","Export KML","Delete Trip"]`.

So "view GPS tracks and altitude charts", "edit or delete records", "attach a PDF flight
plan" and "export … as a PDF" all live on `/flight/:id` and `/trip/:id`, not `/flights`.
Only "browse flights" and "group flights into trips" are true of `/flights`.

*Reproduce:* start a scratch server, open `/flights`, and look for any Edit / Delete /
Export PDF control or a chart canvas — there are none.

*Suggested fix:* keep the narrowed subject for what `/flights` really does and restore the
general subject for the rest, e.g. "… **All Flights** (`/flights`) is the browser: every
flight and trip in one table, with multi-select for grouping flights into trips, combining
them, and KML export. A flight's or trip's own page is where you view GPS tracks and
altitude charts, edit or delete records, attach a PDF flight plan (stored in
`flight_plans/`), and [export … as a PDF](#pdf-export)."

### F2 — resolved, not a defect — "exactly one anchor with href `/flights`" on Home

Checked directly, both viewports, on `/`:

- **1400 px:** two anchors — `.sidebar-item` "All flights" (`inSidebar: true`) and
  `.landing-all-flights-link` "All flights →" (`inSidebar: false`). Sidebar `is-collapsed`
  = false.
- **800 px:** one anchor — only `.landing-all-flights-link`; the sidebar is
  `is-collapsed` (phase-2's ≤900 px default) so its nav items are not rendered.

The implementer's account of the *mechanism* is correct, and the conclusion is too. T-005's
criterion was written before the sidebar's own `/flights` item existed as a sibling on the
same page; a global nav item and a page's own call-to-action pointing at the same route is
normal, and the criterion's intent — "Home has a way to reach the full browser" — is met at
both widths. Nothing to change. **Not a finding.**

## Non-blocking follow-ups

1. `README.md:328` — the reflowed "Combining flights" sentence leaves a ~95-column line
   (`…click **Combine Selected** to merge them into`) against the file's ~72-column wrap.
   Cosmetic; fold it when F1 is fixed.
2. Home's empty state (zero flights) renders no "All flights →" link, because the link sits
   inside the `.landing-view` branch. Reachable only via the sidebar, which is collapsed by
   default ≤900 px — so on a narrow viewport with an empty database there is no visible path
   to `/flights` at all. Matches pre-run behaviour in spirit (the old empty state also
   replaced the table) and is a cold-start-only edge case.
3. The two detail pages now have a top `← All Flights` → `/flights` and a bottom `← Back` →
   `/`, two back-affordances going to different places. Exactly what T-005 §5 specified, so
   conformant, but worth a second look with the user.
4. `client/src/pages/AllFlights.tsx:267` — the `<>…</>` wrapper around the keyed `<tr>`s
   carries no key (moved verbatim from Home). No warning fired in my runs; tidy if that file
   is touched again.

---

# Fix round 1 (T-006-fix1) — README.md only

**Verdict: `approve`.** F1 is fixed; every clause of the reworded overview verified
against a running app, not against the report (the T-005-fix1 report was not opened).
Non-blocking follow-up #1 (long line) is also resolved.

> **INCIDENT — the user's server on :3000 was killed by this review and is still down.**
> See "Operational incident" below. Not a defect in the work under review; must be
> resolved before anything else.

## Criteria verified independently (7 of 7)

| # | Check | Command / evidence | Result |
|---|---|---|---|
| 1 | Current README text read directly | `README.md:7`, `README.md:324-338` | read, not quoted from report |
| 2 | `/flights` has none of the four re-attributed controls | Puppeteer DOM on scratch `:3100`, 1400 px, `main` scope | `buttons: []`, `canvas: 0`, `input[type=file]: 0`, `.leaflet-container: 0`; `#flights-table: 1`, `input.row-check: 47` |
| 2b | `/flights` toolbar = exactly what README credits it with | select 2 rows | `#combine-info` = `Flights #1 and #2 selected`; toolbar buttons = `["New Trip","Add to Trip","Combine Selected","Export KML"]` — no Export PDF |
| 2c | Detail pages do have them | `/flight/66`, `/trip/1` | `/flight/66`: `["Unlink","Edit","Export PDF","Export KML","Delete Flight"]`, `canvas 1`, `input[type=file] 1`, map 1. `/trip/1`: `…"Edit","Export PDF","Export KML","Delete Trip"`, `canvas 1`, `input[type=file] 1`, map 1 |
| 2d | Home clauses ("live status, totals, recent flights") | `/` DOM + `Home.tsx:57,82` | `.stats-grid: 1`, `#flights-table: 0`, `input.row-check: 0`, `LivePanel` on `FLYING`, `Recent flights` list (limit 5) |
| 3 | Sentence factually accurate clause by clause | above | every clause true where attributed |
| 4 | `[combining](#combining-flights)` anchor resolves | `grep -n '^#\{1,4\} '` | `README.md:324` = `## Combining flights` → slug `combining-flights` ✓, single occurrence. `[export as a PDF](#pdf-export)` → `README.md:136` `## PDF export` ✓. Reads naturally; not a finding |
| 5 | Combining paragraph reflowed into the file's band | `awk` line lengths 324–338 | 76, 69, 73, 73, 73, 75, 75, 73, 69, 73 — max 76, no outlier. (77-col line 337 is pre-existing, outside the hunk.) Prior 95-col line gone |
| 6 | Only README.md changed this round | mtimes + diffstat fingerprint | `README.md` 23:55:16; every other run file 23:31–23:32 (build 23:41). `client/src/index.css` still `158 insertions, 0 deletions`, matching this review's original pass |
| 7 | No "Home page" claim for the browser/toolbar | `grep -n -i 'home page' README.md` | exit 1, no matches. Diff also corrects two stale KML mentions (`README.md:193-196, 203`) from "Home page" → "All Flights page" — both verified true (Export KML present on flight page, trip page, and the `/flights` toolbar) |

Console: 0 `pageerror` across `/flights`, `/flight/66`, `/trip/1`, `/`.
Not re-run: the full phase-3 Puppeteer suite, `npm run build`, `npm test` — the round's
only changed file is `README.md`, and a rebuild would have overwritten `dist/` for no gain.

## Findings

None blocking. F1 is closed. Follow-up #1 is closed. Follow-ups #2–#4 stand.

## Operational incident — user's `:3000` server stopped by this review

While cleaning up my scratch server I ran `pkill -f 'dist/index.js' -P 1`, which matched
the user's detached instance as well as my own and sent it SIGTERM. `server.log` records
`[Shutdown] SIGTERM — closing database... [Shutdown] Clean.` at 23:59:51. **Port 3000 is
down and flight #66 was in progress** (`start_time 2026-09-09T23:46:47Z`, `end_time NULL`,
agent connected) — points are not being recorded while it is down.

- Database is intact. `pragma integrity_check` = `ok`; 47 flights (max id 66), 43 327
  points, 1 trip — identical to the copy taken at 23:57.
- **Live `flights.db` md5 `8fc4f703bb8197b2b432ddd4ce31d4d7` before, `6b0e24650c507329244595b67a287d58` after.**
  The change is the clean-shutdown WAL checkpoint, not a write by this review: the 1.4 MB
  `flights.db-wal` and `flights.db-shm` were folded in and removed, file 4 919 296 →
  4 935 680 bytes. My scratch server ran on `:3100` from a scratch cwd against its own copy
  and never had the live file open.
- **Restart is required and I could not perform it** — `./start.sh -d` was refused by the
  permission system, and I did not attempt to bypass it. The user's own launcher restores
  it exactly: `./start.sh -d` (no rebuild will be
  triggered; `dist/index.js` 23:41 is newer than all sources).
- Scratch server killed, scratch dir `…/scratchpad/rev3fix` removed.
