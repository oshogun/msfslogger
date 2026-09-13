// tests/journey.test.ts — src/journey.ts.
//
// src/journey.ts imports nothing but types: no ./db, no ./airports, no fs, no
// network, no clock. This file matches that — fixtures are plain in-memory
// object literals, and nothing here is mocked. Planned legs come from
// makePlannedLegWithChildren() in ./helpers (the same wide row shape the rest
// of the suite uses); the flight fixture is local, as in kmlExport.test.ts,
// since no shared factory for it exists.

import { describe, expect, it } from 'vitest';
import { buildJourney, countryForIcao } from '../src/journey';
import type { Flight, FlightPoint, PlannedLegWithChildren } from '../src/types';
import { makePlannedLegWithChildren } from './helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

type JourneyFlight = Flight & { points: FlightPoint[] };

function flight(over: Partial<JourneyFlight> = {}): JourneyFlight {
  return {
    id: 1,
    aircraft: 'Cessna 172',
    departure_lat: 34.426201,
    departure_lon: -119.841507,
    arrival_lat: 36.586952,
    arrival_lon: -121.843079,
    start_time: '2026-09-09T00:44:26.913Z',
    end_time: '2026-09-09T02:35:35.640Z',
    duration_sec: 6664,
    distance_nm: 252.1,
    max_altitude_ft: 10080,
    max_airspeed_kts: 140,
    point_count: 0,
    notes: null,
    trip_id: 1,
    departure_icao: 'KSBA',
    departure_name: 'Santa Barbara Muni',
    arrival_icao: 'KMRY',
    arrival_name: 'Monterey Rgnl',
    flight_plan_name: null,
    planned_leg_id: null,
    planned_leg_link_source: null,
    planned_leg_prev_trip_id: null,
    points: [],
    ...over,
  };
}

/** A planned leg reduced to what progress depends on: status and distance. */
function leg(
  id: number,
  status: PlannedLegWithChildren['status'],
  approx_distance_nm: number
): PlannedLegWithChildren {
  return makePlannedLegWithChildren({ id, seq: id, status, approx_distance_nm });
}

// ── 1. Countries ──────────────────────────────────────────────────────────────

describe('countryForIcao — Russia & CIS prefixes', () => {
  it('resolves a U* airport instead of returning null', () => {
    expect(countryForIcao('UHPP')).toEqual({ name: 'Russia', flag: '🇷🇺' });
    expect(countryForIcao('UUEE')).toEqual({ name: 'Russia', flag: '🇷🇺' });
    expect(countryForIcao('UKBB')).toEqual({ name: 'Ukraine', flag: '🇺🇦' });
    expect(countryForIcao('UAAA')).toEqual({ name: 'Kazakhstan', flag: '🇰🇿' });
    expect(countryForIcao('UTTT')).toEqual({ name: 'Uzbekistan', flag: '🇺🇿' });
  });

  it('still resolves the pre-existing single-letter and two-letter prefixes', () => {
    expect(countryForIcao('KSBA')).toEqual({ name: 'United States', flag: '🇺🇸' });
    expect(countryForIcao('CYYZ')).toEqual({ name: 'Canada', flag: '🇨🇦' });
    expect(countryForIcao('SBGR')).toEqual({ name: 'Brazil', flag: '🇧🇷' });
  });

  it('returns null for an unallocated prefix and for unusable input', () => {
    expect(countryForIcao('QQQQ')).toBeNull();
    expect(countryForIcao(null)).toBeNull();
    expect(countryForIcao('')).toBeNull();
    expect(countryForIcao('U')).toBeNull();
  });
});

describe('buildJourney — countries rollup', () => {
  it('includes a U* airport as Russia with its flag rather than dropping it', () => {
    const journey = buildJourney([
      flight({
        id: 1,
        departure_icao: 'UHPP', departure_name: 'Yelizovo',
        departure_lat: 53.167, departure_lon: 158.454,
        arrival_icao: 'UHMM', arrival_name: 'Magadan Sokol',
        arrival_lat: 59.911, arrival_lon: 150.72,
      }),
    ]);

    expect(journey.countries).toEqual([{ name: 'Russia', flag: '🇷🇺', airports: 2 }]);
    // The airports list was never filtered by country and must stay complete.
    expect(journey.airports.map(a => a.icao).sort()).toEqual(['UHMM', 'UHPP']);
  });

  it('counts distinct airports per country across a mixed-country trip', () => {
    const journey = buildJourney([
      flight({ id: 1, departure_icao: 'UUEE', arrival_icao: 'UHPP' }),
      flight({ id: 2, departure_icao: 'UHPP', arrival_icao: 'KSBA' }),
    ]);

    expect(journey.countries).toEqual([
      { name: 'Russia', flag: '🇷🇺', airports: 2 },
      { name: 'United States', flag: '🇺🇸', airports: 1 },
    ]);
  });
});

// ── 2. Planned route progress ─────────────────────────────────────────────────

describe('buildJourney — plannedRouteProgressPct', () => {
  it('counts only flown and diverted legs, not raw trip distance', () => {
    const legs = [
      leg(1, 'flown', 100),
      leg(2, 'diverted', 50),
      leg(3, 'planned', 200),
      leg(4, 'skipped', 50),
    ];
    // Raw flown distance (1000 nm) alone exceeds the 400 nm planned total, so
    // the old numerator would have clamped this to 100.
    const flights = [
      flight({ id: 1, distance_nm: 600 }),
      flight({ id: 2, distance_nm: 400 }),
    ];

    const journey = buildJourney(flights, legs);

    expect(journey.totalDistanceNm).toBe(1000);
    expect(journey.plannedRouteProgressPct).toBe(37.5); // 150 / 400
    expect(journey.plannedRouteProgressPct).not.toBe(100);
  });

  it('reads 0 when nothing is flown yet, however far the trip has flown', () => {
    const journey = buildJourney(
      [flight({ id: 1, distance_nm: 900 })],
      [leg(1, 'planned', 100), leg(2, 'planned', 300)]
    );

    expect(journey.plannedRouteProgressPct).toBe(0);
  });

  it('reads 100 only when every planned leg is flown or diverted', () => {
    const allDone = buildJourney(
      [flight({ id: 1, distance_nm: 10 })],
      [leg(1, 'flown', 100), leg(2, 'diverted', 300)]
    );
    expect(allDone.plannedRouteProgressPct).toBe(100);

    // A skipped leg stays in the denominator forever: it was never flown.
    const oneSkipped = buildJourney(
      [flight({ id: 1, distance_nm: 10 })],
      [leg(1, 'flown', 100), leg(2, 'flown', 300), leg(3, 'skipped', 100)]
    );
    expect(oneSkipped.plannedRouteProgressPct).toBe(80);
  });

  it('rounds to one decimal place', () => {
    const journey = buildJourney(
      [flight({ id: 1 })],
      [leg(1, 'flown', 1), leg(2, 'planned', 2)]
    );

    expect(journey.plannedRouteProgressPct).toBe(33.3); // 1/3
  });

  it('omits the key entirely on a trip with no planned legs', () => {
    const journey = buildJourney([flight({ id: 1, distance_nm: 252.1 })]);

    expect('plannedRouteProgressPct' in journey).toBe(false);
    expect(JSON.parse(JSON.stringify(journey))).not.toHaveProperty('plannedRouteProgressPct');
  });

  it('omits the key when the planned legs total a degenerate 0 nm', () => {
    const journey = buildJourney([flight({ id: 1 })], [leg(1, 'flown', 0), leg(2, 'planned', 0)]);

    expect('plannedRouteProgressPct' in journey).toBe(false);
  });

  it('omits the key on an empty trip with no flights and no planned legs', () => {
    const journey = buildJourney([]);

    expect('plannedRouteProgressPct' in journey).toBe(false);
    expect(journey.legCount).toBe(0);
    expect(journey.countries).toEqual([]);
  });
});
