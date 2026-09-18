# Review — Task A (root package npm audit fixes)

**Verdict: approve** — no blocking findings.

Reviewed: `2026-09-18-npm-audit-fixes`, Task A, `backend_sr`.
All evidence below was re-run independently under Node 24 (`v24.21.0`). The
implementer's report was not read except its `risks` list.

**Criteria verified independently: 6 of 6 claimed. 0 could not be verified.**

## Criteria

| # | Criterion | Command | Result |
|---|---|---|---|
| 1 | `package.json` diff is exactly the puppeteer bump + allowScripts rename | `git diff -- package.json` | PASS — 2 hunks, 2 changed lines, nothing else |
| 2 | Lockfile diff is dependency-only | `git diff -U0 -- package-lock.json` | PASS — `269 insertions(+), 1029 deletions(-)`, all dep-graph entries; `lockfileVersion` unchanged |
| 3 | `npm audit` clean | `npm audit` | PASS — `found 0 vulnerabilities` |
| 4 | Typecheck clean | `npx tsc --noEmit` | PASS — exit 0, no output |
| 5 | Test suite passes | `npm test` | PASS — `Test Files 42 passed (42)` / `Tests 1071 passed (1071)` — matches claim exactly |
| 6 | Puppeteer still works post-bump | own scratch script, `pdfExport.ts`'s exact launch args | PASS — `browser version: Chrome/153.0.8010.36`, `PDF bytes: 14889 magic: %PDF-` |

Resolved versions confirm each advisory was fixed by the route the intake
predicted, not by an unplanned bump:

    puppeteer=25.11.0  puppeteer-core=25.11.0  @puppeteer/browsers=3.2.2
    multer=2.4.0       express=4.22.3          shell-quote=1.10.0

## Scope and hygiene

- Changed files are `package.json` + `package-lock.json` only — inside
  `allowed_paths`. (`client/package*.json` are also modified; those are Task B's
  and out of this review.)
- `git diff -- src/pdfExport.ts` is empty. No file under `src/`, `tests/` or
  `agent/` was touched; the smoke test was a throwaway script as claimed.
- No untracked files left in the repo; no Chrome/zip artifacts anywhere under
  the repo or `node_modules/puppeteer`.
- `flights.db` md5 `6de12f35a85eaa7177bb83a6dfeea99d` before and after;
  `max(flights.id)=93, count=56`. Live server never contacted. No `npm run build`.
- No code comments added or edited, so the no-run-citations rule is not engaged.

## The `unzip` finding — evaluated, non-blocking

The reported risk is real, and it **is newly introduced by this bump** — but it
does not break anything today and its remedy is outside this task.

**It is new in puppeteer 25**, confirmed from both trees:

- old `@puppeteer/browsers@2.13.2` declared `"extract-zip": "^2.0.1"` as a hard
  dependency (pure-JS zip via `yauzl`) — no native binary needed.
- new `@puppeteer/browsers@3.2.2` declares only `modern-tar` + `yargs`, and
  `lib/fileUtil.js:251` shells out to `execFileAsync('unzip', ...)`, with `yauzl`
  demoted to an *optional* import.

Note the irony worth telling the user: dropping `extract-zip` is precisely how
the `extract-zip` high advisory got cleared. The fix and the hazard are the same
change — there is no version of this remediation that keeps the JS extractor.

**Reproduction** (scratch dir, isolated `PUPPETEER_CACHE_DIR`, since removed):

    cd <scratch> && npm install puppeteer@25.11.0
    PUPPETEER_CACHE_DIR=<scratch>/cache node node_modules/puppeteer/install.mjs
    # → Extraction failed: no zip archiver is available. Install `unzip`
    #   (or `tar.exe`/Powershell on Windows), or add the optional `yauzl` dependency.
    # === postinstall EXIT CODE: 0 ===
    # cache/chrome/linux-153.0.8010.36/ created but EMPTY, no chrome binary

The failure is loud on stderr but **exits 0**, so `npm install` reports success
while leaving no browser binary — PDF export would then fail at first runtime use.

**Why it is not blocking:**

1. It does not break this machine *right now*. `npx puppeteer browsers list`
   shows `chrome@153.0.8010.36` and `chrome-headless-shell@153.0.8010.36` fully
   installed in `~/.cache/puppeteer`, binary `-rwxrwxr-x`, 293 MB — the executable
   bit survived the Python-shim extraction, which is why my independent smoke
   test launched a real Chrome. A re-install finds them present and no-ops. The
   hazard only fires if the cache is cleared or on a fresh machine.
2. The workaround touched only the global cache, as claimed — verified: no Chrome
   or zip artifacts under the repo or `node_modules`, no untracked repo files, and
   `~/.cache/puppeteer` is outside the tree. It does not misrepresent a real
   `npm install`'s *content* (the extracted Chrome is byte-correct and runnable),
   only its *reachability without `unzip`*.
3. CI is unaffected: `.github/workflows/ci.yml` runs `npm ci`, and GitHub's
   ubuntu runners ship `unzip`. CI also never exercises a browser —
   `tests/pdfExport.test.ts` covers only the no-browser subset.
4. Every acceptance criterion in `intake.md` passes. The intake's criteria do not
   include fresh-clone installability, and the remedy is either a system package
   (`apt install unzip`, outside the repo entirely) or adding `yauzl` as a new
   optional dependency — a new dependency that needs the user's sign-off. The
   implementer was right to stop and flag rather than add it unilaterally.

This is a **flag-for-the-user** matter, not a defect in the diff.

## Follow-ups (non-blocking)

1. **Decide the `unzip` remedy with the user.** Either `sudo apt install unzip`
   on this machine (fixes it globally, no repo change), or add
   `"optionalDependencies": {"yauzl": "^3"}` to `package.json` (fixes it for
   every clone and for CI, but adds a dependency). Until one is done, a cleared
   `~/.cache/puppeteer` or a fresh clone yields a silently browser-less puppeteer.
   Worth a standing line in `.claude/ENVIRONMENT.md` either way.
2. `~/.cache/puppeteer` still holds the now-unused `148.0.7778.97` pair from
   puppeteer 24 (~600 MB with its headless shell). Reclaimable, but do **not**
   run `npx puppeteer browsers clear` — that would wipe 153 too and, without
   `unzip`, it could not be re-downloaded. Prune the 148 directories by hand.
3. `.claude/ENVIRONMENT.md` still says "Use Node 20" while `.nvmrc` pins 24
   (already noted in the intake as `/update-docs` work).
4. Task B (`client/`) is still unreviewed; its `npm audit` was correctly not
   re-run from Task A.
