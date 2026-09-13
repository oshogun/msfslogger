# Review: JourneyMap.tsx antimeridian airport marker fix

**Verdict: approve**

## Scope / diff

`git diff --stat`: only `client/src/components/JourneyMap.tsx` changed (+28/-1).
`git status --porcelain`: no other files touched. `geo.ts`, `TripMap.tsx`,
`FlightMap.tsx`, and all server files are untouched, matching allowed_paths.

## Criteria verified independently

1. **Crossing airport lands at unwrapped endpoint, not raw lat/lon** — verified.
   Bundled the real `JourneyMap.tsx` via esbuild (stubbing only
   react/react-leaflet/leaflet, which `airportPositions` never touches) and
   called the actual exported `airportPositions` against a constructed
   PANC→UHPP fixture whose track crosses the dateline. Result:
   `UHPP unwrapped pos: [ 53.17, -201.3 ]` vs raw `158.7` — matches the chain's
   last point exactly (`chain[5] = [53.17, -201.3]`). Same order of magnitude
   as the implementer's report; I did not reuse their script, built my own
   from scratch and got the identical number.
2. **Non-crossing airports numerically unchanged** — verified. KJFK→KBOS
   fixture: `KJFK lat === raw: 40.64 === 40.64`, `KJFK lon === raw: -73.78 ===
   -73.78`, same for KBOS. Exact equality, no fixed epsilon needed.
3. **Repeated airport keeps first-chronological-visit position, one dot** —
   verified with a two-leg fixture where KJFK is both leg-1 departure and
   leg-2 arrival: `repeated KJFK keeps FIRST occurrence lat/lon` from leg-1's
   `chain[0]`, and `pos.size === 2` (one entry for KJFK, one for KBOS — no
   duplicate). Also checked an empty-chain leg is skipped without throwing
   (`chain.length === 0` guard) — zero entries contributed, no crash.
4. **Test infra** — confirmed no existing client test runner
   (`client/package.json` has only `dev`/`build`/`preview` scripts, no
   Vitest/Jest, no `*.test.*` under `client/src`). The implementer's choice
   not to bootstrap one and instead verify the *real* exported function via a
   standalone bundle is consistent with criterion 4's own wording ("only add
   tests if a working one already exists"). I independently reproduced this
   approach rather than trusting their numbers.
5. **Build/typecheck** — `cd client && npm run build` (Node 20 via nvm):
   `tsc && vite build` → `✓ 107 modules transformed`, `✓ built in 2.07s`. Clean.
6. **Live server/db untouched** — no server started, no `flights.db` write.
   `md5sum flights.db` before and after this review: both
   `6f7e9c8d5693c5e008aa18399d852cc4` (unchanged).

## Design conformance

- `airportPositions(ordered, trackChains)` walks `ordered` (the seq-sorted
  array), indexing `trackChains[i]` — confirmed these two arrays are produced
  by two separate calls to the same deterministic `sortedLegs(legs)` (stable
  sort on the same input), so index `i` refers to the same leg in both. No
  chain/leg misalignment.
- Empty-chain skip (`if (chain.length === 0) return;`), first-occurrence-wins
  via `!positions.has(icao)` guard before `.set()`, `chain[0]` for departure /
  `chain[chain.length - 1]` for arrival — all match the frozen algorithm
  verbatim.
- Iteration order (departure checked before arrival, within each leg in
  seq/chronological order) matches server's `note()` tie-break in
  `src/journey.ts` (`note(departure)` then `note(arrival)`, first `.set()`
  wins, later visits only bump `visits`) — read `src/journey.ts` to confirm
  this, not just the implementer's claim.
- CircleMarker `center` now reads
  `unwrappedAirportPositions.get(a.icao) ?? [a.lat, a.lon]` — correct fallback
  order (unwrapped first, raw only when ICAO absent from the map, which per
  the algorithm only happens if the airport never appears as a leg
  departure/arrival with a non-empty track, e.g. server data inconsistency).
  `radius`, `pathOptions`, `key`, and the visits-count `Tooltip` are
  byte-for-byte untouched — confirmed by diff, nothing else in that block
  moved.
- `JourneyAirport.lat`/`.lon` (server-side type and `src/journey.ts` `note()`)
  untouched — no server file appears in the diff.

## Comment/citation check

Scanned the diff's new comment block for `runs/`, run-id, `§`, "Amendment",
`plan.json`, `T-NNN`, phase/review filenames — none present. The comment
explains the antimeridian problem and server tie-break in its own terms,
consistent with the surrounding file's existing comment style (e.g. the
`sortedLegs` comment above it).

## Verification gap (item 7: is skipping browser/Leaflet rendering acceptable?)

Yes, acceptable as a non-blocking gap here, not a reason to withhold approval:

- `allowed_paths` is one file, and the change is a pure data transformation
  feeding an unmodified `CircleMarker`/Leaflet rendering path — the only new
  logic is `airportPositions`, which the esbuild-bundled test exercises
  directly against the *real* shipped code, not a reimplementation.
- No live server/db may be used for anything beyond read-only `curl`, and
  the implementer correctly notes no genuine UHPP-crossing trip exists in
  real data — fabricating one in a scratch copy and standing up a scratch
  dev server just to eyeball a Leaflet tile would add real effort for a
  visual confirmation of arithmetic already checked exactly against the same
  `unwrapLonChains` function the polylines use.
- A reasonable follow-up (non-blocking): if/when a real antimeridian-crossing
  flight lands in the logbook, do a one-time visual sanity check on a scratch
  server/scratch db copy that the dot and its polyline now coincide.

## Findings

None blocking. No non-blocking findings beyond the follow-up noted above.

## Cleanup

Scratch esbuild bundle/test script removed from
`/tmp/claude-1000/.../scratchpad/reviewcheck` after use. No repo files or
live db touched by this review.
