// Reference artifact for run 2026-09-18-mcp-server. NOT compiled, NOT imported
// by the build. The authoritative prose is design.md §2 and §3.
//
// Type ownership:
//   McpConfig, AppConfig.mcp  → src/config.ts          (§2.1)
//   mcpTokenDigest/Matches    → src/auth/mcpToken.ts   (§2.2)
//   McpScopedRoute, MCP_SCOPED_ROUTES, isMcpScopedRoute,
//   assertToolRoutesAreScoped → src/auth/mcpScope.ts   (§2.3, §3)
//   createMcpTokenGate        → src/auth/mcpScope.ts   (§2.4)

import type { RequestHandler } from 'express';

// ── src/config.ts ─────────────────────────────────────────────────────────────

/** MCP_TOKEN. `enabled: false` (token null) is the default: the /mcp endpoint
 *  is then never mounted. Nothing else in AppConfig changes. */
export interface McpConfig {
  /** MCP_TOKEN, trimmed of nothing — used verbatim. null iff unset/empty. */
  token: string | null;
  /** true iff token !== null. The one flag src/server.ts branches on. */
  enabled: boolean;
}

// AppConfig gains exactly one new key:
//   mcp: McpConfig;
// ENV_VARS gains exactly one new entry: 'MCP_TOKEN'.

// ── src/auth/mcpToken.ts ──────────────────────────────────────────────────────
// A deliberate, self-contained copy of src/auth/ingestToken.ts — see §2.5. No
// import edge to ingestToken.ts, not even for sha256().

/** Fixed-width digest, so the MCP-token check can use timingSafeEqual. */
export function mcpSha256(value: string): Buffer;

/** The configured MCP token's digest, computed once at gate construction.
 *  null iff no MCP token is configured (feature off). */
export function mcpTokenDigest(token: string | null): Buffer | null;

/** Compares a presented credential against the configured token's precomputed
 *  digest. Both sides are 32-byte digests, so timingSafeEqual cannot throw on a
 *  length mismatch and leaks nothing about the token's length. */
export function mcpTokenMatches(presented: string | undefined, tokenDigest: Buffer): boolean;

// ── src/auth/mcpScope.ts ──────────────────────────────────────────────────────

export interface McpScopedRoute {
  method: 'GET' | 'POST' | 'PATCH';
  /** Exact path, one segment per :param, anchored. No wildcard prefix. */
  pattern: RegExp;
  /** Stable audit name, referenced by the tool registry's `route` field. */
  name: string;
  /** 'read' never writes a row; 'write' does. Every 'write' entry is one of the
   *  four in success criterion 3. */
  kind: 'read' | 'write';
}

/** The hardcoded TS constant — not an env var, exactly like
 *  INGEST_SCOPED_ROUTES despite the ALL-CAPS name. Full table in design.md §3. */
export const MCP_SCOPED_ROUTES: readonly McpScopedRoute[];

export function isMcpScopedRoute(method: string, path: string): boolean;

/** The only tools allowed to declare `route: null`. Exactly one member today,
 *  'get_weather' — there is no side-effect-free weather route to point at
 *  (design.md §7.3). Hardcoded, like MCP_SCOPED_ROUTES. */
export const ROUTELESS_TOOLS: readonly string[];

/** Startup assertion (§3.2): every registered tool's declared `route` name must
 *  appear in MCP_SCOPED_ROUTES, and no 'write' route may be claimed by a tool
 *  declared read-only. Throws Error at server construction, never at request
 *  time. This is what keeps the allow-list load-bearing under the in-process
 *  tool architecture of §6.1. */
export function assertToolRoutesAreScoped(
  tools: readonly { name: string; route: string; kind: 'read' | 'write' }[],
): void;

/** Authenticates the /mcp endpoint itself, and nothing else. Mounted ONLY on
 *  the /mcp path (§2.4) — it is never app.use()'d globally, never sees an /api
 *  request, and requireAuth/requireSameOrigin are not modified. Digest computed
 *  once at construction. */
export function createMcpTokenGate(mcp: McpConfig): RequestHandler;
