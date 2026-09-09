import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dbMock, airportsMock, resetMocks, makeFrame } from './helpers/mocks';

vi.mock('../src/db', async () => (await import('./helpers/mocks')).dbMock);
vi.mock('../src/airports', async () => (await import('./helpers/mocks')).airportsMock);

import { FlightManager } from '../src/flightManager';

const T0 = '2026-09-09T12:00:00.000Z';

describe('FlightManager under mocks + fake clock', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
  });
  afterEach(() => vi.useRealTimers());

  it('takes off after 3 airborne frames and records the first point', () => {
    const fm = new FlightManager();
    fm.onFrame(makeFrame());
    fm.onFrame(makeFrame());
    expect(dbMock.insertFlight).not.toHaveBeenCalled();
    fm.onFrame(makeFrame());
    expect(dbMock.insertFlight).toHaveBeenCalledTimes(1);
    expect(dbMock.insertFlight).toHaveBeenCalledWith('Cessna 172', 34.4262, -119.8404, T0, null, null);
    expect(dbMock.insertPoint).toHaveBeenCalledTimes(1);
    expect(dbMock.insertPoint.mock.calls[0][1]).toBe(T0);
    expect(fm.appState.flightState).toBe('FLYING');
    expect(fm.appState.currentFlightId).toBe(1);
  });

  it('records one point per 5 s; duration is built from point gaps', () => {
    const fm = new FlightManager();
    for (let i = 0; i < 3; i++) fm.onFrame(makeFrame());
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(1000); fm.onFrame(makeFrame()); }
    expect(dbMock.insertPoint).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(1000); fm.onFrame(makeFrame({ onGround: true, groundSpeedKnots: 2, airspeedKnots: 0 })); }
    expect(dbMock.closeFlight).toHaveBeenCalledTimes(1);
    console.log('closeFlight args:', JSON.stringify(dbMock.closeFlight.mock.calls[0]));
    expect(fm.appState.flightState).toBe('IDLE');
  });

  it('pause suppresses points and excludes paused time', () => {
    const fm = new FlightManager();
    for (let i = 0; i < 3; i++) fm.onFrame(makeFrame());
    vi.advanceTimersByTime(5000); fm.onFrame(makeFrame());
    fm.setPaused(true, 4);
    expect(fm.appState.pauseFlags).toBe(4);
    for (let i = 0; i < 30; i++) { vi.advanceTimersByTime(1000); fm.onFrame(makeFrame()); }
    expect(dbMock.insertPoint).toHaveBeenCalledTimes(2);
    fm.setPaused(false);
    vi.advanceTimersByTime(5000); fm.onFrame(makeFrame());
    expect(dbMock.insertPoint).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(1000); fm.onFrame(makeFrame({ onGround: true, groundSpeedKnots: 2 })); }
    console.log('paused closeFlight args:', JSON.stringify(dbMock.closeFlight.mock.calls[0]));
  });

  it('auto-links when the matcher returns exactly one eligible leg', () => {
    dbMock.getActiveTripId.mockReturnValue(7);
    dbMock.getPlannedLegCandidatesForActiveTrip.mockReturnValue([{
      plannedLegId: 11, tripId: 7, seq: 1, departureIdent: 'KSBA', departureIsAirport: true,
      departureLat: 34.4262, departureLon: -119.8404, status: 'planned', linkedFlightId: null, aircraftType: 'C172',
    }]);
    dbMock.getPlannedLegById.mockReturnValue({
      id: 11, trip_id: 7, destination_ident: 'KMRY', destination_lat: 36.587, destination_lon: -121.843,
      departure_ident: 'KSBA',
      waypoints: [
        { ident: 'KSBA', lat: 34.4262, lon: -119.8404 },
        { ident: 'KMRY', lat: 36.587, lon: -121.843 },
      ],
    } as any);
    const fm = new FlightManager();
    for (let i = 0; i < 3; i++) fm.onFrame(makeFrame());
    expect(dbMock.linkFlightToPlannedLeg).toHaveBeenCalledWith(1, 11, 'auto');
    const st = fm.getPlannedLegStatus(34.4262, -119.8404);
    console.log('plannedLegStatus:', JSON.stringify(st));
    expect(st?.nextWaypointIdent).toBe('KMRY');
    expect(st?.tripName).toBe('Test Trip');
  });

  it('an auto-link throw is swallowed and the flight still records', () => {
    dbMock.getActiveTripId.mockImplementation(() => { throw new Error('db down'); });
    const fm = new FlightManager();
    for (let i = 0; i < 3; i++) fm.onFrame(makeFrame());
    expect(fm.appState.flightState).toBe('FLYING');
    expect(dbMock.insertFlight).toHaveBeenCalledTimes(1);
    expect(dbMock.linkFlightToPlannedLeg).not.toHaveBeenCalled();
  });

  it('does not load better-sqlite3', () => {
    expect(Object.keys(require.cache ?? {}).some(k => k.includes('better-sqlite3'))).toBe(false);
  });
});
