// tests/db/flights.test.ts — src/db/flights.ts against a real scratch
// database. A real database, never mocked (a file that calls
// createScratchDb() must not vi.mock('../src/db')).
//
// src/flightPlans.ts is a different concern: its fs-touching functions
// resolve a path under process.cwd()/flight_plans, which in this checkout
// holds real PDF attachments for the user's actual logbook. deleteFlight()
// and combineFlights() call into it, so it is mocked here rather than left to
// touch those real files during a test run.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Flight, FlightPoint } from '../../src/types';
import {
  insertFlight,
  closeFlight,
  insertPoint,
  updateFlight,
  setFlightPlanName,
  clearFlightPlanName,
  getFlights,
  getFlightById,
  getFlightPointCount,
  deleteFlight,
  combineFlights,
} from '../../src/db/flights';
import { createScratchDb, destroyScratchDb, seedFlight, seedPoints, type ScratchDb } from '../helpers/db';
import { T0, KSBA, KMRY } from '../helpers/index';

vi.mock('../../src/flightPlans', () => ({
  copyFlightPlanFile: vi.fn(),
  deleteFlightPlanFile: vi.fn(),
}));

import { copyFlightPlanFile, deleteFlightPlanFile } from '../../src/flightPlans';

let scratch: ScratchDb;

beforeEach(() => {
  scratch = createScratchDb();
});

afterEach(() => {
  destroyScratchDb(scratch);
});

function rawFlight(id: number): Flight | undefined {
  return scratch.db.prepare('SELECT * FROM flights WHERE id = ?').get(id) as Flight | undefined;
}

function rawPointCount(flightId: number): number {
  const row = scratch.db
    .prepare('SELECT COUNT(*) as cnt FROM flight_points WHERE flight_id = ?')
    .get(flightId) as { cnt: number };
  return row.cnt;
}

describe('insertFlight / closeFlight / insertPoint', () => {
  it('defaults departureIcao/departureName to null when omitted', () => {
    const id = insertFlight('Cessna 172', KSBA.lat, KSBA.lon, T0);
    const row = rawFlight(id) as Flight;
    expect(row.departure_icao).toBeNull();
    expect(row.departure_name).toBeNull();
    expect(row.end_time).toBeNull();
  });

  it('stores explicit departureIcao/departureName', () => {
    const id = insertFlight('Cessna 172', KSBA.lat, KSBA.lon, T0, 'KSBA', 'Santa Barbara Muni');
    const row = rawFlight(id) as Flight;
    expect(row.departure_icao).toBe('KSBA');
    expect(row.departure_name).toBe('Santa Barbara Muni');
  });

  it('closeFlight() defaults arrivalIcao/arrivalName to null when omitted', () => {
    const id = insertFlight('Cessna 172', KSBA.lat, KSBA.lon, T0);
    closeFlight(id, '2026-09-09T13:00:00.000Z', KMRY.lat, KMRY.lon, 3600, 162.5, 7500, 120, 2);
    const row = rawFlight(id) as Flight;
    expect(row.arrival_icao).toBeNull();
    expect(row.arrival_name).toBeNull();
    expect(row.end_time).toBe('2026-09-09T13:00:00.000Z');
    expect(row.duration_sec).toBe(3600);
  });

  it('closeFlight() stores explicit arrivalIcao/arrivalName', () => {
    const id = insertFlight('Cessna 172', KSBA.lat, KSBA.lon, T0);
    closeFlight(id, '2026-09-09T13:00:00.000Z', KMRY.lat, KMRY.lon, 3600, 162.5, 7500, 120, 2, 'KMRY', 'Monterey Rgnl');
    const row = rawFlight(id) as Flight;
    expect(row.arrival_icao).toBe('KMRY');
    expect(row.arrival_name).toBe('Monterey Rgnl');
  });

  it('insertPoint() stores onGround as 0/1', () => {
    const id = insertFlight('Cessna 172', KSBA.lat, KSBA.lon, T0);
    insertPoint(id, T0, KSBA.lat, KSBA.lon, 1500, 110, 105, 270, 0, false);
    insertPoint(id, '2026-09-09T12:00:10.000Z', KSBA.lat, KSBA.lon, 0, 0, 0, 270, 0, true);
    const points = scratch.db
      .prepare('SELECT * FROM flight_points WHERE flight_id = ? ORDER BY ts ASC')
      .all(id) as FlightPoint[];
    expect(points.map(p => p.on_ground)).toEqual([0, 1]);
  });
});

describe('updateFlight', () => {
  it('returns false and writes nothing when the payload has no allowed keys', () => {
    const id = seedFlight(scratch.db, { aircraft: 'Cessna 172' });
    expect(updateFlight(id, {})).toBe(false);
    expect((rawFlight(id) as Flight).aircraft).toBe('Cessna 172');
  });

  it('updates aircraft and reports a change', () => {
    const id = seedFlight(scratch.db, { aircraft: 'Cessna 172' });
    expect(updateFlight(id, { aircraft: 'Boeing 738' })).toBe(true);
    expect((rawFlight(id) as Flight).aircraft).toBe('Boeing 738');
  });

  it('returns false for an id that does not exist', () => {
    expect(updateFlight(999999, { aircraft: 'Boeing 738' })).toBe(false);
  });
});

describe('setFlightPlanName / clearFlightPlanName', () => {
  it('sets and clears flight_plan_name', () => {
    const id = seedFlight(scratch.db);
    setFlightPlanName(id, 'KSBA-KMRY.lnmpln');
    expect((rawFlight(id) as Flight).flight_plan_name).toBe('KSBA-KMRY.lnmpln');
    clearFlightPlanName(id);
    expect((rawFlight(id) as Flight).flight_plan_name).toBeNull();
  });
});

describe('getFlights', () => {
  it('orders by start_time DESC', () => {
    const earlier = seedFlight(scratch.db, { start_time: '2026-09-09T10:00:00.000Z' });
    const later = seedFlight(scratch.db, { start_time: '2026-09-09T14:00:00.000Z' });
    expect(getFlights().map(f => f.id)).toEqual([later, earlier]);
  });
});

describe('getFlightById', () => {
  it('returns null when the flight does not exist', () => {
    expect(getFlightById(999999)).toBeNull();
  });

  it('joins flight_points ordered by ts ASC', () => {
    const id = seedFlight(scratch.db);
    seedPoints(scratch.db, id, [
      { ts: '2026-09-09T12:00:10.000Z' },
      { ts: T0 },
    ]);
    const flight = getFlightById(id);
    expect(flight?.id).toBe(id);
    expect(flight?.points.map(p => p.ts)).toEqual([T0, '2026-09-09T12:00:10.000Z']);
  });
});

describe('getFlightPointCount', () => {
  it('counts points for the given flight only', () => {
    const idA = seedFlight(scratch.db);
    const idB = seedFlight(scratch.db);
    seedPoints(scratch.db, idA, [{ ts: T0 }, { ts: '2026-09-09T12:00:10.000Z' }]);
    seedPoints(scratch.db, idB, [{ ts: T0 }]);
    expect(getFlightPointCount(idA)).toBe(2);
    expect(getFlightPointCount(idB)).toBe(1);
  });
});

describe('deleteFlight', () => {
  it('returns false for an id that does not exist', () => {
    expect(deleteFlight(999999)).toBe(false);
  });

  it('deletes the flight row and cascades to its flight_points', () => {
    const id = seedFlight(scratch.db);
    seedPoints(scratch.db, id, [{ ts: T0 }, { ts: '2026-09-09T12:00:10.000Z' }]);
    expect(rawPointCount(id)).toBe(2);

    expect(deleteFlight(id)).toBe(true);

    expect(rawFlight(id)).toBeUndefined();
    expect(rawPointCount(id)).toBe(0);
    expect(deleteFlightPlanFile).toHaveBeenCalledWith(id);
  });
});

describe('combineFlights', () => {
  it('returns null for an invalid combination (neither id exists)', () => {
    expect(combineFlights(999998, 999999)).toBeNull();
  });

  it('merges two flights, carrying stats, points (with fillers) and the flight plan name', () => {
    const idA = seedFlight(scratch.db, {
      start_time: '2026-09-09T12:00:00.000Z',
      end_time: '2026-09-09T12:30:00.000Z',
      duration_sec: 1800,
      max_altitude_ft: 6000,
      max_airspeed_kts: 100,
      notes: 'first leg',
      flight_plan_name: 'KSBA-KMRY.lnmpln',
    });
    seedPoints(scratch.db, idA, [
      { ts: '2026-09-09T12:00:00.000Z', lat: KSBA.lat, lon: KSBA.lon },
      { ts: '2026-09-09T12:15:00.000Z', lat: KSBA.lat, lon: KSBA.lon },
    ]);

    const idB = seedFlight(scratch.db, {
      start_time: '2026-09-09T13:00:00.000Z',
      end_time: '2026-09-09T13:30:00.000Z',
      duration_sec: 1800,
      max_altitude_ft: 7500,
      max_airspeed_kts: 120,
      notes: 'second leg',
    });
    seedPoints(scratch.db, idB, [
      { ts: '2026-09-09T13:00:00.000Z', lat: KMRY.lat, lon: KMRY.lon },
      { ts: '2026-09-09T13:15:00.000Z', lat: KMRY.lat, lon: KMRY.lon },
    ]);

    const newId = combineFlights(idA, idB);
    expect(newId).not.toBeNull();

    const merged = rawFlight(newId as number) as Flight;
    expect(merged.start_time).toBe('2026-09-09T12:00:00.000Z');
    expect(merged.end_time).toBe('2026-09-09T13:30:00.000Z');
    // Sum of both legs' own durations, not the wall-clock span between them.
    expect(merged.duration_sec).toBe(3600);
    expect(merged.max_altitude_ft).toBe(7500);
    expect(merged.max_airspeed_kts).toBe(120);
    expect(merged.notes).toBe('first leg\n---\nsecond leg');
    expect(merged.flight_plan_name).toBe('KSBA-KMRY.lnmpln');
    expect(merged.point_count).toBe(12); // 2 + 8 fillers + 2
    expect(rawPointCount(newId as number)).toBe(12);

    expect(rawFlight(idA)).toBeUndefined();
    expect(rawFlight(idB)).toBeUndefined();
    expect(copyFlightPlanFile).toHaveBeenCalledWith(idA, newId);
    expect(deleteFlightPlanFile).toHaveBeenCalledWith(idA);
    expect(deleteFlightPlanFile).toHaveBeenCalledWith(idB);
  });
});
