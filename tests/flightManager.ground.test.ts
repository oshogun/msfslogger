// tests/flightManager.ground.test.ts — tests the GROUND state added to
// src/flightManager.ts's state machine and src/groundState.ts's debounce.
//
// State-machine coverage for IDLE <-> FLYING lives in
// tests/flightManager.state.test.ts and is untouched by this file; the tests
// below only add the third state and its two entry/exit seams: the debounce
// into GROUND, and the four ways out of it (flight start, slew, re-anchor,
// sim exit/crash/disconnect).
//
// Hermetic like its siblings: './db' and './airports' are replaced wholesale
// via tests/helpers, and './db/groundSessions' is replaced here (it is not
// part of the './db' barrel — src/flightManager.ts imports it directly) so no
// native binding and no database file is ever opened.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CreateGroundSession, GroundSession, SimFrame } from '../src/types';
import {
  dbMock, airportsMock, resetMocks, makeFrame, makeCandidate, makePlannedLegWithChildren,
  northOfNm, KSBA, useFakeClock, useRealClock,
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
import { GROUND_DEBOUNCE_FRAMES, GROUND_REANCHOR_NM } from '../src/groundState';
import * as groundSessionsModule from '../src/db/groundSessions';

// vi.mock() replaces the module at runtime, but a `* as` import is still typed
// against the real module's declarations — vi.mocked() re-types the same
// references as the mocks they actually are, with no unsafe cast.
const insertGroundSession = vi.mocked(groundSessionsModule.insertGroundSession);
const getOpenGroundSession = vi.mocked(groundSessionsModule.getOpenGroundSession);
const closeOpenGroundSession = vi.mocked(groundSessionsModule.closeOpenGroundSession);
const fillOpenGroundSessionGaps = vi.mocked(groundSessionsModule.fillOpenGroundSessionGaps);

/**
 * A hand-rolled stand-in for the real fillOpenGroundSessionGaps()'s semantics
 * (src/db/groundSessions.ts): merges `patch` onto whatever is currently open,
 * but only into columns that are still null. Reused by every test below that
 * exercises the adopt path, so each one only has to state the row it starts
 * from and the patch it expects, not re-derive the merge rule.
 */
function simulateGapFill(patch: Partial<CreateGroundSession>): GroundSession | null {
  const current = getOpenGroundSession();
  if (!current) return null;
  const currentAsRecord = current as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...currentAsRecord };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (currentAsRecord[key] !== null) continue;
    merged[key] = value;
  }
  return merged as unknown as GroundSession;
}

// src/flightManager.ts:21 — the airborne debounce, transcribed rather than
// imported (not exported) for the same reason tests/flightManager.state.test.ts
// transcribes it.
const AIRBORNE_DEBOUNCE_FRAMES = 3;

const advance = (ms: number) => vi.advanceTimersByTime(ms);

/** A frame that satisfies isParkedFrame(): on the ground, stationary, engines off. */
const PARKED: Partial<SimFrame> = {
  onGround: true, groundSpeedKnots: 0, enginesRunning: 0, engineCount: 2, parkingBrake: false,
};

function parkFrame(over: Partial<SimFrame> = {}): SimFrame {
  return makeFrame({ ...PARKED, ...over });
}

/** `n` parked frames at 1 Hz, the rate the sim client sends at. */
function park(fm: FlightManager, n: number, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < n; i++) {
    advance(1000);
    fm.onFrame(parkFrame(over));
  }
}

/** The three frames that trip the airborne debounce, matching the makeFrame default. */
function takeoff(fm: FlightManager, over: Partial<SimFrame> = {}): void {
  for (let i = 0; i < AIRBORNE_DEBOUNCE_FRAMES; i++) fm.onFrame(makeFrame(over));
}

let nextSessionId = 1;

function makeSessionRow(over: Partial<GroundSession> = {}): GroundSession {
  const now = '2026-09-09T12:00:00.000Z';
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

describe('FlightManager — GROUND state', () => {
  beforeEach(() => {
    resetMocks();
    useFakeClock();
    nextSessionId = 1;
    getOpenGroundSession.mockReset().mockReturnValue(null);
    // Mirrors real persistence closely enough for these tests: once a row is
    // inserted, a later getOpenGroundSession() call must see it — otherwise
    // the close-gate tests below would be checking a source that a real
    // database would never actually report.
    insertGroundSession.mockReset().mockImplementation((input) => {
      const row = makeSessionRow(input);
      getOpenGroundSession.mockReturnValue(row);
      return row;
    });
    closeOpenGroundSession.mockReset().mockReturnValue(null);
    fillOpenGroundSessionGaps.mockReset().mockImplementation(simulateGapFill);
  });
  afterEach(() => useRealClock());

  // ── Entry: the debounce is exactly GROUND_DEBOUNCE_FRAMES, and it is a streak ─

  it('enters GROUND after GROUND_DEBOUNCE_FRAMES consecutive parked frames, not before', () => {
    const fm = new FlightManager();

    park(fm, GROUND_DEBOUNCE_FRAMES - 1);
    expect(fm.appState.flightState).toBe('IDLE');
    expect(insertGroundSession).not.toHaveBeenCalled();

    park(fm, 1);
    expect(fm.appState.flightState).toBe('GROUND');
    expect(insertGroundSession).toHaveBeenCalledTimes(1);
  });

  it('never enters GROUND while taxiing, however long it continues', () => {
    const fm = new FlightManager();
    park(fm, 20, { groundSpeedKnots: 8, enginesRunning: 2, parkingBrake: false });
    expect(fm.appState.flightState).toBe('IDLE');
    expect(insertGroundSession).not.toHaveBeenCalled();
  });

  it('a single non-qualifying frame resets the ground streak to zero', () => {
    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES - 1);
    advance(1000);
    fm.onFrame(parkFrame({ groundSpeedKnots: 5 })); // resets the streak
    park(fm, GROUND_DEBOUNCE_FRAMES - 1);
    expect(fm.appState.flightState).toBe('IDLE');

    park(fm, 1);
    expect(fm.appState.flightState).toBe('GROUND');
  });

  it('resolves the nearest airport and matches a planned leg exactly once per session', () => {
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });
    const fm = new FlightManager();

    park(fm, GROUND_DEBOUNCE_FRAMES);
    expect(airportsMock.findNearestAirport).toHaveBeenCalledTimes(1);
    expect(dbMock.getActiveTripId).toHaveBeenCalledTimes(1);
    expect(insertGroundSession).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'auto', airport_icao: 'KSBA', airport_name: 'Santa Barbara Muni' }),
    );

    // No re-match while parked — budgeted at one call per session.
    park(fm, 10);
    expect(airportsMock.findNearestAirport).toHaveBeenCalledTimes(1);
  });

  it('adopts an already-open session instead of inserting a second one', () => {
    getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'manual', airport_icao: 'KSBA' }));
    const fm = new FlightManager();

    park(fm, GROUND_DEBOUNCE_FRAMES);
    expect(fm.appState.flightState).toBe('GROUND');
    expect(insertGroundSession).not.toHaveBeenCalled();
    expect(fillOpenGroundSessionGaps).toHaveBeenCalledTimes(1);
  });

  it('adopting a manual session backfills its blank lat/lon and planned_leg_id, but never its airport or stand', () => {
    // KMRY, not KSBA: proves the manual session's own airport survives even
    // though findNearestAirport() below resolves the frame's real position
    // (KSBA, from makeFrame()'s default) to something else entirely.
    getOpenGroundSession.mockReturnValue(makeSessionRow({
      source: 'manual', airport_icao: 'KMRY', airport_name: null,
      parking_position: 'Stand 12', parking_position_source: 'manual',
    }));
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });
    dbMock.getActiveTripId.mockReturnValue(1);
    dbMock.getPlannedLegCandidatesForActiveTrip.mockReturnValue([makeCandidate()]); // departs exactly at KSBA
    dbMock.getPlannedLegById.mockReturnValue(makePlannedLegWithChildren());

    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES);

    expect(insertGroundSession).not.toHaveBeenCalled();
    expect(fillOpenGroundSessionGaps).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: KSBA.lat, lon: KSBA.lon, planned_leg_id: 11, planned_leg_link_source: 'auto',
        // The resolved airport (KSBA) disagrees with the row's own KMRY: the
        // patch must not carry a name for a different airport than the code
        // the row already has, even though airport_name itself is blank.
        airport_icao: null, airport_name: null,
      }),
    );

    const status = fm.getGroundSessionStatus();
    // Backfilled: the match found a leg, and the row had none.
    expect(status?.plannedLegId).toBe(11);
    // Untouched: both were already non-null on the adopted row.
    expect(status?.airportIcao).toBe('KMRY');
    expect(status?.parkingPosition).toBe('Stand 12');
    expect(status?.parkingPositionSource).toBe('manual');
    // Never filled in from the disagreeing resolution — a blank name stays
    // blank rather than being paired with the wrong airport's code.
    expect(status?.airportName).toBeNull();
  });

  it('adopting a session with no airport recorded yet fills in both the icao and the name', () => {
    getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'auto', airport_icao: null, airport_name: null }));
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });
    const fm = new FlightManager();

    park(fm, GROUND_DEBOUNCE_FRAMES);

    expect(fillOpenGroundSessionGaps).toHaveBeenCalledWith(
      expect.objectContaining({ airport_icao: 'KSBA', airport_name: 'Santa Barbara Muni' }),
    );
    expect(fm.getGroundSessionStatus()?.airportIcao).toBe('KSBA');
    expect(fm.getGroundSessionStatus()?.airportName).toBe('Santa Barbara Muni');
  });

  it('adopting a session whose recorded airport agrees with detection backfills the still-blank name', () => {
    getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'manual', airport_icao: 'KSBA', airport_name: null }));
    airportsMock.findNearestAirport.mockReturnValue({ icao: 'KSBA', name: 'Santa Barbara Muni' });
    const fm = new FlightManager();

    park(fm, GROUND_DEBOUNCE_FRAMES);

    expect(fillOpenGroundSessionGaps).toHaveBeenCalledWith(
      expect.objectContaining({ airport_icao: 'KSBA', airport_name: 'Santa Barbara Muni' }),
    );
    expect(fm.getGroundSessionStatus()?.airportName).toBe('Santa Barbara Muni');
  });

  // ── GROUND -> FLYING: the airborne debounce must be untouched ────────────────

  it('GROUND -> FLYING needs exactly AIRBORNE_DEBOUNCE_FRAMES consecutive qualifying frames, same as from IDLE', () => {
    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES);
    expect(fm.appState.flightState).toBe('GROUND');

    fm.onFrame(makeFrame());
    fm.onFrame(makeFrame());
    expect(dbMock.insertFlight).not.toHaveBeenCalled();
    expect(fm.appState.flightState).toBe('GROUND');

    fm.onFrame(makeFrame());
    expect(dbMock.insertFlight).toHaveBeenCalledTimes(1);
    expect(fm.appState.flightState).toBe('FLYING');
  });

  it('a flight start closes the ground session with flight-started and the new flight id', () => {
    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES);
    closeOpenGroundSession.mockClear();

    takeoff(fm);
    const issuedId = dbMock.insertFlight.mock.results[0].value;
    expect(closeOpenGroundSession).toHaveBeenCalledWith('flight-started', issuedId);
  });

  it('a flight start closes any open session, even one flightManager never tracked as GROUND', () => {
    // Simulates a manual session created via the API with the agent never
    // connected: flightManager's own state is IDLE throughout, so this proves
    // the close in startFlight() does not depend on having been in GROUND.
    const fm = new FlightManager();
    takeoff(fm);
    expect(closeOpenGroundSession).toHaveBeenCalledWith(
      'flight-started', dbMock.insertFlight.mock.results[0].value,
    );
  });

  // ── Exits back to IDLE ───────────────────────────────────────────────────────

  it('slew while GROUND closes the session and returns to IDLE', () => {
    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES);

    advance(1000);
    fm.onFrame(parkFrame({ simRunning: 3 }));
    expect(fm.appState.flightState).toBe('IDLE');
    expect(closeOpenGroundSession).toHaveBeenCalledWith('slew');
  });

  it('moving more than GROUND_REANCHOR_NM from the anchor closes the session as superseded', () => {
    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES);

    const far = northOfNm(KSBA, GROUND_REANCHOR_NM + 1);
    advance(1000);
    fm.onFrame(parkFrame({ lat: far.lat, lon: far.lon }));
    expect(fm.appState.flightState).toBe('IDLE');
    expect(closeOpenGroundSession).toHaveBeenCalledWith('superseded');
  });

  it('simRunning === 0 while GROUND closes the session, whatever its source, and returns to IDLE', () => {
    getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'manual' }));
    const fm = new FlightManager();
    park(fm, GROUND_DEBOUNCE_FRAMES);
    expect(fm.appState.flightState).toBe('GROUND');

    fm.onFrame(makeFrame({ simRunning: 0 }));
    expect(fm.appState.flightState).toBe('IDLE');
    expect(closeOpenGroundSession).toHaveBeenCalledWith('sim-exit');
  });

  // ── refreshGroundSession() ───────────────────────────────────────────────────
  //
  // Called by src/routes/groundSessions.ts after every write, since those talk
  // to the database directly and never go through FlightManager.

  describe('refreshGroundSession()', () => {
    it('rebuilds the live cache after an external write refines the open row', () => {
      const fm = new FlightManager();
      park(fm, GROUND_DEBOUNCE_FRAMES);
      expect(fm.getGroundSessionStatus()?.parkingPosition).toBeNull();

      getOpenGroundSession.mockReturnValue(
        makeSessionRow({ id: 1, source: 'auto', parking_position: 'Gate 7', parking_position_source: 'manual' }),
      );
      fm.refreshGroundSession();

      expect(fm.getGroundSessionStatus()?.parkingPosition).toBe('Gate 7');
      expect(fm.getGroundSessionStatus()?.parkingPositionSource).toBe('manual');
      expect(fm.appState.flightState).toBe('GROUND'); // untouched — the row is still open
    });

    it('rebuilds the cache onto a different row entirely after a correction replaces it', () => {
      const fm = new FlightManager();
      park(fm, GROUND_DEBOUNCE_FRAMES); // opens an 'auto' session
      const before = fm.getGroundSessionStatus();
      expect(before?.source).toBe('auto');

      // A same-ICAO refine keeps the row; a different-ICAO correction closes
      // it and opens a new one. Either way, refreshGroundSession() must read
      // whatever is open now, not keep describing what used to be.
      getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'manual', airport_icao: 'EGLL' }));
      fm.refreshGroundSession();

      const after = fm.getGroundSessionStatus();
      expect(after?.source).toBe('manual');
      expect(after?.airportIcao).toBe('EGLL');
      expect(after?.groundSessionId).not.toBe(before?.groundSessionId);
    });

    it('drops the machine to IDLE when no row is open and it was tracking GROUND', () => {
      const fm = new FlightManager();
      park(fm, GROUND_DEBOUNCE_FRAMES);
      expect(fm.appState.flightState).toBe('GROUND');

      getOpenGroundSession.mockReturnValue(null); // e.g. DELETE /api/ground-sessions/current
      fm.refreshGroundSession();

      expect(fm.appState.flightState).toBe('IDLE');
      expect(fm.getGroundSessionStatus()).toBeNull();
    });

    it('is a no-op on flightState when no row is open and the machine was already IDLE', () => {
      const fm = new FlightManager();
      fm.refreshGroundSession();
      expect(fm.appState.flightState).toBe('IDLE');
      expect(fm.getGroundSessionStatus()).toBeNull();
    });
  });

  // ── onCrash() / onSimDisconnect() ─────────────────────────────────────────────

  for (const ending of ['onCrash', 'onSimDisconnect'] as const) {
    const reason = ending === 'onCrash' ? 'crash' : 'sim-exit';

    it(`${ending}() closes an open automatic ground session and returns to IDLE`, () => {
      const fm = new FlightManager();
      park(fm, GROUND_DEBOUNCE_FRAMES);
      expect(fm.appState.flightState).toBe('GROUND');

      fm[ending]();
      expect(fm.appState.flightState).toBe('IDLE');
      expect(closeOpenGroundSession).toHaveBeenCalledWith(reason);
    });

    it(`${ending}() leaves a manual ground session open, but still returns to IDLE`, () => {
      getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'manual' }));
      const fm = new FlightManager();
      park(fm, GROUND_DEBOUNCE_FRAMES);
      expect(fm.appState.flightState).toBe('GROUND');
      closeOpenGroundSession.mockClear();

      fm[ending]();
      expect(fm.appState.flightState).toBe('IDLE');
      expect(closeOpenGroundSession).not.toHaveBeenCalled();
    });

    it(`${ending}() is a no-op when IDLE`, () => {
      const fm = new FlightManager();
      expect(() => fm[ending]()).not.toThrow();
      expect(closeOpenGroundSession).not.toHaveBeenCalled();
    });

    it(`${ending}() reads the row that is actually open now, not a stale cached source`, () => {
      // Regression: the close gate used to check this.groundSessionCache?.source,
      // which still said 'auto' from session entry. A manual correction can
      // replace that row with a fresh manual one without this machine ever
      // leaving GROUND or calling refreshGroundSession() in between — the gate
      // must re-read the open row itself, not trust what it cached earlier.
      const fm = new FlightManager();
      park(fm, GROUND_DEBOUNCE_FRAMES); // cache built with source 'auto'
      expect(fm.getGroundSessionStatus()?.source).toBe('auto');

      getOpenGroundSession.mockReturnValue(makeSessionRow({ source: 'manual' }));
      closeOpenGroundSession.mockClear();

      fm[ending]();
      expect(closeOpenGroundSession).not.toHaveBeenCalled();
      expect(fm.appState.flightState).toBe('IDLE');
    });
  }
});
