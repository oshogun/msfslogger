# Review — phase 2, round 2 (F-1 fix only)

**Verdict: `approve`.** F-1 is resolved at all five sites, the prose survived the
edit, nothing outside the four named files moved, and the suite is still green.
This closes phase 2 (T-003 … T-007) and with it the run's implementation phase.

Scope of this pass, per the Orchestrator's envelope: confirm F-1 only. The round-1
approvals (auth independence, the 18-tool inventory, the seven adversarial
`aircraft` shapes, the § 6.5 extraction diff, live-server/db non-contamination) are
carried forward from `reviews/phase-2.md` and were not re-derived. Nothing was read
from any implementer report; the Orchestrator's own re-run was likewise not taken as
evidence — every line below is output I produced.

| Task | Round 1 | Round 2 |
|---|---|---|
| T-005 MCP server + read tools | request_changes (F-1 ×3) | approve |
| T-006 write tools + extraction | request_changes (F-1 ×1) | approve |
| T-007 integration tests | request_changes (F-1 ×1) | approve |

## 1. Citation grep — empty

    $ grep -nE 'design\.md|T-[0-9]{3}|§' -r src/mcp/ tests/mcp.test.ts
    GREP_EXIT=1          # no matches, no output

Widened to the whole shipped tree, including the patterns F-1 named but the
implementer's grep did not cover (`.claude/runs`, `phaseN.md`):

    $ grep -rnE 'design\.md|\.claude/runs|T-[0-9]{3}|§|phase[0-9]\.md' src/ tests/ client/src/

Ten hits, all `README § HTTPS` / `README § First run` in `src/config.ts`,
`src/index.ts`, `tests/config.test.ts` — pre-existing, pointing at a real in-tree
doc, explicitly excluded by F-1. `src/config.ts` mtime is `13:52`, an hour before
the fix round, so they were left alone rather than rewritten.

## 2. The five sites read naturally and kept their information

Each still carries the non-obvious fact it had before; none is a truncated sentence.

- **`src/mcp/server.ts:27`** — `/** Fresh McpServer per HTTP request: stateless, no
  session map to leak or evict. Registers every tool in MCP_TOOLS. */` — the *why*
  (statelessness, no session map) is the part that was worth having and it is intact.
- **`src/mcp/tools/read.ts:20`** — `// The 14 read tools. Every tool handler calls
  the underlying db/domain function directly, in process — no tool makes an HTTP
  request back into this server…` — count kept, in-process invariant kept.
- **`src/mcp/tools/read.ts:33–36`** — `/** Same grammar as src/routes/flights.ts's
  normalizeDateBound … Duplicated here rather than imported — the route does not
  export it, and this grammar is small enough to state twice. */` — the
  why-stated-twice rationale is kept, and the cross-reference now points at an
  in-tree file a reader can open.
- **`src/mcp/tools/write.ts:9`** — `// The 4 write tools. Every one of them is
  additive or reversible, and every one calls the exact function the corresponding
  route calls — no new backend logic lives here.` — count and the
  additive/reversible claim kept.
- **`tests/mcp.test.ts:72`** — `// A golden list of the 18 tools the server
  registers, deliberately not derived from src/mcp/server.ts's own MCP_TOOLS export,
  so this test actually proves the registered set matches expectations rather than
  only that the source agrees with itself.` — the whole point of the hardcoded list
  is stated more clearly than it was before.

The 18 names in `EXPECTED_TOOL_NAMES` (`tests/mcp.test.ts:76–81`) are character-for-
character the 18 I enumerated from a live `tools/list` in round 1 § Criteria 2.

## 3. Comment-only, four files only

`src/mcp/` and `tests/mcp.test.ts` are untracked (`git status --porcelain` → `?? src/mcp/`,
`?? tests/mcp.test.ts`), so there is no git baseline to diff against and no
round-1 `dist/mcp/` build to compare emitted JS with (`ls dist/mcp/` → *No such file
or directory*; `dist/` is from `00:30`). The evidence that stands in for a diff:

- **mtimes.** Only four files are newer than my round-1 review: `server.ts 15:00:43`,
  `read.ts 15:00:45`, `write.ts 15:00:47`, `tests/mcp.test.ts 15:00:48`. Everything
  else in the phase's blast radius predates it and is therefore byte-identical to
  what round 1 approved: `src/mcp/projections.ts 14:18`, `src/mcp/router.ts 14:17`,
  `src/simbriefImport.ts 14:30`, `src/routes/plannedLegs.ts 14:30`,
  `src/routes/flights.ts 13:53`, `src/config.ts 13:52`.
- **Line numbers did not shift.** All five findings still sit at exactly the line
  numbers F-1 recorded (27, 20, 36, 9, 72), so no line was inserted or removed above
  any of them.
- **Code anchors from round 1 still hold at their old positions** —
  `src/mcp/tools/write.ts:38` is still `const updated = updateFlight(flight_id, { notes });`,
  the object-literal rebuild that made criterion 4 pass, and it still follows an
  `inputSchema` with no `aircraft` key (`write.ts:32–35`).
- **Test count unchanged**: 1071 in round 1, 1071 now — no assertion added, removed
  or renamed in `tests/mcp.test.ts`.

## 4. Green

    $ node -v → v20.20.2
    $ npx tsc --noEmit            → TSC_EXIT=0, no output
    $ npm run test:types          → tsc -p tsconfig.test.json, no output
    $ npm test                    → Test Files 42 passed (42) / Tests 1071 passed (1071)

## 5. Nothing live was touched

No server started, no scratch copy needed — this pass was a read plus a hermetic
suite run. `md5sum flights.db` is `a884c05eeafdef30b525e1c2d10d6936` both before and
after `npm test`, unchanged across the pass. `dist/` and `client/dist/` were not
written (nothing here emits; `tsc --noEmit` only).

## Findings

None blocking. F-1 is closed.

## Non-blocking follow-ups

Carried forward unchanged from `reviews/phase-2.md` — none was addressed in this
round and none needed to be:

1. `FlightStatsFilter`/`AircraftStat`/`RouteStat`/`FlightStats`/`FlightSearchResult`
   live in `src/db/flights.ts`, not `src/types.ts` as § 9.2 / § 6.4 froze. Amend the
   design, do not move the code — `src/types.ts` was in no task's `allowed_paths`.
2. § 5.2's `baseUrl`/`paths` `tsconfig.json` addition was never made and is not
   needed; record the falsified assumption in the design's § 0.
3. T-006's verification made a real read-only SimBrief API call with the operator's
   saved pilot ID. Decide whether a fixture is wanted before the next run exercises
   `import_simbrief_leg`.
4. `GET /api/flights/search` echoes the untrimmed `q` in `result.query`
   (`src/routes/flights.ts:132`). Harmless; § 4.2 does not specify.

New, cosmetic: removing the parenthetical citations left three comment paragraphs
unfilled — `read.ts:20` and `write.ts:9` now wrap short mid-sentence. Worth a
re-flow whenever those files are next edited; not worth an edit of its own.
