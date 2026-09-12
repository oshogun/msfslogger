# T-013 — sidecar config recovery and stopped lifecycle

Implemented in `windows-client/sidecar/src/index.ts`; regression coverage in
`windows-client/sidecar/tests/index.test.ts`.

## Changes

- Track the actual running lifecycle separately from app config diagnostics.
  Repeated invalid reloads retain the last valid config and keep probes active;
  a valid reload restores `app.running` if STOP has not intervened.
- Preserve unresolved config errors through STOP/shutdown. These operations
  cannot emit `app.stopped` with config problems; diagnostics remain until a
  valid reload. An initially missing config also survives shutdown.
- Share stop cleanup with shutdown, reset simulator/backend/pause axes, and send
  the disconnected event based on actual running state even during config errors.
- Ignore ingest and probe responses from before STOP, including after a later
  START. Ignore incoming controls once shutdown begins.
- No config or protocol shape, HTTP payload, SimConnect pause, traffic,
  reconnect, or dependency changes.

## Verification

All Node/npm commands ran with this prefix:

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
```

From repository root:

```sh
npm --prefix windows-client/sidecar test -- tests/index.test.ts
```

Result: **9 tests passed**. Focused criteria:

1. STOP and shutdown after invalid reload preserve `app.error-config/problems`,
   emit idle simulator/backend axes, and send disconnected; no status combines
   `app.stopped` and config problems.
2. Repeated invalid reloads retain the last valid config and active link; START
   remains idempotent, probes and frame ingest continue; a valid reload reports
   running and applies config to both collaborators. STOP followed by a valid
   reload reports stopped.
3. Both frame and event requests completing after STOP (success or failure)
   leave the entire backend snapshot idle and unchanged. An old frame result
   cannot replace the new run's status after STOP/START; a new frame still can.
   A pending probe also cannot overwrite idle after STOP.

```sh
npm --prefix windows-client/sidecar run typecheck
npm --prefix windows-client/sidecar run build
npm --prefix windows-client/sidecar test
```

Final result: **typecheck exit 0; build exit 0; 6 test files / 175 tests passed**.
The existing protocol/config/status/traffic/uplink suites also passed.

Additional test-source check, from `windows-client/sidecar` with the same Node20
prefix:

```sh
./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --strict tests/index.test.ts
```

Result: exit 0, no diagnostics.

## Limits

Lifecycle tests isolate stdin/stdout/process hooks, config loading, SimConnect,
and HTTP using mocks and fake timers. Existing HTTP/TLS tests use ephemeral
loopback servers and scratch certificates. No Windows/MSFS runtime validation
was performed here. No live server, live database, root build, or unrelated
source file was touched; the sidecar build only regenerated its ignored dist.
