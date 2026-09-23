import type { CurrentGroundSessionResponse, Status, TrafficObject } from '../types';
import { AIRPORTS, bearingDeg, haversineNm, interpolate } from './airports';
import { ACTIVE_LEG_ID } from './plannedLegs';
import { LIVE_FLIGHT_ID } from './flights';

/** One scripted cycle, seconds. IDLE, GROUND, FLYING, paused, FLYING, IDLE. */
export const STATUS_LOOP_SEC = 90;

export const SEED_GROUND_SESSION: CurrentGroundSessionResponse = {
  session: {
    id: 1, source: 'auto', airport_icao: 'SBCT', airport_name: AIRPORTS.SBCT.name,
    lat: AIRPORTS.SBCT.lat, lon: AIRPORTS.SBCT.lon, parking_position: 'GATE 5', parking_position_source: 'auto',
    planned_leg_id: ACTIVE_LEG_ID, planned_leg_link_source: 'auto', aircraft: 'Airbus A320neo',
    started_at: '2026-09-23T12:40:00.000Z', ended_at: null, ended_reason: null, flight_id: null,
    created_at: '2026-09-23T12:40:00.000Z', updated_at: '2026-09-23T12:41:00.000Z',
  },
};

const DEP = AIRPORTS.SBCT;
const ARR = AIRPORTS.SBPA;
const AIRCRAFT = 'Airbus A320neo';
const ROUTE_NM = haversineNm(DEP.lat, DEP.lon, ARR.lat, ARR.lon);

const idleStatus = (): Status => ({
  connected: true, flightState: 'IDLE', currentFlightId: null, aircraft: null, frame: null, paused: false, pauseFlags: 0,
});

function groundStatus(): Status {
  const s = SEED_GROUND_SESSION.session!;
  return {
    connected: true, flightState: 'GROUND', currentFlightId: null, aircraft: AIRCRAFT, paused: false, pauseFlags: 0,
    frame: {
      lat: DEP.lat, lon: DEP.lon, altitudeFt: DEP.elevationFt, airspeedKnots: 0, groundSpeedKnots: 0,
      headingDeg: 150, verticalSpeedFpm: 0, onGround: true,
    },
    groundSession: {
      groundSessionId: s.id, source: s.source, airportIcao: s.airport_icao, airportName: s.airport_name,
      parkingPosition: s.parking_position, parkingPositionSource: s.parking_position_source,
      plannedLegId: ACTIVE_LEG_ID, plannedLegLinkSource: 'auto', tripId: 2, tripName: 'Brasil Tour',
      departureIdent: 'SBCT', destinationIdent: 'SBPA', startedAt: s.started_at,
    },
  };
}

function flyingStatus(f: number, paused: boolean): Status {
  const [lat, lon] = interpolate(DEP.lat, DEP.lon, ARR.lat, ARR.lon, f);
  const [nLat, nLon] = interpolate(DEP.lat, DEP.lon, ARR.lat, ARR.lon, Math.min(1, f + 0.01));
  const heading = Math.round(bearingDeg(lat, lon, nLat, nLon));
  const traffic: TrafficObject[] = [0, 1, 2].map(i => ({
    id: 900 + i, lat: lat + 0.25 * (i - 1), lon: lon + 0.3 * (1 - i), altitudeFt: 30000 + i * 2000,
    headingDeg: (heading + 90 * i) % 360, onGround: false,
  }));
  return {
    connected: true, flightState: 'FLYING', currentFlightId: LIVE_FLIGHT_ID, aircraft: AIRCRAFT, paused,
    pauseFlags: paused ? 4 : 0,
    frame: {
      lat, lon, altitudeFt: 35000, airspeedKnots: paused ? 0 : 268, groundSpeedKnots: paused ? 0 : 455,
      headingDeg: heading, verticalSpeedFpm: 0, onGround: false,
    },
    plannedLeg: {
      plannedLegId: ACTIVE_LEG_ID, tripId: 2, tripName: 'Brasil Tour', destinationIdent: 'SBPA',
      nextWaypointIdent: f < 0.5 ? 'ROSIX' : 'BELOM',
      remainingDistanceNm: Math.round(ROUTE_NM * (1 - f)), distanceIsApproximate: true,
    },
    traffic,
  };
}

/** The scripted status at loop time t (seconds, 0 <= t < STATUS_LOOP_SEC). */
export function statusAt(t: number): Status {
  if (t < 10) return idleStatus();
  if (t < 25) return groundStatus();
  if (t < 55) return flyingStatus(0.4 + ((t - 25) / 30) * 0.1, false);
  if (t < 65) return flyingStatus(0.5, true);
  if (t < 80) return flyingStatus(0.5 + ((t - 65) / 15) * 0.1, false);
  return idleStatus();
}
