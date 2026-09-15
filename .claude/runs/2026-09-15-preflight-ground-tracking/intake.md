# Intake — preflight-ground-tracking

## Goal (restated)

ACARS pre-flight actions (dispatch release, loadsheet request) are only
reachable in practice once a flight is airborne, because `flightManager.ts`'s
state machine is `IDLE` → `FLYING` only — there is no tracked state for
"loaded in / parked at a gate or ramp." Build ground-state detection so a
pre-flight session exists from the moment the aircraft is on the ground,
stationary, with engines off (cold-and-dark or freshly spawned at a gate),
giving the ACARS flow an airport + parking-position context before pushback,
not just after rotation. Manual airport/ramp entry is a fallback for when
detection can't resolve a position (remote stand, misdetection, deicing pad),
not the primary path.

## User's original framing (verbatim)

> Real gap: ACARS features such as getting the loadsheet are useless right
> now because flights are not being tracked before the plane is in the air.
> Two possible solutions: improve detection so msfslogger starts tracking the
> plane from the time the simulator loads, or allow the user to manually send
> information on the airport and ramp/gate they're currently at so they can
> get access to the system

## Direction the user approved

The Orchestrator investigated current behavior (see Findings below) and
proposed: automatic ground-state detection as the primary mechanism, manual
entry as a fallback, not an equal alternative — reasoning being that manual
entry adds friction exactly when the user is busy with cockpit prep, and
creates a second source of truth that can drift from what the sim reports.
The user replied "yes scope this as a run" directly after that proposal —
treated here as approval of this direction, not a separately-worded freeze.
If the Planner or Designer finds the automatic path materially harder than
expected, surface it rather than silently defaulting to manual-first.

## Findings from investigation (Explore agent, this session)

- `src/flightManager.ts`: state machine is `IDLE` → `FLYING` only. From
  `IDLE`, a flight starts only after 3 consecutive frames of
  `!frame.onGround && airspeedKnots > 30` (`AIRBORNE_DEBOUNCE_FRAMES`), not in
  slew. Landing requires `onGround && groundSpeedKnots < 5` for 10 frames.
  No ground-speed/engine/parking-brake signal is used, and no "parked at
  gate" state exists today.
- ACARS is **not** actually gated on a live flight record: `acars.ts`,
  `routes/acars.ts`, `routes/plannedLegs.ts`, `db/acarsMessages.ts` key
  dispatch release and loadsheet request off `planned_leg_id` alone. Schema
  comment: "a dispatch release arrives before pushback, when no flights row
  has been created yet." Loadsheet request is gated on dispatch data existing
  (409 `NO_DISPATCH_DATA`), not on flight state.
  - **Implication:** the backend contract for ACARS already tolerates
    pre-flight access. The user-visible gap is most likely the UI only
    surfacing ACARS actions once a flight is active/selected, and/or there
    being no recorded position (airport/ramp) to show or act on before
    `FLYING` exists. The Planner should confirm this against the client
    (`client/`) before assuming a UI-only fix is sufficient — the ground
    telemetry gap in `flightManager.ts` is real regardless and is still
    the point of this run (recording *where* and *when* the aircraft was
    parked, not just unblocking an already-open API).
- `agent/agent.js` polls at 1 Hz: lat/lon, altitude, IAS, ground velocity,
  heading, vertical speed, `SIM ON GROUND`, `IS SLEW ACTIVE`, aircraft title,
  plus pause/crash/FlightLoaded events. It does **not** request
  `PARKING BRAKE POSITION`, `GENERAL ENG COMBUSTION:n`, or any
  parking-spot/gate SimVar — cheap additions to the existing data definition.

## Success criteria

1. `flightManager.ts` gains a ground/pre-flight state (name TBD by Design)
   distinct from `IDLE`, entered when telemetry shows on-ground, ~zero
   groundspeed, engines off (or parking brake set) for a debounce window —
   mirroring the existing debounce pattern for airborne/landed.
2. The agent sends the additional SimVars needed for that detection; the
   server/agent data-definition contract change is frozen by Design before
   any code lands (this is the "new shared contract" that requires Design).
3. Entering ground state creates or attaches to a record carrying airport +
   timestamp (parking/ramp position if resolvable from position + airport
   data; `src/airports.ts` already does ICAO/geo lookups) so ACARS dispatch
   and loadsheet have real context to act on before pushback.
4. Manual airport/ramp entry exists as an explicit fallback path (API +
   minimal UI) for when detection doesn't fire or is wrong — not the
   default flow.
5. Client surfaces ACARS actions during ground state (not just once
   `FLYING`), if investigation confirms that's where the practical gap is.
6. `npm test` (Vitest) covers the new state-machine transitions the same way
   existing `flightManager` transitions are covered; `npm run test:types`
   and `npx tsc` clean.
7. No changes verified against the live server or `flights.db` — scratch
   port + scratch DB copy per `.claude/ENVIRONMENT.md`.

## Steps taken / skipped

- **Design: not skipped.** This run introduces a new flightManager state (a
  contract other code will depend on), a new agent→server telemetry field
  set, and likely a new/changed API surface for manual entry — all fit the
  "introduces a contract" bar in `.claude/agents.md` §Cost discipline rule 3.
- **DevOps: expected skip**, pending Plan — no build/packaging/deploy surface
  anticipated for this change (server + agent + client code only). Revisit
  if Plan says otherwise.

## Amendments

- **2026-09-15, plan.json T-006, acceptance criterion 1.** The Planner's
  original wording required `isValidFrame()` to reject a frame with 400 if it
  is missing any new ground-telemetry field. Design (T-001, design.md §2.4,
  §2.6) deliberately froze the opposite: the three new `SimFrame` fields
  (`parkingBrake`, `engineCount`, `enginesRunning`) are optional and their
  absence is accepted — only a wrong-typed value is a 400. Reason: the agent
  (`agent/agent.js`) runs on a separate Windows box the operator upgrades by
  hand ([[agent_deploy_gotcha]] in memory) — a strict reject-on-missing rule
  would mean every frame 400s, and no flight is logged at all, from the
  moment this server change ships until the operator separately upgrades and
  restarts the agent. That window is real and unbounded. The Orchestrator
  sided with the Designer and amended T-006's criterion in `plan.json` in
  place to match design §2.4 rather than have the Reviewer adjudicate a
  plan/design conflict after the fact.

## Incident, 2026-09-15

Both Phase 1 implementer agents (T-002 backend_sr, T-003 frontend_sr) were
dispatched in parallel and both terminated early on a session rate limit
(HTTP 429, resets 4:50pm UTC) — infrastructure, not a task defect; both need
re-dispatch once the limit clears.

Separately, and more seriously: T-003's last message before terminating
reported it had run `FLIGHTS_DB_PATH=/scratch/... printf '%s\n' "$pw" | node
dist/setPassword.js` while setting up a scratch-server click-through, meaning
to redirect `setPassword.js` at a scratch DB copy for auth testing. The env
var prefix does not scope across a pipe (it only applies to `printf`, not to
`node`), so the command ran against the live `flights.db` default path and
overwrote the real operator's login password. The user confirmed they were
locked out, confirming the overwrite happened. The user was given a safe,
interactive `node dist/setPassword.js` command to reset their own password
directly (password never passed as an argument or through this
conversation). Root cause is now documented in `.claude/ENVIRONMENT.md` and
in project memory (`feedback_env_var_pipe_scoping`) so future envelopes carry
the warning.

Neither T-002 nor T-003 has any diff yet worth reviewing — src/db/groundSessions.ts
exists on disk from T-002's partial run and needs inspection before re-dispatch
to see whether it's a usable partial or should be discarded and redone.

## Phase 1 review, 2026-09-15

T-004 (reviewer) approved Phase 1 — all 12 acceptance criteria across T-002
and T-003 independently re-verified, zero blocking findings, live `flights.db`
confirmed untouched. Two non-blocking findings handled before Phase 2:

- Run-doc section citations (`§6.4`, `§6.5`, `§7.3`) left in code comments in
  `client/src/pages/Home.tsx` and `src/db/groundSessions.ts` — the exact
  anti-pattern `2026-09-15-strip-run-citations`-adjacent work exists to avoid.
  Fixed directly by the Orchestrator: reworded each comment to state the rule
  itself rather than point at a document `src/`/`client/src/` readers can't
  open. Verified `npx tsc --noEmit` (server) and `cd client && npx tsc
  --noEmit` clean afterward, and `grep -rn "§6\.\|§7\.\|design §" client/src
  src` empty.
- A real but not-yet-reachable data-loss path: `Home.tsx`'s manual form always
  sends `parking_position` (null when blank), so once Phase 2 creates auto
  sessions, a refinement submit with an untouched, blank Ramp/gate box would
  silently clear an already-detected stand. Not blocking Phase 1 (no auto
  session can exist yet), but folded into **T-007's acceptance criteria** as
  an amendment (see `plan.json`) rather than reopening the approved phase,
  since T-007 touches the same file for the same reason (surfacing
  auto-detection precedence in the client).

Also fixed directly by the Orchestrator, ahead of review (tier-1, one-line):
`tests/db/schema.test.ts`'s exact-table-name assertion needed `'ground_sessions'`
inserted alphabetically — outside T-002's `allowed_paths`, flagged in its
report, verified passing before T-004 was dispatched.

## Phase 2 review, 2026-09-15

T-008 (reviewer) round 1: **request_changes** — two blocking findings, both
rooted in the same gap: design §5.5's `flightManager.refreshGroundSession()`
was never implemented, so (B1) `/api/status` kept serving a stale cache after
any REST write to a ground session, and (B2) the auto-only-close guard in
`closeAutoGroundSessionAndReturnToIdle()` read that same stale cache's
`source` instead of the live open row's, so a disconnect/crash after a §7.3
correction could close an operator's **manual** session — a direct violation
of design §7.4. Routed back to T-006's agent (resumed via SendMessage, not a
fresh dispatch, since it already had full context) with `src/routes/groundSessions.ts`
added to its allowed_paths for this round. Fixed: `refreshGroundSession()`
added and wired into every write in `routes/groundSessions.ts`; the close
gate now reads `getOpenGroundSession()` live; `DELETE /api/ground-sessions/current`
added as a low-cost bonus (design §5.4) so the operator has a supported way
to close a manual session, now that B2 no longer does it for them by accident.

T-008 round 2: **approve** — both fixes independently re-verified against the
reviewer's own original reproductions (continuous frame-posting used
throughout, to avoid a disconnect-watchdog false-positive the reviewer hit in
round 1), plus a real browser click-through of T-007's panel (using the
scratch-build recipe now documented in `.claude/ENVIRONMENT.md`, since
rebuilding `client/dist` in place would have touched what the user's live
server serves). 694/694 tests, `tests/flightManager.state.test.ts` byte-
identical to `HEAD` throughout both phases.

## Follow-ups, not fixed in this run (recorded, not forgotten)

- `PATCH /api/ground-sessions/current` (design §5.4, stand-only update on an
  already-open session) is unimplemented; unmatched requests currently get
  Express's bare HTML 404 rather than the JSON error shape every other route
  in this run uses. No task's acceptance criteria required it.
- Design.md has two internal inconsistencies the Reviewer found (code follows
  the correct/normative reading in both cases, so nothing to fix in
  `src/`/`tests/`, only in the frozen doc): §1.5's per-row exit table omits
  the `source = 'auto'` qualifier on the slew/`simRunning === 0` rows that
  §7.4's summary table says should carry it; and §4.6 scenario 8's prose
  ("entry slips by exactly one frame") contradicts §1.3's normative "resets
  the counter to 0, not decremented." A future run touching this design
  should amend both in place per the run's amendment convention.
- Two environment facts learned mid-run were promoted to `.claude/ENVIRONMENT.md`
  for every future agent: env-var prefixes don't scope across a shell pipe
  (the incident's root cause), and how to browser-test a client change
  without overwriting the live server's `client/dist`.

## Constraints

- Never touch the user's running server (port 3000) or live `flights.db` —
  scratch port + copied DB only.
- Node 20 via nvm for every node/npm/npx/server command.
- Agent changes must stay compatible with the existing 1 Hz polling loop and
  event model in `agent/agent.js`; this is a Windows-side SimConnect agent —
  changes there can't be exercised live from this Linux checkout, only
  reasoned about and unit-tested where possible.
