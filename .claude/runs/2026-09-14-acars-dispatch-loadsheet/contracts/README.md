# Contracts — ACARS dispatch release and load sheet

Reference artifacts for run `2026-09-14-acars-dispatch-loadsheet`. **None of
these is wired into the build**: no `tsconfig` includes them, nothing imports
them, `npm run build` does not see them. They exist so T-002 and T-003 copy a
shape instead of inventing one.

| File | What it is | Frozen in |
|---|---|---|
| `types.server.ts` | Declarations for `src/simbrief.ts`, `src/types.ts` and `src/acars.ts`. Typechecks standalone under `tsc --strict`. | design.md §3.1, §4.2, §6.1, §6.3, §7.1, §7.3 |
| `types.client.ts` | Declarations for `client/src/types.ts`. Typechecks standalone under `tsc --strict`. | design.md §7.2 |
| `dispatch-payload.sample.json` | The `DispatchPayload` blob, pretty-printed. **Stored as one line**, not like this. | §4.2 |
| `dispatch-message.sample.json` | The whole `acars_messages` row for the dispatch release, every column. | §2.2, §5.2 |
| `loadsheet-response.sample.json` | A full `201` body from the load-sheet endpoint. | §6.1, §6.3, §6.4 |
| `loadsheet-errors.sample.json` | Every rejection body the endpoint can send, keyed by status. | §6.2 |

Every JSON sample was generated from the real captured OFP
(`samples/simbrief/simbrief.userid.json`, UHPP→UHSS, King Air 200, `units: kgs`,
**no alternate**) by `../prototypes/dispatch-loadsheet.ts` — the numbers and the
rendered message bodies are that run's literal output, not hand-written
examples. The `id`, `sent_at` and `planned_leg_id` values in the message rows are
illustrative; everything else is real.

Reproduce:

    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
    npx ts-node --compiler-options '{"module":"commonjs"}' \
      .claude/runs/2026-09-14-acars-dispatch-loadsheet/prototypes/dispatch-loadsheet.ts

Typecheck the stubs:

    npx tsc --noEmit --strict --skipLibCheck \
      .claude/runs/2026-09-14-acars-dispatch-loadsheet/contracts/types.*.ts
