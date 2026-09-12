# T-011 evidence

## Commands run on this machine

```
$ export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
$ node -v
v20.20.2

$ npx tsc --noEmit
(clean, exit 0)

$ npx tsc --noEmit -p windows-client/sidecar/tsconfig.json
(clean, exit 0)

$ npx vitest run --config windows-client/sidecar/vitest.config.ts
 Test Files  6 passed (6)
      Tests  175 passed (175)

$ node windows-client/sidecar/dist/inspect-config.js windows-client/sidecar/samples/config/good.json
config     : OK
  ...
exit:0

$ for f in windows-client/sidecar/samples/config/bad-*.json; do node windows-client/sidecar/dist/inspect-config.js "$f" >/dev/null 2>&1; echo "$f -> $?"; done
(all nine -> 1)

$ node windows-client/tools/contract-check.mjs
(all 10 Rust<->webview names PASS, exit 0)

$ python3 -c "import tomllib; tomllib.load(open('windows-client/src-tauri/Cargo.toml','rb')); print('ok', ...)"
ok 1.88.0 {version: '=2.11.5', ...} {version: '=2.6.3', ...}

$ jq . windows-client/src-tauri/tauri.conf.json
(valid JSON)

$ rustc --version && cargo --version
rustc 1.75.0 (82e1608df 2023-12-21) (built from a source tarball)
cargo 1.75.0

$ git diff --stat README.md
 README.md | 12 ++++++++++++
 1 file changed, 12 insertions(+)

$ git diff README.md | grep -E '^[-+]' | grep -v '^+++\|^---'
(12 added lines, zero removed lines)

$ git status --porcelain agent/
(empty)
```

## Acceptance criteria

1. **Prerequisites + build/run commands + CI pointer.** `windows-client/README.md`
   § Prerequisites (Windows) names Node 20, Rust >= 1.88.0, WebView2; §
   Build and run (Windows) gives `npm --prefix sidecar ci`, `npm --prefix
   sidecar run build`, `cargo tauri dev` / `cargo tauri build` from
   `windows-client/src-tauri`, derived from `plan.json`'s T-005 acceptance
   text and cross-checked against the actual `tauri.conf.json`
   (`beforeDevCommand`/`beforeBuildCommand`) and `sidecar/package.json`
   scripts. States the `.github/workflows/windows-client.yml` `windows-latest`
   CI artifact as the no-toolchain alternative. Done.

2. **Config path, no env/flag required, migration table.** § Where the
   config file lives states `%APPDATA%\msfslogger\config.json` (matches
   `resolveConfigPath()` in `windows-client/sidecar/src/config.ts`, confirmed
   by reading it) and the no-env/no-flag sentence. § Migrating your current
   settings has one row per `SERVER_URL`, `INGEST_TOKEN`,
   `NODE_EXTRA_CA_CERTS`, `TRAFFIC_ENABLED`, `TRAFFIC_RADIUS_M`, `--sim`, and
   `autoUplink` — all seven present, mapped to the `CFG NETWORK`/`CFG
   SIM`/`CFG TRAFFIC` fields confirmed by reading
   `windows-client/ui/src/pages/index.js`. Done.

3. **FMC state table.** § FMC status vocabulary reproduces every row of
   `windows-client/sidecar/src/status.ts`'s `STATUS_STATES` (confirmed by
   reading the file directly) across all four axes, each with label, meaning
   and operator action, `ACARS UPLINK` included, and states the
   independent-axes rule up front. Done.

4. **Manual test plan mapped to design §7 + AC coverage.** § Manual test plan
   follows `ctx.sh design ... 7`'s 16-step table (renumbered 10/10b for the
   stop/restart-server pair so each row proves one thing), same
   command/click-and-observation shape. A coverage line maps each of the five
   user-story ACs (from `intake.md`) to step numbers. Done.

5. **Negative tests per failure mode.** § Manual test plan steps 4, 5, 6, 10,
   12, 13, 14 are the negative cases; a closing paragraph explicitly lists
   wrong token -> step 12 (`ACARS REJECT 401`), untrusted cert -> step 13
   (`ACARS CERT FAULT`), sim not running -> step 6 (`SIM LINK RETRY`), server
   unreachable -> step 10 (`ACARS NO COMM`), invalid config-UI entry -> steps
   4/5/14. Done.

6. **What was never executed + agent/ fallback.** § Verification done on this
   machine lists `cargo build`/`cargo tauri build`, `cargo tauri dev`,
   WebView2 rendering, and a live SimConnect session as not executed here,
   and gives the actual commands (tsc, vitest, inspectors, contract-check)
   that were. The intro and the closing line both state `agent/` is
   unmodified and remains the fallback. Done.

7. **Root README pointer, additions only, agent/ untouched.** New "Windows
   desktop client (in development)" section added after the existing agent
   paragraph in `README.md`. `git diff --stat README.md` shows `12
   insertions(+)`, `0 deletions(-)`; `git status --porcelain agent/` is
   empty. Done.

8. **Every command verified or marked untested.** Commands that were
   actually run (tsc, vitest, inspect-config, contract-check, jq/tomllib,
   rustc/cargo --version) are shown with their real output above and in the
   README's "Verification done on this machine" section. `cargo tauri
   dev`/`build`, `cargo install tauri-cli`, and every step of the 16-row
   manual test plan are explicitly marked "Windows-only, untested here" or
   are inherently a Windows-box/MSFS-in-hand step. Done.

## Note on the Rust-version prerequisite

Per the Orchestrator's correction, `rust-version = "1.88.0"` was confirmed
by reading `windows-client/src-tauri/Cargo.toml` directly (line 6), and the
installed toolchain here (`rustc 1.75.0`) is below it — confirmed by running
`rustc --version`/`cargo --version` above. The design amendment (§0 #2) only
records that 1.75.0 was found; the concrete "feature `edition2024` is
required" failure and the `rust-version = "1.88.0"` pin are recorded in
`reviews/phase-2.md` and `reviews/phase-2-round2.md`, cited in the README's
prose without naming those files.
