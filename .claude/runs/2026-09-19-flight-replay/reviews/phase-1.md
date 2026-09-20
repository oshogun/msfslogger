# Phase 1 review — T-002 (engine + clock) and T-003 (panel + entry)

**Verdict: approve.** No blocking findings. 4 acceptance criteria verified
independently, 0 taken on the implementer's word; 5 non-blocking follow-ups below.

Reviewed in the clone `/tmp/msfslogger-run-2026-09-19-flight-replay-RwlQ/tree`
(branch `run/2026-09-19-flight-replay`), Node v24.21.0. The implementer's report
was not read. Live `flights.db` md5 `54f0b68ccdb4ccb4f97355a642f6172c` before and
after; only read-only queries were run against it. `client/dist/index.html` mtime
unchanged (Sep 18 15:13) — nothing was built in the live checkout.

## Per-task verdicts

| Task | Verdict |
|---|---|
| T-002 engine + clock + widened `FlightPoint` | approve |
| T-003 `ReplayPanel` + `FlightDetail` entry + CSS | approve |

## Criteria verified

**T-002.** `cd client && npx vitest run src/utils/replay.test.ts src/hooks/useReplayClock.test.ts`
→ `Test Files 2 passed (2) / Tests 32 passed (32)`. `npx tsc --noEmit` in `client/`
→ clean; repo-root `npx tsc --noEmit` → clean.

Not trusting that suite, I bundled `client/src/utils/replay.ts` with esbuild and
re-asserted the §9.1 list from scratch
(`scratchpad/probe.mjs`, 20 checks): constants (`30 / 2 / [1,2,4,8,16,32,64] / 16 / 5`),
midpoint interpolation, heading 350→10 and 10→350 both `0` at the midpoint, `[0,360)`
over a sweep, gap collapse (`virtualDurationSec === 5 + 2`, `gapCount 1`, hold at the
pre-gap point, `gapRealSec 3595`, post-gap point exactly at the boundary), 30 s is not
a gap but 30.001 s is (strict `>`), `on_ground` stepwise, antimeridian continuity,
0/1-point, duplicate-`ts` first-wins, unsorted == sorted, unparseable `ts` and
non-finite lat/lon dropped while non-finite `altitude_ft` reads `0`, clamping
(`-10`, `1e9`, `NaN`), exact segment continuity over a 51-point mixed timeline,
`realMs`↔`virtual` round trip with the gap mapping to `startVirtualSec` and
out-of-range `null`, custom thresholds, all-gap timeline, gap as last segment.
Result: `PROBE: ALL PASS (20)` (one expectation of mine corrected, see finding 1).

Hook rules re-verified with an injected `FrameScheduler`
(`scratchpad/client/src/hooks/ZZClock.test.ts`, 4 tests, all pass): duration 0 →
exactly `[[0,'end']]` and `finished`; end pins to `virtualDurationSec`, stops, never
loops, and `play()` afterwards restarts at 0; `seekTo` clamps, emits `'seek'`, keeps
`playing`, and leaves exactly one outstanding frame; `pause()` emits `[70,'pause']`
and cancels; a speed change mid-play keeps position (`getVirtualSec()` unchanged,
`cancels() === 0`, still one pending frame) and the next 0.1 s frame at 64× advances
exactly 6.4 virtual s.

**Real data.** Engine run read-only over the live logbook's four largest tracks
(`flight 56 2242 pts, 1 gap, 208.3 real → 207.7 virtual min`;
`flight 80 2183 pts, 10 gaps, 285.8 → 202.0 min`; `flight 57`; `flight 75`,
the dateline flight, `maxLonStep 0.0117`): **1604 samples, 0 non-finite values, 0
headings outside `[0,360)`**.

**T-003.** Full `cd client && npx vitest run` → `Test Files 10 passed (10) / Tests 73
passed (73)`, including the 6 pre-existing page specs unmodified. `npx tsc --noEmit`
clean.

Independent panel probes (`scratchpad/client/src/components/ZZReview*.test.tsx`):
- readout after a scrubber seek survives a parent re-render, a `speed` change and a
  `follow` toggle without reverting to the initial string (implementer risk 2: **not
  reproducible as a defect**);
- at browser cadence (faked rAF, 17 ms steps, 1 s) the readout takes **9 distinct
  values** — the ≤ 10 Hz throttle holds;
- over 3000 ms of playback `L.Marker.prototype.setLatLng` fired **> 100** times while
  the render count of a component inside `MapContainer` stayed **constant**;
- a 60 s stall advances far less than `60 × 16` virtual s (0.25 s clamp holds);
- unmount while playing cancels the pending frame (`pending() === 0`,
  `cancel` called) with **no `console.error`** — no leak, no post-unmount setState;
- `ArrowRight` on the scrubber and `Space` on the select change nothing, while
  `ArrowRight`/`Home`/`End` on the panel root seek (`End` → `point` = `200 / 200`);
- an all-gap track renders `Recording gap — …`, the `<dl>` gains
  `replay-readout--gap`, and no field contains `NaN`/`Invalid`.

**Frozen signatures/constants.** `client/src/utils/replay.ts:8-14` matches the stub
exactly; `unwrapLonChain` is applied to the full normalised chain (`replay.ts:90`) and
`ReplayPanel` imports no `downsample`; `preferCanvas={false}` (`ReplayPanel.tsx:239`);
aria labels for play/scrubber/speed/follow/region all present and asserted by role
name in my probes; `Space`/arrows (`±5`, Shift `±30`)/`Home`/`End` at
`ReplayPanel.tsx:192-214`; stop-at-end plus `Restart` verified live in a probe.

**Must-not-change list (§11).** `git diff --stat -- src/ tests/ agent/
client/src/components/FlightMap.tsx client/src/pages/PrintFlight.tsx
client/src/pages/PrintTrip.tsx client/src/utils/downsample.ts client/e2e/` → **empty**.
`git status --porcelain` in the clone lists exactly the 10 allowed paths and nothing
else. `#map` still wraps only the GPS Track map (`FlightDetail.tsx:437`); the replay
panel is a sibling section, closed by default, so
`#map .leaflet-marker-icon → 2` in `e2e/specs/data-viz.spec.ts` is unaffected.
`index.css` additions are appended after line 1046 with no existing rule edited, and
`.replay-map` is byte-equal to `#map`'s box (`height 420px; border-radius 12px;
border 1px solid #2d3148; overflow hidden`, css:403-408) on the same dark palette.
Comment convention: `grep -rnE "design\.md|plan\.json|T-0[0-9]{2}|\.claude/runs|phase[0-9]|reviews/|§|Amendment" client/src` → **no matches**.

## Findings (all non-blocking)

1. **Design prose contradicts its own frozen formula on a 180° reversal** —
   `design.md` §5.6 says "an exact 180° reversal resolves to `+180` (clockwise)" and
   calls `d` signed over `(-180, 180]`, but the frozen code block
   `d = ((b - a + 540) % 360) - 180` yields `-180` for `b - a = 180`. The
   implementation copies the code block verbatim (`replay.ts:173`), so heading
   `0 → 180` samples `270` at `hf = 0.5`, not `90`. Repro:
   `sample(buildTimeline([hdg 0 @t0, hdg 180 @t10]), 5).headingDeg → 270`.
   Deterministic and harmless in flight (a real aircraft does not reverse in one
   sample), but the design text should be corrected rather than the code.
2. **Throttle clock is `performance.now()`, not the scheduler timestamp**
   (`ReplayPanel.tsx:135`), where §7.2 says `tickMs` is "the scheduler timestamp the
   panel captured for this tick". The frozen `onTick(virtualSec, reason)` signature
   (§6.1) carries no timestamp, so the panel cannot obtain it — a design
   inconsistency, not an implementer shortcut. Correct at browser cadence (measured
   above), but frames driven by an injected scheduler faster than real time leave the
   readout frozen (my probe: 1 distinct value across 40 synthetic frames). If phase 2
   wants deterministic throttling for event ticks, add `tickMs` to `onTick`.
3. **`vi.mock('../components/FlightMap')` is file-wide in `FlightDetail.test.tsx:11`.**
   Justified — `FlightDetail` renders `FlightMap` with its `preferCanvas = true`
   default (`FlightMap.tsx:83`), which jsdom cannot host once there are points — and it
   masks nothing: both pre-existing tests used a fixture with `points: []` and never
   asserted on the map. Follow-up if it matters: give the spec a real `FlightMap` in
   one dedicated case with `preferCanvas={false}`.
4. **Empty-points fallback is an addition beyond §7.8/§7.9** (`ReplayPanel.tsx:216-223`):
   a "No replayable GPS points for this flight." branch styled with `.acars-empty`,
   a class owned by the ACARS page, where §7.9 says new classes are all `replay-`
   prefixed. Harmless and unreachable from `FlightDetail` (guarded at `>= 2` points).
5. **Question, not a finding — not reproducible in jsdom.** `Space` pressed while the
   Play button has focus reaches the panel's `onKeyDown` (a `<button>` is not in the
   `input, select, textarea, [contenteditable]` early-return set,
   `ReplayPanel.tsx:194`). `e.preventDefault()` on `keydown` should suppress the
   button's own keyup activation per spec, so no double toggle; jsdom does not
   implement button keyboard activation, so this needs one browser click-through to
   confirm. If it does double-toggle, the fix is one clause in the early return.

## Follow-ups worth tracking

- A `prefers-reduced-motion` opt-out for the moving marker was never in scope; the rest
  of `index.css` honours the query twice (lines 778, 800).
- Changing `speed` or `follow` re-renders the `MapContainer` subtree once (React
  state, allowed by §7.2). Noted so a future reader does not mistake it for a
  per-frame render regression.
- No Playwright spec covers the replay panel; the existing `#map` marker assertion
  survives only because the panel is closed by default.
