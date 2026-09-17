import type { Flight, PlannedLegListItem, PlannedLegWithChildren, Trip } from '../types';

/**
 * Typed literals for component tests. Kept minimal on purpose — most of
 * these pages have optional sub-sections (a linked planned leg, GPS points, a
 * SimBrief setting) that a real page render doesn't need to exercise every
 * one of at once; a test that cares about a particular field overrides it
 * with `{ ...flightFixture, ... }` rather than this file growing a fixture
 * per test.
 *
 * `points: []` on every flight fixture is deliberate: FlightMap/TripMap both
 * fall back to a plain "No GPS points recorded" paragraph when there is
 * nothing to draw, so these fixtures never mount react-leaflet inside jsdom.
 */

export const flightFixture: Flight = {
  id: 1,
  aircraft: 'Airbus A320neo',
  start_time: '2026-03-01T08:00:00.000Z',
  end_time: '2026-03-01T09:12:00.000Z',
  duration_sec: 4320,
  distance_nm: 152.4,
  max_altitude_ft: 36000,
  max_airspeed_kts: 451,
  point_count: 0,
  points: [],
  departure_lat: 60.3172,
  departure_lon: 24.9633,
  departure_icao: 'EFHK',
  departure_name: 'Helsinki-Vantaa',
  arrival_lat: 59.4133,
  arrival_lon: 24.8328,
  arrival_icao: 'EETN',
  arrival_name: 'Tallinn Lennart Meri',
  notes: null,
  trip_id: 1,
  flight_plan_name: null,
  planned_leg_id: null,
  planned_leg_link_source: null,
  planned_leg_prev_trip_id: null,
};

export const tripFixture: Trip = {
  id: 1,
  name: 'E2E Baltic Hop',
  notes: null,
  flight_count: 1,
  total_duration_sec: 4320,
  total_distance_nm: 152.4,
  max_altitude_ft: 36000,
  flights: [flightFixture],
  is_active: 0,
  planned_leg_count: 0,
  planned_legs: [],
};

export const plannedLegFixture: PlannedLegWithChildren = {
  id: 1,
  trip_id: 1,
  seq: 1,
  status: 'planned',
  departure_ident: 'EETN',
  departure_name: 'Tallinn Lennart Meri',
  departure_lat: 59.4133,
  departure_lon: 24.8328,
  departure_is_airport: 1,
  departure_start: null,
  departure_start_type: null,
  departure_pos_lat: null,
  departure_pos_lon: null,
  destination_ident: 'ESSA',
  destination_name: 'Stockholm Arlanda',
  destination_lat: 59.6519,
  destination_lon: 17.9186,
  destination_is_airport: 1,
  is_snippet: 0,
  cruise_alt_ft: 34000,
  flightplan_type: 'IFR',
  aircraft_type: 'A20N',
  sid_name: null,
  sid_runway: null,
  sid_transition: null,
  sid_type: null,
  sid_custom_distance_nm: null,
  star_name: null,
  star_runway: null,
  star_transition: null,
  approach_name: null,
  approach_runway: null,
  approach_transition: null,
  approach_type: null,
  approach_arinc: null,
  approach_suffix: null,
  approach_transition_type: null,
  approach_custom_distance_nm: null,
  approach_custom_altitude_ft: null,
  approach_custom_offset_deg: null,
  waypoint_count: 2,
  alternate_count: 0,
  approx_distance_nm: 212.0,
  arrival_deviation_nm: null,
  remarks: null,
  plan_created_at: null,
  source_filename: 'e2e-eetn-essa.lnmpln',
  source_sha256: 'e2e' + '0'.repeat(57) + '0001',
  source_program: 'msfslogger-e2e-seed',
  imported_at: '2026-02-20T12:05:00.000Z',
  linked_flight_id: null,
  waypoints: [],
  alternates: [],
};

export const plannedLegListItemFixture: PlannedLegListItem = {
  ...plannedLegFixture,
  trip_name: 'E2E Baltic Hop',
};
