import express from 'express';
import multer, { MulterError } from 'multer';
import path from 'path';
import { getFlights, getFlightById, deleteFlight, updateFlight, combineFlights, getFlightPointCount, createTrip, getTrips, getTripById, updateTrip, deleteTrip, assignFlightToTrip, removeFlightFromTrip, setFlightPlanName, clearFlightPlanName } from './db';
import { flightPlanPath, saveFlightPlanFile, deleteFlightPlanFile, isPdfBuffer } from './flightPlans';
import { renderPdf, appendPdfs } from './pdfExport';
import type { FlightManager } from './flightManager';
import type { Flight, FlightEditPayload, TripEditPayload } from './types';
import { createIngestRouter } from './ingest';

const MAX_FLIGHT_PLAN_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FLIGHT_PLAN_BYTES } });

/** ASCII-safe slug, so Content-Disposition needs no RFC 5987 encoding. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics: "Circumnavegação" -> "circumnavegacao"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function dateStamp(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10);
}

function flightExportFilename(flight: Flight): string {
  // Flights produced by combineFlights() have no ICAO codes, so fall back to the id alone
  const route = (flight.departure_icao || flight.arrival_icao)
    ? `-${slugify(`${flight.departure_icao ?? 'unknown'}-${flight.arrival_icao ?? 'unknown'}`)}`
    : '';
  return `flight-${flight.id}${route}-${dateStamp(flight.start_time)}.pdf`;
}

function sendPdf(res: express.Response, pdf: Buffer, filename: string): void {
  const safeName = filename.replace(/["\\\r\n/]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.end(pdf);
}

/**
 * Locale/timezone are forwarded to the print page because the export renders on
 * the server, whose timezone (Etc/UTC here) is not the user's. Both values get
 * interpolated into a URL, so they are validated before being trusted.
 */
/**
 * Whether to append attached flight plans to an export. Defaults to true;
 * `?plans=0` skips them, which matters for trips with many legs where the
 * attachments dwarf the generated pages.
 */
function includePlans(req: express.Request): boolean {
  const v = req.query.plans;
  return !(v === '0' || v === 'false');
}

function localeParams(req: express.Request): string {
  const tz = typeof req.query.tz === 'string' ? req.query.tz : '';
  const locale = typeof req.query.locale === 'string' ? req.query.locale : '';
  const params = new URLSearchParams();
  try {
    if (tz) { new Intl.DateTimeFormat(undefined, { timeZone: tz }); params.set('tz', tz); }
  } catch { /* invalid timezone — fall back to the server default */ }
  try {
    if (locale) { new Intl.DateTimeFormat(locale); params.set('locale', locale); }
  } catch { /* invalid locale — fall back to the server default */ }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function createServer(flightManager: FlightManager): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'client', 'dist')));

  app.use('/api/ingest', createIngestRouter(flightManager));

  app.get('/api/status', (_req, res) => {
    const { flightState, currentFlightId, connected, lastFrame, paused, pauseFlags } = flightManager.appState;
    res.json({
      connected,
      flightState,
      currentFlightId,
      paused,
      pauseFlags,
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

  // ── Flight plan attachment ────────────────────────────────────────────────

  app.post('/api/flights/:id/flight-plan', upload.single('file'), (req, res) => {
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
    res.json(getFlightById(id));
  });

  app.get('/api/flights/:id/flight-plan', (req, res) => {
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

  app.delete('/api/flights/:id/flight-plan', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    if (!getFlightById(id)) { res.status(404).json({ error: 'Flight not found' }); return; }

    deleteFlightPlanFile(id);
    clearFlightPlanName(id);
    res.json(getFlightById(id));
  });

  // ── PDF export ────────────────────────────────────────────────────────────
  // Registered before the SPA catch-all so they aren't swallowed by it.

  app.get('/api/flights/:id/export.pdf', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const flight = getFlightById(id);
    if (!flight) { res.status(404).json({ error: 'Flight not found' }); return; }

    try {
      let pdf = await renderPdf(`/print/flight/${id}${localeParams(req)}`);
      if (flight.flight_plan_name && includePlans(req)) {
        pdf = await appendPdfs(pdf, [flightPlanPath(id)]);
      }
      sendPdf(res, pdf, flightExportFilename(flight));
    } catch (err) {
      console.error('[PDF] Flight export failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/trips/:id/export.pdf', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const trip = getTripById(id);
    if (!trip) { res.status(404).json({ error: 'Trip not found' }); return; }

    try {
      let pdf = await renderPdf(`/print/trip/${id}${localeParams(req)}`);
      const attachments = includePlans(req)
        ? trip.flights.filter(f => f.flight_plan_name).map(f => flightPlanPath(f.id))
        : [];
      if (attachments.length > 0) {
        pdf = await appendPdfs(pdf, attachments);
      }
      sendPdf(res, pdf, `trip-${slugify(trip.name) || trip.id}-${dateStamp(trip.created_at)}.pdf`);
    } catch (err) {
      console.error('[PDF] Trip export failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Catch-all: let React Router handle client-side routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'client', 'dist', 'index.html'));
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large (max ${MAX_FLIGHT_PLAN_BYTES / (1024 * 1024)}MB)`
        : err.message;
      res.status(400).json({ error: message });
      return;
    }
    next(err);
  });

  return app;
}
