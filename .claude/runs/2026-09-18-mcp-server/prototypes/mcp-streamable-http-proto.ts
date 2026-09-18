// Throwaway prototype for run 2026-09-18-mcp-server. Mimics msfslogger's
// middleware order (express.json first, then a token gate) and mounts a
// stateless MCP Streamable HTTP endpoint at /mcp on an Express 4 app.
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHash, timingSafeEqual } from 'crypto';

const TOKEN = 'proto-token-0123456789';
const digest = createHash('sha256').update(TOKEN, 'utf8').digest();

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'msfslogger', version: '1.0.0' });

  server.registerTool(
    'list_flights',
    {
      title: 'List flights',
      description: 'List logged flights',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => ({
      content: [{ type: 'text', text: JSON.stringify({ limit: limit ?? null, flights: [{ id: 1, aircraft: 'C172' }] }) }],
    }),
  );

  server.registerTool(
    'boom',
    { title: 'Boom', description: 'Always fails', inputSchema: {} },
    async () => ({ isError: true, content: [{ type: 'text', text: 'Flight 999 not found (HTTP 404)' }] }),
  );

  server.registerTool(
    'throws',
    { title: 'Throws', description: 'Throws an exception', inputSchema: {} },
    async () => { throw new Error('unhandled boom'); },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/status', (_req, res) => { res.json({ ok: true }); });

app.all('/mcp', async (req, res) => {
  const header = req.get('authorization') || '';
  const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : '';
  const ok = presented.length > 0 && timingSafeEqual(createHash('sha256').update(presented, 'utf8').digest(), digest);
  if (!ok) {
    res.status(401)
      .set('WWW-Authenticate', 'Bearer realm="msfslogger-mcp"')
      .json({ error: 'Invalid or missing MCP token', code: 'INVALID_MCP_TOKEN' });
    return;
  }

  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number(process.env.PORT || 3199);
app.listen(port, '127.0.0.1', () => console.log(`proto listening on ${port}`));
