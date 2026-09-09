// tests/flightManager.test.ts — src/flightManager.ts, T-008 part 3 of 3.
//
// The planned-leg seam: the auto-match at takeoff, the live status the /api/status
// poll reads, the arrival outcome written at landing, and the manual-link refresh.
//
// The matcher itself is NOT mocked (design.md §6.5) — src/legMatcher.ts is pure
// and is the logic under test here as much as FlightManager is. Only './db' and
// './airports' are replaced, so the candidates are ours and the decision is the
// real one.
//
// State-machine and duration coverage live in tests/flightManager.state.test.ts
// and tests/flightManager.duration.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlannedWaypoint, SimFrame } from '../src/types';
import {
  dbMock, resetMocks, makeFrame, makeCandidate, makePlannedLegWithChildren,
  northOfNm, KSBA, KMRY, useFakeClock, useRealClock,
} from './helpers';
import { haversineNm } from '../src/geo';

vi.mock('../src/db', async () => (await import('./helpers')).dbMock);
vi.mock('../src/airports', async () => (await import('./helpers')).airportsMock);

import { FlightManager } from '../src/flightManager';

// src/legMatcher.ts:111 — the flown/diverted threshold, imported rather than
// transcribed because it IS exported.
import { ARRIVAL_RADIUS_NM } from '../src/legMatcher';

const advance = (ms: number) => vi.advanceTimersByTime(ms);
const LANDED: Partial<SimFrame> = { onGround: true, groundSpeedKnots: 2, airspeedKnots: 0 };
const TRIP = 7;

function takeoff(fm: FlightManager, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < 3; i++) fm.onFrame(makeFrame(over));
}

function land(fm: FlightManager, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < 10; i++) {
    advance(1000);
    fm.onFrame(makeFrame({ ...LANDED, ...over }));
  }
}

/** A PlannedWaypoint with only the four fields buildPlannedLegCache() reads set. */
function wp(seq: number, ident: string, lat: number, lon: number): PlannedWaypoint {
  return {
    id: seq, planned_leg_id: 11, seq, ident, name: ident,
    region: null, airway: null, track: null, type: 'WAYPOINT', comment: null,
    lat, lon, alt_ft: null,
  };
}

/**
 * Arrange a leg the matcher will accept: an active trip, one eligible candidate
 * whose departure is exactly `from`, and the leg row the link path reads back.
 */
function arrangeMatch(from: { lat: number; lon: number }, waypoints?: PlannedWaypoint[]): void {
  dbMock.getActiveTripId.mockReturnValue(TRIP);
  dbMock.getPlannedLegCandidatesForActiveTrip.mockReturnValue([
    makeCandidate({ tripId: TRIP, departureLat: from.lat, departureLon: from.lon }),
  ]);
  dbMock.getPlannedLegById.mockReturnValue(
    makePlannedLegWithChildren({ trip_id: TRIP, ...(waypoints ? { waypoints, waypoint_count: waypoints.length } : {}) }),
  );
}

/** Four waypoints due north of KSBA — a straight route with three segments. */
const NORTH_ROUTE = [
  wp(1, 'KSBA', KSBA.lat, KSBA.lon),
  wp(2, 'WPT1', 35.0, KSBA.lon),
  wp(3, 'WPT2', 36.0, KSBA.lon),
  wp(4, 'KEND', 37.0, KSBA.lon),
];

/** Sum of the great-circle chain from waypoints[i] to the last waypoint. */
function chainFrom(waypoints: PlannedWaypoint[], i: number): number {
  let sum = 0;
  for (let k = i; k < waypoints.length - 1; k++) {
    sum += haversineNm(waypoints[k].lat, waypoints[k].lon, waypoints[k + 1].lat, waypoints[k + 1].lon);
  }
  return sum;
}

describe('FlightManager — planned-leg live status', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
  });
  afterEach(() => useRealClock());

  // ── AC 17 ────────────────────────────────────────────────────────────────

  it('getPlannedLegStatus() is null before any flight and while a flight is unlinked', () => {
    const fm = new FlightManager();
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();

    takeoff(fm); // default mocks: no active trip -> NO_ACTIVE_TRIP, never linked
    expect(fm.appState.flightState).toBe('FLYING');
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();
  });

  it('names the far end of the segment the aircraft is beside, and the remaining chain from it', () => {
    arrangeMatch(KSBA, NORTH_ROUTE);
    const fm = new FlightManager();
    takeoff(fm);
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledWith(1, 11, 'auto');

    // Beside the FIRST segment (KSBA->WPT1), 0.05° east of the track.
    const near1 = fm.getPlannedLegStatus(34.7, -119.79);
    expect(near1).not.toBeNull();
    expect(near1!.nextWaypointIdent).toBe('WPT1');
    expect(near1!.remainingDistanceNm).toBe(138.3);
    expect(near1!.remainingDistanceNm).toBe(
      Math.round((haversineNm(34.7, -119.79, 35.0, KSBA.lon) + chainFrom(NORTH_ROUTE, 1)) * 10) / 10,
    );

    // Beside the LAST segment (WPT2->KEND): the next waypoint is the destination
    // and the remaining chain beyond it is zero.
    const near3 = fm.getPlannedLegStatus(36.5, -119.79);
    expect(near3!.nextWaypointIdent).toBe('KEND');
    expect(near3!.remainingDistanceNm).toBe(30.1);
    expect(near3!.remainingDistanceNm).toBe(Math.round(haversineNm(36.5, -119.79, 37.0, KSBA.lon) * 10) / 10);

    // The rest of the payload is the cache, identical for both positions.
    expect(near1!.plannedLegId).toBe(11);
    expect(near1!.tripId).toBe(TRIP);
    expect(near1!.tripName).toBe('Test Trip');
    expect(near1!.destinationIdent).toBe('KMRY'); // the leg row's own field, not waypoints[last]
    expect(near1!.distanceIsApproximate).toBe(true);
  });

  it('breaks an exact cross-track tie towards the earlier segment', () => {
    // Three waypoints on one parallel, so a position abeam the middle one is
    // the same cross-track distance from both segments — bit-for-bit, because
    // the two computations differ only in a term that is zero in each. The
    // strict `<` at src/flightManager.ts:338 keeps the first, i.e. progress is
    // never reported further along the route than it has been proved to be.
    const route = [
      wp(1, 'DEP', 35.0, -121.0),
      wp(2, 'MID', 35.0, -120.0),
      wp(3, 'END', 35.0, -119.0),
    ];
    arrangeMatch({ lat: 35.0, lon: -121.0 }, route);

    const fm = new FlightManager();
    takeoff(fm, { lat: 35.0, lon: -121.0 });
    const st = fm.getPlannedLegStatus(35.1, -120.0); // abeam MID, 0.1° north
    expect(st!.nextWaypointIdent).toBe('MID');
  });

  // ── AC 18 — the antimeridian ─────────────────────────────────────────────

  it('picks the right segment across the antimeridian rather than the ~360°-wide one', () => {
    const DEP = { lat: 10.0, lon: 178.5 };
    const route = [
      wp(1, 'DEP', 10.0, 178.5),
      wp(2, 'EAST', 10.0, 179.5), // 179.5°E
      wp(3, 'WEST', 10.0, -179.5), // 179.5°W — 1° further on, not 359° back
      wp(4, 'DEST', 10.0, -178.5),
    ];
    arrangeMatch(DEP, route);

    const fm = new FlightManager();
    takeoff(fm, { lat: DEP.lat, lon: DEP.lon });
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledWith(1, 11, 'auto');

    // Just east of the antimeridian, i.e. beside the EAST->WEST segment.
    const st = fm.getPlannedLegStatus(10.05, 179.9);
    expect(st!.nextWaypointIdent).toBe('WEST');
    // With a raw longitude subtraction the EAST->WEST segment measures ~359°
    // wide, the position falls off its end, and 'EAST' wins instead.
    expect(st!.nextWaypointIdent).not.toBe('EAST');
    expect(st!.remainingDistanceNm).toBe(94.7);
    expect(st!.remainingDistanceNm).toBe(
      Math.round((haversineNm(10.05, 179.9, 10.0, -179.5) + chainFrom(route, 2)) * 10) / 10,
    );
  });
});

describe('FlightManager — auto-link at takeoff', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
  });
  afterEach(() => useRealClock());

  // ── AC 19 ────────────────────────────────────────────────────────────────

  it('a MATCHED result links exactly once and populates the status cache', () => {
    arrangeMatch(KSBA);
    const fm = new FlightManager();
    takeoff(fm);

    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledTimes(1);
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledWith(1, 11, 'auto');
    const st = fm.getPlannedLegStatus(KSBA.lat, KSBA.lon);
    expect(st!.plannedLegId).toBe(11);
    expect(st!.nextWaypointIdent).toBe('KMRY');
    expect(st!.remainingDistanceNm).toBe(162.5);

    // Nothing on the frame path re-links: 30 more seconds, still one call.
    for (let i = 0; i < 30; i++) { advance(1000); fm.onFrame(makeFrame()); }
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledTimes(1);
  });

  it('a refusal links nothing and leaves the status null', () => {
    arrangeMatch(KSBA);
    // …but the only candidate has already been flown (src/legMatcher.ts:127).
    dbMock.getPlannedLegCandidatesForActiveTrip.mockReturnValue([
      makeCandidate({ tripId: TRIP, status: 'flown' }),
    ]);

    const fm = new FlightManager();
    takeoff(fm);

    expect(dbMock.insertFlight).toHaveBeenCalledTimes(1);
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();
    // A refusal is never silent (src/flightManager.ts:424).
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('not linked — LEG_ALREADY_FLOWN');
  });

  // All four database calls autoLinkPlannedLeg makes, each made to throw in
  // turn. The flight row must survive every one of them: insertFlight has
  // already run by then and nothing the trip planner does may cost the session
  // (src/flightManager.ts:377-383).
  const THROW_SITES = [
    'getActiveTripId',
    'getPlannedLegCandidatesForActiveTrip',
    'getPlannedLegById',
    'linkFlightToPlannedLeg',
  ] as const;

  for (const site of THROW_SITES) {
    it(`a throw from ${site}() leaves the flight recorded and unlinked`, () => {
      arrangeMatch(KSBA);
      dbMock[site].mockImplementation(() => { throw new Error(`${site} exploded`); });

      const fm = new FlightManager();
      expect(() => takeoff(fm)).not.toThrow();

      expect(dbMock.insertFlight).toHaveBeenCalledTimes(1);
      expect(fm.appState.flightState).toBe('FLYING');
      expect(fm.appState.currentFlightId).toBe(1);
      expect(dbMock.insertPoint).toHaveBeenCalledTimes(1); // the takeoff point was still written
      expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();
      // The link write is reached only on the fourth site; there it throws.
      expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledTimes(site === 'linkFlightToPlannedLeg' ? 1 : 0);
      expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('auto-link failed');
    });
  }

  it('insertFlight itself is NOT wrapped — its throw propagates out of onFrame', () => {
    dbMock.insertFlight.mockImplementation(() => { throw new Error('insert failed'); });
    const fm = new FlightManager();
    fm.onFrame(makeFrame());
    fm.onFrame(makeFrame());
    expect(() => fm.onFrame(makeFrame())).toThrow('insert failed');
  });
});

describe('FlightManager — arrival on the planned leg', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
    // The link is read from the flight row at landing, not remembered from
    // takeoff (src/flightManager.ts:437-443) — so this is a flight the user
    // linked by hand while it was in the air.
    dbMock.getFlightPlannedLegId.mockReturnValue(11);
    dbMock.getPlannedLegById.mockReturnValue(makePlannedLegWithChildren({ trip_id: TRIP }));
  });
  afterEach(() => useRealClock());

  // ── AC 20 ────────────────────────────────────────────────────────────────

  it("landing inside ARRIVAL_RADIUS_NM of the planned destination records 'flown'", () => {
    const at = northOfNm(KMRY, 3.46); // 3.46 nm out, well inside the radius
    expect(haversineNm(at.lat, at.lon, KMRY.lat, KMRY.lon)).toBeLessThan(ARRIVAL_RADIUS_NM);

    const fm = new FlightManager();
    takeoff(fm);
    land(fm, { lat: at.lat, lon: at.lon });

    expect(dbMock.closeFlight).toHaveBeenCalledTimes(1);
    // 3.46 nm -> Math.round(34.6)/10 = 3.5
    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledTimes(1);
    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledWith(11, 'flown', 3.5);
    // A landing never rewrites the link.
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
  });

  it("landing outside ARRIVAL_RADIUS_NM records 'diverted' and keeps the link", () => {
    const at = northOfNm(KMRY, 25.87);
    expect(haversineNm(at.lat, at.lon, KMRY.lat, KMRY.lon)).toBeGreaterThan(ARRIVAL_RADIUS_NM);

    const fm = new FlightManager();
    takeoff(fm);
    land(fm, { lat: at.lat, lon: at.lon });

    // 25.87 nm -> Math.round(258.7)/10 = 25.9
    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledWith(11, 'diverted', 25.9);
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
    expect(fm.appState.flightState).toBe('IDLE');
  });

  // The two arrival tests above pin the flown/diverted *behaviour* but not the
  // ARRIVAL_RADIUS_NM *value* — 5 or 20 both leave them green, since neither
  // sits near the real threshold. These two pin the constant itself: one
  // landing just inside 10 nm, one just outside, both measured (not derived
  // on paper) per §4.6/§10.5.

  it("landing just inside ARRIVAL_RADIUS_NM (~9.9 nm) still records 'flown'", () => {
    const at = northOfNm(KMRY, 9.9);
    const measuredNm = haversineNm(at.lat, at.lon, KMRY.lat, KMRY.lon);
    expect(measuredNm).toBeCloseTo(9.9, 1);
    expect(measuredNm).toBeLessThan(ARRIVAL_RADIUS_NM);

    const fm = new FlightManager();
    takeoff(fm);
    land(fm, { lat: at.lat, lon: at.lon });

    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledTimes(1);
    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledWith(
      11, 'flown', Math.round(measuredNm * 10) / 10,
    );
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
  });

  it("landing just outside ARRIVAL_RADIUS_NM (~10.1 nm) records 'diverted'", () => {
    const at = northOfNm(KMRY, 10.1);
    const measuredNm = haversineNm(at.lat, at.lon, KMRY.lat, KMRY.lon);
    expect(measuredNm).toBeCloseTo(10.1, 1);
    expect(measuredNm).toBeGreaterThan(ARRIVAL_RADIUS_NM);

    const fm = new FlightManager();
    takeoff(fm);
    land(fm, { lat: at.lat, lon: at.lon });

    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledTimes(1);
    expect(dbMock.recordPlannedLegArrival).toHaveBeenCalledWith(
      11, 'diverted', Math.round(measuredNm * 10) / 10,
    );
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
  });

  it('records nothing when the flight carries no link', () => {
    dbMock.getFlightPlannedLegId.mockReturnValue(null);
    const fm = new FlightManager();
    takeoff(fm);
    land(fm);
    expect(dbMock.closeFlight).toHaveBeenCalledTimes(1);
    expect(dbMock.recordPlannedLegArrival).not.toHaveBeenCalled();
  });

  it('a throw from recordPlannedLegArrival does not escape endFlight', () => {
    dbMock.recordPlannedLegArrival.mockImplementation(() => { throw new Error('arrival write failed'); });
    const fm = new FlightManager();
    takeoff(fm);

    expect(() => land(fm)).not.toThrow();
    expect(dbMock.closeFlight).toHaveBeenCalledTimes(1); // the flight was closed first
    expect(fm.appState.flightState).toBe('IDLE');
    expect(fm.appState.currentFlightId).toBeNull();
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('arrival not recorded');
  });
});

describe('FlightManager — refreshPlannedLegForFlight', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
  });
  afterEach(() => useRealClock());

  // ── AC 21 ────────────────────────────────────────────────────────────────

  it('is a no-op for an id that is not the current flight', () => {
    arrangeMatch(KSBA);
    const fm = new FlightManager();
    takeoff(fm); // flight #1, linked
    expect(dbMock.getFlightPlannedLegId).not.toHaveBeenCalled();

    fm.refreshPlannedLegForFlight(999);
    expect(dbMock.getFlightPlannedLegId).not.toHaveBeenCalled();
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).not.toBeNull();
  });

  it('is a no-op when no flight is in progress', () => {
    const fm = new FlightManager();
    expect(() => fm.refreshPlannedLegForFlight(1)).not.toThrow();
    expect(dbMock.getFlightPlannedLegId).not.toHaveBeenCalled();
  });

  it('clears the cache when the flight row no longer carries a link', () => {
    arrangeMatch(KSBA);
    const fm = new FlightManager();
    takeoff(fm);
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).not.toBeNull();

    dbMock.getFlightPlannedLegId.mockReturnValue(null); // the user unlinked it by hand
    fm.refreshPlannedLegForFlight(1);
    expect(dbMock.getFlightPlannedLegId).toHaveBeenCalledWith(1);
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();
  });

  it('rebuilds the cache when the flight row gains a link', () => {
    const fm = new FlightManager();
    takeoff(fm); // no active trip -> unlinked
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();

    dbMock.getFlightPlannedLegId.mockReturnValue(11); // the user linked it by hand
    dbMock.getPlannedLegById.mockReturnValue(makePlannedLegWithChildren({ trip_id: TRIP }));
    fm.refreshPlannedLegForFlight(1);

    const st = fm.getPlannedLegStatus(KSBA.lat, KSBA.lon);
    expect(st!.plannedLegId).toBe(11);
    expect(st!.tripId).toBe(TRIP);
    expect(st!.nextWaypointIdent).toBe('KMRY');
    expect(st!.remainingDistanceNm).toBe(162.5);
  });

  it('leaves the cache empty when the linked leg row has gone', () => {
    arrangeMatch(KSBA);
    const fm = new FlightManager();
    takeoff(fm);

    dbMock.getFlightPlannedLegId.mockReturnValue(11);
    dbMock.getPlannedLegById.mockReturnValue(null);
    fm.refreshPlannedLegForFlight(1);
    expect(fm.getPlannedLegStatus(KSBA.lat, KSBA.lon)).toBeNull();
  });
});
