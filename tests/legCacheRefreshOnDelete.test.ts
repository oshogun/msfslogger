// tests/legCacheRefreshOnDelete.test.ts — DELETE /trips/:id, DELETE
// /planned-legs/:legId and DELETE /flights/:id against a real scratch
// database (never mocked) and a real HTTP server, with a fake FlightManager
// (only the two members these routes touch: appState.currentFlightId and
// refreshPlannedLegForFlight()) so each case can drive the in-progress-flight
// branch directly.

import express from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTripsRouter } from '../src/routes/trips';
import { createFlightsRouter } from '../src/routes/flights';
import { createPlannedLegsRouter } from '../src/routes/plannedLegs';
import type { FlightManager } from '../src/flightManager';
import { createScratchDb, destroyScratchDb, seedTrip, seedFlight, seedPlannedLeg, type ScratchDb } from './helpers/db';

interface FakeFlightManager {
  appState: { currentFlightId: number | null };
  refreshPlannedLegForFlight: ReturnType<typeof vi.fn>;
}

function makeFlightManager(currentFlightId: number | null, refreshImpl?: (id: number) => void): FakeFlightManager {
  return {
    appState: { currentFlightId },
    refreshPlannedLegForFlight: vi.fn(refreshImpl),
  };
}

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function startServer(flightManager: FakeFlightManager): Promise<TestServer> {
  const fm = flightManager as unknown as FlightManager;
  const app = express();
  app.use(express.json());
  app.use('/api', createTripsRouter(fm));
  app.use('/api', createFlightsRouter(fm));
  app.use('/api', createPlannedLegsRouter(fm));

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

async function deleteJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

let scratch: ScratchDb;
let server: TestServer | undefined;

beforeEach(() => {
  scratch = createScratchDb();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  destroyScratchDb(scratch);
});

describe.each([
  {
    name: 'DELETE /trips/:id',
    seed: () => seedTrip(scratch.db),
    url: (id: number) => `/api/trips/${id}`,
  },
  {
    name: 'DELETE /planned-legs/:legId',
    seed: () => seedPlannedLeg(scratch.db, { trip_id: null }),
    url: (id: number) => `/api/planned-legs/${id}`,
  },
  {
    name: 'DELETE /flights/:id',
    seed: () => seedFlight(scratch.db),
    url: (id: number) => `/api/flights/${id}`,
  },
])('$name — leg-cache refresh on delete', ({ seed, url }) => {
  it('success with a current flight calls refreshPlannedLegForFlight(currentFlightId) once', async () => {
    const id = seed();
    const flightManager = makeFlightManager(412);
    server = await startServer(flightManager);

    const { status } = await deleteJson(`${server.baseUrl}${url(id)}`);

    expect(status).toBe(200);
    expect(flightManager.refreshPlannedLegForFlight).toHaveBeenCalledTimes(1);
    expect(flightManager.refreshPlannedLegForFlight).toHaveBeenCalledWith(412);
  });

  it('currentFlightId null does not call refreshPlannedLegForFlight', async () => {
    const id = seed();
    const flightManager = makeFlightManager(null);
    server = await startServer(flightManager);

    const { status } = await deleteJson(`${server.baseUrl}${url(id)}`);

    expect(status).toBe(200);
    expect(flightManager.refreshPlannedLegForFlight).not.toHaveBeenCalled();
  });

  it('404 (nothing deleted) does not call refreshPlannedLegForFlight', async () => {
    const flightManager = makeFlightManager(412);
    server = await startServer(flightManager);

    const { status } = await deleteJson(`${server.baseUrl}${url(999999)}`);

    expect(status).toBe(404);
    expect(flightManager.refreshPlannedLegForFlight).not.toHaveBeenCalled();
  });

  it('a throwing refresh still answers 200 and logs a warning', async () => {
    const id = seed();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const flightManager = makeFlightManager(412, () => { throw new Error('cache refresh boom'); });
    server = await startServer(flightManager);

    const { status, body } = await deleteJson(`${server.baseUrl}${url(id)}`);

    expect(status).toBe(200);
    expect(body).toEqual({ deleted: true });
    expect(flightManager.refreshPlannedLegForFlight).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe('[Routes] leg cache refresh after delete failed:');
    warnSpy.mockRestore();
  });
});
