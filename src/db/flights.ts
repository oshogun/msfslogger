import type { Flight, FlightPoint, FlightWithPoints, FlightEditPayload } from '../types';
import { copyFlightPlanFile, deleteFlightPlanFile } from '../flightPlans';
// Imported from the barrel, not './plannedLegs' directly, to avoid a domain-module
// cross-import; resolves fine since it's only called inside function bodies, never
// at module load.
import { clearPlannedLegLink } from '../db';
import { getDb } from './connection';

// ── Geo helpers ───────────────────────────────────────────────────────────────

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const la1 = toRad(lat1);
  const la2 = toRad(lat2);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}
// ── Flight CRUD ───────────────────────────────────────────────────────────────

export function insertFlight(aircraft: string, lat: number, lon: number, startTime: string, departureIcao: string | null = null, departureName: string | null = null): number {
  const result = getDb().prepare(`
    INSERT INTO flights (aircraft, departure_lat, departure_lon, departure_icao, departure_name, start_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(aircraft, lat, lon, departureIcao, departureName, startTime);
  return result.lastInsertRowid as number;
}

export function closeFlight(
  id: number,
  endTime: string,
  arrivalLat: number,
  arrivalLon: number,
  durationSec: number,
  distanceNm: number,
  maxAltitudeFt: number,
  maxAirspeedKts: number,
  pointCount: number,
  arrivalIcao: string | null = null,
  arrivalName: string | null = null
): void {
  getDb().prepare(`
    UPDATE flights SET
      end_time         = ?,
      arrival_lat      = ?,
      arrival_lon      = ?,
      duration_sec     = ?,
      distance_nm      = ?,
      max_altitude_ft  = ?,
      max_airspeed_kts = ?,
      point_count      = ?,
      arrival_icao     = ?,
      arrival_name     = ?
    WHERE id = ?
  `).run(endTime, arrivalLat, arrivalLon, durationSec, distanceNm, maxAltitudeFt, maxAirspeedKts, pointCount, arrivalIcao, arrivalName, id);
}

export function updateFlight(id: number, payload: FlightEditPayload): boolean {
  const allowed = ['aircraft', 'notes'] as const;
  const keys = (Object.keys(payload) as (typeof allowed[number])[]).filter(k => allowed.includes(k));
  if (keys.length === 0) return false;

  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values: unknown[] = keys.map(k => payload[k] ?? null);
  values.push(id);

  const result = getDb().prepare(`UPDATE flights SET ${setClauses} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function setFlightPlanName(id: number, name: string): void {
  getDb().prepare('UPDATE flights SET flight_plan_name = ? WHERE id = ?').run(name, id);
}

export function clearFlightPlanName(id: number): void {
  getDb().prepare('UPDATE flights SET flight_plan_name = NULL WHERE id = ?').run(id);
}

export function insertPoint(
  flightId: number,
  ts: string,
  lat: number,
  lon: number,
  altitudeFt: number,
  airspeedKts: number,
  groundSpeedKts: number,
  headingDeg: number,
  verticalSpeedFpm: number,
  onGround: boolean
): void {
  getDb().prepare(`
    INSERT INTO flight_points
      (flight_id, ts, lat, lon, altitude_ft, airspeed_kts, ground_speed_kts, heading_deg, vertical_speed_fpm, on_ground)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(flightId, ts, lat, lon, altitudeFt, airspeedKts, groundSpeedKts, headingDeg, verticalSpeedFpm, onGround ? 1 : 0);
}

export function getFlights(): Flight[] {
  return getDb().prepare('SELECT * FROM flights ORDER BY start_time DESC').all() as Flight[];
}

export function getFlightById(id: number): FlightWithPoints | null {
  const flight = getDb().prepare('SELECT * FROM flights WHERE id = ?').get(id) as Flight | undefined;
  if (!flight) return null;
  const points = getDb().prepare('SELECT * FROM flight_points WHERE flight_id = ? ORDER BY ts ASC').all(id) as FlightPoint[];
  return { ...flight, points };
}

export function getFlightPointCount(id: number): number {
  const row = getDb().prepare('SELECT COUNT(*) as cnt FROM flight_points WHERE flight_id = ?').get(id) as { cnt: number };
  return row.cnt;
}

export function deleteFlight(id: number): boolean {
  // The FK is on flights.planned_leg_id, so deleting the row would drop the
  // link but leave the leg permanently 'flown'/'diverted' by a flight that no
  // longer exists. Same idiom as deleteFlightPlanFile() below.
  clearPlannedLegLink(id);
  const result = getDb().prepare('DELETE FROM flights WHERE id = ?').run(id);
  if (result.changes > 0) deleteFlightPlanFile(id);
  return result.changes > 0;
}
// ── Combine flights ───────────────────────────────────────────────────────────

type InsertablePoint = Omit<FlightPoint, 'id' | 'flight_id'>;

const FILLER_COUNT = 8;

/**
 * A single flight's own logged duration, never spanning into another flight.
 * Falls back to its own start→end wall clock for rows predating duration_sec.
 */
function ownDurationSec(flight: Flight): number {
  if (flight.duration_sec != null) return flight.duration_sec;
  if (!flight.end_time) return 0;
  return Math.max(0, Math.round(
    (new Date(flight.end_time).getTime() - new Date(flight.start_time).getTime()) / 1000
  ));
}

export function combineFlights(idA: number, idB: number): number | null {
  return getDb().transaction((): number | null => {
    const flightA = getDb().prepare('SELECT * FROM flights WHERE id = ?').get(idA) as Flight | undefined;
    const flightB = getDb().prepare('SELECT * FROM flights WHERE id = ?').get(idB) as Flight | undefined;
    if (!flightA || !flightB) return null;

    const [first, second] =
      new Date(flightA.start_time) <= new Date(flightB.start_time)
        ? [flightA, flightB]
        : [flightB, flightA];

    const fetchPoints = getDb().prepare('SELECT * FROM flight_points WHERE flight_id = ? ORDER BY ts ASC');
    const firstPts  = fetchPoints.all(first.id)  as FlightPoint[];
    const secondPts = fetchPoints.all(second.id) as FlightPoint[];

    const fillerPts: InsertablePoint[] = [];

    if (firstPts.length > 0 && secondPts.length > 0) {
      const p1 = firstPts[firstPts.length - 1];
      const p2 = secondPts[0];
      const t1 = new Date(p1.ts).getTime();
      const t2 = new Date(p2.ts).getTime();
      // If timestamps are inverted (data anomaly) space fillers 1s apart from p1
      const tStep = t2 > t1 ? (t2 - t1) : 1000;
      const tBase = t1;
      const hdg = bearingDeg(p1.lat, p1.lon, p2.lat, p2.lon);

      for (let i = 1; i <= FILLER_COUNT; i++) {
        const t = i / (FILLER_COUNT + 1);
        fillerPts.push({
          ts:                new Date(tBase + t * tStep).toISOString(),
          lat:               p1.lat + t * (p2.lat - p1.lat),
          lon:               p1.lon + t * (p2.lon - p1.lon),
          altitude_ft:       p1.altitude_ft + t * (p2.altitude_ft - p1.altitude_ft),
          airspeed_kts:      0,
          ground_speed_kts:  0,
          heading_deg:       hdg,
          vertical_speed_fpm: 0,
          on_ground:         0,
        });
      }
    }

    const gapDistNm =
      firstPts.length > 0 && secondPts.length > 0
        ? haversineNm(
            firstPts[firstPts.length - 1].lat, firstPts[firstPts.length - 1].lon,
            secondPts[0].lat, secondPts[0].lon
          )
        : 0;

    const newDistanceNm  = (first.distance_nm  ?? 0) + gapDistNm + (second.distance_nm  ?? 0);
    const newMaxAlt      = Math.max(first.max_altitude_ft  ?? 0, second.max_altitude_ft  ?? 0);
    const newMaxSpeed    = Math.max(first.max_airspeed_kts ?? 0, second.max_airspeed_kts ?? 0);
    const newPointCount  = firstPts.length + fillerPts.length + secondPts.length;
    const effectiveEndTime =
      second.end_time ??
      (secondPts.length > 0 ? secondPts[secondPts.length - 1].ts : first.end_time ?? new Date().toISOString());

    // Sum the legs' own durations rather than measuring first.start → second.end.
    // A long pause can cause one flight to be logged as two, and the wall-clock
    // gap between the halves is exactly that pause — it must not be counted.
    const durationSec = ownDurationSec(first) + ownDurationSec(second);
    const aircraft = first.aircraft ?? second.aircraft ?? null;
    const noteParts = [first.notes, second.notes].filter(Boolean);
    const notes = noteParts.length > 0 ? noteParts.join('\n---\n') : null;

    const newId = getDb().prepare(`
      INSERT INTO flights
        (aircraft, departure_lat, departure_lon, arrival_lat, arrival_lon,
         start_time, end_time, duration_sec, distance_nm,
         max_altitude_ft, max_airspeed_kts, point_count, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      aircraft,
      first.departure_lat,  first.departure_lon,
      second.arrival_lat,   second.arrival_lon,
      first.start_time,     effectiveEndTime,
      durationSec,
      Math.round(newDistanceNm * 10) / 10,
      Math.round(newMaxAlt),
      Math.round(newMaxSpeed),
      newPointCount,
      notes
    ).lastInsertRowid as number;

    const insertPt = getDb().prepare(`
      INSERT INTO flight_points
        (flight_id, ts, lat, lon, altitude_ft, airspeed_kts, ground_speed_kts,
         heading_deg, vertical_speed_fpm, on_ground)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of [...firstPts, ...fillerPts, ...secondPts]) {
      insertPt.run(newId, p.ts, p.lat, p.lon, p.altitude_ft,
        p.airspeed_kts, p.ground_speed_kts, p.heading_deg, p.vertical_speed_fpm, p.on_ground);
    }

    // Carry over whichever flight had an attached flight plan (preferring the earlier one)
    const flightPlanSource = first.flight_plan_name ? first : (second.flight_plan_name ? second : null);
    if (flightPlanSource) {
      copyFlightPlanFile(flightPlanSource.id, newId);
      setFlightPlanName(newId, flightPlanSource.flight_plan_name as string);
    }
    deleteFlightPlanFile(first.id);
    deleteFlightPlanFile(second.id);

    // Unlike the PDF attachment above, a planned-leg link is deliberately NOT
    // carried to the combined flight: this INSERT does not carry trip_id
    // either, so a carried-over link would put the new flight in no trip
    // while claiming a leg that belongs to one. Combining is a repair
    // operation; the user re-links by hand with the escape hatch. Do not
    // touch filler-point interpolation or ownDurationSec here.
    clearPlannedLegLink(first.id);
    clearPlannedLegLink(second.id);

    getDb().prepare('DELETE FROM flights WHERE id = ?').run(first.id);
    getDb().prepare('DELETE FROM flights WHERE id = ?').run(second.id);

    return newId;
  })();
}
