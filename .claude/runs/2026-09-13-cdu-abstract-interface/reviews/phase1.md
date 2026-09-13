# Review — T-002: `design.md` for 2026-09-13-cdu-abstract-interface

**Verdict: approve**

Method: read `design.md` §1–§6 via `ctx.sh`, then opened every code file it cites
(`app.js`, `bridge.js`, `pages/index.js`, `index.html`, `render-check.mjs`,
`contract-check.mjs`) and checked citations by hand. Did not read T-001's own
report. Ran `contract-check.mjs` and `render-check.mjs` (scratch dir, scratch
port) against the unmodified checkout to confirm the claimed baseline
independently, not from the designer's account of it.

## Criterion 1 — every file:line citation opened and checked

Checked ~45 citations across bridge.js, app.js, pages/index.js, index.html,
render-check.mjs, contract-check.mjs. All resolve to the claimed content
**except**:

- **Finding 1 (non-blocking).** §5.2 item 1: "`refreshConfig` (**221**, 243)".
  `render-check.mjs:220` is `await window.FMC.refreshConfig();`; line 221 is the
  closing `});`. Off by one on the first occurrence; the second (243) is
  correct.

Every other citation I checked — `findHost()` 43–70, `createTauriBridge`
89–124, stub 128–236, `__FMC_STUB__` publish at 234, `host = findHost()` at
238, export at 240, `pageContext()` 120–128, `window.FMC` build 495–505,
`runCommand` 295–303, `toggleUplink` 305–308, STATUS `onLsk` R5/R6/L1–L6,
`paintStatus` 312–323 (dispatch block 315–322), the NETWORK-mask ternary at
app.js:59–61, `pages/index.js:3` and `:155`, the registration loop 169–202,
index.html:36, :119, :232, and all render-check.mjs member/DOM/literal
citations in §5.2 (detailed in criterion 2) — match exactly.

- **Finding 2 (non-blocking).** §3.3's closing paragraph says "a synchronous
  `throw` from **the eight command methods** is undefined behaviour." The
  table has seven rows whose Failure column is "rejected promise"
  (`getConfig`, `setConfig`, `getConfigPath`, `startUplink`, `stopUplink`,
  `restartSidecar`, `getStatus`); the other three (`onStatus`/`onLog`/`onExit`)
  are "must not throw," a different contract. The count should read "seven."

## Criterion 2 — must-not-change list, independently derived

Grepped `render-check.mjs` and `contract-check.mjs` directly rather than
copying §5.2:

- `window.FMC` members used: `showPage`(68), `setScratchpad`(73,164),
  `getScratchpad`(167), `getConfigCache`(97,217,237), `refreshConfig`(220,243),
  `getStatus`(244) — 6, all listed in §5.2 item 1.
- `window.__FMC_STUB__` members used: `.config`(198,219,239),
  `.calls`(76,193,200,201) incl. `call.method === 'setConfig'`,
  `.emitStatus`(71), `.setConfigResult`(203) — all listed in §5.2 item 2
  (which also lists `status`/`emitLog`/`emitExit`, unused by either tool but
  harmless to over-list).
- `contract-check.mjs`: the 7 `COMMANDS` + 3 `EVENTS` literals (line 6–7) and
  the hardcoded `ui/src/bridge.js` path (line 21) — both covered, §5.2 items 3–4.

Two gaps `render-check.mjs` depends on that §5.2 never names:

- **Finding 3 (non-blocking).** `#fmc-unit` — `render-check.mjs:262`
  (`document.getElementById('fmc-unit').getBoundingClientRect()`, the
  window-minimum check) is not in §5.2's "Frozen DOM hooks" list at all.
- **Finding 4 (non-blocking).** `[data-field]` — `render-check.mjs:153`
  selects `[data-field="${field}"] [data-field-value="${field}"]`; only
  `[data-field-value]` is named in §5.2.

Neither is live risk *in this run* — §1.1 already forbids touching
`index.html`, which is the only place these attributes live — so I'm not
treating them as blocking. They should still be added to §5.2 so the list is
actually the ground truth it claims to be, since a later run may not re-derive
it as carefully.

## Criterion 3 — every page capability has a named home

Read `pages/index.js` end to end and the STATUS/MENU objects in `app.js`.
Every host-reaching call in `pages/index.js` (`getConfigCache`,
`setScratchpad`, `getScratchpad`, `hasScratchpadError`, `registerPage`,
`showPage`, `refreshConfig`, and the one violation `fmc.bridge.setConfig`) maps
onto a named §2.2 member; `fmc.bridge.setConfig` → `setConfig` is exactly
§4.4's fix. STATUS's three violations (`bridge.restartSidecar/stopUplink/
startUplink`, app.js:252,306,307) map onto `restartSidecar`/`stopUplink`/
`startUplink`, per §4.1's table.

- **Finding 5 (non-blocking, follow-up for §4.1).** STATUS's R5 handler reads
  `state.status.app.state === 'app.crashed'` (app.js:251) directly off the
  shell's closured `state` — which will not exist once the page body moves
  into `status-page.js`. The interface *does* provide a home for this
  (`ctx.status`, §2.5, or `fmc.getStatus()`), so this is not an orphaned
  capability and criterion 3 is satisfied — but §4.1's "three call sites" table
  and "mechanics" bullets never mention this fourth necessary edit, unlike the
  parked-view timing trap it does call out. An implementer working strictly
  off that table would ship a `ReferenceError` on `state` inside
  `status-page.js`.

MENU stays inline in `app.js` and calls only the shell's own closured
`showPage` — it never touches `bridge`, so leaving it out of the migration is
consistent with the design's scope, not a gap.

## Criterion 4 — are the three decisions actually decided

Yes, all three, each with a stated reason, not deferred:

- **STATUS's three bridge calls** — §4.1, decision (b): move the page to
  `pages/status-page.js`. Reason given: while inline in `app.js`, no
  path-based checker can tell the page's host calls from the shell's own,
  which is why these three survived a design that already forbade it (§6.2
  explicitly rejects "fix the three calls in place" for this reason).
- **`ctx.bridge` / `fmc.bridge`** — §4.2/§4.3: removed outright, not replaced.
  Reason given in §2.5: a page that can reach the adapter will reach it "under
  deadline, for one field," and the boundary is unenforceable the moment that
  member exists.
- **The `TAURI` label** — §4.5, decision (c): generalized to adapter-supplied
  `hostLabel`, shell-rendered, outside the page contract. Reason given: the
  hardcoded string is a stated falsehood on a third host, and exposing host
  identity to pages recreates the coupling the run removes.

## Criterion 5 — `ctx.sh design ... 2 3 4 5` slices cleanly

```
$ .claude/tools/ctx.sh design 2026-09-13-cdu-abstract-interface 2 3 4 5 | grep -n '^## '
1:## 2. The page interface
136:## 3. Ownership boundary and the host-adapter contract
242:## 4. Migration of the code that exists today
426:## 5. Enforcement and verification
```
Four sections, each starting exactly on its `##` header line, no overlap,
573 lines total, none empty.

## Criterion 6 — host-swap check implementability

Confirmed directly: `bridge.js:238` is `const host = findHost();` at module
top level (outside any function), so it runs once when the module is first
evaluated — exactly the "module-evaluation-time host resolution" §5.3 relies
on. Puppeteer's `page.evaluateOnNewDocument(fn)` runs `fn` before any script
on the newly-navigated document executes, including a `<script type="module">`
entry point, so `window.__FMC_HOST__` set that way is guaranteed present
before `bridge.js:238` runs. The check is implementable as specified; no
finding.

## Independent baseline runs (not taken from T-001's report)

```
$ node tools/contract-check.mjs        # Node 20, scratch, repo root cwd
PASS config_get … PASS sidecar:exit    # 10 PASS lines, exit 0
```
```
$ node ui/tools/render-check.mjs <scratchpad>/render-check
… 46 PASS lines, ending "PASS browser errors: none …", no FAIL
```
Both match §5.4's expected counts on today's unmodified tree.

## Out-of-band finding — not part of design.md, found while verifying baselines

- **Finding 6 (flag for the Orchestrator, not a T-002 defect).** 34 files under
  `.claude/runs/2026-09-11-tauri-windows-client/prototypes/*.png` are currently
  **modified in the working tree** (confirmed: `git diff --stat` shows binary
  diffs, e.g. `app.running.png` 138657→142077 bytes), and an untracked
  `windows-client/.claude/runs/2026-09-11-tauri-windows-client/prototypes/`
  (33 more PNGs) exists alongside it. Both are exactly the failure mode
  §5.4 itself warns about: `render-check.mjs` run with no explicit output
  argument resolves relative to cwd and overwrites the previous run's
  committed screenshots. This predates my review (mtimes: one set 02:57
  today, the other 20:38 today) — it is not something I did, and I made no
  writes outside `reviews/`. It should be cleaned up (`git checkout --
  .claude/runs/2026-09-11-tauri-windows-client/prototypes/` and delete the
  stray `windows-client/.claude/` directory) before this run ships, and is
  itself evidence for why the report's claim of "clean prototype runs" needs
  independent checking rather than trust.

## Live-database check

`md5sum flights.db` before and after this review: `1337a4068ab6ef5320fc3dcdff9bc2de`
(unchanged — I never opened it). Scratch render-check ran on a random port,
never 3000, output written to the session scratchpad and deleted afterward.

## Summary

Design conformance is strong: every substantive claim about the boundary
(§3), the interface (§2), and the migration (§4) checks out against the actual
code, all three frozen decisions are genuinely decided, and the host-swap
timing mechanism is real and implementable. Findings 1–5 are documentation
precision gaps (a citation, a miscount, two must-not-change omissions with
zero blast radius since `index.html` is frozen anyway, one migration-guidance
gap with a real home already in the contract) — none change what T-003 must
build. Finding 6 is unrelated to design.md and belongs to run hygiene, not to
this task's verdict.
