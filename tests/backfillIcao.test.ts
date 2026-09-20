// tests/backfillIcao.test.ts — src/backfill-icao.ts against a real scratch
// database with ../src/airports mocked. The one file where a real database and
// a mocked module coexist: main() calls initAirports(), which would otherwise
// download the airport dataset over the network.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScratchDb, destroyScratchDb, seedFlight, seedPoints, useScratchDbEnv, type ScratchDb } from './helpers/db';
import { airportsMock, KSBA, KMRY } from './helpers';

vi.mock('../src/airports', async () => (await import('./helpers')).airportsMock);

describe('src/backfill-icao.ts', () => {
  let scratch: ScratchDb;
  let restoreEnv: () => void;

  // A mocked module's factory result is fixed the first time anything in this
  // file resolves '../src/airports', and later vi.resetModules() calls (used
  // below so each test gets a clean, uninitialized '../src/db') do not
  // refresh it. Resolving it once, up front, pins it to the airportsMock this
  // file already imported above — the same object every test configures.
  beforeAll(async () => {
    await import('../src/airports');
  });

  beforeEach(() => {
    scratch = createScratchDb();
    restoreEnv = useScratchDbEnv(scratch.file);
    vi.resetModules();
    airportsMock.findNearestAirport.mockReset().mockImplementation(() => null);
    airportsMock.initAirports.mockReset().mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    restoreEnv();
    destroyScratchDb(scratch);
  });

  function readRow(id: number) {
    return scratch.db
      .prepare('SELECT departure_icao, departure_name, arrival_icao, arrival_name FROM flights WHERE id = ?')
      .get(id) as { departure_icao: string | null; departure_name: string | null; arrival_icao: string | null; arrival_name: string | null };
  }

  it('does not run main() at import time', async () => {
    const dbMod = await import('../src/db');
    await import('../src/backfill-icao');
    expect(dbMod.getDb()).toBeUndefined();
  });

  it('fills both icao and name when a departure has neither', async () => {
    const id = seedFlight(scratch.db, {
      departure_lat: KSBA.lat, departure_lon: KSBA.lon, departure_icao: null, departure_name: null,
      arrival_lat: null, arrival_lon: null, arrival_icao: null, arrival_name: null,
    });
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });

    const mod = await import('../src/backfill-icao');
    await mod.main();

    expect(readRow(id)).toEqual(expect.objectContaining({ departure_icao: 'KSBA', departure_name: 'Santa Barbara Muni' }));
  });

  it('fills only the name when a departure already has an icao (never overwrites it)', async () => {
    const id = seedFlight(scratch.db, {
      departure_lat: KSBA.lat, departure_lon: KSBA.lon, departure_icao: 'KOLD', departure_name: null,
      arrival_lat: null, arrival_lon: null, arrival_icao: null, arrival_name: null,
    });
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });

    const mod = await import('../src/backfill-icao');
    await mod.main();

    const row = readRow(id);
    expect(row.departure_icao).toBe('KOLD'); // unchanged
    expect(row.departure_name).toBe('Santa Barbara Muni');
  });

  it('fills both icao and name when an arrival has neither', async () => {
    const id = seedFlight(scratch.db, {
      departure_lat: null, departure_lon: null, departure_icao: null, departure_name: null,
      arrival_lat: KMRY.lat, arrival_lon: KMRY.lon, arrival_icao: null, arrival_name: null,
    });
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KMRY', name: 'Monterey Rgnl' });

    const mod = await import('../src/backfill-icao');
    await mod.main();

    expect(readRow(id)).toEqual(expect.objectContaining({ arrival_icao: 'KMRY', arrival_name: 'Monterey Rgnl' }));
  });

  it('fills only the name when an arrival already has an icao (never overwrites it)', async () => {
    const id = seedFlight(scratch.db, {
      departure_lat: null, departure_lon: null, departure_icao: null, departure_name: null,
      arrival_lat: KMRY.lat, arrival_lon: KMRY.lon, arrival_icao: 'KOLD', arrival_name: null,
    });
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KMRY', name: 'Monterey Rgnl' });

    const mod = await import('../src/backfill-icao');
    await mod.main();

    const row = readRow(id);
    expect(row.arrival_icao).toBe('KOLD'); // unchanged
    expect(row.arrival_name).toBe('Monterey Rgnl');
  });

  it('leaves a flight untouched when no nearby airport is found', async () => {
    const id = seedFlight(scratch.db, {
      departure_lat: KSBA.lat, departure_lon: KSBA.lon, departure_icao: null, departure_name: null,
      arrival_lat: null, arrival_lon: null, arrival_icao: null, arrival_name: null,
    });
    airportsMock.findNearestAirport.mockReturnValue(null);

    const mod = await import('../src/backfill-icao');
    await mod.main();

    expect(readRow(id)).toEqual({ departure_icao: null, departure_name: null, arrival_icao: null, arrival_name: null });
  });

  it('takes the early-return path when every flight already has an icao and a name (nothing selected)', async () => {
    seedFlight(scratch.db); // defaults already carry departure/arrival icao and name
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'SHOULD-NOT-BE-CALLED', name: 'unused' });

    const mod = await import('../src/backfill-icao');
    await mod.main();

    expect(airportsMock.findNearestAirport).not.toHaveBeenCalled();
  });

  it('backfillIcao(db, id) fills only that flight and leaves other incomplete flights alone', async () => {
    const blank = { departure_icao: null, departure_name: null, arrival_icao: null, arrival_name: null };
    const a = seedFlight(scratch.db, blank);
    const b = seedFlight(scratch.db, blank);
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });

    const mod = await import('../src/backfill-icao');
    mod.backfillIcao(scratch.db, a);

    expect(readRow(a)).toEqual({ departure_icao: 'KSBA', departure_name: 'Santa Barbara Muni', arrival_icao: 'KSBA', arrival_name: 'Santa Barbara Muni' });
    expect(readRow(b)).toEqual(blank);
  });

  it('POST /flights/combine fills ICAO and names on the combined flight', async () => {
    const blank = { departure_icao: null, departure_name: null, arrival_icao: null, arrival_name: null };
    const a = seedFlight(scratch.db, { ...blank, start_time: '2026-09-09T12:00:00.000Z', end_time: '2026-09-09T12:30:00.000Z', arrival_lat: KMRY.lat, arrival_lon: KMRY.lon });
    const b = seedFlight(scratch.db, { ...blank, start_time: '2026-09-09T13:00:00.000Z', end_time: '2026-09-09T13:30:00.000Z' });
    seedPoints(scratch.db, a, [{ ts: '2026-09-09T12:00:00.000Z' }, { ts: '2026-09-09T12:30:00.000Z' }]);
    seedPoints(scratch.db, b, [{ ts: '2026-09-09T13:00:00.000Z' }, { ts: '2026-09-09T13:30:00.000Z' }]);
    airportsMock.findNearestAirport.mockImplementation((lat: number) =>
      lat === KSBA.lat ? { icao: 'KSBA', name: 'Santa Barbara Muni' } : { icao: 'KMRY', name: 'Monterey Rgnl' });

    // vi.resetModules() in beforeEach gave this test a fresh '../src/db' with no
    // handle, so the route's getDb() needs the module registry's own connection.
    const dbMod = await import('../src/db');
    dbMod.initDb(scratch.file);

    const { default: express } = await import('express');
    const { createFlightsRouter } = await import('../src/routes/flights');
    const app = express();
    app.use(express.json());
    app.use('/api', createFlightsRouter({ appState: { currentFlightId: null } } as never));
    const server = await new Promise<import('http').Server>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const { port } = server.address() as import('net').AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/flights/combine`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id1: a, id2: b }),
      });
      expect(res.status).toBe(201);
      const { id } = await res.json() as { id: number };
      const row = readRow(id);
      expect(row.departure_icao).toBe('KSBA');
      expect(row.departure_name).toBe('Santa Barbara Muni');
      expect(row.arrival_icao).toBe('KMRY');
      expect(row.arrival_name).toBe('Monterey Rgnl');
    } finally {
      await new Promise(r => server.close(r));
      dbMod.closeDb();
    }
  });
});
