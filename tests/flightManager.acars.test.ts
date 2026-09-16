// tests/flightManager.acars.test.ts — the OOOI events and position reports
// src/flightManager.ts files through src/acarsEvents.ts.
//
// Nothing here asserts on the database: src/acarsEvents.ts is replaced
// wholesale (acarsEventsMock, see tests/helpers/index.ts), so every assertion
// below is against fileAcarsMessageOnce's own call arguments — the row it
// would have written, and the label/context it filed under. Message wording
// (bodies, dedup-key formulas) is covered by tests/acars.test.ts; this file is
// only about *when* and *how often* FlightManager reaches for the emitter.
//
// Hermetic like its siblings: './db', './airports' and './db/groundSessions'
// are all replaced, so no native binding and no database file is ever opened.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CreateAcarsMessage, CreateGroundSession, GroundSession, SimFrame } from '../src/types';
import {
  dbMock, airportsMock, acarsEventsMock, resetMocks, makeFrame, makeCandidate, makePlannedLegWithChildren,
  useFakeClock, useRealClock,
} from './helpers';

vi.mock('../src/db', async () => (await import('./helpers')).dbMock);
vi.mock('../src/airports', async () => (await import('./helpers')).airportsMock);
vi.mock('../src/acarsEvents', async () => (await import('./helpers')).acarsEventsMock);
vi.mock('../src/db/groundSessions', () => ({
  insertGroundSession: vi.fn(),
  getOpenGroundSession: vi.fn(),
  closeOpenGroundSession: vi.fn(),
  fillOpenGroundSessionGaps: vi.fn(),
}));

import { FlightManager } from '../src/flightManager';
import { GROUND_DEBOUNCE_FRAMES } from '../src/groundState';
import * as groundSessionsModule from '../src/db/groundSessions';

const insertGroundSession = vi.mocked(groundSessionsModule.insertGroundSession);
const getOpenGroundSession = vi.mocked(groundSessionsModule.getOpenGroundSession);
const closeOpenGroundSession = vi.mocked(groundSessionsModule.closeOpenGroundSession);
const fillOpenGroundSessionGaps = vi.mocked(groundSessionsModule.fillOpenGroundSessionGaps);

// src/flightManager.ts — transcribed, not imported (none of the four is
// exported), for the same reason the sibling test files transcribe them.
const AIRBORNE_DEBOUNCE_FRAMES = 3;
const LANDED_DEBOUNCE_FRAMES = 10;
const TAXI_OUT_SPEED_KTS = 3;

const advance = (ms: number) => vi.advanceTimersByTime(ms);

const PARKED: Partial<SimFrame> = {
  onGround: true, groundSpeedKnots: 0, enginesRunning: 0, engineCount: 2, parkingBrake: false,
};
const LANDED: Partial<SimFrame> = { onGround: true, groundSpeedKnots: 2, airspeedKnots: 0 };

function parkFrame(over: Partial<SimFrame> = {}): SimFrame {
  return makeFrame({ ...PARKED, ...over });
}

/** `n` parked frames at 1 Hz — the debounce into GROUND. */
function park(fm: FlightManager, n: number, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < n; i++) {
    advance(1000);
    fm.onFrame(parkFrame(over));
  }
}

/** `n` taxi-speed frames at 1 Hz — at/above TAXI_OUT_SPEED_KTS, still on the ground. */
function taxi(fm: FlightManager, n: number, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < n; i++) {
    advance(1000);
    fm.onFrame(makeFrame({ onGround: true, groundSpeedKnots: TAXI_OUT_SPEED_KTS + 2, airspeedKnots: 0, ...over }));
  }
}

/** The three frames that trip the airborne debounce, delivered at one instant. */
function takeoff(fm: FlightManager, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < AIRBORNE_DEBOUNCE_FRAMES; i++) fm.onFrame(makeFrame(over));
}

/** `n` landed-qualifying frames at 1 Hz — the debounce that ends a flight. */
function land(fm: FlightManager, n: number, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < n; i++) {
    advance(1000);
    fm.onFrame(makeFrame({ ...LANDED, ...over }));
  }
}

/**
 * Cruise frames spaced exactly RECORD_INTERVAL_MS apart, so every one of them
 * reaches writePoint() (and so maybeFilePositionReport()) rather than being
 * dropped by recordPoint()'s throttle.
 */
function cruise(fm: FlightManager, totalMs: number, over: Partial<SimFrame> = {}): void {
  for (let elapsed = 0; elapsed < totalMs; elapsed += 5000) {
    advance(5000);
    fm.onFrame(makeFrame({ onGround: false, groundSpeedKnots: 250, airspeedKnots: 250, ...over }));
  }
}

let nextSessionId = 1;

function makeSessionRow(over: Partial<GroundSession> = {}): GroundSession {
  const now = '2026-09-16T12:00:00.000Z';
  return {
    id: nextSessionId++,
    source: 'auto',
    airport_icao: null,
    airport_name: null,
    lat: null,
    lon: null,
    parking_position: null,
    parking_position_source: null,
    planned_leg_id: null,
    planned_leg_link_source: null,
    aircraft: null,
    started_at: now,
    ended_at: null,
    ended_reason: null,
    flight_id: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
}

/** The trip/candidate/leg arrangement the matcher accepts at makeFrame()'s default position. */
function arrangeLinkedLeg(): void {
  dbMock.getActiveTripId.mockReturnValue(7);
  dbMock.getPlannedLegCandidatesForActiveTrip.mockReturnValue([
    makeCandidate({ tripId: 7, departureLat: 34.426201, departureLon: -119.841507 }),
  ]);
  dbMock.getPlannedLegById.mockReturnValue(makePlannedLegWithChildren({ trip_id: 7 }));
}

function callsFor(label: string): { message: CreateAcarsMessage & { dedup_key: string }; context: string }[] {
  return acarsEventsMock.fileAcarsMessageOnce.mock.calls
    .filter(([msg]) => (msg as CreateAcarsMessage).label === label)
    .map(([message, context]) => ({ message: message as CreateAcarsMessage & { dedup_key: string }, context: context as string }));
}

function categoryCalls(category: string): (CreateAcarsMessage & { dedup_key: string })[] {
  return acarsEventsMock.fileAcarsMessageOnce.mock.calls
    .map(([msg]) => msg as CreateAcarsMessage & { dedup_key: string })
    .filter((msg) => msg.category === category);
}

describe('FlightManager — OOOI events', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
    nextSessionId = 1;
    getOpenGroundSession.mockReset().mockReturnValue(null);
    insertGroundSession.mockReset().mockImplementation((input) => {
      const row = makeSessionRow(input as Partial<CreateGroundSession>);
      getOpenGroundSession.mockReturnValue(row);
      return row;
    });
    closeOpenGroundSession.mockReset().mockReturnValue(null);
    fillOpenGroundSessionGaps.mockReset().mockReturnValue(null);
  });
  afterEach(() => useRealClock());

  it('AC1: files OUT, OFF, ON, IN exactly once each, in order, with the frozen dedup keys and the transition timestamps — even with redundant frames replayed around each transition', () => {
    const fm = new FlightManager();

    park(fm, GROUND_DEBOUNCE_FRAMES); // -> GROUND
    taxi(fm, 1); // sets the off-blocks memo
    const outAt = new Date().toISOString();
    taxi(fm, 4); // redundant taxi frames: must not move or re-file OUT

    takeoff(fm); // -> FLYING, fires OUT then OFF
    const offAt = new Date().toISOString();

    cruise(fm, 10_000);

    land(fm, 1); // the touchdown frame: fires ON
    const onAt = new Date().toISOString();
    land(fm, LANDED_DEBOUNCE_FRAMES - 1); // -> IDLE at the 10th, fires IN
    const inAt = new Date().toISOString();

    // A replayed rollout: more onGround frames after the flight has already
    // ended — simulating an agent that keeps posting stale frames.
    land(fm, 5);

    expect(callsFor('OUT')).toHaveLength(1);
    expect(callsFor('OFF')).toHaveLength(1);
    expect(callsFor('ON')).toHaveLength(1);
    expect(callsFor('IN')).toHaveLength(1);

    const out = callsFor('OUT')[0].message;
    const off = callsFor('OFF')[0].message;
    const on = callsFor('ON')[0].message;
    const inn = callsFor('IN')[0].message;

    expect(out.dedup_key).toBe('oooi:flight:1:OUT');
    expect(off.dedup_key).toBe('oooi:flight:1:OFF');
    expect(on.dedup_key).toBe('oooi:flight:1:ON');
    expect(inn.dedup_key).toBe('oooi:flight:1:IN');

    expect(out.sent_at).toBe(outAt);
    expect(off.sent_at).toBe(offAt);
    expect(on.sent_at).toBe(onAt);
    expect(inn.sent_at).toBe(inAt);

    // OUT was timestamped to the taxi frame, not the takeoff instant, and is
    // not marked estimated — the ground-session memo was available.
    expect(out.sent_at).not.toBe(off.sent_at);
    expect(JSON.parse(out.payload_json as string).estimated).toBe(false);
  });

  it('an airborne start with no antecedent GROUND state still files all four events, with OUT estimated at the takeoff instant', () => {
    const fm = new FlightManager();
    takeoff(fm);
    const startedAt = new Date().toISOString();
    land(fm, LANDED_DEBOUNCE_FRAMES);

    expect(callsFor('OUT')).toHaveLength(1);
    const out = callsFor('OUT')[0].message;
    expect(out.sent_at).toBe(startedAt);
    expect(JSON.parse(out.payload_json as string).estimated).toBe(true);
  });

  it('onCrash() from FLYING with no touchdown frame files ON (estimated) then IN, exactly once each', () => {
    const fm = new FlightManager();
    takeoff(fm);
    advance(1000);
    fm.onFrame(makeFrame({ onGround: false }));

    fm.onCrash();

    expect(callsFor('ON')).toHaveLength(1);
    expect(callsFor('IN')).toHaveLength(1);
    expect(JSON.parse(callsFor('ON')[0].message.payload_json as string).estimated).toBe(true);
  });

  it('a crash AFTER a touchdown frame files exactly one ON, not a second one from the fallback', () => {
    const fm = new FlightManager();
    takeoff(fm);
    land(fm, 1); // touchdown: fires the real ON
    expect(callsFor('ON')).toHaveLength(1);

    fm.onCrash(); // FlightManager is already IDLE by now — a no-op, but proves no second ON
    expect(callsFor('ON')).toHaveLength(1);
  });

  it('a long rollout files exactly one ON and makes exactly one extra findNearestAirport call for it', () => {
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });
    const fm = new FlightManager();
    takeoff(fm); // 1st findNearestAirport call: departure
    land(fm, LANDED_DEBOUNCE_FRAMES); // touchdown (2nd call) + endFlight's arrival (3rd call)

    expect(callsFor('ON')).toHaveLength(1);
    expect(airportsMock.findNearestAirport).toHaveBeenCalledTimes(3);
  });
});

describe('FlightManager — position reports', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
    nextSessionId = 1;
    getOpenGroundSession.mockReset().mockReturnValue(null);
    insertGroundSession.mockReset();
    closeOpenGroundSession.mockReset().mockReturnValue(null);
    fillOpenGroundSessionGaps.mockReset().mockReturnValue(null);
  });
  afterEach(() => useRealClock());

  it('AC2: a linked leg and a FLYING period longer than the interval files at least one position report strictly between OFF and ON', () => {
    arrangeLinkedLeg();
    const fm = new FlightManager();

    takeoff(fm); // -> FLYING, links the leg, fires OUT/OFF
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledTimes(1);
    const offAt = callsFor('OFF')[0].message.sent_at as string;

    cruise(fm, 650_000); // past the default 10-minute interval

    land(fm, LANDED_DEBOUNCE_FRAMES); // touchdown fires ON, then endFlight fires IN
    const onAt = callsFor('ON')[0].message.sent_at as string;

    const reports = categoryCalls('position-report');
    expect(reports.length).toBeGreaterThanOrEqual(1);
    for (const r of reports) {
      expect((r.sent_at as string) > offAt).toBe(true);
      expect((r.sent_at as string) < onAt).toBe(true);
    }
  });

  it('AC4: every filed message (OOOI and position report) carries the flight\'s own flight_id and no planned_leg_id — reachable from listAcarsMessagesForFlight()\'s WHERE flight_id = ? clause', () => {
    arrangeLinkedLeg();
    const fm = new FlightManager();
    takeoff(fm);
    const issuedFlightId = dbMock.insertFlight.mock.results[0].value as number;
    cruise(fm, 650_000);
    land(fm, LANDED_DEBOUNCE_FRAMES);

    const allCalls = acarsEventsMock.fileAcarsMessageOnce.mock.calls.map(([msg]) => msg as CreateAcarsMessage);
    expect(allCalls.length).toBeGreaterThanOrEqual(5); // 4 OOOI + >=1 position report
    for (const msg of allCalls) {
      expect(msg.flight_id).toBe(issuedFlightId);
      expect(msg.planned_leg_id).toBeUndefined(); // never set -> stored NULL (src/db/acarsMessages.ts default)
    }
  });

  it('AC3: no planned leg linked — zero position reports, OOOI still files, onFrame() never throws and never logs a warning or error', () => {
    // Default mocks: no active trip -> the flight never links.
    const fm = new FlightManager();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => {
      takeoff(fm);
      cruise(fm, 650_000); // several intervals' worth, unlinked throughout
      land(fm, LANDED_DEBOUNCE_FRAMES);
    }).not.toThrow();

    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
    expect(categoryCalls('position-report')).toHaveLength(0);
    expect(callsFor('OUT')).toHaveLength(1);
    expect(callsFor('OFF')).toHaveLength(1);
    expect(callsFor('ON')).toHaveLength(1);
    expect(callsFor('IN')).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('POSITION_REPORT_INTERVAL_MIN=0 files zero position reports and still files all four OOOI messages', () => {
    const prev = process.env.POSITION_REPORT_INTERVAL_MIN;
    process.env.POSITION_REPORT_INTERVAL_MIN = '0';
    try {
      arrangeLinkedLeg();
      const fm = new FlightManager();
      takeoff(fm);
      cruise(fm, 650_000);
      land(fm, LANDED_DEBOUNCE_FRAMES);

      expect(categoryCalls('position-report')).toHaveLength(0);
      expect(callsFor('OUT')).toHaveLength(1);
      expect(callsFor('OFF')).toHaveLength(1);
      expect(callsFor('ON')).toHaveLength(1);
      expect(callsFor('IN')).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.POSITION_REPORT_INTERVAL_MIN;
      else process.env.POSITION_REPORT_INTERVAL_MIN = prev;
    }
  });

  it('two frames inside the same window file at most one report for it, and a leg linked mid-flight starts reporting at the next point', () => {
    // Unlinked at takeoff, so lastPositionReportWindow never advances while
    // cruising — then linked by hand mid-flight, which must start reporting
    // at the very next recorded point rather than needing a fresh interval.
    const fm = new FlightManager();
    takeoff(fm);
    cruise(fm, 650_000);
    expect(categoryCalls('position-report')).toHaveLength(0);

    dbMock.getFlightPlannedLegId.mockReturnValue(11);
    dbMock.getPlannedLegById.mockReturnValue(makePlannedLegWithChildren());
    fm.refreshPlannedLegForFlight(dbMock.insertFlight.mock.results[0].value as number);

    advance(5000);
    fm.onFrame(makeFrame({ onGround: false, groundSpeedKnots: 250, airspeedKnots: 250 }));
    expect(categoryCalls('position-report')).toHaveLength(1);

    // A second frame moments later, still inside the same window: no second report.
    advance(1000);
    fm.onFrame(makeFrame({ onGround: false, groundSpeedKnots: 250, airspeedKnots: 250 }));
    expect(categoryCalls('position-report')).toHaveLength(1);
  });
});
