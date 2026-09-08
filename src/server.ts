import express from 'express';
import multer, { MulterError } from 'multer';
import path from 'path';
import { createHash } from 'crypto';
import { getFlights, getFlightById, deleteFlight, updateFlight, combineFlights, getFlightPointCount, createTrip, getTrips, getTripById, updateTrip, deleteTrip, assignFlightToTrip, removeFlightFromTrip, setFlightPlanName, clearFlightPlanName, createPlannedLeg, getPlannedLegsForTrip, getPlannedLegById, findPlannedLegBySource, deletePlannedLeg, reorderPlannedLegs, setActiveTrip, getActiveTripId, setPlannedLegStatus, setPlannedLegHandOutcome, linkFlightToPlannedLeg, unlinkFlightFromPlannedLeg, PlannedLegAlreadyLinkedError, PlannedLegHasLinkedFlightError, PlannedLegHandCloseConflictError } from './db';
import { flightPlanPath, saveFlightPlanFile, deleteFlightPlanFile, isPdfBuffer } from './flightPlans';
import { renderPdf, appendPdfs } from './pdfExport';
import { buildJourney } from './journey';
import { decideHandClose } from './plannedLegClose';
import { parseLnmpln, LnmplnParseError, chainOrderForBatch, type ParsedFlightPlan } from './lnmpln';
import type { FlightManager } from './flightManager';
import type { Flight, FlightEditPayload, TripEditPayload, PlannedLegWithChildren } from './types';
import { createIngestRouter } from './ingest';
import { TrafficStore } from './trafficStore';

const MAX_FLIGHT_PLAN_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FLIGHT_PLAN_BYTES } });

// ── LNMPLN import ──────────────────────────────────────────────────────────
// A separate multer instance, deliberately: a real .lnmpln plan is a few KB of
// XML, so it gets its own, much smaller, limit rather than sharing
// MAX_FLIGHT_PLAN_BYTES (20 MB, PDFs). design.md §7.1, §20 item 2.
const MAX_LNMPLN_BYTES = 512 * 1024;
const MAX_LNMPLN_FILES = 25;
const uploadLnmpln = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LNMPLN_BYTES, files: MAX_LNMPLN_FILES },
});

/**
 * Content sniffing for an uploaded .lnmpln: after BOM stripping and
 * trimStart(), the bytes must begin with '<'. The extension is not trusted and
 * not required. Mirrors the parser's own BOM handling so a file that passes
 * here is never rejected by the parser for the same reason. design.md §7.1.
 */
function looksLikeXml(buf: Buffer): boolean {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trimStart().startsWith('<');
}

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
 * Whether to append attached flight plans to an export. Defaults to true;
 * `?plans=0` skips them, which matters for trips with many legs where the
 * attachments dwarf the generated pages.
 */
function includePlans(req: express.Request): boolean {
  const v = req.query.plans;
  return !(v === '0' || v === 'false');
}

/**
 * Locale/timezone are forwarded to the print page because the export renders on
 * the server, whose timezone (Etc/UTC here) is not the user's. Both values get
 * interpolated into a URL, so they are validated before being trusted.
 */
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

  // One instance per server (not a module-level singleton), so a scratch
  // server starts empty. Never persisted, never written to flights.db.
  // design.md (run 2026-09-08-ai-traffic-map) §5.1.
  const trafficStore = new TrafficStore();

  app.use('/api/ingest', createIngestRouter(flightManager, trafficStore));

  app.get('/api/status', (_req, res) => {
    const { flightState, currentFlightId, connected, lastFrame, paused, pauseFlags } = flightManager.appState;
    // Only while FLYING, and only when the flight is actually linked — every
    // other case must leave the response byte-identical to before this key
    // existed, so it is spread in rather than ever sent as a literal null.
    // design.md §19.
    const plannedLeg = flightState === 'FLYING' && lastFrame
      ? flightManager.getPlannedLegStatus(lastFrame.lat, lastFrame.lon)
      : null;
    // Present iff non-empty (design.md §6.2, §6.4) — never null, never [],
    // absent instead, so an unchanged AppState serialises byte-identically to
    // before this key existed. Same conditional-spread idiom as plannedLeg.
    const traffic = trafficStore.read();
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
      ...(plannedLeg ? { plannedLeg } : {}),
      ...(traffic.length ? { traffic } : {}),
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
    // Moving a flight between trips can clear its planned-leg link (db.ts), so
    // this gets the same live-status-cache refresh the manual link endpoint
    // does. A no-op unless this is the flight in progress.
    flightManager.refreshPlannedLegForFlight(flightId as number);
    res.json({ ok: true });
  });

  app.delete('/api/trips/:id/flights/:flightId', (req, res) => {
    const flightId = parseInt(req.params.flightId, 10);
    if (isNaN(flightId)) { res.status(400).json({ error: 'Invalid flight id' }); return; }
    const removed = removeFlightFromTrip(flightId);
    if (!removed) { res.status(404).json({ error: 'Flight not found' }); return; }
    flightManager.refreshPlannedLegForFlight(flightId);
    res.json({ ok: true });
  });

  // ── Active trip ────────────────────────────────────────────────────────────
  // /api/active-trip is a new top-level prefix, chosen precisely so it cannot
  // collide with anything — in particular so it never sits as a literal in the
  // :id slot of the destructive DELETE /api/trips/:id. design.md §11.3, §20
  // item 15. The payload is camelCase because it is a computed view (which
  // trip, if any, is active), not a row (design.md §17).

  app.get('/api/active-trip', (_req, res) => {
    try {
      const tripId = getActiveTripId();
      const trip = tripId !== null ? getTripById(tripId) : null;
      res.json({ tripId, name: trip ? trip.name : null });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/active-trip', (req, res) => {
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
      res.json({ tripId, name: trip ? trip.name : null });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
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

  // ── Trip atlas ────────────────────────────────────────────────────────────

  app.get('/api/trips/:id/journey', (req, res) => {
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

  // ── Planned legs ───────────────────────────────────────────────────────────
  // Registered after ── Trips ── and before ── PDF export ──, so every literal
  // route here stays ahead of app.get('*'). design.md §7.3.

  app.post('/api/trips/:id/planned-legs', uploadLnmpln.array('lnmpln', MAX_LNMPLN_FILES), (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: 'Invalid trip id' }); return; }
    if (!getTripById(tripId)) { res.status(404).json({ error: 'Trip not found' }); return; }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) { res.status(400).json({ error: 'No files uploaded' }); return; }

    const allowDuplicates = (req.body as Record<string, unknown> | undefined)?.allow_duplicates === '1';

    interface FileOutcome {
      filename: string;
      status: 'imported' | 'duplicate' | 'rejected';
      planned_leg_id?: number;
      warnings?: { code: string; message: string }[];
      error?: string;
    }

    const results: FileOutcome[] = [];
    // Only successfully-parsed, non-duplicate files participate in chain-sort
    // and get inserted; in upload order until chainOrderForBatch reorders them.
    const toInsert: { filename: string; sha256: string; plan: ParsedFlightPlan; resultIndex: number }[] = [];
    // F-1: findPlannedLegBySource only sees rows already committed, and every
    // insert in this handler happens after this whole scan loop — so without
    // this, the same file twice in one request sailed past the DB check both
    // times and came out as two legs. Tracks the resultIndex of the first
    // (non-duplicate) occurrence of each hash so a repeat within the batch is
    // caught before it ever reaches toInsert.
    const seenInBatch = new Map<string, number>();
    // resultIndex (duplicate) -> resultIndex (the in-batch original) so the
    // duplicate's planned_leg_id can be backfilled once the original is
    // actually inserted below, the same as the cross-request case reports one.
    const duplicateOfInBatch = new Map<number, number>();

    for (const file of files) {
      const filename = file.originalname;

      if (!looksLikeXml(file.buffer)) {
        results.push({ filename, status: 'rejected', error: "NOT_XML: file does not begin with '<'" });
        continue;
      }

      let plan: ParsedFlightPlan;
      try {
        plan = parseLnmpln(file.buffer);
      } catch (err) {
        if (err instanceof LnmplnParseError) {
          results.push({ filename, status: 'rejected', error: `${err.code}: ${err.message}` });
          continue;
        }
        res.status(500).json({ error: String(err) });
        return;
      }

      const sha256 = createHash('sha256').update(file.buffer).digest('hex');

      if (!allowDuplicates) {
        const existing = findPlannedLegBySource(tripId, sha256);
        if (existing) {
          results.push({
            filename, status: 'duplicate', planned_leg_id: existing.id,
            error: `Already imported into this trip as leg ${existing.seq}`,
          });
          continue;
        }

        const dupOf = seenInBatch.get(sha256);
        if (dupOf !== undefined) {
          results.push({
            filename, status: 'duplicate',
            error: `Duplicate of "${results[dupOf].filename}" earlier in this upload`,
          });
          duplicateOfInBatch.set(results.length - 1, dupOf);
          continue;
        }
      }

      // F-2: a warning means the parser tolerated something worth a human's
      // attention (design.md §5.4e) — log it at import time, since nothing
      // downstream of a successful import currently does.
      for (const w of plan.warnings) {
        console.warn(`[LNMPLN] ${filename}: ${w.code}: ${w.message}`);
      }

      results.push({ filename, status: 'imported', warnings: plan.warnings });
      seenInBatch.set(sha256, results.length - 1);
      toInsert.push({ filename, sha256, plan, resultIndex: results.length - 1 });
    }

    const order = chainOrderForBatch(toInsert.map((t) => t.plan));

    const imported: PlannedLegWithChildren[] = [];
    try {
      for (const idx of order.order) {
        const entry = toInsert[idx];
        const legId = createPlannedLeg({
          tripId, plan: entry.plan, sourceFilename: entry.filename, sourceSha256: entry.sha256,
        });
        results[entry.resultIndex].planned_leg_id = legId;
        imported.push(getPlannedLegById(legId)!);
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
      return;
    }

    for (const [dupIdx, origIdx] of duplicateOfInBatch) {
      results[dupIdx].planned_leg_id = results[origIdx].planned_leg_id;
    }

    if (imported.length === 0) {
      // F-3: chainOrderForBatch([]) reports SINGLE_LEG, which is meaningless
      // for a batch that inserted nothing — omit it rather than log a chain
      // verdict for zero legs. The client only branches on batch.ordering,
      // and only when it's present, so this is safe on that side too.
      res.status(400).json({ imported, results });
      return;
    }
    const batch = { ordering: (order.resolved ? 'chain' : 'upload') as 'chain' | 'upload', reason: order.reason };
    res.status(201).json({ imported, batch, results });
  });

  app.get('/api/trips/:id/planned-legs', (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: 'Invalid trip id' }); return; }
    if (!getTripById(tripId)) { res.status(404).json({ error: 'Trip not found' }); return; }
    try {
      res.json(getPlannedLegsForTrip(tripId));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.patch('/api/trips/:id/planned-legs/order', (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (isNaN(tripId)) { res.status(400).json({ error: 'Invalid trip id' }); return; }
    if (!getTripById(tripId)) { res.status(404).json({ error: 'Trip not found' }); return; }

    const { legIds } = req.body as { legIds?: unknown };
    if (!Array.isArray(legIds) || !legIds.every((x) => Number.isInteger(x))) {
      res.status(400).json({ error: 'legIds must be an array of integers' }); return;
    }

    const existingIds = getPlannedLegsForTrip(tripId).map((l) => l.id).sort((a, b) => a - b);
    const providedIds = [...(legIds as number[])].sort((a, b) => a - b);
    const sameMultiset = existingIds.length === providedIds.length
      && existingIds.every((id, i) => id === providedIds[i]);
    if (!sameMultiset) {
      res.status(400).json({ error: 'legIds must list every planned leg of this trip exactly once' });
      return;
    }

    reorderPlannedLegs(tripId, legIds as number[]);
    res.json(getPlannedLegsForTrip(tripId));
  });

  app.get('/api/planned-legs/:legId', (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const leg = getPlannedLegById(legId);
    if (!leg) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(leg);
  });

  app.delete('/api/planned-legs/:legId', (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const deleted = deletePlannedLeg(legId);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ deleted: true });
  });

  app.patch('/api/planned-legs/:legId', (req, res) => {
    const legId = parseInt(req.params.legId, 10);
    if (isNaN(legId)) { res.status(400).json({ error: 'Invalid id' }); return; }

    // 'flown' and 'diverted' are set by the system only — by landing within
    // ARRIVAL_RADIUS_NM of the planned destination — so a client asking for
    // either is a 400, not a state a PATCH can request. design.md §15.
    const { status } = req.body as { status?: unknown };
    if (status !== 'planned' && status !== 'skipped') {
      res.status(400).json({ error: "status must be 'planned' or 'skipped'" }); return;
    }

    if (!getPlannedLegById(legId)) { res.status(404).json({ error: 'Not found' }); return; }

    try {
      setPlannedLegStatus(legId, status);
      res.json(getPlannedLegById(legId));
    } catch (err) {
      if (err instanceof PlannedLegHasLinkedFlightError) {
        res.status(409).json({ error: err.message }); return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Flight ↔ planned-leg link ─────────────────────────────────────────────
  // Deliberately NOT restricted to the active trip: any unflown planned leg of
  // ANY trip can be linked by hand, since this is the escape hatch for a bad
  // (or missing) auto-match and must not be constrained by the mechanism it
  // exists to correct. design.md §12.3.

  app.put('/api/flights/:id/planned-leg', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    if (!getFlightById(id)) { res.status(404).json({ error: 'Flight not found' }); return; }

    const { plannedLegId } = req.body as { plannedLegId?: unknown };
    if (plannedLegId !== null && !Number.isInteger(plannedLegId)) {
      res.status(400).json({ error: 'plannedLegId must be an integer or null' }); return;
    }
    if (plannedLegId !== null && !getPlannedLegById(plannedLegId as number)) {
      res.status(404).json({ error: 'Planned leg not found' }); return;
    }

    try {
      if (plannedLegId === null) {
        // Idempotent, symmetric with PUT /api/active-trip: unlinking a flight
        // that has no link is a no-op, not a 404 — there is nothing wrong
        // with the request, the flight is already in the state it asked for.
        unlinkFlightFromPlannedLeg(id);
      } else {
        linkFlightToPlannedLeg(id, plannedLegId as number, 'manual');
      }
      // A manual link/unlink bypasses FlightManager entirely, so its live-status
      // cache (design.md §19) would otherwise keep whatever autoLinkPlannedLeg
      // last set for this flight. A no-op unless `id` is the flight in progress.
      flightManager.refreshPlannedLegForFlight(id);
      res.json(getFlightById(id));
    } catch (err) {
      if (err instanceof PlannedLegAlreadyLinkedError) {
        res.status(409).json({ error: err.message }); return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  // Close a hand-linked leg by hand — or reopen it. The one transition
  // endFlight()'s touchdown rule can never reach, because the leg was linked
  // after the flight had already landed. Flight-scoped rather than a widened
  // PATCH /api/planned-legs/:legId: three of the four columns the gate reads
  // live on `flights`, and this way that PATCH — including F-1's 409 on every
  // linked leg — is left literally unchanged. design.md §5.1, §5.2, §5.6.
  //
  // This handler is the whole gate: decideHandClose() refuses here everything
  // the client merely hides. Deliberately no flightManager.refreshPlannedLegForFlight()
  // — the gate demands end_time IS NOT NULL, so the flight is never the one in
  // progress and the call could only ever be a no-op. design.md §5.7.
  app.put('/api/flights/:id/planned-leg-status', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    // Checked before the flight 404, matching PATCH /api/planned-legs/:legId: a
    // malformed body is a 400 whether or not the flight exists. 'diverted' and
    // 'skipped' are not settable here in either direction. design.md §5.4, §1.7.
    const { status } = req.body as { status?: unknown };
    if (status !== 'flown' && status !== 'planned') {
      res.status(400).json({ error: "status must be 'flown' or 'planned'" }); return;
    }

    const flight = getFlightById(id);
    if (!flight) { res.status(404).json({ error: 'Flight not found' }); return; }

    // planned_leg_id set with the row gone is unreachable (the FK is
    // ON DELETE SET NULL) but is a genuinely missing named resource, so it is a
    // 404 here rather than one of the gate's 409s. design.md §1.5.
    const leg = flight.planned_leg_id == null ? null : getPlannedLegById(flight.planned_leg_id);
    if (flight.planned_leg_id != null && !leg) {
      res.status(404).json({ error: 'Planned leg not found' }); return;
    }

    const decision = decideHandClose(status, flight, leg);
    if (!decision.allowed) { res.status(409).json({ error: decision.message }); return; }

    try {
      // The writer re-asserts linked/manual/ended inside its transaction, so a
      // concurrent unlink between the decision above and the UPDATE throws
      // rather than writing. design.md §4.3.
      const updated = setPlannedLegHandOutcome(decision.legId, decision.status, decision.deviationNm);
      if (!updated) { res.status(404).json({ error: 'Planned leg not found' }); return; }

      const saved = getPlannedLegById(decision.legId);

      // The automatic path announces itself (flightManager.ts:465, "leg #7
      // marked diverted"); without this line a leg that reads 'flown' with a
      // deviation and no matching log would be unexplainable after the fact —
      // the one asymmetry between the two ways a leg reaches 'flown'.
      console.log(
        decision.status === 'flown'
          ? `[PlannedLeg] Flight #${id} hand-marked flown ` +
            `${decision.deviationNm === null ? '(arrival position unknown)' : `${decision.deviationNm} nm`} ` +
            `from planned ${saved?.destination_ident ?? '—'} — leg #${decision.legId}`
          : `[PlannedLeg] Flight #${id} hand-reopened — leg #${decision.legId} back to planned`
      );

      res.json(saved);
    } catch (err) {
      if (err instanceof PlannedLegHandCloseConflictError) {
        res.status(409).json({ error: err.message }); return;
      }
      res.status(500).json({ error: String(err) });
    }
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
      if (err.code === 'LIMIT_FILE_SIZE') {
        // err.field distinguishes which multer instance hit its limit: the
        // shared PDF message would be wrong (and misleadingly large) for an
        // oversized .lnmpln. design.md §7.1, §20 item 2.
        const message = err.field === 'lnmpln'
          ? `File too large (max ${MAX_LNMPLN_BYTES / 1024}KB)`
          : `File too large (max ${MAX_FLIGHT_PLAN_BYTES / (1024 * 1024)}MB)`;
        res.status(400).json({ error: message });
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        res.status(400).json({ error: `Too many files (max ${MAX_LNMPLN_FILES})` });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  });

  return app;
}
