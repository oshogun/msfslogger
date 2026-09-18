# Ship report — T-009: Pass MCP_TOKEN through docker-compose.yml

## Change

One line added to `docker-compose.yml`'s `environment:` block, grouped with
the existing security-settings vars, same style/position:

```diff
       - INGEST_TOKEN=${INGEST_TOKEN}
+      - MCP_TOKEN=${MCP_TOKEN}
       - TLS_CERT_FILE=${TLS_CERT_FILE}
```

`git diff -- docker-compose.yml` confirms this is the only line changed —
no reformat.

## Empty/unset MCP_TOKEN safety — confirmed empirically

Read `src/config.ts` lines 213–233 (Step 6.5, already built by T-003):
`const rawMcpToken = env.MCP_TOKEN || '';` — an empty string is treated
identically to unset. When falsy, it logs `MCP endpoint disabled (MCP_TOKEN
is not set).` and sets `mcp = { token: null, enabled: false }` — no warning,
no throw, no fatal exit. This is exactly today's pre-run behavior (no /mcp
route mounted).

Rendered the compose file with `docker compose config` (a static render,
starts no container, touches nothing live) with `MCP_TOKEN` and all other
optional vars explicitly unset via `env -u`:

```
$ env -u MCP_TOKEN -u INGEST_TOKEN ... docker compose config
level=warning msg="The \"MCP_TOKEN\" variable is not set. Defaulting to a blank string."
...
environment:
  MCP_TOKEN: ""
```

Confirms Compose's "unset var → blank string" substitution is exactly the
input `config.ts`'s `|| ''` already treats as "not set" — no mismatch
between what Compose passes and what the app expects for the disabled
state.

## Dockerfile — explicitly not touched

No Dockerfile change is needed and none was made. `@modelcontextprotocol/sdk`
and `zod` are pure-JS dependencies with no native build step (unlike
`better-sqlite3`), so `npm ci`/`npm run build` inside the existing image
picks them up with no Dockerfile edit. `/mcp` shares the already-exposed
port 3000 (same Express app, new route) rather than opening a new port, so
the `ports:` block is untouched too.

## Live server / live database

Task never touched `flights.db`, ran no build, started no container against
the live checkout — `docker compose config` only renders YAML.

- `flights.db` md5 before: `a884c05eeafdef30b525e1c2d10d6936`
- `flights.db` md5 after: `a884c05eeafdef30b525e1c2d10d6936` (unchanged)

## Not done / out of scope

- No `npm ci` / `npm run build` / container build-and-run rehearsal was
  performed for this task — T-009's scope is the one Compose line, and the
  acceptance criteria only asked for the `config.ts` read + empirical
  unset-var check above. A full clean-build + Docker image rehearsal across
  T-003–T-008's combined changes (the whole MCP feature) is still open if
  the Orchestrator wants a broader Ship pass before committing the run.
