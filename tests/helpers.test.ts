// tests/helpers.test.ts — self-test for tests/helpers/index.ts (T-002).
//
// Proves each builder returns an object satisfying the real type it claims to
// build, that per-field overrides apply without disturbing the rest of the
// defaults, that the dbMock stubs cover every ./db import src/flightManager.ts
// makes and record their call arguments, and that resetMocks() re-installs
// default implementations even after vitest's restoreMocks strips them
// (design.md §6.4 — the trap this module exists to avoid).

import { describe, expect, it, vi } from 'vitest';
import type { SimFrame, LegMatchCandidate, PlannedLegWithChildren } from '../src/types';
import type { HandCloseFlight, HandCloseLeg } from '../src/plannedLegClose';
import {
  makeFrame, makeCandidate, makeHandCloseFlight, makeHandCloseLeg, makePlannedLegWithChildren,
  dbMock, airportsMock, resetMocks, nextFlightId,
  northOfNm, NM_PER_DEG, DEG_PER_NM, KSBA,
} from './helpers';

describe('makeFrame', () => {
  it('returns a SimFrame with every field at its §4.2 default', () => {
    const f: SimFrame = makeFrame();
    expect(f).toEqual({
      lat: 34.426201,
      lon: -119.841507,
      altitudeFt: 1500,
      airspeedKnots: 110,
      groundSpeedKnots: 105,
      headingDeg: 270,
      verticalSpeedFpm: 500,
      onGround: false,
      simRunning: 1,
      aircraft: 'Cessna 172',
    });
  });

  it('applies a single override and leaves every other field at default', () => {
    const f = makeFrame({ onGround: true });
    expect(f.onGround).toBe(true);
    expect(f).toEqual({ ...makeFrame(), onGround: true });
  });
});

describe('makeCandidate', () => {
  it('returns a LegMatchCandidate with every field at its §4.3 default', () => {
    const c: LegMatchCandidate = makeCandidate();
    expect(c).toEqual({
      plannedLegId: 11,
      tripId: 1,
      seq: 1,
      departureIdent: 'KSBA',
      departureIsAirport: true,
      departureLat: 34.426201,
      departureLon: -119.841507,
      status: 'planned',
      linkedFlightId: null,
      aircraftType: 'C172',
    });
  });

  it('is eligible per src/legMatcher.ts refusalFor(): status planned, unlinked, departure is an airport', () => {
    // refusalFor() itself is not exported; these are exactly the fields it
    // checks (src/legMatcher.ts:126-131) — flown/diverted/skipped status,
    // a non-null linkedFlightId, or a non-airport departure each refuse.
    const c = makeCandidate();
    expect(c.status).toBe('planned');
    expect(c.linkedFlightId).toBeNull();
    expect(c.departureIsAirport).toBe(true);
  });

  it('applies an override and leaves every other field at default', () => {
    const c = makeCandidate({ linkedFlightId: 42 });
    expect(c.linkedFlightId).toBe(42);
    expect(c).toEqual({ ...makeCandidate(), linkedFlightId: 42 });
  });
});

describe('makeHandCloseFlight / makeHandCloseLeg', () => {
  it('makeHandCloseFlight returns a HandCloseFlight with every field at its §4.4 default', () => {
    const flight: HandCloseFlight = makeHandCloseFlight();
    expect(flight).toEqual({
      id: 900,
      end_time: '2026-09-07T17:06:00.726Z',
      planned_leg_id: 500,
      planned_leg_link_source: 'manual',
      arrival_lat: 34.426201,
      arrival_lon: -119.841507,
    });
  });

  it('makeHandCloseFlight applies an override and leaves every other field at default', () => {
    const flight = makeHandCloseFlight({ planned_leg_link_source: 'auto' });
    expect(flight.planned_leg_link_source).toBe('auto');
    expect(flight).toEqual({ ...makeHandCloseFlight(), planned_leg_link_source: 'auto' });
  });

  it('makeHandCloseLeg returns a HandCloseLeg with every field at its §4.4 default', () => {
    const leg: HandCloseLeg = makeHandCloseLeg();
    expect(leg).toEqual({
      id: 500,
      status: 'planned',
      destination_lat: 36.586952,
      destination_lon: -121.843079,
    });
  });

  it('makeHandCloseLeg applies an override and leaves every other field at default', () => {
    const leg = makeHandCloseLeg({ status: 'flown' });
    expect(leg.status).toBe('flown');
    expect(leg).toEqual({ ...makeHandCloseLeg(), status: 'flown' });
  });
});

describe('makePlannedLegWithChildren', () => {
  it('returns a complete, type-valid PlannedLegWithChildren at its §4.5 defaults', () => {
    const leg: PlannedLegWithChildren = makePlannedLegWithChildren();
    expect(leg.id).toBe(11);
    expect(leg.trip_id).toBe(1);
    expect(leg.departure_ident).toBe('KSBA');
    expect(leg.destination_ident).toBe('KMRY');
    expect(leg.destination_lat).toBe(36.586952);
    expect(leg.destination_lon).toBe(-121.843079);
    expect(leg.linked_flight_id).toBeNull();
    expect(leg.alternates).toEqual([]);
    // Every "remaining" field (departure_start*, departure_pos_*, sid_*,
    // star_*, approach_*, remarks) defaults to null per §4.5.
    expect(leg.departure_start).toBeNull();
    expect(leg.departure_pos_lat).toBeNull();
    expect(leg.sid_name).toBeNull();
    expect(leg.star_name).toBeNull();
    expect(leg.approach_name).toBeNull();
    expect(leg.remarks).toBeNull();
  });

  it('waypoints is departure-first, destination-last, the order buildPlannedLegCache() depends on', () => {
    const leg = makePlannedLegWithChildren();
    expect(leg.waypoints).toHaveLength(2);
    expect(leg.waypoints[0].ident).toBe('KSBA');
    expect(leg.waypoints[0].seq).toBe(1);
    expect(leg.waypoints[1].ident).toBe('KMRY');
    expect(leg.waypoints[1].seq).toBe(2);
  });

  it('applies an override and leaves every other field at default', () => {
    const leg = makePlannedLegWithChildren({ status: 'flown' });
    expect(leg.status).toBe('flown');
    expect(leg).toEqual({ ...makePlannedLegWithChildren(), status: 'flown' });
  });

  it('mutating one builder call\'s waypoints does not leak into the next call', () => {
    const first = makePlannedLegWithChildren();
    first.waypoints[0].ident = 'MUTATED';
    const second = makePlannedLegWithChildren();
    expect(second.waypoints[0].ident).toBe('KSBA');
  });
});

describe('geometry helpers', () => {
  it('northOfNm moves latitude north by DEG_PER_NM per nm, not /60', () => {
    const moved = northOfNm(KSBA, 60);
    expect(moved.lon).toBe(KSBA.lon);
    expect(moved.lat).toBeCloseTo(KSBA.lat + 60 * DEG_PER_NM, 10);
    // One arc-minute is NOT one nm here: 60 nm north is less than a full
    // degree of latitude change (NM_PER_DEG > 60).
    expect(moved.lat - KSBA.lat).toBeLessThan(1);
    expect(NM_PER_DEG).toBeGreaterThan(60);
  });
});

describe('dbMock', () => {
  it('stubs all ten functions src/flightManager.ts imports from ./db', () => {
    const names = [
      'insertFlight', 'insertPoint', 'closeFlight', 'getFlightPlannedLegId',
      'getActiveTripId', 'getPlannedLegCandidatesForActiveTrip', 'getPlannedLegById',
      'linkFlightToPlannedLeg', 'recordPlannedLegArrival', 'getTripName',
    ] as const;
    expect(names).toHaveLength(10);
    for (const name of names) {
      expect(typeof dbMock[name]).toBe('function');
      expect(vi.isMockFunction(dbMock[name])).toBe(true);
    }
  });

  it('default stub behaviour matches §6.2', () => {
    resetMocks();
    expect(dbMock.insertFlight('Cessna 172', 1, 2, '2026-09-09T12:00:00.000Z')).toBe(1);
    expect(dbMock.insertFlight('Cessna 172', 1, 2, '2026-09-09T12:00:00.000Z')).toBe(2);
    expect(dbMock.insertPoint(1, 't', 1, 2, 3, 4, 5, 6, 7, false)).toBeUndefined();
    expect(dbMock.getFlightPlannedLegId(1)).toBeNull();
    expect(dbMock.getActiveTripId()).toBeNull();
    expect(dbMock.getPlannedLegCandidatesForActiveTrip()).toEqual([]);
    expect(dbMock.getPlannedLegById(1)).toBeNull();
    expect(dbMock.getTripName(1)).toBe('Test Trip');
  });

  it('records the call arguments of linkFlightToPlannedLeg', () => {
    resetMocks();
    dbMock.linkFlightToPlannedLeg(7, 11, 'auto');
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledTimes(1);
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledWith(7, 11, 'auto');
  });

  it('nextFlightId() reads the counter without advancing it', () => {
    resetMocks();
    expect(nextFlightId()).toBe(1);
    expect(nextFlightId()).toBe(1);
    dbMock.insertFlight('Cessna 172', 1, 2, '2026-09-09T12:00:00.000Z');
    expect(nextFlightId()).toBe(2);
  });

  it('vi.restoreAllMocks() (what config restoreMocks: true runs) does NOT touch a plain vi.fn() (§6.4 trap, verified against @vitest/spy)', () => {
    // dbMock's functions are plain vi.fn()s, not vi.spyOn() spies, so
    // vitest's restoreMocks: true — which calls vi.restoreAllMocks() — is a
    // no-op on them: it restores only vi.spyOn() spies. This is exactly why
    // this module ships its own resetMocks() rather than relying on vitest's
    // automatic hook.
    resetMocks();
    dbMock.getTripName.mockImplementation(() => 'Overridden');
    vi.restoreAllMocks();
    expect(dbMock.getTripName(1)).toBe('Overridden'); // NOT restored — the trap
  });

  it('resetMocks() re-installs default implementations after a test overrides one, and clears call history and the flight-id counter', () => {
    resetMocks();
    dbMock.getTripName.mockImplementation(() => 'Overridden');
    dbMock.linkFlightToPlannedLeg(7, 11, 'auto');
    dbMock.insertFlight('Cessna 172', 1, 2, '2026-09-09T12:00:00.000Z');
    expect(nextFlightId()).toBe(2);

    resetMocks();

    expect(dbMock.getTripName(1)).toBe('Test Trip'); // default re-installed
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled(); // history cleared
    expect(nextFlightId()).toBe(1); // counter reset
    expect(dbMock.insertFlight('Cessna 172', 1, 2, '2026-09-09T12:00:00.000Z')).toBe(1);
  });
});

describe('airportsMock', () => {
  it('stubs findNearestAirport and initAirports per §6.3', () => {
    resetMocks();
    expect(airportsMock.findNearestAirport(0, 0)).toBeNull();
    return expect(airportsMock.initAirports()).resolves.toBeUndefined();
  });

  it('resetMocks() re-installs defaults after a test overrides one and clears call history', () => {
    resetMocks();
    airportsMock.findNearestAirport.mockImplementation(() => ({ icao: 'KSBA', name: 'Santa Barbara Muni' }));
    airportsMock.findNearestAirport(0, 0);

    resetMocks();

    expect(airportsMock.findNearestAirport).not.toHaveBeenCalled();
    expect(airportsMock.findNearestAirport(0, 0)).toBeNull();
  });
});
