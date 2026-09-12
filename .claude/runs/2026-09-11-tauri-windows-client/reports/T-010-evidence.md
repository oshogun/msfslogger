# T-010 evidence — windows-client CI workflow

Status: **done**. This workflow has **not been executed** — there is no `gh`
CLI and no `actionlint` on this machine, and agents do not push. YAML
validity (below) is the only local check performed. The first real run must
be observed by the user after the Orchestrator pushes.

## Files touched

- `.github/workflows/windows-client.yml` (new)
- `.gitignore` (appended)

## AC-by-AC evidence

**1. YAML parses, full job pasted.**
`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/windows-client.yml')); print('ok')"`
→ `ok`. Full job definition is the `build:` job in the file above (one job,
`runs-on: windows-latest`, 9 steps) — pasted in full in the file itself,
reproduced here:

```
build:
  runs-on: windows-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version-file: .nvmrc }
    - uses: dtolnay/rust-toolchain@1.88.0
    - name: Sidecar install
      working-directory: windows-client/sidecar
      run: npm ci
    - name: Sidecar typecheck
      working-directory: windows-client/sidecar
      run: npm run typecheck
    - name: Sidecar tests
      working-directory: windows-client/sidecar
      run: npm test
    - name: Rust <-> webview contract check
      run: node windows-client/tools/contract-check.mjs
    - name: Install tauri-cli
      run: cargo install tauri-cli --version "^2.0.0" --locked
    - name: Build Tauri app (produces the Windows installer)
      working-directory: windows-client/src-tauri
      run: cargo tauri build
    - uses: actions/upload-artifact@v4
      with:
        name: msfslogger-windows-client-installer
        path: |
          windows-client/src-tauri/target/release/bundle/msi/*.msi
          windows-client/src-tauri/target/release/bundle/nsis/*.exe
        if-no-files-found: error
```

**2. windows-latest, path-filtered, ci.yml untouched.**
`on.push.paths`/`on.pull_request.paths` = `windows-client/**` and the
workflow's own path. `git status --porcelain .github/workflows/ci.yml` →
empty (verified above; file was never opened for write).

**3. Node from `.nvmrc`, pinned Rust toolchain, Windows prerequisites.**
`setup-node` uses `node-version-file: .nvmrc` (root file, contents `20`,
same one `ci.yml` uses — untouched). Rust: `dtolnay/rust-toolchain@1.88.0`
— pinned to the exact version, not `stable`/`beta`. `windows-client/src-tauri/Cargo.toml`
has `rust-version = "1.88.0"` (checked directly), matching the task's
CRITICAL note (design.md §0 amendment #2) that the resolved dependency graph
needs ≥1.88.0 for Rust 2024 edition support. No extra Windows packages are
installed: `windows-latest`'s stock image ships the MSVC build tools and
WebView2 runtime Tauri needs, and `cargo tauri build` fetches WiX/NSIS itself
for bundling — stated as a comment in the workflow rather than left implicit.

**4. Step order and developer-command mapping.**

| Workflow step | Exact command | Same as developer runs |
|---|---|---|
| Sidecar install | `npm ci` (cwd `windows-client/sidecar`) | `cd windows-client/sidecar && npm ci` |
| Sidecar typecheck | `npm run typecheck` | sidecar's own script, = `tsc --noEmit -p tsconfig.json` (`windows-client/sidecar/package.json` line 9) |
| Sidecar tests | `npm test` | sidecar's own script, = `vitest run --config vitest.config.ts` (package.json line 10) |
| Contract check | `node windows-client/tools/contract-check.mjs` | identical string, run from repo root, matches design.md §5.5's own verification table |
| Tauri build | `cargo tauri build` (cwd `windows-client/src-tauri`) | matches design.md §7.1's manual test plan verbatim ("Build, from `windows-client/src-tauri` … `cargo tauri build`") |

Order in the file matches the AC's required order exactly. `cargo tauri
build`'s own `beforeBuildCommand` (`tauri.conf.json`) runs
`npm --prefix sidecar run build`, so the sidecar's compiled `dist/` used by
the bundled app is produced as part of this same step — no separate manual
sidecar-build step was needed to satisfy the 5 listed checks.

**5. Installer uploaded via `actions/upload-artifact`.**
`bundle.targets: ["msi", "nsis"]` in `tauri.conf.json` (checked directly) →
artifact step globs both `target/release/bundle/msi/*.msi` and
`target/release/bundle/nsis/*.exe`, `if-no-files-found: error` so a bundling
regression fails the job loudly instead of uploading an empty artifact.

**6. No secrets, no signing.**
`grep -n 'secrets\.' .github/workflows/windows-client.yml` → no output (exit
1, no match). `grep -in 'sign' .github/workflows/windows-client.yml` → one
hit, a comment referencing `design.md` (the substring "sign" inside
"de**sign**.md") — not signing configuration. No `certificateThumbprint`, no
`signCommand`, no secret reference anywhere in the file.

**7. render-check disposition stated, not ambiguous.**
Deliberately omitted, with the reason as an explicit comment block in the
workflow: `render-check.mjs` imports `puppeteer`, a dependency declared only
in the *root* `package.json` (`grep -n puppeteer package.json` →
`"puppeteer": "^24.43.1"`), not in `windows-client/sidecar/package.json`
(checked, no puppeteer). Running it here would require a full root `npm ci`
(including `better-sqlite3`'s native build) that this path-filtered,
windows-client-only job has no other reason to perform, for a check whose
value (structure/label/layout of the panel) is not Windows-specific and is
already covered wherever `render-check.mjs` is run today.

**8. Not executed — stated plainly.** See status line at top. No `gh`, no
`actionlint` on this box; only `python3 -c "import yaml..."` (AC1) was run.
The first execution happens on GitHub after the Orchestrator pushes, and the
user should watch that run (first-ever Rust compile on this project, ~10+
minutes expected for `cargo install tauri-cli` plus `cargo tauri build`).

**9. `.gitignore` addition, scoped, clean tree.**
Added (paste, exact lines):
```
# Rust build output (windows-client/src-tauri) - hundreds of megabytes,
# never committed. Scoped to that directory, not a bare `target/`, so it
# cannot swallow an unrelated dir named `target` under src/ or client/.
windows-client/src-tauri/target/
```
Scoped to the one path rather than a bare `target/` (which would match any
directory literally named `target` anywhere, including hypothetically under
`src/` or `client/`) — confirmed no such directory exists today via
`find src client -iname target` (no output), and the scoped pattern makes
that guarantee permanent rather than incidental.
`git status --porcelain .github/ .gitignore`:
```
 M .gitignore
?? .github/workflows/windows-client.yml
```
That is the complete set of changes this task made — nothing else in the
tree is dirty as a side effect.

## What was not touched / not run

- The live server and `flights.db` — never opened, no command in this task
  touches a database. No before/after md5 applicable.
- `.github/workflows/ci.yml` — read only, confirmed untouched.
- `windows-client/**` source — read only, for the tool/config paths cited
  in `context`.

## Risks / residual

- `cargo install tauri-cli --version "^2.0.0" --locked` compiles from source
  on the runner; expect the first real run to take noticeably longer than
  `ci.yml`'s job. Untested here — no way to time a Windows Rust build on
  this Linux box.
- If the Tauri bundler needs an env var or tool beyond WiX/NSIS
  auto-fetch on a stock `windows-latest` image, that will surface only on
  the first real run.
- `dtolnay/rust-toolchain@1.88.0` pin behavior (an exact-version ref rather
  than a `v1`/`v2`-style major tag) could not be verified against GitHub —
  no network fetch of the action was possible from this box.
