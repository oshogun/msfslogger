// tests/flightsChanged.test.ts — the onChanged callback createFlightsRouter,
// createTripsRouter, createPlannedLegsRouter and createGroundSessionsRouter
// now accept: every mutation handler calls it exactly once immediately before
// its 2xx response, and never on a 4xx/5xx.
//
// A real scratch database (never mocked) and a real HTTP server, the same
// pattern as tests/sayIntentions.test.ts and tests/legCacheRefreshOnDelete.test.ts.
// Two dependencies are stubbed rather than exercised for real: SimBrief's
// fetch, a partial mock of ../src/simbriefClient (same technique as
// tests/sayIntentions.test.ts's getCommsHistory stub); and the flight-plan
// PDF file writes, a partial mock of ../src/flightPlans — its target
// directory is computed once from process.cwd() at import time, before any
// test runs, so there is no way to redirect it into scratch from inside a
// test. Everything else, including the .lnmpln parser and every db write,
// runs for real against the scratch database file.

import express from 'express';
import fs from 'fs';
import path from 'path';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/simbriefClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/simbriefClient')>();
  return { ...actual, fetchSimbriefPlan: vi.fn() };
});
vi.mock('../src/flightPlans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/flightPlans')>();
  return { ...actual, saveFlightPlanFile: vi.fn(), deleteFlightPlanFile: vi.fn() };
});

import { createFlightsRouter } from '../src/routes/flights';
import { createTripsRouter } from '../src/routes/trips';
import { createPlannedLegsRouter } from '../src/routes/plannedLegs';
import { createGroundSessionsRouter } from '../src/routes/groundSessions';
import type { FlightManager } from '../src/flightManager';
import { fetchSimbriefPlan } from '../src/simbriefClient';
import { SIMBRIEF_USER_ID_SETTING } from '../src/simbrief';
import { setSetting } from '../src/db/settings';
import {
  createScratchDb, destroyScratchDb,
  seedTrip, seedFlight, seedPoints, seedPlannedLeg,
  type ScratchDb,
} from './helpers/db';

const fetchSimbriefPlanMock = vi.mocked(fetchSimbriefPlan);

const LNMPLN_ROOT = path.resolve(__dirname, '../samples/lnmpln');
const SIMBRIEF_FIXTURE = path.resolve(__dirname, '../samples/simbrief/simbrief.userid.json');

function simbriefFixtureBody(): unknown {
  return JSON.parse(fs.readFileSync(SIMBRIEF_FIXTURE, 'utf8'));
}

function lnmplnFormData(filename: string): FormData {
  const buf = fs.readFileSync(path.join(LNMPLN_ROOT, filename));
  const form = new FormData();
  form.append('lnmpln', new Blob([buf]), filename);
  return form;
}

function makeFlightManager(currentFlightId: number | null = null): FlightManager {
  return {
    appState: { currentFlightId, lastFrame: null },
    refreshPlannedLegForFlight: vi.fn(),
    refreshGroundSession: vi.fn(),
  } as unknown as FlightManager;
}

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function startServer(flightManager: FlightManager, onChanged: () => void): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api', createFlightsRouter(flightManager, onChanged));
  app.use('/api', createTripsRouter(flightManager, onChanged));
  app.use('/api', createPlannedLegsRouter(flightManager, onChanged));
  app.use('/api', createGroundSessionsRouter(flightManager, onChanged));

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Test server did not bind to a TCP port'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((res, rej) => {
          server.close(err => (err ? rej(err) : res()));
        }),
      });
    });
    server.on('error', reject);
  });
}

async function json(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json() };
}
function postJson(url: string, body: unknown) {
  return json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function patchJson(url: string, body: unknown) {
  return json(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function putJson(url: string, body: unknown) {
  return json(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function del(url: string) {
  return json(url, { method: 'DELETE' });
}
function postForm(url: string, form: FormData) {
  return json(url, { method: 'POST', body: form });
}

let scratch: ScratchDb;
let server: TestServer;
let onChanged: ReturnType<typeof vi.fn<() => void>>;
let flightManager: FlightManager;

beforeEach(async () => {
  scratch = createScratchDb();
  onChanged = vi.fn<() => void>();
  flightManager = makeFlightManager();
  server = await startServer(flightManager, onChanged);
  fetchSimbriefPlanMock.mockReset();
});

afterEach(async () => {
  await server.close();
  destroyScratchDb(scratch);
});

// ── flights.ts ────────────────────────────────────────────────────────────

describe('POST /flights/combine', () => {
  it('calls onChanged once on 201', async () => {
    const id1 = seedFlight(scratch.db, { start_time: '2026-09-09T12:00:00.000Z' });
    const id2 = seedFlight(scratch.db, { start_time: '2026-09-09T13:00:00.000Z' });
    seedPoints(scratch.db, id1, [{ ts: '2026-09-09T12:00:00.000Z' }]);
    seedPoints(scratch.db, id2, [{ ts: '2026-09-09T13:00:00.000Z' }]);

    const { status } = await postJson(`${server.baseUrl}/api/flights/combine`, { id1, id2 });

    expect(status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (same id twice)', async () => {
    const { status } = await postJson(`${server.baseUrl}/api/flights/combine`, { id1: 1, id2: 1 });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PATCH /flights/:id', () => {
  it('calls onChanged once on 200', async () => {
    const id = seedFlight(scratch.db);
    const { status } = await patchJson(`${server.baseUrl}/api/flights/${id}`, { notes: 'updated' });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (no valid fields)', async () => {
    const { status } = await patchJson(`${server.baseUrl}/api/flights/1`, {});
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('DELETE /flights/:id', () => {
  it('calls onChanged once on 200', async () => {
    const id = seedFlight(scratch.db);
    const { status } = await del(`${server.baseUrl}/api/flights/${id}`);
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404', async () => {
    const { status } = await del(`${server.baseUrl}/api/flights/999999`);
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('POST /flights/:id/flight-plan', () => {
  it('calls onChanged once on 200', async () => {
    const id = seedFlight(scratch.db);
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'plan.pdf');

    const { status } = await postForm(`${server.baseUrl}/api/flights/${id}/flight-plan`, form);

    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (no file)', async () => {
    const id = seedFlight(scratch.db);
    const form = new FormData();

    const { status } = await postForm(`${server.baseUrl}/api/flights/${id}/flight-plan`, form);

    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('DELETE /flights/:id/flight-plan', () => {
  it('calls onChanged once on 200', async () => {
    const id = seedFlight(scratch.db);
    const { status } = await del(`${server.baseUrl}/api/flights/${id}/flight-plan`);
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404', async () => {
    const { status } = await del(`${server.baseUrl}/api/flights/999999/flight-plan`);
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// ── trips.ts ──────────────────────────────────────────────────────────────

describe('POST /trips', () => {
  it('calls onChanged once on 201', async () => {
    const { status } = await postJson(`${server.baseUrl}/api/trips`, { name: 'Alaska 2026' });
    expect(status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (empty name)', async () => {
    const { status } = await postJson(`${server.baseUrl}/api/trips`, { name: '  ' });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PATCH /trips/:id', () => {
  it('calls onChanged once on 200', async () => {
    const id = seedTrip(scratch.db);
    const { status } = await patchJson(`${server.baseUrl}/api/trips/${id}`, { name: 'Renamed' });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (no valid fields)', async () => {
    const id = seedTrip(scratch.db);
    const { status } = await patchJson(`${server.baseUrl}/api/trips/${id}`, {});
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('DELETE /trips/:id', () => {
  it('calls onChanged once on 200', async () => {
    const id = seedTrip(scratch.db);
    const { status } = await del(`${server.baseUrl}/api/trips/${id}`);
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404', async () => {
    const { status } = await del(`${server.baseUrl}/api/trips/999999`);
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('POST /trips/:id/flights', () => {
  it('calls onChanged once on 200', async () => {
    const tripId = seedTrip(scratch.db);
    const flightId = seedFlight(scratch.db);
    const { status } = await postJson(`${server.baseUrl}/api/trips/${tripId}/flights`, { flightId });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404 (trip not found)', async () => {
    const flightId = seedFlight(scratch.db);
    const { status } = await postJson(`${server.baseUrl}/api/trips/999999/flights`, { flightId });
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('DELETE /trips/:id/flights/:flightId', () => {
  it('calls onChanged once on 200', async () => {
    const tripId = seedTrip(scratch.db);
    const flightId = seedFlight(scratch.db, { trip_id: tripId });
    const { status } = await del(`${server.baseUrl}/api/trips/${tripId}/flights/${flightId}`);
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404 (flight not found)', async () => {
    const tripId = seedTrip(scratch.db);
    const { status } = await del(`${server.baseUrl}/api/trips/${tripId}/flights/999999`);
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PUT /active-trip', () => {
  it('calls onChanged once on 200', async () => {
    const tripId = seedTrip(scratch.db);
    const { status } = await putJson(`${server.baseUrl}/api/active-trip`, { tripId });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (tripId not an integer)', async () => {
    const { status } = await putJson(`${server.baseUrl}/api/active-trip`, { tripId: 'nope' });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// ── plannedLegs.ts ────────────────────────────────────────────────────────

describe('POST /trips/:id/planned-legs (.lnmpln import)', () => {
  it('calls onChanged once on 201', async () => {
    const tripId = seedTrip(scratch.db);
    const form = lnmplnFormData('VFR Santa Barbara Muni (KSBA) to Monterey Rgnl (KMRY).lnmpln');

    const { status } = await postForm(`${server.baseUrl}/api/trips/${tripId}/planned-legs`, form);

    expect(status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (no files)', async () => {
    const tripId = seedTrip(scratch.db);
    const { status } = await postForm(`${server.baseUrl}/api/trips/${tripId}/planned-legs`, new FormData());
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('POST /planned-legs (.lnmpln import, loose)', () => {
  it('calls onChanged once on 201', async () => {
    const form = lnmplnFormData('VFR Monterey Rgnl (KMRY) to San Francisco Intl (KSFO).lnmpln');
    const { status } = await postForm(`${server.baseUrl}/api/planned-legs`, form);
    expect(status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (no files)', async () => {
    const { status } = await postForm(`${server.baseUrl}/api/planned-legs`, new FormData());
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('POST /trips/:id/planned-legs/simbrief', () => {
  it('calls onChanged once on the imported 201 and once more on the duplicate 200', async () => {
    setSetting(SIMBRIEF_USER_ID_SETTING, 'pilot123');
    fetchSimbriefPlanMock.mockResolvedValue(simbriefFixtureBody());
    const tripId = seedTrip(scratch.db);

    const first = await postJson(`${server.baseUrl}/api/trips/${tripId}/planned-legs/simbrief`, {});
    expect(first.status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);

    const second = await postJson(`${server.baseUrl}/api/trips/${tripId}/planned-legs/simbrief`, {});
    expect(second.status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('does not call onChanged on a 400 (no SimBrief user id saved)', async () => {
    const tripId = seedTrip(scratch.db);
    const { status } = await postJson(`${server.baseUrl}/api/trips/${tripId}/planned-legs/simbrief`, {});
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('POST /planned-legs/simbrief (loose)', () => {
  it('calls onChanged once on the imported 201 and once more on the duplicate 200', async () => {
    setSetting(SIMBRIEF_USER_ID_SETTING, 'pilot123');
    fetchSimbriefPlanMock.mockResolvedValue(simbriefFixtureBody());

    const first = await postJson(`${server.baseUrl}/api/planned-legs/simbrief`, {});
    expect(first.status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);

    const second = await postJson(`${server.baseUrl}/api/planned-legs/simbrief`, {});
    expect(second.status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('does not call onChanged on a 400 (no SimBrief user id saved)', async () => {
    const { status } = await postJson(`${server.baseUrl}/api/planned-legs/simbrief`, {});
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PATCH /trips/:id/planned-legs/order', () => {
  it('calls onChanged once on 200', async () => {
    const tripId = seedTrip(scratch.db);
    const legId = seedPlannedLeg(scratch.db, { trip_id: tripId });
    const { status } = await patchJson(`${server.baseUrl}/api/trips/${tripId}/planned-legs/order`, { legIds: [legId] });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (legIds mismatch)', async () => {
    const tripId = seedTrip(scratch.db);
    seedPlannedLeg(scratch.db, { trip_id: tripId });
    const { status } = await patchJson(`${server.baseUrl}/api/trips/${tripId}/planned-legs/order`, { legIds: [] });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('DELETE /planned-legs/:legId', () => {
  it('calls onChanged once on 200', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const { status } = await del(`${server.baseUrl}/api/planned-legs/${legId}`);
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404', async () => {
    const { status } = await del(`${server.baseUrl}/api/planned-legs/999999`);
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PATCH /planned-legs/:legId', () => {
  it('calls onChanged once on 200', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const { status } = await patchJson(`${server.baseUrl}/api/planned-legs/${legId}`, { status: 'skipped' });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (invalid status)', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const { status } = await patchJson(`${server.baseUrl}/api/planned-legs/${legId}`, { status: 'flown' });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PUT /flights/:id/planned-leg', () => {
  it('calls onChanged once on 200', async () => {
    const flightId = seedFlight(scratch.db);
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const { status } = await putJson(`${server.baseUrl}/api/flights/${flightId}/planned-leg`, { plannedLegId: legId });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404 (flight not found)', async () => {
    const { status } = await putJson(`${server.baseUrl}/api/flights/999999/planned-leg`, { plannedLegId: null });
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PUT /flights/:id/planned-leg-status', () => {
  it('calls onChanged once on 200', async () => {
    const legId = seedPlannedLeg(scratch.db, { trip_id: null });
    const flightId = seedFlight(scratch.db, {
      end_time: '2026-09-09T13:00:00.000Z',
      planned_leg_id: legId,
      planned_leg_link_source: 'manual',
    });
    const { status } = await putJson(`${server.baseUrl}/api/flights/${flightId}/planned-leg-status`, { status: 'flown' });
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (invalid status)', async () => {
    const { status } = await putJson(`${server.baseUrl}/api/flights/1/planned-leg-status`, { status: 'bogus' });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// ── groundSessions.ts ─────────────────────────────────────────────────────

describe('POST /ground-sessions', () => {
  it('calls onChanged once on 201', async () => {
    const { status } = await postJson(`${server.baseUrl}/api/ground-sessions`, { icao: 'KSBA' });
    expect(status).toBe(201);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 400 (bad icao shape)', async () => {
    const { status } = await postJson(`${server.baseUrl}/api/ground-sessions`, { icao: 'NOPE!' });
    expect(status).toBe(400);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('DELETE /ground-sessions/current', () => {
  it('calls onChanged once on 200', async () => {
    await postJson(`${server.baseUrl}/api/ground-sessions`, { icao: 'KSBA' });
    onChanged.mockClear();

    const { status } = await del(`${server.baseUrl}/api/ground-sessions/current`);
    expect(status).toBe(200);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not call onChanged on a 404 (nothing open)', async () => {
    const { status } = await del(`${server.baseUrl}/api/ground-sessions/current`);
    expect(status).toBe(404);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
