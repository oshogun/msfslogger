import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlightManager } from '../flightManager';
import { toolError, type ToolResult } from './projections';
import { readTools } from './tools/read';
import { writeTools } from './tools/write';

/**
 * One entry per tool. `route` is the MCP_SCOPED_ROUTES name (src/auth/mcpScope.ts)
 * this tool's data corresponds to — checked once at server construction by
 * assertToolRoutesAreScoped, even though the handler below calls an in-process
 * function rather than the route itself. `route: null` is reserved for a tool
 * with no HTTP equivalent at all (get_weather), and is only valid when the
 * tool's name is also in ROUTELESS_TOOLS.
 */
export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  route: string | null;
  kind: 'read' | 'write';
  register(server: McpServer, flightManager: FlightManager): void;
}

/** Every tool this server registers: the 14 read tools plus the 4 write tools. */
export const MCP_TOOLS: readonly McpToolDescriptor[] = [...readTools, ...writeTools];

/** Fresh McpServer per HTTP request: stateless, no session map to leak or
 *  evict. Registers every tool in MCP_TOOLS. */
export function buildMcpServer(flightManager: FlightManager): McpServer {
  const server = new McpServer({ name: 'msfslogger', version: '1.0.0' });
  for (const tool of MCP_TOOLS) {
    tool.register(server, flightManager);
  }
  return server;
}

/**
 * Wraps a tool handler so an unexpected exception never reaches the SDK
 * directly. Without this the SDK stringifies the raw exception into the tool
 * result, which can leak a SQL fragment, a filesystem path or an upstream
 * URL. Expected failures (not found, empty, upstream-refused) are not
 * exceptions — a handler returns toolError() for those itself and this
 * wrapper never sees them as an error case.
 */
export function runTool<Args>(
  name: string,
  fn: (args: Args) => ToolResult | Promise<ToolResult>,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    try {
      return await fn(args);
    } catch (err) {
      console.error(`[MCP] tool ${name} failed: ${String(err)}`);
      return toolError(`Internal error while running ${name}. Check the msfslogger server log.`);
    }
  };
}
