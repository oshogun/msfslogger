# Review — phase 1 design freeze (T-002)

**Round 2 verdict: approve.** All eight round-1 items are fixed in the amended
design.md (A1–A7), and I re-derived each fix rather than reading the Designer's
report: the `git ls-files` flags, the Node guard and the backend suite were
executed here, the rest read from the amended sections. One new non-blocking
sequencing note (N7) and one disclosed boundary exception (below) are recorded
for the Orchestrator; neither sends the task back.

Round 1 verdict was `request_changes` (one blocking, five non-blocking, one
"taken on trust"); its criteria verification is archived at the bottom and still
stands — the amendments touched none of it.

## Round 2: each finding re-derived

| # | Fix claimed | Verdict | Evidence I produced |
| --- | --- | --- | --- |
| **B1** | §4.1 step 4 now uses `git ls-files --cached --others --exclude-standard` | **fixed** | Probe repo (git 2.43.0) seeded with the repo's real `.gitignore`, one tracked `src/tracked.ts`, untracked `src/testSeed.ts`, and ignored `flights.db`, `client/dist/index.html`, `client/node_modules/foo/index.js`. Bare form → `package.json`, `src/tracked.ts`. Amended form → adds `src/testSeed.ts` and **no** ignored path. So the seed reaches `$SCRATCH` uncommitted, and `flights.db`/`dist/`/`node_modules/` still cannot ride along. §4.1 also now spells out why each of the three flags is load-bearing and marks `--exclude-standard` as never-drop. |
| **N1** | Node-major guard | **fixed** | §4.4 guard 5, cross-referenced from §4.1 step 2 and the §4.6 table. I executed the frozen snippet verbatim: default node → `want=20 have=26 -> refuse`; after `nvm use 20` → `want=20 have=20 -> pass`. `.nvmrc` reads `20`, and `tr -dc '0-9' … head -c 2` still yields `20` if the pin later becomes `20.11.1`. Correctly refuses rather than sourcing nvm itself. |
| **N2** | `PORT` assigned from `MSFSLOGGER_E2E_PORT` | **fixed** | §4.1 step 1: `PORT="${MSFSLOGGER_E2E_PORT:-3210}"`, with an explicit rule that an inherited `PORT` is ignored and the reason (guard 1 only catches 3000). Matches §2.2's `baseURL`, which reads the same single variable. |
| **N3** | ci.yml step count | **fixed** | §5 preamble, §5.1 and must-not-change 10 all now say "two bare `uses:` setup actions … plus five named steps" and name all five. Matches `.github/workflows/ci.yml` as it stands. |
| **N4** | "existing three" client scripts | **fixed** | §1.5: "do not reorder or rewrite the three that are already there (`dev`, `build`, `preview`)" — matches `client/package.json`. |
| **N5** | §3.3 determinism claim narrowed | **fixed** | §3.3 now claims row-level equality of the rendered fixture, and names what legitimately differs: `auth_user`/`app_setting` timestamps (`src/db/settings.ts:30,57,83`) and the per-call scrypt salt in the password hash, with "the file is **not** byte-identical run to run and no test may assert that it is". The supporting facts are the ones I verified in round 1. |
| **N6** | citation comment removed from `vitest.config.ts:1` | **fixed** | `git diff vitest.config.ts` → the old `// … see design §3.2.` line replaced by five lines of self-contained reasoning (why CommonJS, what breaks if someone "fixes" it). No `§`, run-id, `design.md`, task-id or phase-file reference remains. `git diff --stat` → `5 insertions(+), 1 deletion(-)`, comment lines only. I re-ran the suite myself: **38 files, 850/850 passed, 3.74 s**, no CJS/ESM warning in the output. |
| **A7** | `webServer`/`globalSetup` ordering no longer assumed | **fixed** | §2.3 `globalSetup` now calls `waitForServer()` — polls `GET /login` every 500 ms up to 180 s (matched to `webServer.timeout`) and throws a message naming the last error — *before* the login POST, so it is correct under either start order. §2.2 records the two as belt-and-braces; Risks 9 states the ordering is undocumented, unreproducible without Playwright installed, mitigated rather than merely noted, and asks **T-005 to report whether the poll ever iterates** on the first real run. That is the right disposition for an assumption I could not test. |

## N7 (new, non-blocking) — the `.gitignore` append now has to land early

A1's `--others` is correct, but it interacts with §1.6: the three ignore entries
(`client/e2e/.auth/`, `client/playwright-report/`, `client/test-results/`) are
assigned to devops, whose task (T-010) is in phase 4. Until those lines exist,
`--others --exclude-standard` sweeps the previous run's artifacts into the
scratch tree on every phase-2/3 run. Reproduced in the same probe: with the
current `.gitignore`, the amended form listed `client/test-results/trace.zip`
and `client/e2e/.auth/operator.json` alongside `src/testSeed.ts`.

Harmless — scratch only, wiped by step 3 next run, nothing written in the real
tree — but it copies a session-cookie file and a growing trace directory on
every run. Cheapest fix: have the §1.6 append land with phase 2 (T-004's
envelope) rather than with T-010. Risks 10 notes the general "uncommitted files
get copied" consequence but not this specific one.

## Disclosed boundary exception — on the record

T-001's `allowed_paths` was `design.md` alone; the Designer also edited
`/home/guilherme/msfslogger/vitest.config.ts`, which is application source
outside that list. Under normal policy a file outside `allowed_paths` is a
finding regardless of the change's quality. The Orchestrator inspected the diff,
confirmed it comment-only, and accepted it rather than revert-and-redo. I am not
re-litigating that call; I am recording it, and confirming the two facts it
rests on independently: the diff is `5 insertions(+), 1 deletion(-)` touching
only the leading comment block (`git diff vitest.config.ts`), and `npm test`
passes 850/850 with no new warnings. Must-not-change 4 was amended to carry the
carve-out explicitly, so the exception is visible to anyone reading the design
later rather than being an undocumented drift. Worth noting for future runs: the
Designer had the option of putting the fix in the plan for an implementer to
make, and a doc-only role reaching into `src/`-adjacent config is the kind of
thing that is only benign when the diff is this small.

## Follow-ups (non-blocking, tracked)

1. **N7** — land §1.6's `.gitignore` entries with phase 2, not phase 4.
2. **T-005 must report the readiness-poll observation** Risks 9 asks for: did
   `waitForServer` return on its first attempt (webServer started first) or
   iterate (globalSetup started first)? Either answer closes the assumption.
3. **Still unreproduced here**: P1–P9. No Playwright is installed in
   `client/node_modules`, so the prototype claims remain the Designer's word.
   Phase 2's first green run is their real test — that is what T-005 gates.

---

## Round 1 archive — criteria verification (unchanged by the amendments)

Verified against source, not against the report, on 2026-09-17:

- **SS1** — §1.1–§1.3, §1.5 name every config, directory, setup file and script
  T-001 asked for; root `vitest.config.ts` includes `tests/**/*.test.ts` and
  already excludes `client/**`, so must-not-change 3 is accurate.
- **SS2** — §2.3's `POST /api/auth/login` matches `src/auth/routes.ts:18-90`
  exactly (throttle → `getAuthUser` → `verifyPassword` → `session.regenerate` →
  `save` → `200 {user:{username}}`). The one plausible hidden bypass,
  `requireSameOrigin` (`src/server.ts:80`, mounted before the auth router),
  passes header-less clients deliberately (`src/auth/middleware.ts:75-76`), so
  the POST exercises the real chain. §2.4 bans every forge variant;
  must-not-change 7 bans app changes to make tests pass. **Real login confirmed.**
- **SS3** — §3.2 rule 1 makes `FLIGHTS_DB_PATH` mandatory with no fallback; the
  fallback it guards against is real (`src/db/connection.ts:20`). Rule 3 adds a
  content guard keyed on the `e2e_seed` marker; §3.7 rejects `--force`. Every
  helper §3.1 names is exported from the `src/db.ts` barrel (`setAuthUser`
  settings.ts:29, `createTrip` trips.ts:10, `insertFlight` flights.ts:32,
  `closeFlight` flights.ts:40, `insertPoint` flights.ts:90,
  `assignFlightToTrip` trips.ts:151, `createPlannedLeg` plannedLegs.ts:126,
  `setSetting` settings.ts:72, `initDb` connection.ts:25); `app_setting` is an
  existing table (schema.ts:556), so must-not-change 9 holds. Fixture arithmetic
  checks: 4320+3900 = 8220 s, 152.4+96.1 = 248.5 nm. **Confirmed.**
- **SS4** — `src/config.ts:142-160` takes the loopback branch (`LOOPBACK_HOSTS`,
  line 66) **before** consulting `ALLOW_PLAINTEXT_HTTP` (line 149) and logs the
  exact string §4.3 quotes, so §4.2's env starts with both TLS vars and the
  opt-out unset. `INGEST_TOKEN` is required (step 4, line 166) and §4.2's literal
  is 29 chars, above `INGEST_TOKEN_MIN_LEN = 16`. `SESSION_SECRET` unset is valid
  (step 7 rejects only a short non-empty value). `src/server.ts:67`
  `secure: config.tls.enabled` → `false`, matching §2.3's captured
  `storageState`. **This configuration would start.**
- **SS5** — §5 adds to the existing `ci.yml`; `.github/workflows/` holds that
  file only. Reporters (§5.3) and the red-test-red-job rule (§5.4) are stated.
- **No TBD / "either works"** — `grep -n 'TBD\|either works'` → no matches.
- **§1.7 pins exist**: `npm view` → `@playwright/test 1.63.0` (latest),
  `vitest 3.2.7`, `jsdom 26.1.0`.

## Safety

I started no server and opened no database for writing; the only writes were in
the session scratchpad (two throwaway git repos, both removed) and to this file.
`npm test` is hermetic by contract and touched neither. Live artifacts at the end
of round 2: `client/dist/index.html` `2bc39f5beda19389908e20ffbf12415c`,
`flights.db` `d7b2a00eb72f9354dce759c3ccac9a3f` — unchanged from round 1 and
equal to the values design.md records from its prototypes (must-not-change 1, 2).
