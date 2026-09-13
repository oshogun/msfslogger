# Design — CDU pages depend only on the abstract interface

Run id: `2026-09-13-cdu-abstract-interface`
Status: **frozen** 2026-09-13. Sections are numbered and the numbers are stable;
downstream tasks are handed slices with
`.claude/tools/ctx.sh design 2026-09-13-cdu-abstract-interface <n>`.

All line numbers in this document refer to the checkout as it stood when the
design was frozen (`ee03501`). They are navigation aids for the implementer, not
contract text: if a line has moved, the named identifier is what counts.

Nothing in this document — no section number, no run id, no task id, no file
name from `.claude/` — may appear in a comment in `windows-client/ui/**`. Where a
reason belongs in the code, write the reason.

## 0. Amendments

| # | Date | Section | Change | Evidence |
|---|---|---|---|---|
| — | — | — | none yet | — |

## 1. Scope, non-goals, and what already exists

### 1.1 What this run does

It freezes the page-facing interface the CDU pages are allowed to use, freezes
the host-adapter contract a non-Tauri host must implement, and moves the two
pieces of existing code that reach around that boundary onto it. It is a
boundary freeze over code that already has most of the seam — not a redesign of
the panel.

Everything in this run is confined to `windows-client/ui/**`:
`ui/src/app.js`, `ui/src/bridge.js`, `ui/src/pages/**`, and two new tools under
`ui/tools/`. `ui/index.html`, `ui/css/**` and `ui/src/status.js` are not
modified.

### 1.2 Non-goals, one sentence each

- **No file under `src/**`, `client/**`, `agent/**`, `windows-client/src-tauri/**`
  or `windows-client/sidecar/**` is modified by this run** — the Rust commands,
  the sidecar protocol and the server are all untouched, and
  `windows-client/tools/contract-check.mjs` proves the Rust↔webview name
  contract still holds afterwards (§5.4).
- **The MSFS / Coherent-GT adapter itself is not built here** — §3 writes down
  what such an adapter must implement and §5.3 proves a synthetic one can drive
  every page, but no in-sim gauge, no HTTP/WS protocol from inside the sim, and
  no packaging for MSFS is produced by this run.

### 1.3 What already exists (verified by reading the code)

- `ui/src/bridge.js` is already the only file that mentions `window.__TAURI__` /
  `window.__TAURI_INTERNALS__` (`findHost()`, lines 43–70). It exports one object
  with eleven members and falls back to a stub implementation (lines 128–236)
  when no Tauri host is present, publishing `window.__FMC_STUB__` (line 234) for
  the test harness.
- `ui/src/app.js` builds `window.FMC` (lines 495–505) and hands every page a
  `pageContext()` (lines 120–128).
- `ui/src/pages/index.js` (NETWORK / SIM / TRAFFIC) already calls only `fmc.*`.

Three things break the property "every CDU page depends only on the abstract
interface", all confirmed by running the §5.1 rule set against this checkout:

```text
FAIL page-adapter: ui/src/pages/index.js:155   fmc.bridge.setConfig(patch)
FAIL page-global:  ui/src/pages/index.js:3     const fmc = window.FMC
FAIL adapter-leak: ui/src/app.js:123           ctx.bridge
FAIL adapter-leak: ui/src/app.js:504           window.FMC.bridge
```

and a fourth that the rule set **cannot** see, which is itself an argument in
§6.2: the built-in STATUS page (app.js:232–263) calls `bridge.restartSidecar()`
(app.js:253), `bridge.stopUplink()` (app.js:306) and `bridge.startUplink()`
(app.js:307) through the module-level import at app.js:11. Because that page is
inline in the shell file, no path-based checker can tell its calls apart from
the shell's own.

## 2. The page interface

The *page interface* is one plain object built by the shell. A page obtains it
in exactly two ways (§2.1) and may use nothing else to reach the outside world.

### 2.1 How a page obtains it — decision (a)

Frozen: **both, with distinct roles, and neither of them is a global read from
inside a page.**

1. **Registration time — injection.** Every page module exports
   `register(fmc)`. The shell calls it once with the interface object. That call
   is the only way a page module learns the interface at module-evaluation time.
   - `ui/src/pages/status-page.js` is imported statically by `app.js` and its
     `register` is called from `boot()` before the first `showPage('STATUS')`.
   - `ui/src/pages/index.js` is imported lazily (app.js:133) and its `register`
     is called from the `.then()` of that dynamic import, before
     `state.pagesLoaded` is set.
2. **Callback time — the context argument.** `render(ctx)`, `onLsk(lsk, ctx)`
   and `onKey(key, ctx)` receive `ctx` whose `fmc` member is the *same object*
   (`ctx.fmc === the object passed to register`). A callback may use either;
   `ctx.fmc` is preferred because it needs no module state.

`window.FMC` still exists and is still assigned the same object (§5.4 requires
it: `render-check.mjs` drives the panel through it). It is **shell and host
harness surface, not a page mechanism**: no file under `ui/src/pages/` may
contain the token `FMC` at all, which §5.1 rule `page-global` checks by grep.

Why both rather than the global alone: a page cannot get a context before it is
registered, so registration needs a non-`ctx` path; and a Coherent-GT gauge may
load page modules through a bundler, a different realm, or an injected
`<script>` whose evaluation order relative to the shell is not the browser's.
Injection makes the page's dependency an argument the host wiring supplies,
which works under any loader. See §6.1 for the options rejected.

### 2.2 Members

`sync` members never touch the host and never throw. `host-backed` means the
adapter in §3 must implement the corresponding method; `shell-local` means the
shell implements it identically on every host, usually over state it already
caches from host events.

| Member | Signature | Returns | Sync/async | Backing | Semantics |
|---|---|---|---|---|---|
| `registerPage` | `registerPage(page)` | `void` | sync | shell-local | Adds a page descriptor (§2.4) to the registry. A descriptor missing `id` or `render` is rejected and puts `PAGE UNAVAILABLE` on the scratchpad instead of throwing. |
| `showPage` | `showPage(id)` | `Promise<boolean>` | async | shell-local | Navigates to page `id`, loading the lazy page bundle first if `id` is one of `NETWORK`/`SIM`/`TRAFFIC`. Resolves `false` and shows `PAGE UNAVAILABLE` if the page cannot be produced; never rejects. |
| `setScratchpad` | `setScratchpad(text, kind = 'entry')` | `void` | sync | shell-local | `'entry'` replaces what the user typed and clears any message; `'error'` and `'advisory'` layer a message over the typed entry, which returns when the message is cleared. Any other `kind` is treated as `'error'`. |
| `getScratchpad` | `getScratchpad()` | `string` | sync | shell-local | The typed entry, or `''` while a message is displayed. |
| `hasScratchpadError` | `hasScratchpadError()` | `boolean` | sync | shell-local | True when the current message kind is `'error'`. Lets a page abandon an LSK rather than overwrite a rejection the user has not read. |
| `getConfigCache` | `getConfigCache()` | `object \| null` | sync | shell-local | The last config the shell read from the host (the unredacted `raw` when the host supplies one), or `null` before the first read or when no config file exists. Never a copy-on-read: a page must not mutate it. |
| `getConfigPath` | `getConfigPath()` | `string` | sync | shell-local | The cached on-disk config path for display, `''` if unknown. The host fetch behind it is the shell's job. |
| `getStatus` | `getStatus()` | `StatusMessage` | sync | shell-local | The last status snapshot. Never `null` — before the first host message this is the shell's `defaultStatus()` (`ui/src/status.js`), every axis populated. |
| `refreshConfig` | `refreshConfig()` | `Promise<void>` | async | host-backed | Re-reads config and config path from the host and repaints. Never rejects: a failed read puts `CONFIG READ FAILED` on the message line and leaves the cache as it was. |
| `setConfig` | `setConfig(patch)` | `Promise<{ ok, path?, message? }>` | async | host-backed | Shallow-merge write of `patch`. Pass-through: resolves with whatever the adapter resolves with, **rejects when the adapter rejects**. The caller owns the outcome message (§2.3). |
| `startUplink` | `startUplink()` | `Promise<boolean>` | async | host-backed | Asks the host to start the uplink. Resolves `true` on success; on adapter failure the shell puts `COMMAND FAILED` (kind `error`) on the scratchpad and resolves `false`. Never rejects. |
| `stopUplink` | `stopUplink()` | `Promise<boolean>` | async | host-backed | As `startUplink`, stopping. |
| `restartSidecar` | `restartSidecar()` | `Promise<boolean>` | async | host-backed | As `startUplink`, restarting the host's worker process (Tauri: the sidecar). |

Thirteen members. `bridge` is **not** one of them (§2.5).

### 2.3 Why `setConfig` rejects when the three commands do not

`startUplink`, `stopUplink` and `restartSidecar` have no result a page can use
and exactly one sensible failure message, so the shell owns both — this is
today's `runCommand` (app.js:295–303) promoted from a shell-private helper to
the behaviour of three interface members, and it keeps the try/catch out of
every page that ever offers a command prompt.

`setConfig` has a result the page must inspect (`{ ok:false, message }` is a
*refused write*, not a transport failure) and its own message vocabulary:
`ui/src/pages/index.js` renders `SAVE FAILED` for both, and
`render-check.mjs:205` asserts that string. Wrapping it in `COMMAND FAILED`
would change observable behaviour, so it stays a pass-through.

### 2.4 The page descriptor

What a page hands `registerPage`. Only `id`, `title` and `render` are required.

| Field | Type | Semantics |
|---|---|---|
| `id` | `string` | Page id; becomes `#fmc-screen`'s `data-page` (§5.4). |
| `title` | `string` | Rendered into `#page-title`. |
| `group` | `string?` | `PREV`/`NEXT` step through pages sharing a group, ordered by `n`, wrapping. |
| `n`, `m` | `number?` | Position in the group; `#page-number` shows `n/m` when `m > 1`. |
| `render(ctx)` | `(ctx) => Node \| void` | Returns the element to place in `#page-body`, or writes into `ctx.body` and returns nothing. A throw is caught and shows `PAGE UNAVAILABLE`. |
| `onLsk(lsk, ctx)` | `(string, ctx) => boolean` | `true` = handled. `false` or absent gives `KEY NOT ACTIVE`. A throw is caught and gives `COMMAND FAILED`. |
| `onKey(key, ctx)` | `(string, ctx) => boolean` | Same, for non-navigation keys the shell did not consume. |
| `onStatus(status)` | `(StatusMessage) => void` | §2.6. |
| `dispose()` | `() => void` | Called on navigation away. A throw is caught and never blocks navigation. |

### 2.5 The page context object

After this run, `pageContext()` returns exactly four members:

| Member | Type | Semantics |
|---|---|---|
| `body` | `Element` | `#page-body`, the only container a page may write into. |
| `config` | `object \| null` | Snapshot of the config cache at call time; identical to `ctx.fmc.getConfigCache()`. |
| `status` | `StatusMessage` | Snapshot of the status at call time; identical to `ctx.fmc.getStatus()`. |
| `fmc` | `object` | The interface of §2.2. |

`bridge` is **not** among them, and that is the point of the run: a page that
can reach the adapter is a page that will reach the adapter — under deadline,
for one field, with a comment promising to clean it up — and from that moment
the boundary is unenforceable, because the only thing separating "uses the
interface" from "uses the host" is a reviewer's attention. Removing the member
makes the property mechanical: no page can call a Tauri command, because no page
holds anything that has one.

`config` and `status` are kept for compatibility with the existing call shape;
they are snapshots, so a callback that awaits something must re-read through
`ctx.fmc` rather than trust them.

### 2.6 Status, log and exit events

Frozen, and this does not change from today's behaviour:

- **The shell is the only subscriber.** It subscribes once at boot —
  `onStatus`, `onLog`, `onExit` on the adapter (app.js:511–513) — and never
  unsubscribes.
- **A page receives status through its own `onStatus(status)` callback**, which
  the shell calls, for the *current page only*, from `paintStatus()`
  (app.js:315–322): once per host status message, once per second from the local
  tick that drives the retry countdown, and once at the end of every navigation
  so a page is painted current the moment it appears. A page that throws in
  `onStatus` is caught and ignored.
- **A page never receives log or exit events.** They drive `#msg-line`, which is
  shell chrome; no page-facing member exposes them.
- **A page may not subscribe to host events directly**: no file under
  `windows-client/ui/src/pages/` may call `.onStatus(`, `.onLog(` or `.onExit(`
  on anything, and §5.1 rule `page-events` greps for exactly that.

A page needing status outside a callback calls `fmc.getStatus()`, which is the
same snapshot the shell would have handed it.

## 3. Ownership boundary and the host-adapter contract

### 3.1 Who owns what

| Layer | Files | May touch |
|---|---|---|
| Host adapter | `ui/src/bridge.js` (Tauri + stub), plus any future adapter installed per §3.4 | `window.__TAURI__`, `window.__TAURI_INTERNALS__`, `window.__FMC_HOST__`, `window.__FMC_STUB__`, host IPC |
| Shell | `ui/src/app.js` | The adapter (one import), the DOM chrome, the page registry; builds and owns the §2 interface |
| Presentation | `ui/src/status.js` | Nothing host-shaped: pure functions over a status object and a DOM root |
| Pages | `ui/src/pages/**` | The §2 interface only, plus `../status.js` and sibling page modules |

### 3.2 The import rule, as a checkable sentence

**`windows-client/ui/src/app.js` is the only file under `windows-client/ui/src/`
that may import `./bridge.js`; no file under `windows-client/ui/src/pages/` may
import it, contain the identifier `bridge`, contain the token `FMC`, or mention
`__TAURI__` / `__TAURI_INTERNALS__` / `__FMC_HOST__` / `__FMC_STUB__`.**

Corollary, checked the same way: `__TAURI__` and `__TAURI_INTERNALS__` appear in
`ui/src/bridge.js` and nowhere else in `ui/src/**`, which is the property
`2026-09-11-tauri-windows-client` §5.2 already froze and this run keeps.

### 3.3 The host-adapter contract

An adapter is a plain object. `ui/src/bridge.js`'s Tauri branch
(`createTauriBridge`, bridge.js:89–124) is **the reference implementation of this
contract**, and the stub bridge (bridge.js:128–236) is a **second, already
shipping implementation of the same contract** — which is why the panel runs in
a plain browser today. An MSFS/Coherent-GT implementer needs this table and
nothing else; no page code is involved.

| Member | Arguments | Resolves to | Failure | Notes |
|---|---|---|---|---|
| `getConfig()` | — | `{ exists: boolean, path: string, config: object\|null, raw: object\|null }` | rejected promise | `exists:false` for "no config file yet" is a **success**, not a failure. `raw` is the unredacted on-disk object the CFG pages prefill from; a host with no redaction may set `raw === config`. |
| `setConfig(patch)` | `patch`: flat object of config keys | `{ ok: true, path: string }` or `{ ok: false, message: string }` | rejected promise | Shallow merge over the stored config, then persist. A refused write is `ok:false`, not a rejection. An absent `ingestToken` key means "leave the stored credential alone" and must not be interpreted as clearing it. |
| `getConfigPath()` | — | `string` | rejected promise | Display only. |
| `startUplink()` | — | any (ignored) | rejected promise | |
| `stopUplink()` | — | any (ignored) | rejected promise | |
| `restartSidecar()` | — | any (ignored) | rejected promise | Restarting whatever the host uses to reach the sim and the server. |
| `getStatus()` | — | `StatusMessage \| null` | rejected promise | Last known status for an immediate first paint. `null` is allowed and is ignored by the shell. |
| `onStatus(fn)` | `fn(status)` | — (returns, see Failure column) | must not throw | Returns an unsubscribe function **synchronously** (§3.5). `fn` receives the status payload itself, not an event wrapper. |
| `onLog(fn)` | `fn({ level, message })` | — | must not throw | |
| `onExit(fn)` | `fn({ code, signal, restarting })` | — | must not throw | |
| `isStub` | property, `boolean` | — | — | `true` only for the built-in no-host stub. Drives `#bridge-mode`'s `data-stub` (§4.5). |
| `hostLabel` | property, `string` | — | — | Short uppercase host name for the annunciator, e.g. `TAURI`, `STUB BRIDGE`, `MSFS GAUGE` (§4.5). |

**Every method is async from the shell's point of view.** An adapter may return
a plain value; the shell always treats the return as a thenable. A *rejected
promise* is the failure channel — a synchronous `throw` from the eight command
methods is undefined behaviour and an adapter must not rely on the shell
catching it.

### 3.4 The host-installation seam

Frozen name: **`window.__FMC_HOST__`**.

`bridge.js` resolves its host once, at module evaluation
(bridge.js:238, `const host = findHost()`). `findHost()` gains a first branch:

1. `window.__FMC_HOST__`, if it is an object carrying all ten methods of §3.3 as
   functions. Adopted as the adapter.
2. else `window.__TAURI__` / `window.__TAURI_INTERNALS__`, exactly as today.
3. else the stub bridge.

Precedence is deliberate: an installed host wins over Tauri, so a host embedding
the panel inside something Tauri-shaped still gets its own adapter, and a
half-built host object (missing a method) falls through to Tauri or the stub
rather than booting a panel whose buttons throw.

The adapter is **adopted, not used raw**: the shell sees an object built by
`bridge.js` with the ten methods bound through and `isStub:false`,
`hostLabel` defaulted to `'HOST'` when the installed object gives no usable
string. The shell therefore never has to defend against a partial adapter.

**Timing rule.** `window.__FMC_HOST__` must be assigned **before the `app.js`
module graph evaluates** — i.e. before `<script type="module" src="src/app.js">`
(index.html:232) runs. In a real host that means the gauge's own bootstrap
script, injected ahead of the panel document. In the automated check (§5.3) it
means puppeteer's `page.evaluateOnNewDocument(...)` before `page.goto(...)`,
which is the only ordering that reliably beats a module preload. Assigning it
later has no effect and is not supported.

**This seam is not a dev-only branch to be stripped.** It is the whole mechanism
by which a second host exists: the MSFS gauge will ship an adapter and install
it here, and the check in §5.3 is the same door used by production. This is the
argument already written at the top of `bridge.js` for the stub, extended one
step: a panel that cannot find a host still shows a working panel that says so,
and a panel that finds a *different* host runs unmodified page code against it.

### 3.5 Subscription and unsubscribe semantics

`onStatus` / `onLog` / `onExit` return an unsubscribe function **synchronously**,
even when the underlying subscription is asynchronous. Requirements:

- Calling it stops delivery to `fn`, and it is safe to call before an async
  subscription has completed — the adapter must remember the cancellation and
  tear down when it lands. `createTauriBridge`'s `subscribe` (bridge.js:92–109)
  is the worked example: a `cancelled` flag plus a late `off()`.
- It is idempotent and never throws. A second call is a no-op.
- An adapter that cannot subscribe at all returns a no-op unsubscribe and never
  delivers, rather than throwing (`listenViaInternals`, bridge.js:72–87). A panel
  that misses live updates beats a panel that fails to boot.

The shell subscribes once at boot and never unsubscribes (§2.6); unsubscribe
exists for hosts whose gauge is torn down and rebuilt within one page lifetime.

## 4. Migration of the code that exists today

### 4.1 The STATUS page — decision (b)

Frozen: **the STATUS page moves out of `app.js` into
`windows-client/ui/src/pages/status-page.js`.**

Reason: while it lives in `app.js`, no path-based checker can distinguish its
host calls from the shell's own — which is precisely why today's three direct
`bridge` calls survived a design that already said pages must not do that
(§1.3 shows the rule set passing `app.js` while those calls sit in it). Moving
it puts every page in the repo under one directory with one rule. The file name
is `status-page.js`, not `status.js`, so it is never confused with
`ui/src/status.js`, which stays exactly where it is and keeps owning the status
*vocabulary and painting* for both the page and any future one.

The three call sites, resolved:

| Today | Becomes |
|---|---|
| `runCommand(() => bridge.restartSidecar())` (app.js:253) | `fmc.restartSidecar()` |
| `runCommand(() => bridge.stopUplink())` (app.js:306) | `fmc.stopUplink()` |
| `runCommand(() => bridge.startUplink())` (app.js:307) | `fmc.startUplink()` |

`runCommand` (app.js:295–303) **stays a shell-private helper** and is not an
interface member: it becomes the implementation of the three command members in
§2.2, so its `COMMAND FAILED` behaviour is preserved exactly and no page repeats
it. `toggleUplink` (app.js:305–308) **moves into the page** as a private
function, because "R6 means START or STOP depending on `app.state`" is the
STATUS page's behaviour and nothing else in the shell refers to it; it reads
`uplinkRunning(fmc.getStatus())` from `../status.js`.

Mechanics the implementer must get right:

- `register(fmc)` captures the parked view with
  `document.querySelector('[data-page-view="STATUS"]')` **at registration time**.
  It ships in `index.html` (index.html:36) and `showPage` detaches it with
  `dom.body.replaceChildren()` (app.js:169) on the first navigation; a page that
  looks it up lazily in `render()` finds nothing, because by then it has been
  removed from the document and only a held reference keeps it alive. This is
  what app.js:34 does today, and the timing is the reason.
- The page paints itself: `render()` and `onStatus(status)` both call
  `renderStatus(view, status)` and `renderConfigPath(view, fmc.getConfigPath())`
  from `../status.js`.
- The shell's `paintStatus()` (app.js:312–323) loses its two `statusView` lines
  (app.js:313–314) and keeps only the dispatch to the current page's `onStatus`.
  The parked view stops being repainted while another page is up — which is not
  observable, because it is detached from the document, and because
  `showPage` calls `paintStatus()` after `render` (app.js:187) so the page is
  current before it is seen.
- `app.js` then imports only `defaultStatus` from `./status.js`; the now-unused
  `renderStatus`, `renderConfigPath` and `uplinkRunning` imports are dropped.
- `status-page.js` is imported **statically** by `app.js` and registered inside
  `boot()` before `showPage('STATUS')` — STATUS is the launch page and must not
  depend on a lazy import.

The page keeps its id, title, group, `n`/`m` and its whole LSK map: `L6` to
MENU, `R6` uplink toggle, `R5` restart only while `app.crashed`, `L1`–`L5`
`NOT ALLOWED`.

### 4.2 `pageContext()`

`pageContext()` (app.js:120–128) loses one member and gains none. Post-refactor
body:

```js
function pageContext() {
  return {
    body: dom.body,
    config: state.config,
    status: state.status,
    fmc: window.FMC,
  };
}
```

The removed member is `bridge` (app.js:123). The reason is §2.5.

### 4.3 `window.FMC`

`window.FMC` (app.js:495–505) is built as a named local first, so the same
object can be injected into page modules (§2.1), then published:

```js
const fmc = {
  registerPage,
  showPage,
  setScratchpad,
  getScratchpad,
  hasScratchpadError: () => state.message?.kind === 'error',
  getConfigCache: () => state.config,
  getConfigPath: () => state.configPath,
  getStatus: () => state.status,
  refreshConfig: loadConfig,
  setConfig: (patch) => bridge.setConfig(patch),
  startUplink: () => runCommand(() => bridge.startUplink()),
  stopUplink: () => runCommand(() => bridge.stopUplink()),
  restartSidecar: () => runCommand(() => bridge.restartSidecar()),
};
window.FMC = fmc;
```

**Removed:** `bridge` (app.js:504). **Added:** `getConfigPath`, `setConfig`,
`startUplink`, `stopUplink`, `restartSidecar`. **Unchanged, and frozen by
§5.4:** `registerPage`, `showPage`, `setScratchpad`, `getScratchpad`,
`hasScratchpadError`, `getConfigCache`, `getStatus`, `refreshConfig`.

### 4.4 `pages/index.js`

- Line 3, `const fmc = window.FMC;`, becomes `let fmc = null;`, assigned in a new
  exported `register(api)`.
- The registration loop (lines 169–202) moves inside `register(api)`, so the
  module has no side effect at evaluation time beyond defining functions.
- **Line 155, `const result = await fmc.bridge.setConfig(patch);`, becomes
  `const result = await fmc.setConfig(patch);`.** Nothing else about `save()`
  changes: the `result?.ok` check, the `SAVE FAILED` feedback on both the refused
  write and the rejection, the `await fmc.refreshConfig()`, and the
  `CONFIG SAVED` advisory all stay as they are.
- `app.js`'s lazy import (app.js:133) calls `module.register(window.FMC)` inside
  the existing `.then()`, before `state.pagesLoaded = true`, and the existing
  `.catch()` that shows `PAGE UNAVAILABLE` keeps covering a `register` that
  throws.

### 4.5 The bridge-mode label — decision (c)

Frozen: **generalized behind the adapter as a host descriptor
(`hostLabel`, §3.3), rendered by the shell as chrome, and not part of the page
contract.**

Both halves matter. The string is generalized because the alternative —
`bridge.isStub ? 'STUB BRIDGE' : 'TAURI'` (app.js:492) — states a falsehood on
any third host: an MSFS gauge would sit there annunciating `TAURI`, and the one
piece of chrome whose entire job is telling the user which host they are on
would be the piece that lies. A one-word string is also the cheapest possible
thing for an adapter to provide, so the cost of getting it right is a property
on an object that already exists. It stays *outside* the page contract because
no page has ever read it and none should: it is host identity, and a page that
branches on host identity is the exact coupling this run exists to remove —
the interface would stop being an abstraction the moment page logic could ask
which host it was running on. A third host renders whatever its adapter's
`hostLabel` says — `MSFS GAUGE` for the in-sim gauge — or `HOST` if it omits
the property, and `data-stub="false"` because it is not the stub.

Post-refactor, `boot()` (app.js:489–493) keeps both attributes:

```js
dom.bridgeMode.setAttribute('data-stub', bridge.isStub ? 'true' : 'false');
dom.bridgeMode.textContent = bridge.hostLabel;
```

`#bridge-mode` keeps its id and its `data-stub` attribute, and `data-stub` is
`'true'` under the stub host — `render-check.mjs:98` asserts exactly that, and
`index.html:119` ships the element with `data-stub="false"` as its initial
value. `createTauriBridge` sets `hostLabel: 'TAURI'` and the stub sets
`hostLabel: 'STUB BRIDGE'`, so the rendered text is unchanged on both existing
hosts.

### 4.6 The NETWORK scratchpad masking rule

Frozen: **stays shell-owned, unchanged, keyed on `state.pageId === 'NETWORK'`
(app.js:59–61). It is not an interface member and no page can turn it on or
off.**

It is a credential-handling rule, and its failure mode is a token painted into
the DOM in plain text. A page-declared flag (`page.maskEntry`) would read better
and would put the guarantee in the hands of whoever writes the next page; a
central rule in the shell is checkable in one place by the harness that already
checks it — `render-check.mjs:168–173` asserts the scratchpad shows 22 bullets
while a typed token is in the buffer and that the token appears nowhere in
`document.documentElement.textContent`, and line 197 asserts the same after a
save. A future page that needs masking adds its id to that rule in the shell,
deliberately, in the file the check covers. A third host inherits the masking
for free, because the scratchpad is shell DOM on every host.

### 4.7 `bridge.js`

Additive only. `findHost()` gains the `window.__FMC_HOST__` branch and a
validator, the module gains an `adoptHost()` that binds the ten methods,
`createTauriBridge` gains `hostLabel: 'TAURI'`, the stub gains
`hostLabel: 'STUB BRIDGE'`, and the export at bridge.js:240 selects among three
outcomes instead of two. The `COMMANDS` and `EVENTS` tables (bridge.js:13–28),
the file's path, the stub's shape and `window.__FMC_STUB__` are untouched
(§5.4).

## 5. Enforcement and verification

### 5.1 `windows-client/ui/tools/boundary-check.mjs`

A static checker. It reads **only** application source — every `.js` file under
`windows-client/ui/src/`, recursively — and reads no run artifact, no
`node_modules`, and no test tool. It needs **no browser and no server**. It
prints one `PASS <rule>: <detail>` or `FAIL <rule>: <locations> — <message>` line
per rule in the style of `windows-client/tools/contract-check.mjs`, exits `0`
when every rule passes and `1` if any rule fails. Locations are printed as
`ui/src/<file>:<line>`.

Every rule is (scanned set, violating pattern, message). No judgement calls.

| Rule | Scanned | A violation is | Failure message |
|---|---|---|---|
| `bridge-import` | all files | a line matching `/(from\s*['"][^'"]*\/bridge\.js['"]\|import\(\s*['"][^'"]*\/bridge\.js['"])/` in any file other than `ui/src/app.js` | `FAIL bridge-import: <loc> — only ui/src/app.js may import ./bridge.js` |
| `tauri-reference` | all files | a line matching `/__TAURI__\|__TAURI_INTERNALS__/` in any file other than `ui/src/bridge.js` | `FAIL tauri-reference: <loc> — only ui/src/bridge.js may mention Tauri` |
| `host-global` | all files | a line matching `/__FMC_HOST__\|__FMC_STUB__/` in any file other than `ui/src/bridge.js` | `FAIL host-global: <loc> — only ui/src/bridge.js may resolve or publish a host` |
| `page-adapter` | `ui/src/pages/**` | a line matching `/\bbridge\b/` | `FAIL page-adapter: <loc> — a page may not name the adapter; use ctx.fmc` |
| `page-global` | `ui/src/pages/**` | a line matching `/\bFMC\b/` | `FAIL page-global: <loc> — a page receives the interface via register(fmc)/ctx.fmc, not a global` |
| `page-events` | `ui/src/pages/**` | a line matching `/\.\s*(onLog\|onExit)\s*\(/` | `FAIL page-events: <loc> — the shell owns host event subscriptions` |
| `adapter-leak` | `ui/src/app.js` | a line matching `/^\s*bridge,\s*$\|\bbridge\s*:/` | `FAIL adapter-leak: <loc> — the adapter must not be a member of window.FMC or the page context` |
| `interface-members` | `ui/src/app.js` | any of the thirteen §2.2 names absent as a property line (`/^\s*<name>[,:]/`) | `FAIL interface-members: <names> missing from the interface built in ui/src/app.js` |

Two notes for the implementer, both from running these rules during design:

- `bridge-import` must also fail if `ui/src/app.js` contains **zero** matches —
  otherwise deleting the import passes the rule.
- `page-adapter` deliberately matches the bare word, which catches
  `fmc.bridge.setConfig`, `ctx.bridge`, and an import alias in one pattern.

Run against this checkout **before** the refactor, the rule set produces exactly
the four failures quoted in §1.3 (`page-adapter` pages/index.js:155,
`page-global` pages/index.js:3, `adapter-leak` app.js:123 and app.js:504) plus
`interface-members` for the five members that do not exist yet. Against the
prototype of the refactored tree (§6.5) it exits 0 with eight `PASS` lines. If
the implementer's version does not reproduce both of those, the rules were
written differently from this table.

### 5.2 The must-not-change list

Checked one by one by the Reviewer, by re-running the evidence.

1. **`window.FMC` member names `render-check.mjs` calls** — `showPage`
   (render-check.mjs:68), `setScratchpad` (73, 164), `getScratchpad` (167),
   `getConfigCache` (97, 217, 237), `getStatus` (244), `refreshConfig`
   (221, 243). All eight pre-existing members of §4.3 keep their names and
   behaviour; only `bridge` is removed.
2. **`window.__FMC_STUB__` and its recorded method names** — the stub object
   (bridge.js:128–236, published at bridge.js:234) keeps `config`, `status`,
   `calls`, `setConfigResult`, `emitStatus`, `emitLog`, `emitExit`, and
   `calls[].method` keeps the value `'setConfig'` that render-check.mjs filters
   on (76, 193, 200, 201). Also read by the harness: `__FMC_STUB__.config`
   (198, 219, 239–244) and `setConfigResult` (203).
3. **`windows-client/ui/src/bridge.js` keeps that exact path** —
   `contract-check.mjs:21` hardcodes `ui/src/bridge.js` and reads it directly.
4. **The quoted command and event literals in `bridge.js`** —
   `contract-check.mjs:6–7` greps that file for all ten of `config_get`,
   `config_set`, `config_path`, `uplink_start`, `uplink_stop`,
   `sidecar_restart`, `status_get`, `sidecar:status`, `sidecar:log`,
   `sidecar:exit`, each as a quoted string, and cross-checks each against
   `src-tauri/**`. They live in `COMMANDS`/`EVENTS` (bridge.js:13–28) and none
   of them moves, changes quoting, or is templated. *(The run's task record
   lists nine; the tool checks ten — `status_get` is in `COMMANDS` at
   contract-check.mjs:6 and bridge.js:20.)*
5. **Frozen DOM hooks** — `#fmc-screen` with `data-page` (render-check.mjs:69,
   211–213), `#scratchpad` with `data-message-kind` (81), `#bridge-mode` with
   `data-stub` (98; index.html:119), `[data-field-value]` (153, 172, 185, 188,
   223, 224, 247) and `[data-config-feedback]` (pages/index.js:70, 185). Also
   unchanged: `#page-title`, `#page-number`, `#page-body`, `#msg-line`, the
   `#status-*` lines, `#uplink-prompt`, `#restart-prompt`,
   `[data-page-view="STATUS"]` (index.html:36) and every `[data-lsk]` /
   `[data-key]`.
6. **Behaviour** — the STATUS page's LSK map; `COMMAND FAILED` on a failed
   command; `SAVE FAILED` on both a refused and a rejected write;
   `CONFIG SAVED`; `PAGE UNAVAILABLE` on a failed lazy import;
   `KEY NOT ACTIVE`; `NOT ALLOWED` on STATUS L1–L5; CFG `PREV`/`NEXT` wrap;
   the retry countdown ticking locally once a second; the NETWORK masking rule
   (§4.6); the token never appearing in `document.documentElement.textContent`
   and never being sent when untouched.
7. **`index.html`, `css/**` and `ui/src/status.js` are not modified by this
   run**, and neither is anything outside `windows-client/ui/` (§1.2).

### 5.3 The host-swap check — `windows-client/ui/tools/host-swap-check.mjs`

This is the evidence for the definition of done's "a future host can implement
this without page-code changes". It serves `ui/` from a scratch port on
`127.0.0.1` (never 3000), installs a **synthetic adapter** — neither Tauri nor
the stub — and drives the real pages.

- **Installation**: `page.evaluateOnNewDocument(fn)` before `page.goto(...)`,
  where `fn` assigns `window.__FMC_HOST__` (§3.4) and a separate
  `window.__SYNTH__ = { calls, emitStatus }` for the assertions. Installing at
  document-start is required: `bridge.js` resolves the host at module evaluation
  (bridge.js:238).
- **Recorded**: every one of the ten §3.3 methods, as `{ method, args }`, in call
  order. `setConfig` also applies the patch to the synthetic store so the panel's
  post-save re-read behaves like a real host.
- **Asserted, in order**:
  1. `'__FMC_STUB__' in window === false` and
     `('__TAURI__' in window || '__TAURI_INTERNALS__' in window) === false` —
     the panel is running on neither shipped host.
  2. `#bridge-mode` text is the synthetic `hostLabel` and its `data-stub` is
     `'false'` (§4.5).
  3. Boot reached `getConfig`, `getConfigPath`, `getStatus`, `onStatus`,
     `onLog`, `onExit`.
  4. **STATUS uplink toggle**: emit `app.stopped`, click `[data-lsk="R6"]` →
     `startUplink` recorded; emit `app.running`, click `R6` → `stopUplink`
     recorded.
  5. **STATUS sidecar restart**: emit `app.crashed`, click `[data-lsk="R5"]` →
     `restartSidecar` recorded.
  6. **One CFG page save**: `showPage('NETWORK')`, type a token onto the
     scratchpad, `L2`, `R6` → scratchpad reaches `CONFIG SAVED` and the last
     recorded `setConfig` carries that token and the canonical field set.
  7. No `pageerror` and no `console.error` for the whole run.
- Exit `0` / `1`, `PASS`/`FAIL` lines, browser and server closed in a `finally`.
  It takes no output directory and writes no screenshots.

### 5.4 Verification commands

Copy-pasteable, from the repo. Node 20 is mandatory (`.claude/ENVIRONMENT.md`);
`puppeteer` resolves from the repo-root `node_modules/`, which is why these tools
must be run from inside the checkout.

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
cd /home/guilherme/msfslogger/windows-client

node tools/contract-check.mjs
node ui/tools/boundary-check.mjs
node ui/tools/host-swap-check.mjs
node ui/tools/render-check.mjs "$SCRATCH/render-check"
```

`render-check.mjs` **must** be given an explicit output directory. With no
argument it resolves `.claude/runs/2026-09-11-tauri-windows-client/prototypes`
(render-check.mjs:12) relative to the current directory and overwrites another
run's committed screenshots. Use the session scratchpad — e.g.
`SCRATCH=/tmp/claude-1000/<session>/scratchpad` — and never a path inside
`.claude/runs/`. All four tools use scratch ports on `127.0.0.1` and never touch
port 3000, `flights.db`, or the user's running server.

Expected: `contract-check` 10 `PASS` lines; `boundary-check` 8 `PASS` lines;
`host-swap-check` 5 `PASS` lines; `render-check` its existing ~50 `PASS` lines
ending with `PASS browser errors: none`. Any `FAIL` line, or a non-zero exit, is
a failed task.

## 6. Alternatives considered and risks

### 6.1 Interface delivery to pages (decision a)

| Option | Rejected because |
|---|---|
| **Global only** — keep `const fmc = window.FMC` at page module top level (pages/index.js:3) | It works today only because the lazy import happens after `boot()`; a statically-imported page module (the STATUS page needs to be one, §4.1) evaluates *before* `window.FMC` exists, and the failure is a `TypeError` at boot with a blank panel. It also assumes every host loads page modules into the same realm with the same global — the assumption a Coherent-GT gauge is most likely to break. |
| **Context only** — pass the interface exclusively through `ctx` | A page cannot receive a `ctx` before it is registered, and registration is the first thing a page module does. There is no bootstrap path. |
| **Chosen: injection at registration (`register(fmc)`) plus `ctx.fmc`** | Registration gets the interface as an argument, which is loader-independent; callbacks get the same object without module state; and `FMC` becoming a forbidden token inside `ui/src/pages/**` turns "pages do not use ambient globals" into a grep (§5.1). Cost: `pages/index.js` grows a wrapper function and `app.js` calls `register` in two places. |

### 6.2 STATUS page placement (decision b)

| Option | Rejected because |
|---|---|
| **Leave STATUS inline in `app.js`** and just route its three calls through the interface | It fixes the symptom and leaves the hole: `app.js` is the one file allowed to hold the adapter, so a future edit to the inline page can reach `bridge` again and every checker in §5.1 will pass. The four violations the rule set finds today do *not* include those three calls, for exactly this reason. |
| **Move STATUS into the lazy `pages/index.js` bundle** | STATUS is the launch page (app.js:509). Making it lazy puts a dynamic import on the boot path and a `PAGE UNAVAILABLE` panel one failed fetch away from being all the user ever sees. |
| **Chosen: `ui/src/pages/status-page.js`, statically imported, registered in `boot()`** | One directory, one rule, no boot-path import failure. Cost: the parked-view capture timing (§4.1) is a real trap, and `paintStatus` stops repainting a detached element — both are called out in §4.1 for the implementer. |

### 6.3 The bridge-mode label (decision c)

| Option | Rejected because |
|---|---|
| **Freeze as shell-only chrome, leave `isStub ? 'STUB BRIDGE' : 'TAURI'`** | Zero cost, and wrong on the first day the second host exists: the annunciator whose only job is naming the host would name the wrong one. |
| **Expose the host name to pages** so a page can adapt its layout | That is the coupling this run removes. A page that can ask which host it is on will grow a branch per host, and the "same CDU logic in both hosts" property dies quietly. |
| **Chosen: `hostLabel` on the adapter, rendered by the shell, unreadable by pages** | One string property on an object that already exists; `data-stub` unchanged for the harness; page contract unchanged (§4.5). |

### 6.4 Enforcement

| Option | Rejected because |
|---|---|
| **Leave the boundary as convention** — write it down in §2/§3 and let review enforce it | This is what the previous run did: `2026-09-11-tauri-windows-client` §5.2 already froze "only `bridge.js` mentions Tauri", and it held — because it is one grep anyone can run. The rules it did *not* reduce to a grep are the ones that drifted: `ctx.bridge`, `fmc.bridge.setConfig`, and three direct `bridge` calls in a page. A convention that costs a reviewer attention is a convention that is checked when the reviewer has attention to spare. |
| **A lint rule / ESLint config** | `windows-client/ui` has no build step, no `package.json` and no dependencies by deliberate design. A 60-line Node script with no dependencies matches what `tools/contract-check.mjs` already does and keeps that property. |
| **Chosen: `boundary-check.mjs` (static) + `host-swap-check.mjs` (behavioural)** | The static tool proves no page *can* reach the host; the host-swap tool proves the interface is *sufficient* — a boundary nobody can cross is worthless if the legal side cannot do the job. |

### 6.5 Prototypes — what was run, and what it showed

All prototyping was done on a copy of `windows-client/ui/` in the session
scratchpad; no file in the repo was modified. The copy carried the whole
refactor described in §4 (STATUS moved to `pages/status-page.js`,
`register(fmc)` injection, `ctx.bridge` and `FMC.bridge` removed, the five new
interface members, `hostLabel`, the `__FMC_HOST__` branch in `findHost`).

1. **The unmodified `render-check.mjs`, run against the refactored copy, passes
   end to end** — every status state, the CFG save path, the token-masking
   assertions, first-run, invalid-object-repair, window-minimum, and
   `PASS browser errors: none`. The refactor in §4 is therefore known to be
   behaviour-preserving against the harness that guards it, not merely intended
   to be.
2. **The host-swap check passes against a synthetic adapter** installed with
   `evaluateOnNewDocument`:
   `PASS host: synthetic adapter adopted; no stub, no Tauri; label SYNTH HOST`,
   `PASS boot: onStatus, onLog, onExit, getConfig, getStatus, getConfigPath`,
   `PASS STATUS: startUplink, stopUplink, restartSidecar landed on the synthetic host`,
   `PASS NETWORK: setConfig reached the synthetic host with 8 keys`,
   `PASS browser errors: none`. This is the §3.4 seam and the §3.3 contract
   demonstrated, not assumed.
3. **The §5.1 rule set was run against both trees**: four rule failures on the
   current checkout at the exact lines quoted in §1.3, eight `PASS` lines and
   exit 0 on the refactored copy.
4. **Baseline**: `tools/contract-check.mjs` (10 `PASS`) and
   `ui/tools/render-check.mjs` both pass on the unmodified checkout, so any
   failure after the refactor is the refactor's.

### 6.6 Risks

| Risk | What it looks like | What would falsify the design |
|---|---|---|
| **Coherent GT is not a modern-ESM host.** The panel ships native `<script type="module">` and a dynamic `import()`. If the in-sim webview does not support them, the gauge needs a bundling step. | The MSFS adapter work discovers it must bundle `ui/src/**`. | Nothing here breaks: `register(fmc)` injection is bundler-safe precisely because it does not depend on evaluation order of a global, and `__FMC_HOST__` is a plain global assignment. This risk is why §6.1 rejected the global-only option. |
| **`window.__FMC_HOST__` may not be the shape the real gauge finds convenient.** A Coherent host might prefer to supply a low-level `{ invoke, listen }` pair and let `bridge.js` build the adapter. | The MSFS adapter re-implements ten thin methods over one `invoke`. | If it does, add a *second* accepted shape in `findHost()` rather than changing this one — §3.3 is already the boundary, and ten thin methods is a small cost paid once. |
| **The parked-view capture timing (§4.1)** is a silent failure: query it a moment too late and STATUS renders nothing, on a panel whose whole purpose is being reachable. | `#status-app` empty after the first navigation away and back. | `render-check.mjs` covers it — `show('STATUS')` at window-minimum asserts all four axes are non-empty with non-zero height. The prototype (§6.5) passed it. |
| **`boundary-check.mjs` greps text, not syntax.** `bridge` inside a comment or a string in a page file fails the build; a cleverly aliased import would not be caught by `page-adapter` alone. | A spurious `FAIL page-adapter` on a comment. | `page-import` coverage is not in the rule table on purpose — `bridge-import` already catches any import of `bridge.js` from anywhere but `app.js`, and an alias cannot be created without one. A false positive on a comment is the intended trade: it is one word to reword. |
| **The interface is frozen before a second host exists.** The first real MSFS adapter may want a member that is not here (e.g. a host-side notion of "is the sim running"). | The gauge work returns asking for a new member. | Additive: new members are added to §2.2 and §3.3 as an amendment in §0, with a default in `adoptHost` so existing adapters keep working. Nothing in this design requires a member to be removed. |
