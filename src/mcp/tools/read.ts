import { z } from 'zod';
import type { McpToolDescriptor } from '../server';
import { runTool } from '../server';
import {
  toolText, toolError, toFlightSummary, toTripSummary, toPlannedLegSummary,
  downsampleTrack, toTrackPoint,
} from '../projections';
import {
  getFlights, getFlightById, getFlightStats, searchFlights, countSearchFlights,
} from '../../db/flights';
import type { FlightStatsFilter } from '../../db/flights';
import { getTripName, getTrips, getTripById } from '../../db/trips';
import { buildJourney } from '../../journey';
import { getPlannedLegsForTrip, getAllPlannedLegs, getPlannedLegById } from '../../db/plannedLegs';
import { listAcarsMessagesForFlight, listAcarsMessagesForPlannedLeg } from '../../db/acarsMessages';
import { getCachedWeather, WeatherFetchError } from '../../weatherClient';
import { CANNED_MESSAGES } from '../../acars';
import { getOpenGroundSession } from '../../db/groundSessions';

// The 14 read tools. Every tool handler calls the underlying
// db/domain function directly, in process — no tool makes an HTTP request
// back into this server, and none of these imports ever reaches a delete,
// combine, active-trip or settings write.

const TRACK_POINT_CAP = 200;
const WAYPOINT_CAP = 200;
const ACARS_MESSAGE_CAP = 100;
const LIMIT_DEFAULT = 25;

const limitSchema = z.number().int().min(1).max(100).optional();
const offsetSchema = z.number().int().min(0).optional();

/** Same grammar as src/routes/flights.ts's normalizeDateBound: a bare date, or
 *  a UTC timestamp with an explicit Z. Duplicated here rather than imported —
 *  the route does not export it, and this grammar is small enough to state
 *  twice. */
const DATE_BOUND_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z)?$/;

function normalizeDateBound(value: string): string | null {
  if (!DATE_BOUND_RE.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── list_flights ────────────────────────────────────────────────────────────

const listFlights: McpToolDescriptor = {
  name: 'list_flights',
  title: 'List flights',
  description: 'List logged flights, newest first, optionally scoped to one trip.',
  route: 'flights-list',
  kind: 'read',
  register(server) {
    server.registerTool(
      'list_flights',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          limit: limitSchema,
          offset: offsetSchema,
          trip_id: z.number().int().optional(),
        },
      },
      runTool('list_flights', ({ limit, offset, trip_id }) => {
        const lim = limit ?? LIMIT_DEFAULT;
        const off = offset ?? 0;
        const all = trip_id !== undefined ? getFlights().filter(f => f.trip_id === trip_id) : getFlights();
        const page = all.slice(off, off + lim);
        return toolText({ total: all.length, limit: lim, offset: off, flights: page.map(toFlightSummary) });
      }),
    );
  },
};

// ── get_flight ──────────────────────────────────────────────────────────────

const getFlight: McpToolDescriptor = {
  name: 'get_flight',
  title: 'Get flight',
  description: 'Get one flight by id, including its route, times and (optionally) its GPS track.',
  route: 'flight-read',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_flight',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          flight_id: z.number().int(),
          include_track: z.boolean().optional(),
        },
      },
      runTool('get_flight', ({ flight_id, include_track }) => {
        const flight = getFlightById(flight_id);
        if (!flight) return toolError(`No flight with id ${flight_id} exists in the logbook.`);
        const { points, ...fields } = flight;
        const tripName = fields.trip_id !== null ? getTripName(fields.trip_id) : null;
        const track = include_track ? downsampleTrack(points, TRACK_POINT_CAP).map(toTrackPoint) : null;
        return toolText({
          ...fields,
          trip_name: tripName,
          track,
          ...(include_track && points.length > TRACK_POINT_CAP ? { track_downsampled: true } : {}),
        });
      }),
    );
  },
};

// ── search_flights ────────────────────────────────────────────────────────

const searchFlightsTool: McpToolDescriptor = {
  name: 'search_flights',
  title: 'Search flights',
  description: 'Free-text search over notes, airports and aircraft, newest first.',
  route: 'flights-search',
  kind: 'read',
  register(server) {
    server.registerTool(
      'search_flights',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          q: z.string().min(1).max(200),
          limit: limitSchema,
          offset: offsetSchema,
        },
      },
      runTool('search_flights', ({ q, limit, offset }) => {
        const trimmed = q.trim();
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return toolError('q must contain at least one non-whitespace term.');
        if (tokens.length > 8) return toolError('q must have at most 8 terms.');

        const lim = limit ?? LIMIT_DEFAULT;
        const off = offset ?? 0;
        const flights = searchFlights(tokens, lim, off);
        const total = countSearchFlights(tokens);
        return toolText({ query: q, total, limit: lim, offset: off, flights: flights.map(toFlightSummary) });
      }),
    );
  },
};

// ── get_flight_stats ────────────────────────────────────────────────────────

const getFlightStatsTool: McpToolDescriptor = {
  name: 'get_flight_stats',
  title: 'Get flight statistics',
  description: 'Aggregate totals, top aircraft and top routes over the logbook, optionally date-bounded.',
  route: 'flights-stats',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_flight_stats',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          from: z.string().regex(DATE_BOUND_RE).optional(),
          to: z.string().regex(DATE_BOUND_RE).optional(),
        },
      },
      runTool('get_flight_stats', ({ from, to }) => {
        const filter: FlightStatsFilter = { from: null, to: null };
        if (from !== undefined) {
          const normalized = normalizeDateBound(from);
          if (normalized === null) return toolError('from must be a real calendar date or UTC timestamp.');
          filter.from = normalized;
        }
        if (to !== undefined) {
          const normalized = normalizeDateBound(to);
          if (normalized === null) return toolError('to must be a real calendar date or UTC timestamp.');
          filter.to = normalized;
        }
        return toolText(getFlightStats(filter));
      }),
    );
  },
};

// ── list_trips ──────────────────────────────────────────────────────────────

const listTrips: McpToolDescriptor = {
  name: 'list_trips',
  title: 'List trips',
  description: 'List every trip, newest first, with flight/planned-leg counts.',
  route: 'trips-list',
  kind: 'read',
  register(server) {
    server.registerTool(
      'list_trips',
      { title: this.title, description: this.description, inputSchema: {} },
      runTool('list_trips', () => toolText({ trips: getTrips().map(toTripSummary) })),
    );
  },
};

// ── get_trip ────────────────────────────────────────────────────────────────

const getTrip: McpToolDescriptor = {
  name: 'get_trip',
  title: 'Get trip',
  description: 'Get one trip by id, with its flights and planned legs.',
  route: 'trip-read',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_trip',
      { title: this.title, description: this.description, inputSchema: { trip_id: z.number().int() } },
      runTool('get_trip', ({ trip_id }) => {
        const trip = getTripById(trip_id);
        if (!trip) return toolError(`No trip with id ${trip_id} exists in the logbook.`);
        return toolText({
          ...toTripSummary(trip),
          flights: trip.flights.map(toFlightSummary),
          planned_legs: trip.planned_legs.map(l => toPlannedLegSummary({ ...l, trip_name: trip.name })),
        });
      }),
    );
  },
};

// ── get_journey ─────────────────────────────────────────────────────────────

const getJourney: McpToolDescriptor = {
  name: 'get_journey',
  title: 'Get trip journey',
  description: 'Get the trip atlas view for one trip: countries, aircraft mix, longest leg and chain.',
  route: 'trip-journey',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_journey',
      { title: this.title, description: this.description, inputSchema: { trip_id: z.number().int() } },
      runTool('get_journey', ({ trip_id }) => {
        const trip = getTripById(trip_id);
        if (!trip) return toolError(`No trip with id ${trip_id} exists in the logbook.`);
        return toolText(buildJourney(trip.flights, trip.planned_legs));
      }),
    );
  },
};

// ── list_planned_legs ───────────────────────────────────────────────────────

const listPlannedLegs: McpToolDescriptor = {
  name: 'list_planned_legs',
  title: 'List planned legs',
  description: 'List planned legs, scoped to one trip or across every loose and trip-linked leg.',
  route: 'planned-legs-list',
  kind: 'read',
  register(server) {
    server.registerTool(
      'list_planned_legs',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          trip_id: z.number().int().optional(),
          status: z.enum(['planned', 'flown', 'diverted', 'skipped']).optional(),
          limit: limitSchema,
          offset: offsetSchema,
        },
      },
      runTool('list_planned_legs', ({ trip_id, status, limit, offset }) => {
        const lim = limit ?? LIMIT_DEFAULT;
        const off = offset ?? 0;
        const tripName = trip_id !== undefined ? getTripName(trip_id) : null;
        const legs = trip_id !== undefined ? getPlannedLegsForTrip(trip_id) : getAllPlannedLegs();
        const filtered = status !== undefined ? legs.filter(l => l.status === status) : legs;
        const page = filtered.slice(off, off + lim);
        const summaries = page.map(l => toPlannedLegSummary(trip_id !== undefined ? { ...l, trip_name: tripName } : l));
        return toolText({ total: filtered.length, limit: lim, offset: off, planned_legs: summaries });
      }),
    );
  },
};

// ── get_planned_leg ─────────────────────────────────────────────────────────

const getPlannedLeg: McpToolDescriptor = {
  name: 'get_planned_leg',
  title: 'Get planned leg',
  description: 'Get one planned leg by id, with its waypoints and alternates.',
  route: 'planned-leg-read',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_planned_leg',
      { title: this.title, description: this.description, inputSchema: { planned_leg_id: z.number().int() } },
      runTool('get_planned_leg', ({ planned_leg_id }) => {
        const leg = getPlannedLegById(planned_leg_id);
        if (!leg) return toolError(`No planned leg with id ${planned_leg_id} exists in the logbook.`);
        const { waypoints, alternates, ...fields } = leg;
        const truncated = waypoints.length > WAYPOINT_CAP;
        return toolText({
          ...fields,
          waypoints: truncated ? waypoints.slice(0, WAYPOINT_CAP) : waypoints,
          ...(truncated ? { waypoints_truncated: true } : {}),
          alternates,
        });
      }),
    );
  },
};

// ── get_acars_thread ────────────────────────────────────────────────────────

const acarsThreadInput = z.object({
  flight_id: z.number().int().optional(),
  planned_leg_id: z.number().int().optional(),
}).refine(
  v => (v.flight_id !== undefined) !== (v.planned_leg_id !== undefined),
  { message: 'Exactly one of flight_id or planned_leg_id is required.' },
);

const getAcarsThread: McpToolDescriptor = {
  name: 'get_acars_thread',
  title: 'Get ACARS thread',
  description: 'Get the ACARS message thread for one flight or one planned leg (exactly one of the two ids).',
  route: 'flight-acars-read',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_acars_thread',
      { title: this.title, description: this.description, inputSchema: acarsThreadInput },
      runTool('get_acars_thread', ({ flight_id, planned_leg_id }) => {
        let all;
        if (flight_id !== undefined) {
          if (!getFlightById(flight_id)) return toolError(`No flight with id ${flight_id} exists in the logbook.`);
          all = listAcarsMessagesForFlight(flight_id);
        } else {
          if (!getPlannedLegById(planned_leg_id as number)) {
            return toolError(`No planned leg with id ${planned_leg_id} exists in the logbook.`);
          }
          all = listAcarsMessagesForPlannedLeg(planned_leg_id as number);
        }
        const truncated = all.length > ACARS_MESSAGE_CAP;
        const messages = truncated ? all.slice(-ACARS_MESSAGE_CAP) : all;
        return toolText({
          flight_id: flight_id ?? null,
          planned_leg_id: planned_leg_id ?? null,
          total: all.length,
          truncated,
          messages,
        });
      }),
    );
  },
};

// ── get_weather ─────────────────────────────────────────────────────────────

const getWeather: McpToolDescriptor = {
  name: 'get_weather',
  title: 'Get weather',
  description: 'Get the cached METAR/TAF for an ICAO station. Read-only: never files an ACARS message.',
  route: null,
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_weather',
      {
        title: this.title,
        description: this.description,
        inputSchema: { icao: z.string().regex(/^[A-Za-z0-9]{3,4}$/) },
      },
      runTool('get_weather', async ({ icao }) => {
        try {
          const weather = await getCachedWeather(icao.toUpperCase());
          return toolText(weather);
        } catch (err) {
          if (err instanceof WeatherFetchError) return toolError(err.userMessage);
          throw err;
        }
      }),
    );
  },
};

// ── list_canned_messages ────────────────────────────────────────────────────

const listCannedMessages: McpToolDescriptor = {
  name: 'list_canned_messages',
  title: 'List canned ACARS messages',
  description: 'List the fixed set of canned downlink ACARS messages a client may send.',
  route: 'acars-canned-messages',
  kind: 'read',
  register(server) {
    server.registerTool(
      'list_canned_messages',
      { title: this.title, description: this.description, inputSchema: {} },
      runTool('list_canned_messages', () => toolText({ messages: [...CANNED_MESSAGES] })),
    );
  },
};

// ── get_status ──────────────────────────────────────────────────────────────

const getStatus: McpToolDescriptor = {
  name: 'get_status',
  title: 'Get live status',
  description: 'Get the current sim connection, flight state and position — never the AI traffic list.',
  route: 'status',
  kind: 'read',
  register(server, flightManager) {
    server.registerTool(
      'get_status',
      { title: this.title, description: this.description, inputSchema: {} },
      runTool('get_status', () => {
        const { flightState, currentFlightId, connected, lastFrame, paused, pauseFlags } = flightManager.appState;
        const plannedLeg = flightState === 'FLYING' && lastFrame
          ? flightManager.getPlannedLegStatus(lastFrame.lat, lastFrame.lon)
          : null;
        const groundSession = flightState === 'GROUND' ? flightManager.getGroundSessionStatus() : null;
        return toolText({
          connected,
          flight_state: flightState,
          current_flight_id: currentFlightId,
          paused,
          pause_flags: pauseFlags,
          sim_running: lastFrame?.simRunning ?? 0,
          on_ground: lastFrame?.onGround ?? true,
          aircraft: lastFrame?.aircraft ?? null,
          position: lastFrame ? {
            lat: lastFrame.lat,
            lon: lastFrame.lon,
            altitude_ft: lastFrame.altitudeFt,
            ground_speed_kts: lastFrame.groundSpeedKnots,
            heading_deg: lastFrame.headingDeg,
          } : null,
          planned_leg: plannedLeg,
          ground_session: groundSession,
        });
      }),
    );
  },
};

// ── get_ground_session ──────────────────────────────────────────────────────

const getGroundSession: McpToolDescriptor = {
  name: 'get_ground_session',
  title: 'Get current ground session',
  description: 'Get the currently open ground session, or null when none is open.',
  route: 'ground-session-current',
  kind: 'read',
  register(server) {
    server.registerTool(
      'get_ground_session',
      { title: this.title, description: this.description, inputSchema: {} },
      runTool('get_ground_session', () => toolText({ session: getOpenGroundSession() })),
    );
  },
};

export const readTools: readonly McpToolDescriptor[] = [
  listFlights,
  getFlight,
  searchFlightsTool,
  getFlightStatsTool,
  listTrips,
  getTrip,
  getJourney,
  listPlannedLegs,
  getPlannedLeg,
  getAcarsThread,
  getWeather,
  listCannedMessages,
  getStatus,
  getGroundSession,
];
