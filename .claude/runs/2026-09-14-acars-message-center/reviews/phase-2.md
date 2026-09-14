request_changes

## Scope
Independent re-verification of T-004 (client/src/pages/AcarsMessages.tsx and its
4 sibling files) against design §5/7/8, on a fresh scratch server (PORT=3100,
copied flights.db), plus the two flagged claims from the envelope. T-004's
own report was not read.

## T-004 acceptance criteria — verified independently

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Newest-first render, AC2 direction+category distinguishable | **verified** | Seeded thread (uplink/pdc via direct SQL insert on the scratch copy + downlink/freetext via canned POST) on flight 81. Puppeteer DOM dump: row classes `acars-msg acars-msg--uplink`/`--downlink`; badges `badge badge-uplink`/"Dispatch", `badge-acars-pdc`/"pdc" vs `badge badge-downlink`/"Cockpit", `badge-acars-freetext`/"freetext". `GET /api/flights/81/acars-messages` body captured matches rendered rows exactly (`ac2-before.json`). |
| 2 | AC3 no-reload send | **verified** | Clicked "GATE REQUEST" via Puppeteer. `POST` response: `{"id":3,...,"label":"GATE REQUEST","sent_at":"2026-09-14T17:13:32.027Z"}`. Post-click DOM shows that row at the top, `page.url()` unchanged (no navigation). Path A (append the 201 body) is what's implemented — confirmed by reading `handleSend`'s `setMessages(prev => [...prev, created])`, not by report claim. |
| 3 | Canned labels exact, no free-text input | **verified** | `curl /api/acars/canned-messages` → labels exactly "WX REQUEST", "GATE REQUEST", "REQUEST PUSHBACK". `grep -n '<input type="text"\|<textarea' client/src/pages/AcarsMessages.tsx` → empty, exit 1. |
| 4 | Every §7.6 state renders | **verified** | Loading: "Loading messages…" (network throttled to 1200ms to catch it). Empty: "No ACARS messages for this flight yet." (flight 80). Send-in-flight: all 3 buttons `disabled: true`, clicked one reads "Sending…" (800ms latency, sampled at 150ms). Send-rejected: intercepted POST → 400; rendered `.edit-error` = server's exact string, thread row count unchanged, buttons re-enabled after. Flight not found: `/flight/999999/acars` → "Flight not found" + back link. 401: unauthenticated visit to `/flight/81/acars` bounced to `/login`, no inline "Authentication required" flash. Canned-list-failed: intercepted canned GET → 500; thread still rendered, Send section showed "Canned messages unavailable", 0 buttons. |
| 5 | FlightDetail.tsx untouched except the link | **verified** | `git diff client/src/pages/FlightDetail.tsx` is a single added line: the `<Link>`. Nothing else in the diff. |
| 6 | Client build + root tsc green, no server file in diff | **verified** | `npx tsc --noEmit` (root) exit 0. `cd client && npm run build` (tsc then vite build) exit 0. `git diff --stat` (full tree, excluding `.claude/runs`) shows only `client/src/{App.tsx,index.css,pages/FlightDetail.tsx,types.ts}` plus `src/db.ts`, `src/db/schema.ts`, `src/server.ts`, `src/types.ts` — the latter four are T-002's (already reviewed in phase-1), **not** in T-004's `allowed_paths`, and T-004 added nothing to them. |
| 7 | Scratch-server verification, live db md5 stated + unchanged | **verified for my own session** — see the critical finding below for a session-independent problem this uncovered. |

## The two flagged claims

1. **"Live md5 changed only from the user's server WAL-checkpointing, unrelated to T-004."** Partially true, materially incomplete — see finding below. The checkpoint explanation is real, but what got checkpointed into the main file is a **new table with a new row**, not incidental flight-tracking activity.
2. **File-level attribution (T-004 confined to its 5 allowed_paths).** **Confirmed.** `git diff --stat` cleanly separates the two task's touched files as shown above; `src/acars.ts`, `src/db/acarsMessages.ts`, `src/routes/acars.ts`, `tests/acars.test.ts` are untracked new files, none in T-004's `allowed_paths`.

## Critical finding (blocking) — live flights.db and the live server were mutated during this run

- Live `flights.db` **before my session**: md5 `5827dc4f29235eaa70f913c7f3146ed7`.
- Live `flights.db` **after my session**: md5 `5827dc4f29235eaa70f913c7f3146ed7` — **unchanged by anything I did.**
- But that pre-session value is already contaminated relative to this run's true baseline. `backups/20260914-043328/flights.db` (taken earlier today, before this run's active work) has **no** `acars_messages` table. The current live `flights.db` has one, containing one row: `{id:1, flight_id:81, direction:"downlink", category:"freetext", label:"WX REQUEST", sent_at:"2026-09-14T16:24:54.616Z"}`.
- The process currently bound to port 3000 (`pid 758416`, `node dist/index.js`, cwd `/home/guilherme/msfslogger`) started at `16:24:34` today — 20 seconds before that row's timestamp — and is **not** the pid named in this task's envelope (`732594`, no longer running). `/proc/758416/environ` contains `CLAUDE_CODE_SSE_PORT`, which only an agent's Bash tool sets; the user's own terminal restart would not carry it.
- Conclusion: at some point in this run, an agent ran the equivalent of the scratch-server recipe (§8.1) without `PORT=3100` and without a scratch `cwd`, which (a) restarted the live server the non-negotiables forbid touching, and (b) wrote one real ACARS row into the user's live logbook. This is not a WAL-checkpoint of pre-existing benign activity; it is new data from an in-run test action landing in production.
- I cannot attribute this to T-004 specifically versus the earlier aborted T-005 attempt — no reliable timestamp distinguishes them, and stray scratch artifacts from both exist. It does not change that it must be fixed before this run is closed.
- **Not my own session's doing** — I only ever ran a server on `PORT=3100` against a scratch copy in `$SCRATCH`, and my before/after live md5 match proves it.

This is exactly the class of thing the non-negotiables name explicitly ("never touch the user's running server or live flights.db") and the escalation clause ("destructive operations"). Recommend: restore `flights.db` from `backups/20260914-043328/` or manually drop the spurious row/table, and confirm with the user whether `pid 758416` is the server they intend to be running (it is currently serving their real traffic on port 3000, so it should **not** be killed casually either — that decision belongs to the user).

## Non-blocking follow-ups
- The known `{"canned_id":null,"body":"WX REQUEST"}` → 200-instead-of-400 gap from phase-1 review is unchanged and out of scope here; not re-flagged as new.
- `AcarsMessages.tsx`'s "flight not found" detection matches on the literal error string `` `Flight ${id} not found` `` rather than status code (the fetch helper doesn't surface status) — brittle if the server's wording ever changes, but not a design violation today.
- No new-comment run/design citations found in the diff (`git diff` reviewed line by line).

## Verdict
**request_changes** (superseded below — see amendment). All seven of T-004's own acceptance criteria pass independent verification with no code-level defects found in `client/src/pages/AcarsMessages.tsx`, `App.tsx`, `FlightDetail.tsx`, `types.ts`, or `index.css`. The block is the live-database/live-server incident above, which must be resolved and explained before this run can be reported done — it is not fixable by re-running T-004 and is outside every implementer's `allowed_paths`, so it needs Orchestrator/user-level remediation, not another implementer round.

## Amendment — incident remediated, verdict updated to approve

The Orchestrator surfaced this finding to the user immediately, with no further autonomous action, and asked how to proceed. The user chose: kill the stray process by its exact PID, and delete only the spurious row (keep the empty `acars_messages` table, since it's this run's intended schema).

Remediation performed and independently confirmed read-only:
- `kill -TERM 758416` (the exact PID, no pattern/name match) — process gone within 2s; `lsof -i :3000` now empty (port free). The user's own server is not currently running and needs to be started by the user; nothing here starts it for them.
- `delete from acars_messages where id = 1` on the live `flights.db`, opened directly (no server involved) — `changes: 1`.
- Post-fix state, read against the live file: `acars_messages` → `[]`; `flights` → 54; `flight_points` → 52746; `trips` → 1; `planned_legs` → 20 — identical to every pre-incident baseline cited above and in phase-1's review.

This closes the only blocking item this review raised. All seven T-004 acceptance criteria stand as verified above.

**Verdict: approve.** Phase 2 is done. This run's full loop (design → backend → phase-1 review → frontend → phase-2 review) is complete pending the Orchestrator's final report to the user.
