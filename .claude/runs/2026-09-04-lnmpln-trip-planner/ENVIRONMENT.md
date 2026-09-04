# Environment — read before running anything

## Use Node 20. The default `node` on this machine is wrong.

    $ node -v
    v26.3.1          # default — WRONG, .nvmrc pins 20

`better-sqlite3` is a native addon with no prebuilt binary for Node 26's ABI, so
`require('better-sqlite3')` throws and **the server will not start** under the
default node. The README documents this; it is not a new problem and it is not
something to "fix" by rebuilding or upgrading the dependency.

**Prefix every command that runs node, npm, npx or the server with:**

    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20

Verified working under Node 20.20.2:

    better-sqlite3   loads and opens a database  OK
    tsc              5.9.3                       OK

`nvm use` does not persist between Bash tool calls — shell state is not carried
over — so it must be repeated in each call, in the same command as the work.

## There is no `sqlite3` CLI on this machine

Several acceptance criteria in `plan.json` are written as
`sqlite3 flights.db "select ..."`. That binary is **not installed**. Do not
install it and do not treat its absence as a blocker: run the same query through
`better-sqlite3` under Node 20, which is the library the app itself uses.

    export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
    node -e "
      const D=require('better-sqlite3');
      const db=new D('flights.db', { readonly: true });
      console.table(db.prepare('select ...').all());
    "

Read-only for inspection. When a check needs writes, work on a **copy**.

## Never verify against the live database

`flights.db` holds the user's real logbook, and the server may be running
against it in WAL mode. Copy it first — and copy the WAL and SHM files with it,
or recent commits are missed:

    cp flights.db flights.db-wal flights.db-shm /tmp/.../check/ 2>/dev/null

`npm run backup` is the supported way to get a consistent snapshot and is safe
while the server is live. Prefer it for anything beyond a quick read.
