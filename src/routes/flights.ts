import express, { Router } from 'express';
import {
  getFlights, getFlightById, updateFlight, deleteFlight, combineFlights, getFlightPointCount,
  setFlightPlanName, clearFlightPlanName, getFlightStats, searchFlights, countSearchFlights,
} from '../db/flights';
import type { FlightStatsFilter, FlightSearchResult } from '../db/flights';
import { getDb } from '../db';
import { backfillIcao } from '../backfill-icao';
import { flightPlanPath, saveFlightPlanFile, deleteFlightPlanFile, isPdfBuffer } from '../flightPlans';
import { upload } from './uploads';
import type { FlightManager } from '../flightManager';
import type { FlightEditPayload } from '../types';

const DATE_BOUND_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z)?$/;

/** Parses a date/timestamp query param into the exact ISO-8601 form
 *  flights.start_time is stored in, so bounding it is a plain string
 *  comparison. Returns null for anything that isn't a real instant. */
function normalizeDateBound(value: string): string | null {
  if (!DATE_BOUND_RE.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * /api/flights — mounted at '/api' by src/server.ts, behind requireAuth and
 * requireSameOrigin, and before the SPA catch-all.
 *
 * flightManager is a parameter rather than a module import: there is exactly
 * one per process, created in src/index.ts, and a router that reached for a
 * singleton instead would make the scratch/test servers share it.
 */
export function createFlightsRouter(flightManager: FlightManager, onChanged: () => void = () => {}): Router {
  const router = express.Router();

  router.get('/flights', (_req, res) => {
    try {
      res.json(getFlights());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Must come before /flights/:id to avoid "combine" being parsed as an id
  router.post('/flights/combine', (req, res) => {
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
      try {
        backfillIcao(getDb(), newId);
      } catch (err) {
        console.warn(`ICAO backfill for combined flight ${newId} failed:`, err);
      }
      onChanged();
      res.status(201).json({ id: newId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Must come before /flights/:id — same reason as /flights/combine above: a
  // literal path registered after :id would be shadowed by it and silently
  // parsed as an id instead.
  router.get('/flights/search', (req, res) => {
    const qRaw = req.query.q;
    if (typeof qRaw !== 'string') {
      res.status(400).json({ error: 'q is required and must be a non-empty string', code: 'INVALID_QUERY' });
      return;
    }
    const trimmed = qRaw.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ error: 'q is required and must be a non-empty string', code: 'INVALID_QUERY' });
      return;
    }
    if (trimmed.length > 200) {
      res.status(400).json({ error: 'q must be 200 characters or fewer', code: 'INVALID_QUERY' });
      return;
    }
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      res.status(400).json({ error: 'q is required and must be a non-empty string', code: 'INVALID_QUERY' });
      return;
    }
    if (tokens.length > 8) {
      res.status(400).json({ error: 'q must have at most 8 terms', code: 'TOO_MANY_TERMS' });
      return;
    }

    let limit = 25;
    if (req.query.limit !== undefined) {
      const raw = req.query.limit;
      if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
        res.status(400).json({ error: 'limit must be an integer between 1 and 100', code: 'INVALID_LIMIT' });
        return;
      }
      limit = Number(raw);
    }

    let offset = 0;
    if (req.query.offset !== undefined) {
      const raw = req.query.offset;
      if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
        res.status(400).json({ error: 'offset must be a non-negative integer', code: 'INVALID_OFFSET' });
        return;
      }
      offset = Number(raw);
    }

    try {
      const flights = searchFlights(tokens, limit, offset);
      const total = countSearchFlights(tokens);
      const result: FlightSearchResult = { query: qRaw, total, limit, offset, flights };
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Must come before /flights/:id — same reason as /flights/combine above.
  router.get('/flights/stats', (req, res) => {
    const filter: FlightStatsFilter = { from: null, to: null };

    if (req.query.from !== undefined) {
      if (typeof req.query.from !== 'string') {
        res.status(400).json({ error: 'from must be a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)', code: 'INVALID_RANGE' });
        return;
      }
      const normalized = normalizeDateBound(req.query.from);
      if (normalized === null) {
        res.status(400).json({ error: 'from must be a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)', code: 'INVALID_RANGE' });
        return;
      }
      filter.from = normalized;
    }

    if (req.query.to !== undefined) {
      if (typeof req.query.to !== 'string') {
        res.status(400).json({ error: 'to must be a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)', code: 'INVALID_RANGE' });
        return;
      }
      const normalized = normalizeDateBound(req.query.to);
      if (normalized === null) {
        res.status(400).json({ error: 'to must be a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)', code: 'INVALID_RANGE' });
        return;
      }
      filter.to = normalized;
    }

    try {
      res.json(getFlightStats(filter));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/flights/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const flight = getFlightById(id);
    if (!flight) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(flight);
  });

  router.patch('/flights/:id', (req, res) => {
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

    onChanged();
    res.json(getFlightById(id));
  });

  router.delete('/flights/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const deleted = deleteFlight(id);
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

  // ── Flight plan attachment ────────────────────────────────────────────────

  router.post('/flights/:id/flight-plan', upload.single('file'), (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    if (!getFlightById(id)) { res.status(404).json({ error: 'Flight not found' }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    if (file.mimetype !== 'application/pdf' || !isPdfBuffer(file.buffer)) {
      res.status(400).json({ error: 'File must be a PDF' });
      return;
    }

    saveFlightPlanFile(id, file.buffer);
    setFlightPlanName(id, file.originalname.slice(0, 255));
    onChanged();
    res.json(getFlightById(id));
  });

  router.get('/flights/:id/flight-plan', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const flight = getFlightById(id);
    if (!flight || !flight.flight_plan_name) { res.status(404).json({ error: 'No flight plan attached' }); return; }

    const safeName = flight.flight_plan_name.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.sendFile(flightPlanPath(id), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Flight plan file missing' });
    });
  });

  router.delete('/flights/:id/flight-plan', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    if (!getFlightById(id)) { res.status(404).json({ error: 'Flight not found' }); return; }

    deleteFlightPlanFile(id);
    clearFlightPlanName(id);
    onChanged();
    res.json(getFlightById(id));
  });

  return router;
}
