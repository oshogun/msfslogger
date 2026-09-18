# Review — Task B (client package npm audit fixes)

**Verdict: approve.** 5 of 5 acceptance criteria verified independently, 0
claimed-but-unverified. No blocking findings. 2 non-blocking follow-ups.

Run: `2026-09-18-npm-audit-fixes` · Reviewer re-ran every command below under
Node 24 (`v24.21.0`). The implementer's report was not read except its
`Risks / assumptions` section.

## Criteria verified

**1. Diff scope — PASS.** `git diff -- client/package.json` is exactly the two
claimed bumps, nothing else:

```
-    "vite": "^5.3.4",
-    "vitest": "^3.2.7"
+    "vite": "^6.4.3",
+    "vitest": "^4.1.11"
```

`git status --porcelain` shows only `client/package.json`,
`client/package-lock.json` (Task B's `allowed_paths`) plus `package.json`,
`package-lock.json` (Task A's, not this task's). No source, config, `dist/`, or
test file touched. `@vitejs/plugin-react` left at `^4.3.1` as scoped.

**2. `npm audit` in `client/` — PASS** (0 critical, 0 high):

```
2 moderate severity vulnerabilities
```

The leftovers are exactly what the report names — `react-router` /
`react-router-dom` (GHSA-wrjc-x8rr-h8h6 open redirect, GHSA-337j-9hxr-rhxg
constructor injection), advisory range `6.0.0 - 7.17.0`, `fix available via npm
audit fix --force → react-router-dom@7.18.4, which is a breaking change`.
Nothing worse is being glossed over: no high/critical entry of any kind, and
the previously-flagged `vite`, `esbuild`, `vitest`, `@vitest/mocker`,
`browserslist`, `postcss`, `nanoid`, `@babel/core` findings are all gone from
the report.

**3. `npm run test:types` — PASS.** `tsc -p tsconfig.test.json` produced no
output (clean exit).

**4. `npm test` — PASS**, matching the claimed counts exactly:

```
 Test Files  7 passed (7)
      Tests  29 passed (29)
```

**5. Lockfile resolved versions — PASS.** Read out of
`client/package-lock.json` (lockfileVersion 3):

| package | resolved |
|---|---|
| `vite` | `6.4.3` |
| `vitest` | `4.1.11` |
| `@vitest/mocker` | `4.1.11` |
| `esbuild` | `0.25.12` |
| `@vitejs/plugin-react` | `4.7.0` |
| `react-router-dom` / `react-router` | `6.30.6` |

`npm ls vite vitest @vitejs/plugin-react` shows a single deduped `vite@6.4.3`
under all three consumers — no duplicate vite trees, no unmet peer warnings.

**6. Build — PASS, verified independently in scratch, live `dist/` untouched.**
Copied `client/` (minus `node_modules`/`dist`) to
`…/scratchpad/rev-b`, `npm ci`, `npx vite build` **there**:

```
vite v6.4.3 building for production...
✓ 107 modules transformed.
dist/assets/index-rwrMAS4t.js   435.47 kB │ gzip: 129.69 kB
✓ built in 2.19s
```

The real `client/dist/index.html` mtime is `2026-09-18 15:13:36` both before
and after my review — 3.5 hours *older* than the Task B edits
(`client/package.json` 18:44:16, `client/package-lock.json` 18:44:56), so
nothing in this task or this review emitted into the live tree. Scratch dir
removed. The user's server still answers `200` on
`https://localhost:3000/login`; never stopped, restarted, or rebuilt.

**7. Intake reasoning — CONFIRMED independently**, not taken on trust:

- `vite@6.4.3` is the minimal fix, not `8.3.0`. The pre-bump audit JSON records
  `vite high <=6.4.2` — `6.4.3` is the first fixed release, and npm's
  `fixAvailable: 8.3.0` was indeed latest-overall rather than minimal.
- `esbuild` advisory range was `<=0.24.2`; resolved `0.25.12` clears it.
- `vitest` / `@vitest/mocker` vulnerable range `2.1.0 - 4.1.10` — `4.1.11` is
  the minimal fix, and no 3.x release is fixed, so the 3→4 major was genuinely
  required.
- `npm view @vitejs/plugin-react@4.7.0 peerDependencies` →
  `{ vite: '^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0' }`. Supports vite 6; leaving
  its range alone is correct.
- `npm view vitest@4.1.11 peerDependencies.vite` →
  `^6.0.0 || ^7.0.0 || ^8.0.0`. Consistent with the vite 6 bump and
  incompatible with the old vite 5 — the two bumps had to land together, and
  they did.

One correction to the intake's *expectation* (not to the implementation): the
intake predicted the `react-router` advisories were "all fixed within the 6.x
line (`6.30.6`)". They are not — the advisory range extends to `7.17.0`, so
`6.30.6` still matches. The implementer correctly reported the two survivors
instead of claiming a clean audit. No finding against Task B.

## Design conformance / must-not-change

No `design.md` for this run (tier-2, no contract) — conformance checked against
`intake.md` § Tasks and § Success criteria, all met. Standing must-not-change
items: live `client/dist` unmodified (mtime evidence above), live server
untouched (read-only `curl` only), no `dist/`/`flights.db` edit from this task.
`vite.config.ts` and `vitest.config.ts` required no migration and were not
modified — confirmed by `git status` and by the suite passing under vitest 4.

`flights.db` md5 moved during the review window (`f248a9bc…` → `6de12f35…`).
This is the live server's own WAL checkpointing, which `ENVIRONMENT.md`
documents as happening with no writes from any task; Task B is client-only and
neither it nor this review opened the database in write mode. Smoke check, not
a finding.

## Findings

None blocking.

## Non-blocking follow-ups

1. **2 moderate `react-router` advisories remain** and cannot be cleared inside
   the 6.x line — the fix is `react-router-dom@7.x`, a breaking change touching
   route definitions across `client/src`. Correctly out of scope here; worth its
   own run.
2. **`esbuild@0.25.12` postinstall is not in an `allowScripts` allowlist** —
   `npm warn install-scripts` fires on every install in `client/`. Harmless
   today (the `@esbuild/linux-x64` binary is present and the scratch build
   worked), and `client/package.json` has no `allowScripts` key at all, unlike
   root. If the project standardises on the allowlist, `client/` should get one.
