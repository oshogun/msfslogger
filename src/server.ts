import express from 'express';
import path from 'path';
import { getFlights, getFlightById, deleteFlight, updateFlight, combineFlights, getFlightPointCount, createTrip, getTrips, getTripById, updateTrip, deleteTrip, assignFlightToTrip, removeFlightFromTrip } from './db';
import type { FlightManager } from './flightManager';
import type { FlightEditPayload, TripEditPayload } from './types';

export function createServer(flightManager: FlightManager): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/api/status', (_req, res) => {
    const { flightState, currentFlightId, connected, lastFrame } = flightManager.appState;
    res.json({
      connected,
      flightState,
      currentFlightId,
      simRunning: lastFrame?.simRunning ?? 0,
      onGround: lastFrame?.onGround ?? true,
      aircraft: lastFrame?.aircraft ?? null,
      frame: lastFrame ? {
        lat:              lastFrame.lat,
        lon:              lastFrame.lon,
        altitudeFt:       lastFrame.altitudeFt,
        airspeedKnots:    lastFrame.airspeedKnots,
        groundSpeedKnots: lastFrame.groundSpeedKnots,
        headingDeg:       lastFrame.headingDeg,
        verticalSpeedFpm: lastFrame.verticalSpeedFpm,
        onGround:         lastFrame.onGround,
      } : null,
    });
  });

  app.get('/api/flights', (_req, res) => {
    try {
      res.json(getFlights());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Must come before /api/flights/:id to avoid "combine" being parsed as an id
  app.post('/api/flights/combine', (req, res) => {
    const { id1, id2 } = req.body as { id1?: unknown; id2?: unknown };

    if (!Number.isInteger(id1) || !Number.isInteger(id2)) {
      res.status(400).json({ error: 'id1 and id2 must be integers' });
      return;
    }
    if (id1 === id2) {
      res.status(400).json({ error: 'Cannot combine a flight with itself' });
      return;
    }

    const f1 = getFlightById(id1 as number);
    const f2 = getFlightById(id2 as number);
    if (!f1) { res.status(404).json({ error: `Flight ${id1} not found` }); return; }
    if (!f2) { res.status(404).json({ error: `Flight ${id2} not found` }); return; }
    if (!getFlightPointCount(id1 as number)) { res.status(409).json({ error: `Flight ${id1} has no recorded points` }); return; }
    if (!getFlightPointCount(id2 as number)) { res.status(409).json({ error: `Flight ${id2} has no recorded points` }); return; }

    const { currentFlightId } = flightManager.appState;
    if (currentFlightId === id1 || currentFlightId === id2) {
      res.status(409).json({ error: 'Cannot combine an in-progress flight' });
      return;
    }

    try {
      const newId = combineFlights(id1 as number, id2 as number);
      if (newId === null) {
        res.status(500).json({ error: 'Combine failed' });
        return;
      }
      res.status(201).json({ id: newId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Trips ──────────────────────────────────────────────────────────────────

  app.post('/api/trips', (req, res) => {
    const { name, notes } = req.body as { name?: unknown; notes?: unknown };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      res.status(400).json({ error: 'notes must be a string or null' }); return;
    }
    const id = createTrip(name.trim(), (notes as string | null | undefined) ?? null);
    res.status(201).json({ id });
  });

  app.get('/api/trips', (_req, res) => {
    try {
      res.json(getTrips());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/trips/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const trip = getTripById(id);
    if (!trip) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(trip);
  });

  app.patch('/api/trips/:id', (req, res) => {
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
    res.json(getTripById(id));
  });

  app.delete('/api/trips/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const deleted = deleteTrip(id);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ deleted: true });
  });

  app.post('/api/trips/:id/flights', (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: 'Invalid trip id' }); return; }
    const { flightId } = req.body as { flightId?: unknown };
    if (!Number.isInteger(flightId)) {
      res.status(400).json({ error: 'flightId must be an integer' }); return;
    }
    if (!getTripById(tripId)) { res.status(404).json({ error: 'Trip not found' }); return; }
    if (!getFlightById(flightId as number)) { res.status(404).json({ error: 'Flight not found' }); return; }
    assignFlightToTrip(flightId as number, tripId);
    res.json({ ok: true });
  });

  app.delete('/api/trips/:id/flights/:flightId', (req, res) => {
    const flightId = parseInt(req.params.flightId, 10);
    if (isNaN(flightId)) { res.status(400).json({ error: 'Invalid flight id' }); return; }
    const removed = removeFlightFromTrip(flightId);
    if (!removed) { res.status(404).json({ error: 'Flight not found' }); return; }
    res.json({ ok: true });
  });

  app.get('/api/flights/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const flight = getFlightById(id);
    if (!flight) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(flight);
  });

  app.patch('/api/flights/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const body = req.body as Record<string, unknown>;
    const payload: FlightEditPayload = {};

    if ('aircraft' in body) {
      if (body.aircraft !== null && typeof body.aircraft !== 'string') {
        res.status(400).json({ error: 'aircraft must be a string or null' }); return;
      }
      payload.aircraft = (body.aircraft as string | null) || null;
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

    const updated = updateFlight(id, payload);
    if (!updated) { res.status(404).json({ error: 'Not found' }); return; }

    res.json(getFlightById(id));
  });

  app.delete('/api/flights/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const deleted = deleteFlight(id);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ deleted: true });
  });

  return app;
}
