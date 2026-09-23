import type { PlannedLegStatus, PlannedLegWithChildren, PlannedWaypoint } from '../types';
import { AIRPORTS, haversineNm, interpolate } from './airports';
import { cruiseAltFor } from './tracks';

/** Trip 2's route: 28 airports -> 27 legs, so the trip list paginates. */
export const BRAZIL_CHAIN = [
  'SBGR', 'SBBR', 'SBSV', 'SBRF', 'SBFZ', 'SBRF', 'SBSV', 'SBCF', 'SBGR', 'SBCT',
  'SBPA', 'SBCT', 'SBGL', 'SBRJ', 'SBSP', 'SBKP', 'SBBR', 'SBCF', 'SBGL', 'SBSV',
  'SBBR', 'SBGR', 'SBPA', 'SBCT', 'SBKP', 'SBBR', 'SBFZ', 'SBRF',
];

/** Seq (1-based) within trip 2 -> status. Everything else is 'planned'. */
const TRIP2_STATUS: Record<number, PlannedLegStatus> = {
  1: 'flown', 2: 'flown', 3: 'flown', 4: 'flown', 5: 'diverted', 6: 'flown', 7: 'skipped', 8: 'flown', 9: 'flown',
};

/** The leg trip 2's in-progress flight is on (SBCT -> SBPA), the one with SID/STAR/approach. */
export const ACTIVE_LEG_ID = 13;

const FIX_NAMES = [
  'TIBAM', 'RUKLA', 'ERKOK', 'VIRAL', 'GOTAN', 'PARAK', 'LIKUM', 'NEBAX', 'ORSOT', 'DUMBA', 'KEVIL', 'UTAPA',
  'ROSIX', 'BELOM', 'ANTEP', 'IGSAD', 'MOLVA', 'TUKNA', 'SEPTA', 'ARISO', 'CANIL', 'DEXAB', 'PUMAL', 'OKRIT',
];

interface LegSpec {
  id: number;
  tripId: number | null;
  seq: number;
  status: PlannedLegStatus;
  dep: string;
  arr: string;
  overrides?: Partial<PlannedLegWithChildren>;
  /** Waypoint ident/lat/lon for a snippet whose first waypoint is not an airport. */
  snippetStart?: { ident: string; lat: number; lon: number };
}

function sha(id: number): string {
  return ('mock' + String(id).padStart(4, '0')).padEnd(64, '0');
}

function makeLeg(s: LegSpec): PlannedLegWithChildren {
  const a = AIRPORTS[s.dep] ?? null;
  const b = AIRPORTS[s.arr];
  const start = s.snippetStart ?? (a ? { ident: a.icao, lat: a.lat, lon: a.lon } : { ident: s.dep, lat: 0, lon: 0 });
  const dist = haversineNm(start.lat, start.lon, b.lat, b.lon);
  const waypoints: PlannedWaypoint[] = [];
  const push = (ident: string, name: string | null, lat: number, lon: number, type: string, airway: string | null) =>
    waypoints.push({
      id: s.id * 100 + waypoints.length + 1, planned_leg_id: s.id, seq: waypoints.length + 1, ident, name,
      region: a?.icao.slice(0, 2) ?? null, airway, track: null, type, comment: null, lat, lon, alt_ft: null,
    });
  push(start.ident, a?.name ?? null, start.lat, start.lon, a ? 'AIRPORT' : 'USER', null);
  const midCount = dist > 350 ? 3 : 2;
  for (let i = 1; i <= midCount; i++) {
    const [lat, lon] = interpolate(start.lat, start.lon, b.lat, b.lon, i / (midCount + 1));
    push(FIX_NAMES[(s.id * 3 + i) % FIX_NAMES.length], null, lat, lon, 'WAYPOINT', i > 1 ? `UZ${20 + (s.id % 9)}` : null);
  }
  push(b.icao, b.name, b.lat, b.lon, 'AIRPORT', null);
  const linked = s.status === 'flown' || s.status === 'diverted';
  return {
    id: s.id, trip_id: s.tripId, seq: s.seq, status: s.status,
    departure_ident: start.ident, departure_name: a?.name ?? null, departure_lat: start.lat, departure_lon: start.lon,
    departure_is_airport: a ? 1 : 0, departure_start: null, departure_start_type: null,
    departure_pos_lat: null, departure_pos_lon: null,
    destination_ident: b.icao, destination_name: b.name, destination_lat: b.lat, destination_lon: b.lon,
    destination_is_airport: 1,
    is_snippet: s.snippetStart ? 1 : 0,
    cruise_alt_ft: cruiseAltFor(dist), flightplan_type: 'IFR', aircraft_type: 'A20N',
    sid_name: null, sid_runway: null, sid_transition: null, sid_type: null, sid_custom_distance_nm: null,
    star_name: null, star_runway: null, star_transition: null,
    approach_name: null, approach_runway: null, approach_transition: null, approach_type: null,
    approach_arinc: null, approach_suffix: null, approach_transition_type: null,
    approach_custom_distance_nm: null, approach_custom_altitude_ft: null, approach_custom_offset_deg: null,
    waypoint_count: waypoints.length, alternate_count: 0,
    approx_distance_nm: Math.round(dist * 1.04 * 10) / 10,
    arrival_deviation_nm: linked ? (s.status === 'diverted' ? Math.round(haversineNm(AIRPORTS.SBJP.lat, AIRPORTS.SBJP.lon, b.lat, b.lon) * 10) / 10 : 0.4) : null,
    remarks: null,
    plan_created_at: '2026-08-30T18:00:00.000Z',
    source_filename: `${s.dep.toLowerCase()}-${s.arr.toLowerCase()}.lnmpln`,
    source_sha256: sha(s.id),
    source_program: 'Little Navmap',
    imported_at: '2026-08-30T18:05:00.000Z',
    linked_flight_id: null,
    waypoints,
    alternates: [],
    ...s.overrides,
  };
}

const specs: LegSpec[] = [
  { id: 1, tripId: 1, seq: 1, status: 'flown', dep: 'EFHK', arr: 'EETN' },
  { id: 2, tripId: 1, seq: 2, status: 'flown', dep: 'EETN', arr: 'ESSA' },
  { id: 3, tripId: 1, seq: 3, status: 'planned', dep: 'ESSA', arr: 'EFHK' },
];
for (let seq = 1; seq < BRAZIL_CHAIN.length; seq++) {
  const id = 3 + seq;
  const overrides: Partial<PlannedLegWithChildren> = {};
  if (id === ACTIVE_LEG_ID) {
    Object.assign(overrides, {
      sid_name: 'TNOL1A', sid_runway: '15', sid_transition: null, sid_type: 'STANDARD',
      star_name: 'ISOB1A', star_runway: '11', star_transition: 'ISOB',
      approach_name: 'ILS Z RWY 11', approach_runway: '11', approach_type: 'ILS', approach_arinc: 'I11',
      approach_suffix: 'Z', approach_transition: null,
      remarks: 'Mock leg carrying a SID, a STAR and an approach.',
    });
  }
  specs.push({
    id, tripId: 2, seq, status: TRIP2_STATUS[seq] ?? 'planned',
    dep: BRAZIL_CHAIN[seq - 1], arr: BRAZIL_CHAIN[seq], overrides,
  });
}
specs.push(
  {
    id: 31, tripId: null, seq: 1, status: 'planned', dep: 'ISBAX', arr: 'SBGR',
    snippetStart: { ident: 'ISBAX', lat: -22.1, lon: -46.9 },
    overrides: { remarks: 'Snippet: joins an existing route mid-way.' },
  },
  { id: 32, tripId: null, seq: 1, status: 'planned', dep: 'SBGR', arr: 'SBRJ' },
);

export const SEED_PLANNED_LEGS: PlannedLegWithChildren[] = specs.map(makeLeg);
