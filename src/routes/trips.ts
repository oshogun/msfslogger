import express, { Router } from 'express';
import {
  createTrip, getTrips, getTripById, updateTrip, deleteTrip,
  assignFlightToTrip, removeFlightFromTrip,
} from '../db/trips';
import { getFlightById } from '../db/flights';
import { setActiveTrip, getActiveTripId } from '../db/plannedLegs';
import { buildJourney } from '../journey';
import type { FlightManager } from '../flightManager';
import type { TripEditPayload } from '../types';

/**
 * /api/trips, /api/active-trip and the trip atlas — mounted at '/api' by
 * src/server.ts, behind requireAuth and requireSameOrigin, and before the SPA
 * catch-all.
 *
 * flightManager is a parameter for the same reason as in ./flights: one
 * instance per process, handed in rather than reached for.
 */
export function createTripsRouter(flightManager: FlightManager, onChanged: () => void = () => {}): Router {
  const router = express.Router();

  router.post('/trips', (req, res) => {
    const { name, notes } = req.body as { name?: unknown; notes?: unknown };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      res.status(400).json({ error: 'notes must be a string or null' }); return;
    }
    const id = createTrip(name.trim(), (notes as string | null | undefined) ?? null);
    onChanged();
    res.status(201).json({ id });
  });

  router.get('/trips', (_req, res) => {
    try {
      res.json(getTrips());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/trips/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const trip = getTripById(id);
    if (!trip) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(trip);
  });

  router.patch('/trips/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const body = req.body as Record<string, unknown>;
    const payload: TripEditPayload = {};

    if ('name' in body) {
      if (!body.name || typeof body.name !== 'string' || !(body.name as string).trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' }); return;
      }
      payload.name = (body.name as string).trim();
    }
    if ('notes' in body) {
      if (body.notes !== null && typeof body.notes !== 'string') {
        res.status(400).json({ error: 'notes must be a string or null' }); return;
      }
      payload.notes = (body.notes as string | null) || null;
    }

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' }); return;
    }

    const updated = updateTrip(id, payload);
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }
    onChanged();
    res.json(getTripById(id));
  });

  router.delete('/trips/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const deleted = deleteTrip(id);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    const inProgressFlightId = flightManager.appState.currentFlightId;
    if (inProgressFlightId !== null) {
      try {
        flightManager.refreshPlannedLegForFlight(inProgressFlightId);
      } catch (err) {
        console.warn('[Routes] leg cache refresh after delete failed:', err);
      }
    }
    onChanged();
    res.json({ deleted: true });
  });

  router.post('/trips/:id/flights', (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: 'Invalid trip id' }); return; }
    const { flightId } = req.body as { flightId?: unknown };
    if (!Number.isInteger(flightId)) {
      res.status(400).json({ error: 'flightId must be an integer' }); return;
    }
    if (!getTripById(tripId)) { res.status(404).json({ error: 'Trip not found' }); return; }
    if (!getFlightById(flightId as number)) { res.status(404).json({ error: 'Flight not found' }); return; }
    assignFlightToTrip(flightId as number, tripId);
    // Moving a flight between trips can clear its planned-leg link (db/trips.ts),
    // so this gets the same live-status-cache refresh the manual link endpoint
    // does. A no-op unless this is the flight in progress.
    flightManager.refreshPlannedLegForFlight(flightId as number);
    onChanged();
    res.json({ ok: true });
  });

  router.delete('/trips/:id/flights/:flightId', (req, res) => {
    const flightId = parseInt(req.params.flightId, 10);
    if (isNaN(flightId)) { res.status(400).json({ error: 'Invalid flight id' }); return; }
    const removed = removeFlightFromTrip(flightId);
    if (!removed) { res.status(404).json({ error: 'Flight not found' }); return; }
    flightManager.refreshPlannedLegForFlight(flightId);
    onChanged();
    res.json({ ok: true });
  });

  // ── Active trip ────────────────────────────────────────────────────────────
  // /api/active-trip is a new top-level prefix, chosen precisely so it cannot
  // collide with anything — in particular so it never sits as a literal in the
  // :id slot of the destructive DELETE /api/trips/:id. The payload is
  // camelCase because it is a computed view (which trip, if any, is active),
  // not a row.

  router.get('/active-trip', (_req, res) => {
    try {
      const tripId = getActiveTripId();
      const trip = tripId !== null ? getTripById(tripId) : null;
      res.json({ tripId, name: trip ? trip.name : null });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put('/active-trip', (req, res) => {
    const { tripId } = req.body as { tripId?: unknown };
    if (tripId !== null && !Number.isInteger(tripId)) {
      res.status(400).json({ error: 'tripId must be an integer or null' }); return;
    }
    if (tripId !== null && !getTripById(tripId as number)) {
      res.status(404).json({ error: 'Trip not found' }); return;
    }

    try {
      setActiveTrip(tripId as number | null);
      const trip = tripId !== null ? getTripById(tripId as number) : null;
      onChanged();
      res.json({ tripId, name: trip ? trip.name : null });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Trip atlas ────────────────────────────────────────────────────────────

  router.get('/trips/:id/journey', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const trip = getTripById(id);
    if (!trip) { res.status(404).json({ error: 'Trip not found' }); return; }

    try {
      res.json(buildJourney(trip.flights, trip.planned_legs));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
