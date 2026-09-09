import { vi } from 'vitest';
import type { SimFrame, LegMatchCandidate, PlannedLegWithChildren } from '../../src/types';

let nextFlightId = 1;

export const dbMock = {
  insertFlight: vi.fn((..._a: unknown[]) => nextFlightId++),
  insertPoint: vi.fn(),
  closeFlight: vi.fn(),
  getFlightPlannedLegId: vi.fn((_id: number): number | null => null),
  getActiveTripId: vi.fn((): number | null => null),
  getPlannedLegCandidatesForActiveTrip: vi.fn((): LegMatchCandidate[] => []),
  getPlannedLegById: vi.fn((_id: number): PlannedLegWithChildren | null => null),
  linkFlightToPlannedLeg: vi.fn(),
  recordPlannedLegArrival: vi.fn(),
  getTripName: vi.fn((_id: number): string | null => 'Test Trip'),
};

export const airportsMock = {
  findNearestAirport: vi.fn((_lat: number, _lon: number, _maxNm?: number): { icao: string; name: string } | null => null),
  initAirports: vi.fn(async () => {}),
};

export function resetMocks(): void {
  nextFlightId = 1;
  for (const m of [...Object.values(dbMock), ...Object.values(airportsMock)]) (m as any).mockClear();
  dbMock.insertFlight.mockImplementation(() => nextFlightId++);
  dbMock.getFlightPlannedLegId.mockImplementation(() => null);
  dbMock.getActiveTripId.mockImplementation(() => null);
  dbMock.getPlannedLegCandidatesForActiveTrip.mockImplementation(() => []);
  dbMock.getPlannedLegById.mockImplementation(() => null);
  dbMock.getTripName.mockImplementation(() => 'Test Trip');
  airportsMock.findNearestAirport.mockImplementation(() => null);
}

export function makeFrame(over: Partial<SimFrame> = {}): SimFrame {
  return {
    lat: 34.4262, lon: -119.8404, altitudeFt: 1500, airspeedKnots: 110,
    groundSpeedKnots: 105, headingDeg: 270, verticalSpeedFpm: 500,
    onGround: false, simRunning: 1, aircraft: 'Cessna 172', ...over,
  };
}
