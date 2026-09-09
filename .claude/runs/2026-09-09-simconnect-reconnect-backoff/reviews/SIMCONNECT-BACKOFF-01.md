# Review: SIMCONNECT-BACKOFF-01

**Verdict: approve**

## Scope
`git status --porcelain -- agent/` → only `agent/README.md` and `agent/agent.js`
modified. `agent/package.json`, `agent/package-lock.json`, `agent/traffic.js`
untouched (empty diff). All within `allowed_paths`.

## Criteria verified independently

1. **Backoff sequence 5/10/20/40/60/60/60...** — copied `nextReconnectDelayMs`
   verbatim into a scratch script and ran attempts 0..7:
   `5000,10000,20000,40000,60000,60000,60000,60000`. Matches. Formula:
   `Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS)`,
   called with the *pre-increment* `reconnectAttempt` (agent.js:169), so the
   first-ever call (attempt=0) is 5s, confirming no off-by-one. **PASS**.

2. **Reset on successful connect** — `reconnectAttempt = 0` at agent.js:188,
   placed immediately after `recvOpen` is received (post-`await open()`), before
   any further awaits. Traced: the only path back to `scheduleReconnect` is
   through a disconnect event on the now-live `handle`, which can only fire
   after this reset has already run. **PASS**.

3. **Guarded error handler, no double-schedule** — walked all plausible
   node-simconnect event orderings by hand:
   - `close` alone / `quit` alone: `handleDisconnect` → `scheduleReconnect`,
     guard false→true, one timer. OK.
   - `error` then `close` (or reverse): first call sets
     `reconnectScheduled=true` and schedules; second call sees it already
     true and returns at agent.js:167 before touching `reconnectAttempt` or
     scheduling — exactly one `tryConnect()` timer pending. OK.
   - `quit` and `close` both firing for the same drop: same guard applies,
     one timer; `sendEvent('disconnected')` does fire twice in this case
     (see Follow-ups — dispatcher already flagged this, not blocking).
   - Initial `open()` throws: only the `catch` block runs;
     `reconnectScheduled` was reset to `false` at function entry
     (agent.js:176) before the throw could occur, so the guard is in a known
     state and schedules cleanly.
   - Guard cannot get stuck `true`: it is only ever set `true` inside
     `scheduleReconnect` in the same call that unconditionally calls
     `setTimeout(tryConnect, delayMs)`, and `tryConnect` clears it
     (agent.js:176) the instant that timer fires — no code path sets it
     `true` without a corresponding scheduled clear. **PASS**.

4. **No new dependency** — `agent/package.json` diff is empty (confirmed
   above); only `setTimeout`/`Math.min`/`**` used, all builtin. **PASS**.

5. **No behavior change elsewhere** — `grep` for `TRAFFIC_ENABLED`,
   `TRAFFIC_RADIUS_M`/`trafficRadiusM`, `SERVER_URL`, `INGEST_TOKEN`,
   `resolveSimProtocol`, pause handling: all present, unmodified, and
   `agent/traffic.js` has zero diff. **PASS**.

6. **Log lines communicate delay + attempt** — `scheduleReconnect` logs
   `` `[Agent] ${reason} — retrying in ${delayMs / 1000}s (attempt ${reconnectAttempt})...` ``
   for all three call sites (close/quit, error, initial-connect-failure),
   consistent with the existing `[Agent] ...` style. **PASS**.

7. **README sentence accuracy** — read agent/README.md:35. New text: "...and
   retries the server if it's briefly unreachable — retries back off from 5s
   up to a 60s cap so a prolonged outage doesn't hammer SimConnect." The
   factual content (5s base, 60s cap, SimConnect reconnect) is correct.
   **Non-blocking wording issue**: the em-dash clause is appended right after
   "retries the server if it's briefly unreachable," which reads as if HTTP
   retries-to-the-msfslogger-server also back off — they don't; `postJson`
   (agent.js:117) swallows failures with no retry/backoff of its own, it just
   naturally gets called again on the next 1Hz tick. The backoff only applies
   to the SimConnect reconnect path. Content is accurate if read as
   describing the whole paragraph, but a reader skimming just the last clause
   could misattribute it. Recommend rewording, not blocking.

## Other checks

- `node --check agent/agent.js` (Node 20.20.2 via nvm) → passed, no output,
  `SYNTAX_OK`.
- `reconnectAttempt` is reset only at agent.js:188, inside the
  post-`recvOpen` success path — no other write site, so it cannot be reset
  by anything short of a genuine new connection. Confirmed by `grep -n
  reconnectAttempt agent/agent.js`.
- Style: new code (JSDoc-less inline comments, `[Agent] ...` log prefix,
  arrow-free named functions) matches the surrounding file.
- Live DB untouched (task doesn't touch it): `md5sum flights.db` before and
  after review = `7a6651ecfa30fab34ce52340b7f7f5cb` (unchanged). No server
  started, no scratch DB needed — pure static review + a standalone scratch
  script, no agent process run (no SimConnect on this box, as instructed).

## Findings

None blocking.

## Follow-ups (non-blocking)

- `sendEvent('disconnected')` can be posted twice for a single physical
  disconnect when SimConnect fires more than one of `quit`/`close`/`error`
  for it (each handler calls `sendEvent` before `scheduleReconnect`'s guard
  is checked). Cosmetic/log-volume only — the guard correctly prevents the
  reconnect timer itself from duplicating. Already known per the task
  description as a pre-flagged risk; worth a small dedup guard in a later
  pass if `/api/ingest/event` semantics ever make a duplicate `disconnected`
  costly.
- `agent/README.md:35` wording could be tightened so the backoff clause
  unambiguously modifies "reconnects automatically if MSFS restarts" rather
  than trailing the unrelated "retries the server" clause.
