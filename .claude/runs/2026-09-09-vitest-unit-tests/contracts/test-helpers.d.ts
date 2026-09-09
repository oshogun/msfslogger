// Frozen export surface of tests/helpers/index.ts — design.md §4, §5, §6.
// REFERENCE ARTIFACT. Not compiled, not imported, not wired into the build.
// The implementation lives at tests/helpers/index.ts and is written by T-002.

import type {
  SimFrame,
  LegMatchCandidate,
  PlannedLegWithChildren,
  PlannedWaypoint,
  PlannedAlternate,
} from '../../../../src/types';
import type { HandCloseFlight, HandCloseLeg } from '../../../../src/plannedLegClose';

// ── §4 Builders ───────────────────────────────────────────────────────────────

export declare function makeFrame(over?: Partial<SimFrame>): SimFrame;
export declare function makeCandidate(over?: Partial<LegMatchCandidate>): LegMatchCandidate;
export declare function makeHandCloseFlight(over?: Partial<HandCloseFlight>): HandCloseFlight;
export declare function makeHandCloseLeg(over?: Partial<HandCloseLeg>): HandCloseLeg;
export declare function makePlannedLegWithChildren(
  over?: Partial<PlannedLegWithChildren>,
): PlannedLegWithChildren;

/** Nautical miles per degree of latitude under src/geo.ts's R = 3440.065. */
export declare const NM_PER_DEG: 60.04046120432669;
/** Degrees of latitude per nautical mile. 1 / NM_PER_DEG. */
export declare const DEG_PER_NM: 0.016655435148240015;

/** A position `nm` due north of `pos`, exact to ~1e-15 nm under haversineNm. */
export declare function northOfNm(
  pos: { lat: number; lon: number },
  nm: number,
): { lat: number; lon: number };

// ── §4.6 Airport fixtures (real coordinates, from samples/lnmpln) ─────────────

export declare const KSBA: { lat: 34.426201; lon: -119.841507 };
export declare const KMRY: { lat: 36.586952; lon: -121.843079 };
export declare const KSTS: { lat: 38.509693; lon: -122.812897 };
export declare const KACV: { lat: 40.977814; lon: -124.108475 };
export declare const KSFO: { lat: 37.618023; lon: -122.375519 };
export declare const KLAX: { lat: 33.942474; lon: -118.409332 };

// ── §5 Clock ──────────────────────────────────────────────────────────────────

/** ISO instant every fake-clock test starts from. */
export declare const T0: '2026-09-09T12:00:00.000Z';

/** vi.useFakeTimers() + vi.setSystemTime(new Date(iso)). Call in beforeEach. */
export declare function useFakeClock(iso?: string): void;
/** vi.useRealTimers(). Call in afterEach. */
export declare function useRealClock(): void;
/** Milliseconds since T0 on the fake clock, as an ISO instant. */
export declare function isoAfter(ms: number, from?: string): string;

// ── §6 Module-boundary fakes ──────────────────────────────────────────────────

export declare const dbMock: {
  insertFlight: import('vitest').Mock<
    (
      aircraft: string,
      lat: number,
      lon: number,
      startTime: string,
      departureIcao?: string | null,
      departureName?: string | null,
    ) => number
  >;
  insertPoint: import('vitest').Mock<(...args: unknown[]) => void>;
  closeFlight: import('vitest').Mock<(...args: unknown[]) => void>;
  getFlightPlannedLegId: import('vitest').Mock<(flightId: number) => number | null>;
  getActiveTripId: import('vitest').Mock<() => number | null>;
  getPlannedLegCandidatesForActiveTrip: import('vitest').Mock<() => LegMatchCandidate[]>;
  getPlannedLegById: import('vitest').Mock<(legId: number) => PlannedLegWithChildren | null>;
  linkFlightToPlannedLeg: import('vitest').Mock<
    (flightId: number, legId: number, source: 'auto' | 'manual') => void
  >;
  recordPlannedLegArrival: import('vitest').Mock<
    (legId: number, status: 'flown' | 'diverted', deviationNm: number) => void
  >;
  getTripName: import('vitest').Mock<(tripId: number) => string | null>;
};

export declare const airportsMock: {
  findNearestAirport: import('vitest').Mock<
    (lat: number, lon: number, maxNm?: number) => { icao: string; name: string } | null
  >;
  initAirports: import('vitest').Mock<() => Promise<void>>;
};

/**
 * Clears call history AND re-installs every default implementation listed in
 * design.md §6.2/§6.3. MUST be called in beforeEach: vitest.config.ts sets
 * `restoreMocks: true`, which strips vi.fn() implementations after each test.
 */
export declare function resetMocks(): void;

/** Next id insertFlight will return. Reset to 1 by resetMocks(). */
export declare function nextFlightId(): number;
