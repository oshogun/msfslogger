import Database from 'better-sqlite3';
import path from 'path';
import type { Flight, FlightPoint, FlightWithPoints, FlightEditPayload, Trip, TripWithFlights, TripEditPayload } from './types';
import { copyFlightPlanFile, deleteFlightPlanFile } from './flightPlans';

const DB_PATH = path.join(process.cwd(), 'flights.db');

let db: Database.Database;

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

// ── Schema ────────────────────────────────────────────────────────────────────

export function initDb(): Database.Database {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS flights (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      aircraft         TEXT,
      departure_lat    REAL,
      departure_lon    REAL,
      arrival_lat      REAL,
      arrival_lon      REAL,
      start_time       TEXT NOT NULL,
      end_time         TEXT,
      duration_sec     INTEGER,
      distance_nm      REAL,
      max_altitude_ft  REAL,
      max_airspeed_kts REAL,
      point_count      INTEGER,
      notes            TEXT,
      departure_icao   TEXT,
      departure_name   TEXT,
      arrival_icao     TEXT,
      arrival_name     TEXT
    );

    CREATE TABLE IF NOT EXISTS flight_points (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_id           INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
      ts                  TEXT NOT NULL,
      lat                 REAL NOT NULL,
      lon                 REAL NOT NULL,
      altitude_ft         REAL NOT NULL,
      airspeed_kts        REAL NOT NULL,
      ground_speed_kts    REAL NOT NULL,
      heading_deg         REAL NOT NULL,
      vertical_speed_fpm  REAL NOT NULL,
      on_ground           INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_points_flight ON flight_points(flight_id);

    CREATE TABLE IF NOT EXISTS trips (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      notes      TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Migrate existing DBs that predate the notes and trip_id columns
  const cols = (db.prepare('PRAGMA table_info(flights)').all() as { name: string }[]).map(c => c.name);
  if (!cols.includes('notes')) {
    db.exec('ALTER TABLE flights ADD COLUMN notes TEXT');
  }
  if (!cols.includes('trip_id')) {
    db.exec('ALTER TABLE flights ADD COLUMN trip_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_flights_trip ON flights(trip_id)');
  }
  if (!cols.includes('departure_icao')) {
    db.exec('ALTER TABLE flights ADD COLUMN departure_icao TEXT');
  }
  if (!cols.includes('departure_name')) {
    db.exec('ALTER TABLE flights ADD COLUMN departure_name TEXT');
  }
  if (!cols.includes('arrival_icao')) {
    db.exec('ALTER TABLE flights ADD COLUMN arrival_icao TEXT');
  }
  if (!cols.includes('arrival_name')) {
    db.exec('ALTER TABLE flights ADD COLUMN arrival_name TEXT');
  }
  if (!cols.includes('flight_plan_name')) {
    db.exec('ALTER TABLE flights ADD COLUMN flight_plan_name TEXT');
  }

  return db;
}

export function getDb(): Database.Database {
  return db;
}

// ── Flight CRUD ───────────────────────────────────────────────────────────────

export function insertFlight(aircraft: string, lat: number, lon: number, startTime: string, departureIcao: string | null = null, departureName: string | null = null): number {
  const result = db.prepare(`
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
  db.prepare(`
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

  const result = db.prepare(`UPDATE flights SET ${setClauses} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function setFlightPlanName(id: number, name: string): void {
  db.prepare('UPDATE flights SET flight_plan_name = ? WHERE id = ?').run(name, id);
}

export function clearFlightPlanName(id: number): void {
  db.prepare('UPDATE flights SET flight_plan_name = NULL WHERE id = ?').run(id);
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
  db.prepare(`
    INSERT INTO flight_points
      (flight_id, ts, lat, lon, altitude_ft, airspeed_kts, ground_speed_kts, heading_deg, vertical_speed_fpm, on_ground)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(flightId, ts, lat, lon, altitudeFt, airspeedKts, groundSpeedKts, headingDeg, verticalSpeedFpm, onGround ? 1 : 0);
}

export function getFlights(): Flight[] {
  return db.prepare('SELECT * FROM flights ORDER BY start_time DESC').all() as Flight[];
}

export function getFlightById(id: number): FlightWithPoints | null {
  const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(id) as Flight | undefined;
  if (!flight) return null;
  const points = db.prepare('SELECT * FROM flight_points WHERE flight_id = ? ORDER BY ts ASC').all(id) as FlightPoint[];
  return { ...flight, points };
}

export function getFlightPointCount(id: number): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM flight_points WHERE flight_id = ?').get(id) as { cnt: number };
  return row.cnt;
}

export function deleteFlight(id: number): boolean {
  const result = db.prepare('DELETE FROM flights WHERE id = ?').run(id);
  if (result.changes > 0) deleteFlightPlanFile(id);
  return result.changes > 0;
}

// ── Trips ─────────────────────────────────────────────────────────────────────

export function createTrip(name: string, notes: string | null): number {
  const result = db.prepare(
    'INSERT INTO trips (name, notes, created_at) VALUES (?, ?, ?)'
  ).run(name, notes, new Date().toISOString());
  return result.lastInsertRowid as number;
}

export function getTrips(): TripWithFlights[] {
  type AggRow = Trip & { flight_count: number; total_distance_nm: number | null; total_duration_sec: number | null; max_altitude_ft: number | null };
  const rows = db.prepare(`
    SELECT t.*,
      COUNT(f.id)            AS flight_count,
      SUM(f.distance_nm)     AS total_distance_nm,
      SUM(f.duration_sec)    AS total_duration_sec,
      MAX(f.max_altitude_ft) AS max_altitude_ft
    FROM trips t
    LEFT JOIN flights f ON f.trip_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).all() as AggRow[];

  const fetchFlights = db.prepare('SELECT * FROM flights WHERE trip_id = ? ORDER BY start_time ASC');
  return rows.map(row => ({
    ...row,
    flights: (fetchFlights.all(row.id) as Flight[]).map(f => ({ ...f, points: [] })),
  }));
}

export function getTripById(id: number): TripWithFlights | null {
  type AggRow = Trip & { flight_count: number; total_distance_nm: number | null; total_duration_sec: number | null; max_altitude_ft: number | null };
  const row = db.prepare(`
    SELECT t.*,
      COUNT(f.id)            AS flight_count,
      SUM(f.distance_nm)     AS total_distance_nm,
      SUM(f.duration_sec)    AS total_duration_sec,
      MAX(f.max_altitude_ft) AS max_altitude_ft
    FROM trips t
    LEFT JOIN flights f ON f.trip_id = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `).get(id) as AggRow | undefined;
  if (!row) return null;

  const flightRows = db.prepare('SELECT * FROM flights WHERE trip_id = ? ORDER BY start_time ASC').all(id) as Flight[];
  const fetchPoints = db.prepare('SELECT * FROM flight_points WHERE flight_id = ? ORDER BY ts ASC');
  const flights: FlightWithPoints[] = flightRows.map(f => ({
    ...f,
    points: fetchPoints.all(f.id) as FlightPoint[],
  }));

  return { ...row, flights };
}

export function updateTrip(id: number, payload: TripEditPayload): boolean {
  const allowed = ['name', 'notes'] as const;
  const keys = (Object.keys(payload) as (typeof allowed[number])[]).filter(k => allowed.includes(k));
  if (keys.length === 0) return false;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values: unknown[] = keys.map(k => payload[k] ?? null);
  values.push(id);
  const result = db.prepare(`UPDATE trips SET ${setClauses} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteTrip(id: number): boolean {
  const result = db.prepare('DELETE FROM trips WHERE id = ?').run(id);
  return result.changes > 0;
}

export function assignFlightToTrip(flightId: number, tripId: number): boolean {
  const result = db.prepare('UPDATE flights SET trip_id = ? WHERE id = ?').run(tripId, flightId);
  return result.changes > 0;
}

export function removeFlightFromTrip(flightId: number): boolean {
  const result = db.prepare('UPDATE flights SET trip_id = NULL WHERE id = ?').run(flightId);
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
  return db.transaction((): number | null => {
    const flightA = db.prepare('SELECT * FROM flights WHERE id = ?').get(idA) as Flight | undefined;
    const flightB = db.prepare('SELECT * FROM flights WHERE id = ?').get(idB) as Flight | undefined;
    if (!flightA || !flightB) return null;

    const [first, second] =
      new Date(flightA.start_time) <= new Date(flightB.start_time)
        ? [flightA, flightB]
        : [flightB, flightA];

    const fetchPoints = db.prepare('SELECT * FROM flight_points WHERE flight_id = ? ORDER BY ts ASC');
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

    const newId = db.prepare(`
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

    const insertPt = db.prepare(`
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

    db.prepare('DELETE FROM flights WHERE id = ?').run(first.id);
    db.prepare('DELETE FROM flights WHERE id = ?').run(second.id);

    return newId;
  })();
}
