import express, { Router } from 'express';
import { getFlightById, getTripById } from '../db';
import { flightPlanPath } from '../flightPlans';
import { renderPdf, appendPdfs } from '../pdfExport';
import {
  buildFlightKml, buildFlightSetKml, buildTripKml,
  MAX_FLIGHT_SET_IDS,
  type KmlFlightSetRequest,
} from '../kmlExport';
import { sessionCookieFrom } from '../auth/middleware';
import type { Flight } from '../types';

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

function flightExportFilename(flight: Flight, ext: 'pdf' | 'kml' = 'pdf'): string {
  // Flights produced by combineFlights() have no ICAO codes, so fall back to the id alone
  const route = (flight.departure_icao || flight.arrival_icao)
    ? `-${slugify(`${flight.departure_icao ?? 'unknown'}-${flight.arrival_icao ?? 'unknown'}`)}`
    : '';
  return `flight-${flight.id}${route}-${dateStamp(flight.start_time)}.${ext}`;
}

function sendPdf(res: express.Response, pdf: Buffer, filename: string): void {
  const safeName = filename.replace(/["\\\r\n/]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.end(pdf);
}

/** Same header-sanitising rule as sendPdf(). */
function sendKml(res: express.Response, kml: string, filename: string): void {
  const safeName = filename.replace(/["\\\r\n/]/g, '_');
  const buf = Buffer.from(kml, 'utf8');
  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.end(buf);
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

/**
 * /api — the PDF and KML export routes. Mounted at '/api' by src/server.ts,
 * before the SPA catch-all so they aren't swallowed by it.
 */
export function createExportsRouter(): Router {
  const router = express.Router();

  // ── PDF export ────────────────────────────────────────────────────────────

  router.get('/flights/:id/export.pdf', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const flight = getFlightById(id);
    if (!flight) { res.status(404).json({ error: 'Flight not found' }); return; }

    try {
      // The print page fetches its data from the gated /api, so the headless
      // render carries this caller's own session cookie.
      let pdf = await renderPdf(`/print/flight/${id}${localeParams(req)}`, { sessionCookie: sessionCookieFrom(req) });
      if (flight.flight_plan_name && includePlans(req)) {
        pdf = await appendPdfs(pdf, [flightPlanPath(id)]);
      }
      sendPdf(res, pdf, flightExportFilename(flight));
    } catch (err) {
      console.error('[PDF] Flight export failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/trips/:id/export.pdf', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const trip = getTripById(id);
    if (!trip) { res.status(404).json({ error: 'Trip not found' }); return; }

    try {
      // Same as the flight export above.
      let pdf = await renderPdf(`/print/trip/${id}${localeParams(req)}`, { sessionCookie: sessionCookieFrom(req) });
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

  // ── KML export ────────────────────────────────────────────────────────────

  router.get('/flights/:id/export.kml', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const flight = getFlightById(id);
    if (!flight) { res.status(404).json({ error: 'Flight not found' }); return; }

    try {
      const kml = buildFlightKml(flight);
      sendKml(res, kml, flightExportFilename(flight, 'kml'));
    } catch (err) {
      console.error('[KML] Flight export failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/trips/:id/export.kml', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const trip = getTripById(id);
    if (!trip) { res.status(404).json({ error: 'Trip not found' }); return; }

    try {
      const kml = buildTripKml(trip.name, trip.flights);
      sendKml(res, kml, `trip-${slugify(trip.name) || trip.id}-${dateStamp(trip.created_at)}.kml`);
    } catch (err) {
      console.error('[KML] Trip export failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // The flight-set scope: an arbitrary list of ids in the body, not a single
  // resource in the path, so it cannot live at GET /api/flights/:id/export.kml
  // — that is why this is a POST.
  router.post('/flights/export.kml', (req, res) => {
    const { ids } = (req.body ?? {}) as KmlFlightSetRequest;

    // Checks run in this order — shape, then emptiness, then cap, then
    // per-element integer check.
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'ids must be an array of integers' });
      return;
    }
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids must contain at least one flight id' });
      return;
    }
    if (ids.length > MAX_FLIGHT_SET_IDS) {
      res.status(400).json({ error: `Too many flights: ${ids.length} requested, maximum is ${MAX_FLIGHT_SET_IDS}` });
      return;
    }
    if (!ids.every(Number.isInteger)) {
      res.status(400).json({ error: 'ids must be an array of integers' });
      return;
    }

    // First occurrence wins; the duplicate is dropped before any lookup, so it
    // is not counted against the cap and does not affect the filename's n.
    const distinctIds = [...new Set(ids)];

    const flights: NonNullable<ReturnType<typeof getFlightById>>[] = [];
    for (const id of distinctIds) {
      const flight = getFlightById(id);
      if (!flight) { res.status(404).json({ error: `Flight ${id} not found` }); return; }
      flights.push(flight);
    }

    try {
      const kml = buildFlightSetKml(flights);
      const earliest = flights.reduce((min, f) => (f.start_time < min ? f.start_time : min), flights[0].start_time);
      sendKml(res, kml, `flights-${flights.length}-${dateStamp(earliest)}.kml`);
    } catch (err) {
      console.error('[KML] Flight set export failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
