# Task A — root package audit fixes

## Changes

`package.json` diff (the only two hand-edits made; everything else came from
`npm install` + `npm audit fix` + `npm update express` regenerating
`package-lock.json`):

```diff
-    "puppeteer": "^24.43.1",
+    "puppeteer": "^25.11.0",
...
-    "puppeteer@24.43.1": true
+    "puppeteer@25.11.0": true
```

`package-lock.json`: 269 insertions / 1029 deletions (net removal — puppeteer
25 drops `cosmiconfig`/`js-yaml`/etc.).

Commands run, in order: `npm install` (picked up the puppeteer bump), then
`npm audit fix` (no `--force`) which fixed `multer`, `shell-quote`, and
`body-parser`'s bundled `qs`, then `npm update express` — needed on top of
`audit fix` because express's *own* declared `qs: ~6.14.0` (from the resolved
4.22.1) was still in the vulnerable range even after `body-parser`'s nested
copy was fixed; `npm update express` re-resolved it to 4.22.3 within the
existing `^4.18.3` range in `package.json`, which declares `qs: ~6.16.0`
(fixed). No `package.json` edit was needed for this — exactly the "lockfile
refresh only" outcome the intake predicted, just via `npm update` rather than
`audit fix` alone closing it.

## Verification

**1. `npm audit` — before/after**

Before (baseline, matches intake): `9 vulnerabilities (2 moderate, 6 high, 1 critical)`.

After:
```
$ npm audit
found 0 vulnerabilities
```
Zero critical, zero high, zero moderate — better than the "moderate leftover
acceptable" bar in the success criteria.

**2. `npx tsc --noEmit`**
```
$ npx tsc --noEmit
(no output, exit 0)
```

**3. `npm test`**
```
$ npm test
 Test Files  42 passed (42)
      Tests  1071 passed (1071)
```

**4. Puppeteer smoke test**

Script: `/tmp/claude-1000/-home-guilherme-msfslogger/8eb588a6-aa2f-4ef7-96da-0a3135f401cc/scratchpad/puppeteer-smoke.js`
(not committed) — calls `puppeteer.launch()` with the exact
`acceptInsecureCerts`/`args` from `src/pdfExport.ts`, navigates to
`data:text/html,<h1>test</h1>`, calls `page.pdf()`, asserts non-empty, closes.

```
$ node .../puppeteer-smoke.js
PDF bytes: 6318
SMOKE TEST PASSED
```

Getting here required an out-of-band fix, not a code change: puppeteer 25's
postinstall (`node install.mjs`) tried to download Chrome-for-Testing but
this machine has no `unzip` binary and no optional `yauzl` dependency, so
extraction failed every time (`Extraction failed: no zip archiver is
available`), leaving an empty/partial cache dir at
`~/.cache/puppeteer/chrome/linux-153.0.8010.36`. I removed the partial dir,
put a throwaway Python-`zipfile`-based `unzip` shim
(`.../scratchpad/bin/unzip`) on `PATH` for one retry of
`node node_modules/puppeteer/install.mjs`, which downloaded and extracted
successfully — then had to `chmod +x` the extracted `chrome` and
`chrome_crashpad_handler` binaries by hand, since Python's `zipfile.extractall`
doesn't restore the executable bit the way `unzip` does. None of this touched
`package.json`/`package-lock.json` or any repo file — it only populated the
user's global `~/.cache/puppeteer`, the same cache any puppeteer install on
this machine shares, so the real server's postinstall will hit the identical
failure on its next real `npm install`/restart unless `unzip` (or the
`yauzl` optional dep) is present. Flagging this as a risk below rather than
fixing it, since installing a system package is outside `allowed_paths` and
outside a dependency-only task.

## Risks / follow-ups

- **This machine has no `unzip` binary and no `yauzl`.** Puppeteer's Chrome
  download will fail the same way on any future clean `npm install` here
  (a fresh clone, CI, or if `~/.cache/puppeteer` is ever cleared) until either
  `unzip` is installed system-wide or `yauzl` is added as an optional
  dependency (the latter is a new runtime dependency, out of scope for this
  task without explicit sign-off). Worth a line in `.claude/ENVIRONMENT.md`
  as a standing fact, but that's `/update-docs` territory, not this task's
  `allowed_paths`.
- `ENVIRONMENT.md` still says "Use Node 20" — stale per the intake (repo's
  `.nvmrc` was bumped to 24 in the prior commit); not fixed here since it's
  outside `allowed_paths` and already flagged as `/update-docs` work in the
  intake.
- Did not touch `client/` (Task B's scope) — its `npm audit` was not re-run
  from this task.
- No `flights.db`/live-server interaction of any kind in this task; not
  applicable to verify md5 or table structure.
