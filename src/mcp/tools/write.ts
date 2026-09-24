import { z } from 'zod';
import type { McpToolDescriptor } from '../server';
import { runTool } from '../server';
import { toolText, toolError } from '../projections';
import { updateFlight, getFlightById } from '../../db/flights';
import { getTripName, getTripById, createTrip, assignFlightToTrip } from '../../db/trips';
import { importSimbriefLooseLeg } from '../../simbriefImport';

// The 4 write tools. Every one of them is additive or
// reversible, and every one calls the exact function the corresponding
// route calls — no new backend logic lives here.

// ── update_flight_notes ─────────────────────────────────────────────────────
//
// The only mutation surface reachable from a remote client that touches an
// existing row's non-notes fields would be a real problem, so this tool's
// input schema has no `aircraft` key and the handler below builds a fresh
// `{ notes }` object literal rather than ever forwarding its raw input.

const updateFlightNotes: McpToolDescriptor = {
  name: 'update_flight_notes',
  title: 'Update flight notes',
  description: 'Replace the notes on one flight. Cannot change the aircraft or any other field.',
  route: 'flight-edit-notes',
  kind: 'write',
  register(server, _flightManager, onChanged) {
    server.registerTool(
      'update_flight_notes',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          flight_id: z.number().int(),
          notes: z.string().max(4000),
        },
      },
      runTool('update_flight_notes', ({ flight_id, notes }) => {
        const updated = updateFlight(flight_id, { notes });
        if (!updated) return toolError(`No flight with id ${flight_id} exists in the logbook.`);
        const flight = getFlightById(flight_id)!;
        const { points, ...fields } = flight;
        const tripName = fields.trip_id !== null ? getTripName(fields.trip_id) : null;
        onChanged();
        return toolText({ ...fields, trip_name: tripName, track: null });
      }),
    );
  },
};

// ── create_trip ──────────────────────────────────────────────────────────────

const createTripTool: McpToolDescriptor = {
  name: 'create_trip',
  title: 'Create trip',
  description: 'Create a new trip with a name and optional notes.',
  route: 'trip-create',
  kind: 'write',
  register(server, _flightManager, onChanged) {
    server.registerTool(
      'create_trip',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          name: z.string().min(1).max(200),
          notes: z.string().max(4000).nullable().optional(),
        },
      },
      runTool('create_trip', ({ name, notes }) => {
        const trimmed = name.trim();
        if (trimmed.length === 0) return toolError('name must be a non-empty string.');
        const resolvedNotes = notes ?? null;
        const id = createTrip(trimmed, resolvedNotes);
        onChanged();
        return toolText({ id, name: trimmed, notes: resolvedNotes });
      }),
    );
  },
};

// ── assign_flight_to_trip ────────────────────────────────────────────────────

const assignFlightToTripTool: McpToolDescriptor = {
  name: 'assign_flight_to_trip',
  title: 'Assign flight to trip',
  description: 'Assign one flight to one trip.',
  route: 'trip-assign-flight',
  kind: 'write',
  register(server, flightManager, onChanged) {
    server.registerTool(
      'assign_flight_to_trip',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          flight_id: z.number().int(),
          trip_id: z.number().int(),
        },
      },
      runTool('assign_flight_to_trip', ({ flight_id, trip_id }) => {
        const trip = getTripById(trip_id);
        if (!trip) return toolError(`No trip with id ${trip_id} exists in the logbook.`);
        if (!getFlightById(flight_id)) return toolError(`No flight with id ${flight_id} exists in the logbook.`);
        assignFlightToTrip(flight_id, trip_id);
        // Moving a flight between trips can clear its planned-leg link
        // (src/db/trips.ts), so the live-status cache needs the same refresh
        // the web route performs — a no-op unless this is the flight
        // currently in progress.
        flightManager.refreshPlannedLegForFlight(flight_id);
        onChanged();
        return toolText({ ok: true, flight_id, trip_id, trip_name: trip.name });
      }),
    );
  },
};

// ── import_simbrief_leg ──────────────────────────────────────────────────────

const importSimbriefLeg: McpToolDescriptor = {
  name: 'import_simbrief_leg',
  title: 'Import SimBrief leg',
  description: 'Import the operator\'s current SimBrief OFP as a loose planned leg, not attached to any trip.',
  route: 'planned-leg-simbrief-import',
  kind: 'write',
  register(server, _flightManager, onChanged) {
    server.registerTool(
      'import_simbrief_leg',
      {
        title: this.title,
        description: this.description,
        inputSchema: {
          allow_duplicates: z.boolean().optional(),
        },
      },
      runTool('import_simbrief_leg', async ({ allow_duplicates }) => {
        const outcome = await importSimbriefLooseLeg({ allowDuplicates: allow_duplicates ?? false });
        if (outcome.kind === 'error') return toolError(outcome.body.error);
        onChanged();
        return toolText(outcome.body.result);
      }),
    );
  },
};

export const writeTools: readonly McpToolDescriptor[] = [
  updateFlightNotes,
  createTripTool,
  assignFlightToTripTool,
  importSimbriefLeg,
];
