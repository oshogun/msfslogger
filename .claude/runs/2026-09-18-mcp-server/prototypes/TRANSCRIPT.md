# Prototype transcript — MCP Streamable HTTP on Express 4, Node 20

Run: 2026-09-18-mcp-server. Everything below was executed on 2026-09-18 in the
session scratchpad (`.../scratchpad/mcpproto`), never in the repo, never against
the live server or `flights.db`. Scratch port `3199`, bound to `127.0.0.1`,
stopped afterwards by tracked PID.

Files: `mcp-streamable-http-proto.ts` (the server that produced the output
below), `proto-tsconfig.json` (the repo's `tsconfig.json` compiler options plus
the one addition under test).

## 0. Environment

    $ node -v
    v20.20.2                       # nvm use 20, per .claude/ENVIRONMENT.md
    $ npx tsc -v
    Version 5.9.3                  # same major/minor as the repo's devDependency

    $ npm i @modelcontextprotocol/sdk@1.30.0 express@^4.18.3 zod@^4

## 1. The SDK is `"type": "module"` but dual-published

    $ npm view @modelcontextprotocol/sdk version   → 1.30.0
    $ node -p "require('./node_modules/@modelcontextprotocol/sdk/package.json').type"
    module

`package.json#exports` carries a `require` condition for every subpath:

    ".":       { "types": "./dist/esm/index.d.ts",
                 "import": "./dist/esm/index.js",
                 "require": "./dist/cjs/index.js" }

and `dist/cjs/**` ships its own `.d.ts` files. A CommonJS `require()` works
under Node 20.20.2:

    $ node -e "console.log(Object.keys(require('@modelcontextprotocol/sdk/server/mcp.js')))"
    [ 'McpServer', 'ResourceTemplate' ]
    $ node -e "console.log(Object.keys(require('@modelcontextprotocol/sdk/server/streamableHttp.js')))"
    [ 'StreamableHTTPServerTransport' ]

No `ERR_REQUIRE_ESM`, no top-level-await failure. Every SDK version checked
(1.12.3, 1.17.5, 1.20.0, 1.25.0, 1.30.0) reports `"type": "module"`, so there is
no "pick an older CJS release" escape hatch — the `require` condition is the
mechanism, and it is present.

## 2. tsc resolution needs a `paths` entry

The repo compiles with `"module": "commonjs"` and therefore the *node10*
resolver, which does not read `package.json#exports`. Without help, tsc resolves
`@modelcontextprotocol/sdk/server/mcp.js` to a path that does not exist on disk.
Adding this to `compilerOptions` makes it resolve to the shipped CJS `.d.ts`:

    "baseUrl": ".",
    "paths": {
      "@modelcontextprotocol/sdk/*": ["./node_modules/@modelcontextprotocol/sdk/dist/cjs/*"]
    }

With it, `npx tsc` on `mcp-streamable-http-proto.ts` (same target/module/strict
settings as the repo) emits CommonJS that runs unmodified. No change to
`module`/`moduleResolution` is required, so no existing import in `src/**`
changes meaning.

## 3. zod 4 is required — zod 3.25 does not typecheck

    zod@3.25.76 → src/proto.ts(16,3): error TS2589: Type instantiation is
                  excessively deep and possibly infinite.   (at registerTool)
    zod@4.6.5   → clean compile, exit 0

The SDK accepts `zod ^3.25 || ^4.0` at runtime; only zod 4 survives
`registerTool`'s generic inference under this project's `strict` settings.

## 4. Stateless transport, Express 4, pre-parsed body

Server shape (full source in `mcp-streamable-http-proto.ts`): `express.json({
limit: '100kb' })` first, then a bearer-token gate, then per request a fresh
`McpServer` + `new StreamableHTTPServerTransport({ sessionIdGenerator:
undefined, enableJsonResponse: true })`, `await server.connect(transport)`,
`await transport.handleRequest(req, res, req.body)`.

    # 1. no token
    HTTP/1.1 401 Unauthorized
    WWW-Authenticate: Bearer realm="msfslogger-mcp"
    {"error":"Invalid or missing MCP token","code":"INVALID_MCP_TOKEN"}

    # 2. initialize (bearer token)
    HTTP/1.1 200 OK   content-type: application/json     ← no mcp-session-id header
    {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},
     "serverInfo":{"name":"msfslogger","version":"1.0.0"}},"jsonrpc":"2.0","id":1}

    # 3. tools/list on a *fresh* connection, no prior initialize — works in stateless mode
    {"result":{"tools":[{"name":"list_flights","title":"List flights",...,
      "inputSchema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object",
      "properties":{"limit":{"type":"integer","minimum":1,"maximum":200}}},
      "execution":{"taskSupport":"forbidden"}}, ...]},"jsonrpc":"2.0","id":2}

    # 4. tools/call, happy path
    {"result":{"content":[{"type":"text","text":"{\"limit\":5,\"flights\":[...]}"}]},"jsonrpc":"2.0","id":3}

    # 5. handler returning { isError: true, content:[...] }
    {"result":{"content":[{"type":"text","text":"Flight 999 not found (HTTP 404)"}],"isError":true},"jsonrpc":"2.0","id":4}

    # 6. handler that *throws* — the SDK converts it, it does not become a JSON-RPC error
    {"result":{"content":[{"type":"text","text":"unhandled boom"}],"isError":true},"jsonrpc":"2.0","id":5}

    # 7. zod rejection of bad arguments
    {"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error:
      Invalid arguments for tool list_flights: Invalid input: expected number, received string at limit"}],
      "isError":true},"jsonrpc":"2.0","id":6}

    # 8. notification (no id)
    HTTP/1.1 202 Accepted

    # 9. GET /mcp with Accept: text/event-stream
    HTTP/1.1 200 OK   content-type: text/event-stream   (stream held open)

    # 10. DELETE /mcp
    HTTP/1.1 200 OK

Two findings that change the design:

- **`Accept` must list both types even with `enableJsonResponse: true`.** With
  `Accept: application/json` alone, or with no `Accept` header at all:

      {"jsonrpc":"2.0","error":{"code":-32000,
       "message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}

  Any `curl` smoke test must send `-H 'accept: application/json, text/event-stream'`.

- **A malformed JSON body never reaches the transport.** `express.json()`
  throws first and Express's default error handler answers with an HTML page:

      HTTP/1.1 400 Bad Request
      Content-Type: text/html; charset=utf-8
      <!DOCTYPE html> ...

  which is why §5.5 of `design.md` extends the existing `SyntaxError` branch in
  `src/server.ts`'s error middleware to `/mcp`.

## What this prototype did *not* prove

- No real MCP client (Claude Desktop/Code) was connected — only raw JSON-RPC
  over `curl`. Session-less operation is per the spec and per the SDK's own
  documented stateless mode, but the first end-to-end client connection is still
  an implementation-phase verification step (§13).
- Nothing was run over TLS. The prototype listened plaintext on loopback.
