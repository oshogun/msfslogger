# Environment — read before running anything

Standing facts about this machine and this checkout. Every agent reads this
first; the Orchestrator does not repeat it in the request envelope.

Originally written during the run `2026-09-04-lnmpln-trip-planner`, promoted here
because none of it is specific to that feature.

## The user's server is running. Leave it alone.

`node dist/index.js` serves the app on port `3000` against the live
`flights.db`. It is the user's, it is in use, and no agent may stop, restart,
rebuild over, or reconfigure it.

- Read-only `curl` against `http://localhost:3000/api/...` is fine.
- Anything that needs a server of its own starts one on **another port**
  (`PORT=3100 …`) against a **copy** of the database, and shuts it down when the
  task ends.
- `npm run build` overwrites `dist/`, which the running server has already
  loaded. It does not disturb the live process, but the user's next restart
  picks up whatever was built — so a build must leave the tree in a shippable
  state, never mid-edit.

## Use Node 20. The default `node` on this machine is wrong.

    $ node -v
    v26.3.1          # default — WRONG, .nvmrc pins 20

`better-sqlite3` is a native addon with no prebuilt binary for Node 26's ABI, so
`require('better-sqlite3')` throws and the server will not start under the
default node. The README documents this. It is not a new problem and not
something to "fix" by rebuilding or upgrading the dependency.

Prefix every command that runs node, npm, npx or the server with:

    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20

Verified under Node 20.20.2: `better-sqlite3` loads and opens a database, `tsc`
5.9.3 runs. `nvm use` does not persist between Bash calls — shell state is not
carried over — so repeat it in the same command as the work.

## There is no `sqlite3` CLI on this machine

Do not install it and do not treat its absence as a blocker. Run the query
through `better-sqlite3` under Node 20, which is what the app itself uses:

    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
    node -e "
      const D=require('better-sqlite3');
      const db=new D('flights.db', { readonly: true });
      console.table(db.prepare('select ...').all());
    "

## Never verify against the live database

`flights.db` holds the user's real logbook and the running server has it open in
WAL mode. Read-only queries are fine. Anything that writes works on a copy —
and copies the WAL and SHM files with it, or recent commits are missed:

    cp flights.db flights.db-wal flights.db-shm "$SCRATCH/" 2>/dev/null

`npm run backup` is the supported way to take a consistent snapshot and is safe
while the server is live. Prefer it for anything beyond a quick read. A task
that touched a database copy states the live file's md5 before and after in its
report.

## Scratch space

Working files, scratch databases and throwaway servers go in the session
scratchpad or `/tmp`, never in the repo. Run artifacts that are meant to survive
go under `.claude/runs/<run-id>/` — see `.claude/runs/README.md`.

## Verification without a test framework

This project has no test runner and does not want one. Verification is: `npx
tsc` / `npm run build`, `curl` against a scratch server, `better-sqlite3`
queries, and purpose-built `ts-node` CLI inspectors (`src/inspect-*.ts`) for
logic that is hard to reach through the UI. Claims in a report must name the
command that produced them.
