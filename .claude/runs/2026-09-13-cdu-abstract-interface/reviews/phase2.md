# Review — phase 2 (T-003, T-004) — VERDICT: approve

Reviewer: T-005. Node 20.20.2. Nothing from either implementer report was used as
evidence; every claim below is a command I ran. Scratch dir
`$SCRATCH = /tmp/claude-1000/-home-guilherme-msfslogger/3d45404c-.../scratchpad`,
removed at the end. Live `flights.db` md5 `2ac03206e808516033fe2fbb42d6af54`
before and after — unchanged. No server on port 3000 was touched; every probe
used an ephemeral 127.0.0.1 port.

## Per-task verdicts

- **T-003 (shell/page refactor)** — approve. 0 blocking findings.
- **T-004 (boundary-check, host-swap-check)** — approve. 1 non-blocking finding (F-1).

## Criteria verified independently: 8 of 8

**1. All four checks re-run (from `windows-client/`, Node 20), actual output.**

```
node tools/contract-check.mjs        exit=0  10 PASS  (config_get … sidecar:exit, Rust ↔ ui/src/bridge.js)
node ui/tools/boundary-check.mjs     exit=0   8 PASS  (bridge-import, tauri-reference, host-global,
                                                        page-adapter, page-global, page-events,
                                                        adapter-leak, interface-members)
node ui/tools/host-swap-check.mjs    exit=0   5 PASS  + "Cleanup: browser closed; scratch server closed"
node ui/tools/render-check.mjs "$SCRATCH/review-render"
                                     exit=0  46 PASS  ending "PASS browser errors: none"
```

render-check wrote its 34 PNGs to `$SCRATCH/review-render` (`ls | wc -l` → 34).
`git status --porcelain` captured before and after the whole session is
byte-identical (`diff before.txt after.txt` → empty, "REPO STILL UNTOUCHED"),
so `.claude/runs/2026-09-11-tauri-windows-client/prototypes/` was not rewritten
by me. Note: those 34 PNGs were *already* modified in the working tree at
session start (mtime `2026-09-13 02:57`, i.e. hours before this run's intake at
20:38) — pre-existing debris from an earlier session, not T-003/T-004's doing,
and left untouched. Same for the untracked `windows-client/.claude/` tree.

**2. I re-broke the boundary myself** — in a copy of `windows-client/` under
`$SCRATCH/break`, seven mutations, each run of `node ui/tools/boundary-check.mjs`
exiting 1 with a one-line reason:

| Mutation | Output |
|---|---|
| page imports `../bridge.js` | `FAIL bridge-import: ui/src/pages/status-page.js:1 …` + `FAIL page-adapter: …:1` |
| page comments `window.__TAURI__` | `FAIL tauri-reference: ui/src/pages/index.js:218 …` |
| `import bridge` deleted from app.js | `FAIL bridge-import: ui/src/app.js:1 …` (the zero-match case really fails) |
| `bridge,` re-added to the interface | `FAIL adapter-leak: ui/src/app.js:467 …` |
| `getConfigPath` removed | `FAIL interface-members: … getConfigPath missing …` |
| page reads `window.FMC` | `FAIL page-global: ui/src/pages/status-page.js:76 …` |
| page calls `h.onExit(() => {})` | `FAIL page-events: ui/src/pages/index.js:218 …` |

Restoring the files returned exit 0 with no FAIL lines. The checker would catch
a future violation of every rule it claims to enforce. The repo itself was never
edited: `git status --porcelain` diff against the session baseline is empty.

**3. Design §2 and §3 tables traced to code, member by member.**

- §2.2, thirteen members → `ui/src/app.js:466-478`, in table order:
  `registerPage`466 `showPage`467 `setScratchpad`468 `getScratchpad`469
  `hasScratchpadError`470 `getConfigCache`471 `getConfigPath`472 `getStatus`473
  `refreshConfig`474 `setConfig`475 `startUplink`476 `stopUplink`477
  `restartSidecar`478. No fourteenth member; `bridge` is gone.
- §2.5, four context members → `app.js:120-127` (`body`, `config`, `status`,
  `fmc`), `bridge` removed.
- §3.3, twelve adapter members → Tauri `bridge.js:177-188`, stub
  `bridge.js:250-297`, adopted host `bridge.js:88-101` (`HOST_METHODS` 55-66
  bound through, `isStub:false`, `hostLabel`). No member frozen in the design is
  missing and no method exists that the design does not name.
- Semantics I exercised rather than read (synthetic host, `$SCRATCH/fail-probe.mjs`):
  failing `startUplink` → scratchpad `COMMAND FAILED`, `data-message-kind=error`,
  `window.FMC.startUplink()` resolves `false`; rejecting `setConfig` →
  `SAVE FAILED` (pass-through kept, §2.3); `CONFIG READ FAILED` goes to the
  message line (`app.js:443`), cache left alone.

**4. My own greps for the DoD's first bullet** (from `windows-client/`):

```
$ grep -rn '__TAURI__\|__TAURI_INTERNALS__' ui/src/
ui/src/bridge.js:7   ui/src/bridge.js:107   ui/src/bridge.js:108
$ grep -rn '\bbridge\b' ui/src/pages/     → (no output)
$ grep -rn '\bFMC\b'    ui/src/pages/     → (no output)
$ grep -rn 'bridge\.js' ui/src/ | grep -v '^ui/src/bridge.js'
ui/src/app.js:5 (comment)   ui/src/app.js:18 (import bridge from './bridge.js';)
$ grep -rn '__FMC_HOST__\|__FMC_STUB__' ui/src/   → ui/src/bridge.js only (7 lines)
```

No page-level code can reach the adapter: `pageContext()` hands out four members
and none of them is host-shaped, and the only import of `bridge.js` is the
shell's.

**5. Token masking, read line by line after the refactor.** The rule is
untouched by the diff and still shell-owned at `app.js:57-62`, keyed on
`state.pageId === 'NETWORK'`; `showPage` clears the entry on every navigation
*before* `state.pageId` changes (`app.js:170`), so an uncommitted token cannot
be repainted unmasked on the next page. In `pages/index.js`, `display()`:89
returns `••••••••` for `ingestToken`; the only `el.title =` assignment (:105,
and :185 in the render path) is guarded by `field === 'serverUrl' || field ===
'certPath'`; the typed value lives in module-local `pendingToken` (:131) and
reaches the DOM nowhere. Verified, not inferred — `$SCRATCH/token-probe.mjs`
typed `PROBE-SECRET-9f3ac1` and swept `documentElement.textContent`, every
attribute of every element, every `.title`, every `.value` and `outerHTML` at
five points:

```
after typing  -> scratchpad: "•••••••••••••••••••"  leaks: []
after L2      -> scratchpad: ""  tokenfield: ••••••••  leaks: []
after save    -> leaks: []   patch had token: true
after nav SIM -> scratchpad: ""  leaks: []
uncommitted+nav -> scratchpad: ""  getScratchpad: ""  leaks: []
```

A typed token cannot be painted, put in an attribute or a title, or saved
anywhere but the `setConfig` patch it is meant for.

**6. Bridge-mode label vs §4.5.** Decided as a host descriptor: the adapter owns
`hostLabel`, the shell renders it as chrome, no page can read it (it is not a
§2.2 member). Code matches at `app.js:454-458` — `data-stub` from
`bridge.isStub`, `textContent = bridge.hostLabel`; `createTauriBridge` sets
`'TAURI'` (:178), the stub `'STUB BRIDGE'` (:251). What a third host renders
today, measured (`$SCRATCH/host-variants.mjs`, real panel, three installed hosts):

```
complete-no-hostLabel  label "HOST"        data-stub false   __FMC_STUB__ absent
partial-missing-onExit label "STUB BRIDGE" data-stub true    (falls through, §3.4)
host-plus-fake-tauri   label "MSFS GAUGE"  data-stub false   (installed host beats Tauri)
blank/whitespace label label "HOST"
```

**7. Scope.** `git status --porcelain windows-client/src-tauri windows-client/sidecar
src client agent tests` → empty. `git status --porcelain package.json
package-lock.json` → empty. The run's entire diff is
`M windows-client/ui/src/{app.js,bridge.js,pages/index.js}` plus untracked
`windows-client/ui/src/pages/status-page.js`, `windows-client/ui/tools/{boundary,host-swap}-check.mjs`
and `.claude/runs/2026-09-13-cdu-abstract-interface/`. `index.html`, `css/**`,
`ui/src/status.js` and `ui/tools/render-check.mjs` are unmodified (§5.2 item 7).

**8. What this Linux box cannot verify.** No WebView2/Tauri host and no
MSFS/Coherent-GT host exists here. `contract-check` only greps the command
literals, so nothing runs the real Tauri IPC. I closed part of that gap by
installing a fake `window.__TAURI__` (`$SCRATCH/tauri-probe.mjs`): label `TAURI`,
`data-stub=false`, boot invoked `config_get, status_get, config_path`, R6 invoked
`uplink_start`, no page errors — so the `kind:'tauri'` field added to `findHost()`
did not break the branch. Still unverified: a real WebView2 module-evaluation
order, and whether a Coherent-GT loader evaluates `pages/index.js` in a way
`register(api)` injection survives. What would falsify the design: a host whose
loader cannot assign `window.__FMC_HOST__` before the `app.js` module graph
evaluates (§3.4's timing rule is load-bearing and has no fallback), or a gauge
runtime without `<template>`/`content.cloneNode` support, which `pages/index.js`
render still assumes.

## Findings

**F-1 — non-blocking — T-004 — `windows-client/ui/tools/boundary-check.mjs:122`.**
The comment reads `// interface-members: the thirteen §2.2 names must each appear
as a ...`. A `§`-numbered citation points at a document no reader of the tool can
resolve; the rest of the file's comments state the rule in prose and read fine
without it. Exposed by
`grep -rn '§\|\.claude/runs\|design\.md\|T-0[0-9][0-9]\|plan\.json' ui/src/*.js ui/src/pages/*.js ui/tools/*.mjs`,
which returns this one line and nothing else. Fix: say "the thirteen interface
names". Does not send the task back.

## Can an MSFS/Coherent-GT implementer write their adapter without touching a page?

Yes, on the evidence. §3.3's twelve rows are exactly what `installSynth`
(`host-swap-check.mjs:38-56`) implements and exactly what `HOST_METHODS`
(`bridge.js:55-66`) validates and binds; the synthetic host drove STATUS R6/R5
and a NETWORK save through real clicks and keystrokes with zero page-file
changes and no console errors. Nothing in `ui/src/pages/**` names Tauri, the
adapter, the FMC global or a host event — three independent greps above. The
one thing an implementer still needs beyond the table is the §3.4 timing rule,
which is in the design and restated in `bridge.js:83-87`.

## Non-blocking follow-ups

1. Design §2.6 prose says `page-events` greps `.onStatus(` as well as
   `.onLog(`/`.onExit(`; the §5.1 rule table and the implementation
   (`boundary-check.mjs:107`) cover only the latter two. Not a hole today — the
   interface has no `onStatus` member for a page to call — but the two
   paragraphs disagree and the next reader will trust the wrong one.
2. `boundary-check.mjs` is line-grep based, so a computed reach
   (`window['__TAU' + 'RI__']`, `globalThis[k]`) passes. Acceptable for the
   stated purpose; worth knowing before anyone calls it a guarantee.
3. Nothing in CI runs these four tools together; today they are four manual
   commands. A single `npm run check:ui` would make the boundary regression-proof
   rather than review-proof.
