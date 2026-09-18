// Reference artifact for run 2026-09-18-mcp-server. NOT compiled, NOT imported
// by the build. Authoritative prose: design.md §6 (architecture) and §7 (the
// 18-tool inventory).
//
// Type ownership:
//   McpToolDescriptor, buildMcpServer  → src/mcp/server.ts       (§6.4)
//   readTools / writeTools registries  → src/mcp/tools/read.ts, src/mcp/tools/write.ts
//   FlightSummary, TripSummary, PlannedLegSummary, projection helpers,
//   downsampleTrack, toolText, toolError
//                                      → src/mcp/projections.ts (§6.3)
//   createMcpRouter                    → src/mcp/router.ts       (§5.4)

import type { Router } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlightManager } from '../../../../src/flightManager';
import type { McpConfig } from './mcpAuth';

// ── src/mcp/server.ts ─────────────────────────────────────────────────────────

/** One entry per tool. `route` is the MCP_SCOPED_ROUTES name this tool's data
 *  corresponds to; it is asserted against the allow-list at startup (§3.2) even
 *  though the handler calls in-process functions rather than the route (§6.1). */
export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  route: string;
  kind: 'read' | 'write';
  /** Registered via server.registerTool(name, { title, description, inputSchema }, handler).
   *  inputSchema is a zod *raw shape* ({ [k]: ZodType }), not z.object(...). */
  register(server: McpServer, flightManager: FlightManager): void;
}

/** Fresh instance per HTTP request (§5.3). Registers all 18 tools. */
export function buildMcpServer(flightManager: FlightManager): McpServer;

// ── src/mcp/router.ts ─────────────────────────────────────────────────────────

/** POST /mcp behind createMcpTokenGate; GET and DELETE answer 405 (§5.6).
 *  Only called when config.mcp.enabled is true. */
export function createMcpRouter(mcp: McpConfig, flightManager: FlightManager): Router;

// ── src/mcp/projections.ts ────────────────────────────────────────────────────

/** The compact flight shape every list-ish tool returns (§6.3). Deliberately
 *  NOT src/types.ts's Flight: it is an MCP-only view, and putting it in
 *  src/types.ts would invite the client or the routes to depend on it. */
export interface FlightSummary {
  id: number;
  aircraft: string | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  departure_icao: string | null;
  arrival_icao: string | null;
  trip_id: number | null;
  planned_leg_id: number | null;
  /** flights.notes truncated to 200 chars; '…' appended iff truncated. */
  notes: string | null;
}

export interface TripSummary {
  id: number;
  name: string;
  notes: string | null;
  created_at: string;
  is_active: 0 | 1;
  flight_count: number;
  planned_leg_count: number;
  total_distance_nm: number | null;
  total_duration_sec: number | null;
}

export interface PlannedLegSummary {
  id: number;
  trip_id: number | null;
  trip_name: string | null;
  seq: number;
  status: 'planned' | 'flown' | 'diverted' | 'skipped';
  departure_ident: string | null;
  destination_ident: string | null;
  cruise_alt_ft: number | null;
  aircraft_type: string | null;
  approx_distance_nm: number | null;
  waypoint_count: number | null;
  is_snippet: 0 | 1;
  imported_at: string | null;
}

export function toFlightSummary(f: import('../../../../src/types').Flight): FlightSummary;
export function toTripSummary(t: import('../../../../src/types').TripWithFlights): TripSummary;
export function toPlannedLegSummary(
  l: import('../../../../src/types').PlannedLegWithChildren & { trip_name?: string | null },
): PlannedLegSummary;

/** Even-stride sample of a track down to at most `max` points (§10.4).
 *  Deterministic: index i of the output is points[round(i*(n-1)/(k-1))]. */
export function downsampleTrack<T>(points: readonly T[], max: number): T[];

/** Success envelope: a single text content block holding JSON.stringify(value)
 *  with no indentation (§6.2). */
export function toolText(value: unknown): { content: [{ type: 'text'; text: string }] };

/** Failure envelope: isError: true plus one plain-sentence text block. The
 *  sentence never contains a stack trace, a file path, a SQL string, or a
 *  credential (§6.2). */
export function toolError(message: string): {
  isError: true;
  content: [{ type: 'text'; text: string }];
};
