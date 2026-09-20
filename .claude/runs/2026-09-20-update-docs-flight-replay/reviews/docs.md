# Review: D-001 docs refresh (flight replay)

Verdict: approve

Checked directly against the source in the run tree (cf5c60b + uncommitted docs diff). Only docs/usage.md and docs/architecture.md are modified.

Verified:
- Speeds 1/2/4/8/16/32/64, default 16 (utils/replay.ts:13-14). GAP_THRESHOLD_SEC=30, COLLAPSED_GAP_SEC=2 (replay.ts:10,12). Frame clamp 0.25 s (useReplayClock.ts MAX_FRAME_DT_SEC). UI writes 100 ms = 10 Hz (ReplayPanel UI_INTERVAL_MS).
- Keyboard: Space, Arrow left/right 5 s (30 with Shift), Home/End. Ignored for input/select/textarea/contenteditable, which covers the scrubber (range input) and the speed select; the handler is on the panel section.
- Follow checkbox defaults to true. Play/Pause/Restart labels. State strings "Airborne" / "On ground" / "Recording gap — <real duration>". Readout fields TIME, ELAPSED, ALT, IAS, GS, HDG, VS, STATE, POINT.
- Button text "Replay flight" / "Hide replay"; shown when points.length >= 2, not gated on flight status. It sits after the GPS Track map section.
- No new API endpoint: ReplayPanel is fed flight.points from the single GET /api/flights/:id fetch. FlightDetail has only two useEffects (the flight fetch and the planned-leg fetch), with no polling, so the in-progress claim holds.
- unwrapLonChain is imported and used in replay.ts:90. Heading interpolates by shortest arc (replay.ts:173). SVG renderer via preferCanvas={false}. The marker is moved via setLatLng.
- FlightMap and the print routes are untouched by 6558286 (stat lists only replay files, FlightDetail, types, css). Replay is not in the PDF/KML export path.
- Anchor #replaying-a-flight matches the "Replaying a flight" heading. No run-id, task-id or design citations in the added text.

Findings: none blocking.

Non-blocking notes:
- usage.md says "Keys are ignored while a field ... has focus"; the code also ignores them when a textarea or contenteditable has focus. This is a harmless simplification.
- The Space key with focus on the Play button is preventDefault-ed and toggles once. Correct as documented.

Other pages possibly stale (not fixed):
- docs/development.md:16 lists client utils (api.ts, format.ts, geo.ts, downsample.ts) without replay.ts, and probably omits the hooks/ directory and the new test files. Already-known items: 4 e2e specs, `user_stories/` rename.
- docs/api.md:50 "Single flight" is still accurate. No other page contradicts replay.

next_suggested_role: none (Orchestrator may commit).
