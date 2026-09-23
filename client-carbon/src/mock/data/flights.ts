import type { Flight } from '../types';
import { AIRPORTS, haversineNm } from './airports';
import { ACTIVE_LEG_ID, BRAZIL_CHAIN } from './plannedLegs';
import { buildTrack, cruiseAltFor } from './tracks';

interface FlightSpec {
  id: number;
  aircraft: string;
  dep: string;
  arr: string;
  start: string;
  tripId: number | null;
  legId: number | null;
  link?: 'auto' | 'manual';
  /** Points to emit; 0 = a flight with no track at all. */
  points: number;
  /** null = still in progress. */
  finished: boolean;
  progress?: number;
  notes?: string;
}

const A320 = 'Airbus A320neo';
const B738 = 'Boeing 737-800';
const ATR = 'ATR 72-600';

/** Leg ids for trip 2 are 3 + seq. */
const t2 = (seq: number) => 3 + seq;

const SPECS: FlightSpec[] = [
  { id: 1, aircraft: A320, dep: 'EFHK', arr: 'EETN', start: '2026-08-12T08:00:00.000Z', tripId: 1, legId: 1, points: 600, finished: true, notes: 'Smooth. Good sample for replay.' },
  { id: 2, aircraft: A320, dep: 'EETN', arr: 'ESSA', start: '2026-08-12T11:30:00.000Z', tripId: 1, legId: 2, points: 80, finished: true },
  { id: 3, aircraft: A320, dep: BRAZIL_CHAIN[0], arr: BRAZIL_CHAIN[1], start: '2026-09-01T12:00:00.000Z', tripId: 2, legId: t2(1), points: 90, finished: true },
  { id: 4, aircraft: A320, dep: BRAZIL_CHAIN[1], arr: BRAZIL_CHAIN[2], start: '2026-09-02T12:00:00.000Z', tripId: 2, legId: t2(2), points: 90, finished: true },
  { id: 5, aircraft: B738, dep: BRAZIL_CHAIN[2], arr: BRAZIL_CHAIN[3], start: '2026-09-03T12:00:00.000Z', tripId: 2, legId: t2(3), points: 70, finished: true },
  { id: 6, aircraft: B738, dep: BRAZIL_CHAIN[3], arr: BRAZIL_CHAIN[4], start: '2026-09-04T12:00:00.000Z', tripId: 2, legId: t2(4), points: 70, finished: true },
  { id: 7, aircraft: B738, dep: 'SBFZ', arr: 'SBJP', start: '2026-09-05T12:00:00.000Z', tripId: 2, legId: t2(5), points: 60, finished: true, notes: 'Diverted to SBJP: weather at SBRF.' },
  { id: 8, aircraft: A320, dep: BRAZIL_CHAIN[5], arr: BRAZIL_CHAIN[6], start: '2026-09-07T12:00:00.000Z', tripId: 2, legId: t2(6), link: 'manual', points: 60, finished: true },
  { id: 9, aircraft: A320, dep: BRAZIL_CHAIN[7], arr: BRAZIL_CHAIN[8], start: '2026-09-09T12:00:00.000Z', tripId: 2, legId: t2(8), points: 90, finished: true },
  { id: 10, aircraft: ATR, dep: BRAZIL_CHAIN[8], arr: BRAZIL_CHAIN[9], start: '2026-09-11T12:00:00.000Z', tripId: 2, legId: t2(9), points: 60, finished: true },
  { id: 11, aircraft: ATR, dep: 'SBRJ', arr: 'SBSP', start: '2026-09-14T14:00:00.000Z', tripId: null, legId: null, points: 50, finished: true },
  { id: 12, aircraft: 'Cessna 172 Skyhawk', dep: 'SBSP', arr: 'SBKP', start: '2026-09-16T10:00:00.000Z', tripId: null, legId: null, points: 0, finished: true, notes: 'Recorder started late; no points.' },
  { id: 13, aircraft: A320, dep: 'SBCT', arr: 'SBPA', start: '2026-09-23T13:20:00.000Z', tripId: 2, legId: ACTIVE_LEG_ID, points: 45, finished: false, progress: 0.4 },
  { id: 14, aircraft: 'Cessna 172 Skyhawk', dep: 'SBGL', arr: 'SBRJ', start: '2026-09-22T09:00:00.000Z', tripId: null, legId: null, points: 12, finished: false, progress: 0.5, notes: 'Sim closed mid-flight; never finalised.' },
];

function build(s: FlightSpec): Flight {
  const a = AIRPORTS[s.dep];
  const b = AIRPORTS[s.arr];
  const dist = haversineNm(a.lat, a.lon, b.lat, b.lon);
  const durationSec = Math.round((dist / 380) * 3600 + 900);
  const progress = s.finished ? 1 : s.progress ?? 0.5;
  const points = s.points > 0
    ? buildTrack({ flightId: s.id, dep: s.dep, arr: s.arr, startIso: s.start, durationSec, points: s.points, progress })
    : [];
  const startMs = Date.parse(s.start);
  const cruise = cruiseAltFor(dist);
  return {
    id: s.id,
    aircraft: s.aircraft,
    start_time: s.start,
    end_time: s.finished ? new Date(startMs + durationSec * 1000).toISOString() : null,
    duration_sec: s.finished ? durationSec : null,
    distance_nm: s.finished ? Math.round(dist * 1.03 * 10) / 10 : null,
    max_altitude_ft: points.length ? Math.max(...points.map(p => p.altitude_ft)) : s.finished ? cruise : null,
    max_airspeed_kts: points.length ? Math.max(...points.map(p => p.airspeed_kts)) : null,
    point_count: points.length,
    points,
    departure_lat: a.lat, departure_lon: a.lon, departure_icao: a.icao, departure_name: a.name,
    arrival_lat: s.finished ? b.lat : null, arrival_lon: s.finished ? b.lon : null,
    arrival_icao: s.finished ? b.icao : null, arrival_name: s.finished ? b.name : null,
    notes: s.notes ?? null,
    trip_id: s.tripId,
    flight_plan_name: s.legId ? `${s.dep}-${s.arr}` : null,
    planned_leg_id: s.legId,
    planned_leg_link_source: s.legId ? s.link ?? 'auto' : null,
    planned_leg_prev_trip_id: null,
  };
}

export const SEED_FLIGHTS: Flight[] = SPECS.map(build);

/** The flight the scripted live status is "recording". */
export const LIVE_FLIGHT_ID = 13;
