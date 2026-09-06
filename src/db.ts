import Database from 'better-sqlite3';
import path from 'path';
import type {
  Flight, FlightPoint, FlightWithPoints, FlightEditPayload, Trip, TripWithFlights, TripEditPayload,
  PlannedLeg, PlannedWaypoint, PlannedAlternate, PlannedLegWithChildren, PlannedLegStatus, LegMatchCandidate,
} from './types';
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

    -- Planned legs: a route imported from a Little Navmap .lnmpln file and
    -- attached to a trip, before it is flown. Must be created before the
    -- ALTER TABLE below, which adds flights.planned_leg_id REFERENCES here.
    -- design.md §2, §3.
    CREATE TABLE IF NOT EXISTS planned_legs (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id                INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      -- 1-based within a trip, dense on import, gappy after a delete. Every read
      -- orders by (seq, id) so the order stays total even if two rows shared a
      -- seq. Assigned in CHAIN order (destination ident -> next departure ident)
      -- by the import handler, not multipart upload order. design.md §9.2.
      seq                    INTEGER NOT NULL,
      -- 'linked' is deliberately absent: a leg is linked when a flight row
      -- points at it, so the two facts cannot drift apart.
      status                 TEXT    NOT NULL DEFAULT 'planned'
                               CHECK (status IN ('planned', 'flown', 'diverted', 'skipped')),

      -- First waypoint of the plan. Not necessarily an airport: Little Navmap
      -- allows plan snippets, so departure_is_airport gates any ICAO claim.
      departure_ident        TEXT    NOT NULL,
      departure_name         TEXT,
      departure_lat          REAL    NOT NULL,
      departure_lon          REAL    NOT NULL,
      departure_is_airport   INTEGER NOT NULL DEFAULT 0,
      -- <Departure> in the file: the parking spot / runway the plan starts at.
      -- More precise than departure_lat/lon but optional (commonly absent),
      -- so the matcher uses the waypoint position above and these are
      -- display-only.
      departure_start        TEXT,
      departure_start_type   TEXT,
      departure_pos_lat      REAL,
      departure_pos_lon      REAL,

      -- Last waypoint of the plan, same caveat as the departure.
      destination_ident      TEXT    NOT NULL,
      destination_name       TEXT,
      destination_lat        REAL    NOT NULL,
      destination_lon        REAL    NOT NULL,
      destination_is_airport INTEGER NOT NULL DEFAULT 0,

      is_snippet             INTEGER NOT NULL DEFAULT 0,
      -- CruisingAltF preferred over CruisingAlt; null when the file carries neither.
      cruise_alt_ft          REAL,
      flightplan_type        TEXT,
      aircraft_type          TEXT,

      -- Procedures are stored flat because the file never contains their
      -- waypoints, so there would be nothing for a procedure-leg table to
      -- hold. Eighteen columns: a real custom approach is characterised
      -- entirely by Type plus the Custom* values. design.md §2.2.1.
      --
      -- sid_runway is the ONLY place a departure runway appears: no real file
      -- has ever carried a <Departure> element. design.md §5.4b, §5.4f.
      sid_name               TEXT,
      sid_runway             TEXT,
      sid_transition         TEXT,
      -- 'CUSTOMDEPART' for the manual's custom-departure form, which the XSD
      -- does not declare. NULL for an ordinary published SID.
      sid_type               TEXT,
      sid_custom_distance_nm REAL,

      -- Three columns only: no observed file and no documentation gives a STAR
      -- a type or a custom form. An unrecognised child of <STAR> surfaces as an
      -- UNKNOWN_ELEMENT parser warning rather than vanishing. design.md §5.4e.
      star_name              TEXT,
      star_runway            TEXT,
      star_transition        TEXT,

      -- approach_name is an opaque label, never a fix reference: with
      -- Type=CUSTOM Little Navmap synthesizes it as ICAO+runway ("KLAX24R").
      -- design.md §5.4g.
      approach_name          TEXT,
      approach_runway        TEXT,
      approach_transition    TEXT,
      approach_type          TEXT,     -- e.g. 'CUSTOM'; says whether the name means anything
      approach_arinc         TEXT,
      approach_suffix        TEXT,
      approach_transition_type TEXT,
      -- The three Custom* values. CustomOffsetAngle is written by real Little
      -- Navmap and appears NOWHERE in the official XSD. design.md §5.4e.
      approach_custom_distance_nm REAL,
      approach_custom_altitude_ft REAL,
      approach_custom_offset_deg  REAL,

      waypoint_count         INTEGER NOT NULL DEFAULT 0,
      alternate_count        INTEGER NOT NULL DEFAULT 0,
      -- Great-circle sum over the en-route waypoint chain only. Named "approx"
      -- because SID/STAR/approach legs are absent from the file, so this is
      -- always short of the real routing — never render without an "approx."
      -- qualifier. design.md §6.
      approx_distance_nm     REAL    NOT NULL DEFAULT 0,
      -- Written at landing on both the 'flown' and the 'diverted' path.
      arrival_deviation_nm   REAL,

      remarks                TEXT,
      -- CreationDate normalised to a full ISO instant (the file writes a
      -- two-digit UTC offset, e.g. +02, which Date parses inconsistently).
      plan_created_at        TEXT,

      -- Provenance. The uploaded bytes are not kept; these three columns plus
      -- the import log are what makes a mis-parse reproducible from the
      -- user's own file.
      source_filename        TEXT    NOT NULL,
      source_sha256          TEXT    NOT NULL,
      source_program         TEXT,
      imported_at            TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS planned_waypoints (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      planned_leg_id    INTEGER NOT NULL REFERENCES planned_legs(id) ON DELETE CASCADE,
      -- 1-based document order across every <Waypoints> block in the file
      seq               INTEGER NOT NULL,
      ident             TEXT    NOT NULL,
      name              TEXT,
      region            TEXT,
      airway            TEXT,
      track             TEXT,
      -- AIRPORT | UNKNOWN | WAYPOINT | VOR | NDB | USER, or an unrecognised
      -- value passed through verbatim. Only AIRPORT is behaviourally significant.
      type              TEXT    NOT NULL,
      comment           TEXT,
      lat               REAL    NOT NULL,
      lon               REAL    NOT NULL,
      -- Pos/@Alt is optional in the format, and where present it is Little
      -- Navmap's COMPUTED profile altitude, not a planned constraint. Store
      -- it, never present it as planned. design.md §6.1.
      alt_ft            REAL
    );

    CREATE TABLE IF NOT EXISTS planned_alternates (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      planned_leg_id    INTEGER NOT NULL REFERENCES planned_legs(id) ON DELETE CASCADE,
      seq               INTEGER NOT NULL,
      ident             TEXT    NOT NULL,
      name              TEXT,
      type              TEXT,
      -- Nullable, unlike planned_waypoints: <Alternate><Pos> is optional in the XSD
      lat               REAL,
      lon               REAL,
      alt_ft            REAL
    );

    CREATE INDEX IF NOT EXISTS idx_planned_legs_trip       ON planned_legs(trip_id, seq);
    CREATE INDEX IF NOT EXISTS idx_planned_legs_source     ON planned_legs(trip_id, source_sha256);
    CREATE INDEX IF NOT EXISTS idx_planned_waypoints_leg   ON planned_waypoints(planned_leg_id, seq);
    CREATE INDEX IF NOT EXISTS idx_planned_alternates_leg  ON planned_alternates(planned_leg_id, seq);
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

  // Planned-leg link columns on flights. ADD COLUMN ... REFERENCES requires a
  // NULL default, which is why planned_leg_id has none — design.md §3.
  if (!cols.includes('planned_leg_id')) {
    db.exec('ALTER TABLE flights ADD COLUMN planned_leg_id INTEGER REFERENCES planned_legs(id) ON DELETE SET NULL');
  }
  if (!cols.includes('planned_leg_link_source')) {
    db.exec("ALTER TABLE flights ADD COLUMN planned_leg_link_source TEXT"); // 'auto' | 'manual' | NULL
  }
  if (!cols.includes('planned_leg_prev_trip_id')) {
    db.exec('ALTER TABLE flights ADD COLUMN planned_leg_prev_trip_id INTEGER'); // trip_id held immediately before the link
  }

  const tripCols = (db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]).map(c => c.name);
  if (!tripCols.includes('is_active')) {
    db.exec('ALTER TABLE trips ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
  }

  // Unconditional and idempotent: an index can be missing even when its column
  // exists. Both are partial UNIQUE indexes and are load-bearing — they turn a
  // convention into a database guarantee. A SQLITE_CONSTRAINT from either means
  // the caller's statement order is wrong; fix the order, never the index.
  // design.md §2.5, §3, §20.7.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_flights_planned_leg ON flights(planned_leg_id) WHERE planned_leg_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_active        ON trips(is_active)        WHERE is_active = 1;
  `);

  return db;
}

/**
 * Closes the database, checkpointing the WAL back into flights.db.
 *
 * Without this, killing the process can leave recently committed data only in
 * flights.db-wal, where a naive file copy of flights.db would miss it.
 */
export function closeDb(): void {
  if (!db || !db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Checkpoint is best-effort; closing still flushes.
  }
  db.close();
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
  // The FK is on flights.planned_leg_id, so deleting the row would drop the
  // link but leave the leg permanently 'flown'/'diverted' by a flight that no
  // longer exists. Same idiom as deleteFlightPlanFile() below. design.md §16.
  clearPlannedLegLink(id);
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
  type AggRow = Trip & { flight_count: number; total_distance_nm: number | null; total_duration_sec: number | null; max_altitude_ft: number | null; planned_leg_count: number };
  const rows = db.prepare(`
    SELECT t.*,
      COUNT(f.id)            AS flight_count,
      SUM(f.distance_nm)     AS total_distance_nm,
      SUM(f.duration_sec)    AS total_duration_sec,
      MAX(f.max_altitude_ft) AS max_altitude_ft,
      (SELECT COUNT(*) FROM planned_legs pl WHERE pl.trip_id = t.id) AS planned_leg_count
    FROM trips t
    LEFT JOIN flights f ON f.trip_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).all() as AggRow[];

  // planned_legs stays [] here, mirroring the existing flights[].points = []:
  // this endpoint is deliberately light. GET /api/trips/:id populates it fully.
  const fetchFlights = db.prepare('SELECT * FROM flights WHERE trip_id = ? ORDER BY start_time ASC');
  return rows.map(row => ({
    ...row,
    flights: (fetchFlights.all(row.id) as Flight[]).map(f => ({ ...f, points: [] })),
    planned_legs: [],
  }));
}

export function getTripById(id: number): TripWithFlights | null {
  type AggRow = Trip & { flight_count: number; total_distance_nm: number | null; total_duration_sec: number | null; max_altitude_ft: number | null; planned_leg_count: number };
  const row = db.prepare(`
    SELECT t.*,
      COUNT(f.id)            AS flight_count,
      SUM(f.distance_nm)     AS total_distance_nm,
      SUM(f.duration_sec)    AS total_duration_sec,
      MAX(f.max_altitude_ft) AS max_altitude_ft,
      (SELECT COUNT(*) FROM planned_legs pl WHERE pl.trip_id = t.id) AS planned_leg_count
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

  // Fully populated, unlike getTrips(): the trip page and the trip map both
  // need the whole chain on first paint, and embedding avoids a race with
  // MapReadySignal on the print path. design.md §8.
  const plannedLegs = getPlannedLegsForTrip(id);

  return { ...row, flights, planned_legs: plannedLegs };
}

/**
 * A trip's name alone, for FlightManager's planned-leg live-status cache
 * (design.md §19) — that cache is built once at link time and must not pull
 * in a trip's whole flight/point history just to label it.
 */
export function getTripName(tripId: number): string | null {
  const row = db.prepare('SELECT name FROM trips WHERE id = ?').get(tripId) as { name: string } | undefined;
  return row?.name ?? null;
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

/**
 * Flights the user put in this trip directly (assignFlightToTrip, or never
 * touched by a link) are NOT restored here — they keep their dangling
 * trip_id after the trip is gone, exactly as before this feature; that part
 * of §16 is unchanged and stays unchanged. But a flight a LINK moved into
 * this trip is different in kind: the link promised that unlinking restores
 * planned_leg_prev_trip_id, and letting the ON DELETE CASCADE / SET NULL
 * combination run unattended would break that promise silently — it clears
 * planned_leg_id but leaves trip_id dangling at the now-deleted trip and
 * discards planned_leg_prev_trip_id unread. So those flights are read and
 * restored to their prior trip_id here, in the same transaction as the
 * delete and BEFORE it runs: once the trip row is gone, the cascade has
 * already removed the planned_legs rows that make "linked into this trip"
 * findable at all. design.md §16 (amended).
 */
export function deleteTrip(id: number): boolean {
  return db.transaction((): boolean => {
    const linkedFlights = db.prepare(`
      SELECT f.id, f.planned_leg_prev_trip_id
        FROM flights f
        JOIN planned_legs l ON l.id = f.planned_leg_id
       WHERE l.trip_id = ?
    `).all(id) as { id: number; planned_leg_prev_trip_id: number | null }[];

    const restore = db.prepare(`
      UPDATE flights
         SET trip_id                  = ?,
             planned_leg_id           = NULL,
             planned_leg_link_source  = NULL,
             planned_leg_prev_trip_id = NULL
       WHERE id = ?
    `);
    for (const flight of linkedFlights) {
      restore.run(flight.planned_leg_prev_trip_id, flight.id);
    }

    const result = db.prepare('DELETE FROM trips WHERE id = ?').run(id);
    return result.changes > 0;
  })();
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

    // Unlike the PDF attachment above, a planned-leg link is deliberately NOT
    // carried to the combined flight: this INSERT does not carry trip_id
    // either, so a carried-over link would put the new flight in no trip
    // while claiming a leg that belongs to one. Combining is a repair
    // operation; the user re-links by hand with the escape hatch.
    // design.md §16, §20 item 12 (do not touch filler-point interpolation or
    // ownDurationSec here).
    clearPlannedLegLink(first.id);
    clearPlannedLegLink(second.id);

    db.prepare('DELETE FROM flights WHERE id = ?').run(first.id);
    db.prepare('DELETE FROM flights WHERE id = ?').run(second.id);

    return newId;
  })();
}

// ── Planned legs ──────────────────────────────────────────────────────────────
//
// CRUD for the planned-leg feature (design.md). Deliberately does not import
// anything from src/lnmpln.ts — the parser's ParsedFlightPlan shape lives
// there and is turned into CreatePlannedLegInput by src/server.ts, the only
// module that sees both (design.md §4). The shapes below are structurally
// compatible with ParsedFlightPlan so no conversion boilerplate is needed at
// the call site, but db.ts never imports the parser's types.
//
// Functions here never read or write flights.flight_plan_name or the
// flight_plans/ directory — that is the unrelated PDF attachment feature.

interface CreatePlannedLegEndpoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  isAirport: boolean;
}

interface CreatePlannedLegDepartureStart {
  pos: { lat: number; lon: number } | null;
  start: string | null;
  startType: string | null;
}

interface CreatePlannedLegProcedures {
  sidName: string | null;
  sidRunway: string | null;
  sidTransition: string | null;
  sidType: string | null;
  sidCustomDistanceNm: number | null;
  starName: string | null;
  starRunway: string | null;
  starTransition: string | null;
  approachName: string | null;
  approachRunway: string | null;
  approachTransition: string | null;
  approachType: string | null;
  approachArinc: string | null;
  approachSuffix: string | null;
  approachTransitionType: string | null;
  approachCustomDistanceNm: number | null;
  approachCustomAltitudeFt: number | null;
  approachCustomOffsetDeg: number | null;
}

interface CreatePlannedLegWaypoint {
  seq: number;
  ident: string;
  name: string | null;
  region: string | null;
  airway: string | null;
  track: string | null;
  type: string;
  comment: string | null;
  lat: number;
  lon: number;
  altFt: number | null;
}

interface CreatePlannedLegAlternate {
  seq: number;
  ident: string;
  name: string | null;
  type: string | null;
  lat: number | null;
  lon: number | null;
  altFt: number | null;
}

/** Structurally compatible with ParsedFlightPlan (src/lnmpln.ts), not imported. */
export interface CreatePlannedLegPlan {
  departure: CreatePlannedLegEndpoint;
  destination: CreatePlannedLegEndpoint;
  isSnippet: boolean;
  cruiseAltFt: number | null;
  flightplanType: string | null;
  aircraftType: string | null;
  remarks: string | null;
  createdAt: string | null;
  sourceProgram: string | null;
  departureStart: CreatePlannedLegDepartureStart;
  procedures: CreatePlannedLegProcedures;
  waypoints: CreatePlannedLegWaypoint[];
  alternates: CreatePlannedLegAlternate[];
  /** Great-circle sum over the waypoint chain, computed by the parser. Stored as-is. */
  approxDistanceNm: number;
}

/** Everything needed to insert one leg with its children, in one transaction. */
export interface CreatePlannedLegInput {
  tripId: number;
  plan: CreatePlannedLegPlan;
  sourceFilename: string;
  sourceSha256: string;
}

function attachPlannedLegChildren(row: PlannedLeg & { linked_flight_id: number | null }): PlannedLegWithChildren {
  const waypoints = db.prepare(
    'SELECT * FROM planned_waypoints WHERE planned_leg_id = ? ORDER BY seq ASC'
  ).all(row.id) as PlannedWaypoint[];
  const alternates = db.prepare(
    'SELECT * FROM planned_alternates WHERE planned_leg_id = ? ORDER BY seq ASC'
  ).all(row.id) as PlannedAlternate[];
  return { ...row, waypoints, alternates };
}

/**
 * Inserts leg + waypoints + alternates atomically: a failure partway (e.g. a
 * NOT NULL violation on a waypoint) rolls back the whole leg, so no orphan
 * planned_waypoints/planned_alternates rows survive. seq = MAX(seq)+1 for the
 * trip, computed inside the transaction, so the caller controls route order
 * purely by the order it calls this (chainOrderForBatch's order, not upload
 * order). design.md §9.2, §9.2.3.
 */
export function createPlannedLeg(input: CreatePlannedLegInput): number {
  return db.transaction((): number => {
    const { tripId, plan, sourceFilename, sourceSha256 } = input;

    const { next_seq: seq } = db.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM planned_legs WHERE trip_id = ?'
    ).get(tripId) as { next_seq: number };

    const legId = db.prepare(`
      INSERT INTO planned_legs (
        trip_id, seq, status,
        departure_ident, departure_name, departure_lat, departure_lon, departure_is_airport,
        departure_start, departure_start_type, departure_pos_lat, departure_pos_lon,
        destination_ident, destination_name, destination_lat, destination_lon, destination_is_airport,
        is_snippet, cruise_alt_ft, flightplan_type, aircraft_type,
        sid_name, sid_runway, sid_transition, sid_type, sid_custom_distance_nm,
        star_name, star_runway, star_transition,
        approach_name, approach_runway, approach_transition, approach_type, approach_arinc, approach_suffix,
        approach_transition_type, approach_custom_distance_nm, approach_custom_altitude_ft, approach_custom_offset_deg,
        waypoint_count, alternate_count, approx_distance_nm,
        remarks, plan_created_at,
        source_filename, source_sha256, source_program, imported_at
      ) VALUES (
        ?, ?, 'planned',
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      tripId, seq,
      plan.departure.ident, plan.departure.name, plan.departure.lat, plan.departure.lon, plan.departure.isAirport ? 1 : 0,
      plan.departureStart.start, plan.departureStart.startType,
      plan.departureStart.pos?.lat ?? null, plan.departureStart.pos?.lon ?? null,
      plan.destination.ident, plan.destination.name, plan.destination.lat, plan.destination.lon, plan.destination.isAirport ? 1 : 0,
      plan.isSnippet ? 1 : 0, plan.cruiseAltFt, plan.flightplanType, plan.aircraftType,
      plan.procedures.sidName, plan.procedures.sidRunway, plan.procedures.sidTransition,
      plan.procedures.sidType, plan.procedures.sidCustomDistanceNm,
      plan.procedures.starName, plan.procedures.starRunway, plan.procedures.starTransition,
      plan.procedures.approachName, plan.procedures.approachRunway, plan.procedures.approachTransition,
      plan.procedures.approachType, plan.procedures.approachArinc, plan.procedures.approachSuffix,
      plan.procedures.approachTransitionType, plan.procedures.approachCustomDistanceNm,
      plan.procedures.approachCustomAltitudeFt, plan.procedures.approachCustomOffsetDeg,
      plan.waypoints.length, plan.alternates.length, plan.approxDistanceNm,
      plan.remarks, plan.createdAt,
      sourceFilename, sourceSha256, plan.sourceProgram, new Date().toISOString()
    ).lastInsertRowid as number;

    const insertWaypoint = db.prepare(`
      INSERT INTO planned_waypoints (planned_leg_id, seq, ident, name, region, airway, track, type, comment, lat, lon, alt_ft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const wp of plan.waypoints) {
      insertWaypoint.run(legId, wp.seq, wp.ident, wp.name, wp.region, wp.airway, wp.track, wp.type, wp.comment, wp.lat, wp.lon, wp.altFt);
    }

    const insertAlternate = db.prepare(`
      INSERT INTO planned_alternates (planned_leg_id, seq, ident, name, type, lat, lon, alt_ft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const alt of plan.alternates) {
      insertAlternate.run(legId, alt.seq, alt.ident, alt.name, alt.type, alt.lat, alt.lon, alt.altFt);
    }

    return legId;
  })();
}

/** Legs of a trip, ORDER BY seq ASC, id ASC, children attached. */
export function getPlannedLegsForTrip(tripId: number): PlannedLegWithChildren[] {
  const rows = db.prepare(`
    SELECT l.*,
           (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
      FROM planned_legs l
     WHERE l.trip_id = ?
     ORDER BY l.seq ASC, l.id ASC
  `).all(tripId) as (PlannedLeg & { linked_flight_id: number | null })[];
  return rows.map(attachPlannedLegChildren);
}

export function getPlannedLegById(legId: number): PlannedLegWithChildren | null {
  const row = db.prepare(`
    SELECT l.*,
           (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
      FROM planned_legs l
     WHERE l.id = ?
  `).get(legId) as (PlannedLeg & { linked_flight_id: number | null }) | undefined;
  if (!row) return null;
  return attachPlannedLegChildren(row);
}

/** Returns the existing leg when this trip already holds a leg with these bytes. */
export function findPlannedLegBySource(tripId: number, sha256: string): PlannedLeg | null {
  const row = db.prepare(
    'SELECT * FROM planned_legs WHERE trip_id = ? AND source_sha256 = ? LIMIT 1'
  ).get(tripId, sha256) as PlannedLeg | undefined;
  return row ?? null;
}

/**
 * Deletes a leg. Children go by ON DELETE CASCADE and any linked flight is
 * unlinked by ON DELETE SET NULL on flights.planned_leg_id — but that FK
 * action does not know about the other two bookkeeping columns, so they are
 * cleared and the flight's trip_id is restored from
 * planned_leg_prev_trip_id in the same transaction. Deleting a leg must never
 * leave a flight stranded in a trip it was moved into by a link that no
 * longer exists. design.md §16.
 */
export function deletePlannedLeg(legId: number): boolean {
  return db.transaction((): boolean => {
    const linkedFlight = db.prepare(
      'SELECT id, planned_leg_prev_trip_id FROM flights WHERE planned_leg_id = ?'
    ).get(legId) as { id: number; planned_leg_prev_trip_id: number | null } | undefined;

    const result = db.prepare('DELETE FROM planned_legs WHERE id = ?').run(legId);
    if (result.changes === 0) return false;

    if (linkedFlight) {
      db.prepare(`
        UPDATE flights
           SET trip_id = ?,
               planned_leg_link_source = NULL,
               planned_leg_prev_trip_id = NULL
         WHERE id = ?
      `).run(linkedFlight.planned_leg_prev_trip_id, linkedFlight.id);
    }

    return true;
  })();
}

/**
 * Full permutation, renumbered 1..N in one transaction. Caller has already
 * checked legIds is exactly this trip's set of leg ids (design.md §7.2).
 */
export function reorderPlannedLegs(tripId: number, legIds: number[]): boolean {
  return db.transaction((): boolean => {
    const update = db.prepare('UPDATE planned_legs SET seq = ? WHERE id = ? AND trip_id = ?');
    legIds.forEach((legId, index) => {
      update.run(index + 1, legId, tripId);
    });
    return true;
  })();
}

/**
 * Thrown by setPlannedLegStatus() when asked to change the status of a leg
 * that a flight is still linked to (design.md §12.3, §15). A linked leg's
 * status is not the caller's to set at all — 'flown' and 'diverted' are
 * written by endFlight(), and the only way to reopen such a leg is to
 * unlink it, which is the transition §15 actually defines. The 409-vs-404
 * decision belongs to the endpoint (T-012); this class exists so the
 * endpoint can tell that refusal apart from "leg not found" (which is a
 * plain boolean `false`) and name the flight in its own error message.
 */
export class PlannedLegHasLinkedFlightError extends Error {
  constructor(readonly legId: number, readonly flightId: number) {
    super(`Planned leg ${legId} cannot have its status changed: linked to flight ${flightId}`);
    this.name = 'PlannedLegHasLinkedFlightError';
  }
}

/**
 * Thrown by linkFlightToPlannedLeg() when the target leg already belongs to a
 * different flight. idx_flights_planned_leg would catch this too, but that
 * constraint error can't name the offending flight — this check runs first so
 * the thrown error can, which is what lets T-012 turn it into a 409 that says
 * which flight.
 */
export class PlannedLegAlreadyLinkedError extends Error {
  constructor(readonly legId: number, readonly flightId: number) {
    super(`Planned leg ${legId} is already linked to flight ${flightId}`);
    this.name = 'PlannedLegAlreadyLinkedError';
  }
}

// ── Active trip ───────────────────────────────────────────────────────────────

/**
 * Clear first, then set — never the reverse. With idx_trips_active in place,
 * clearing after setting would raise SQLITE_CONSTRAINT_UNIQUE the moment
 * another trip is already active; clearing first makes "at most one active
 * trip" hold at every intermediate point in the transaction, not just at
 * commit. design.md §11.2.
 *
 * Setting a trip that does not exist changes nothing (§11.2) — the existence
 * check has to run BEFORE the clearing UPDATE, inside the same transaction,
 * because the clear-then-set order above means there is no later point to
 * discover the target is missing and undo it. The HTTP endpoint already
 * pre-checks existence and 404s, but this function must honour its own
 * contract for a caller that reaches it directly (T-016).
 */
export function setActiveTrip(tripId: number | null): void {
  db.transaction(() => {
    if (tripId !== null) {
      const exists = db.prepare('SELECT 1 FROM trips WHERE id = ?').get(tripId);
      if (!exists) return;
    }
    db.prepare('UPDATE trips SET is_active = 0 WHERE is_active = 1').run();
    if (tripId !== null) {
      db.prepare('UPDATE trips SET is_active = 1 WHERE id = ?').run(tripId);
    }
  })();
}

export function getActiveTripId(): number | null {
  const row = db.prepare('SELECT id FROM trips WHERE is_active = 1').get() as { id: number } | undefined;
  return row ? row.id : null;
}

// ── Planned-leg status ────────────────────────────────────────────────────────

/**
 * 'planned' | 'skipped' only; 'flown' and 'diverted' are system-set and this
 * function has no runtime path that accepts them (the parameter type already
 * forbids it at compile time). Refuses — by throwing
 * PlannedLegHasLinkedFlightError — whenever the leg still has a linked
 * flight, regardless of which of the two statuses was requested (design.md
 * §12.3, §15). This is not just the skip guard widened: a still-linked leg
 * is either 'planned' (being flown right now) or 'flown'/'diverted' (just
 * landed) per §15, and in every one of those cases the status and the link
 * are the system's to manage, not a PATCH's — resetting a flown/diverted
 * leg to 'planned' while the link stays would destroy
 * arrival_deviation_nm and produce a state §15's transition table does not
 * define (a "landed" leg rendering as "being flown"). §15 lists exactly one
 * way back from flown/diverted to planned: unlink, which clears the
 * deviation because the link is going away too. A skip that quietly failed
 * would likewise leave the caller believing the leg was skipped when it was
 * not.
 *
 * Always clears arrival_deviation_nm alongside status, in the same statement
 * as the update, for the unlinked legs that do reach here: a leg PATCHed
 * back to 'planned' from 'flown'/'diverted' after its flight was deleted or
 * combined must not keep reading "planned, 47 nm from plan" (design.md
 * §15) — the same clearing already done by unlinkFlightFromPlannedLeg() and
 * clearPlannedLegLink(), applied uniformly on this path too.
 */
export function setPlannedLegStatus(legId: number, status: 'planned' | 'skipped'): boolean {
  return db.transaction((): boolean => {
    const row = db.prepare(`
      SELECT l.id, (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linked_flight_id
        FROM planned_legs l
       WHERE l.id = ?
    `).get(legId) as { id: number; linked_flight_id: number | null } | undefined;
    if (!row) return false;

    if (row.linked_flight_id != null) {
      throw new PlannedLegHasLinkedFlightError(legId, row.linked_flight_id);
    }

    const result = db.prepare(
      'UPDATE planned_legs SET status = ?, arrival_deviation_nm = NULL WHERE id = ?'
    ).run(status, legId);
    return result.changes > 0;
  })();
}

// ── Auto-match candidates ─────────────────────────────────────────────────────

/**
 * Candidates for the auto-matcher: EVERY leg of the active trip, with no
 * status filtering at all — 'flown', 'diverted', 'skipped' and already-linked
 * legs are all included. Eligibility is entirely step 5's job (design.md
 * §13.2): the matcher is what turns a 'flown' candidate into the
 * LEG_ALREADY_FLOWN reason code, a 'skipped' one into LEG_SKIPPED, and so on.
 * Filtering any status out here would make that reason code unreachable in
 * production and surface a misleading NO_LEG_IN_RADIUS instead (reviewed in
 * phase3.md, adjudication A). This query stays one indexed read with no
 * per-row business logic. ORDER BY seq ASC, id ASC because determinism of the
 * matcher's AMBIGUOUS/nearbyLegIds output depends on candidates arriving in a
 * defined order (§13.2). Returns [] when no trip is active — the JOIN on
 * is_active = 1 simply matches nothing.
 */
export function getPlannedLegCandidatesForActiveTrip(): LegMatchCandidate[] {
  type Row = {
    plannedLegId: number;
    tripId: number;
    seq: number;
    departureIdent: string;
    departureIsAirport: number;
    departureLat: number;
    departureLon: number;
    status: PlannedLegStatus;
    linkedFlightId: number | null;
    aircraftType: string | null;
  };
  const rows = db.prepare(`
    SELECT
      l.id                    AS plannedLegId,
      l.trip_id               AS tripId,
      l.seq                   AS seq,
      l.departure_ident       AS departureIdent,
      l.departure_is_airport  AS departureIsAirport,
      l.departure_lat         AS departureLat,
      l.departure_lon         AS departureLon,
      l.status                AS status,
      (SELECT f.id FROM flights f WHERE f.planned_leg_id = l.id) AS linkedFlightId,
      l.aircraft_type         AS aircraftType
    FROM planned_legs l
    JOIN trips t ON t.id = l.trip_id AND t.is_active = 1
    ORDER BY l.seq ASC, l.id ASC
  `).all() as Row[];

  return rows.map(row => ({
    ...row,
    departureIdent: row.departureIsAirport ? row.departureIdent : null,
    departureIsAirport: !!row.departureIsAirport,
  }));
}

// ── Flight <-> planned-leg link ───────────────────────────────────────────────

/**
 * The flight's link, and nothing else. getFlightById() would answer this too,
 * but it returns FlightWithPoints and so loads every flight_points row to
 * read one integer — thousands of them on a long haul at a 5 s recording
 * interval. endFlight() (T-016) asks this question on its way out, including
 * from onCrash() and onSimDisconnect(), which is the worst moment to allocate
 * a track nobody reads.
 *
 * NULL means "no link", and it also means "no such flight": the one caller
 * does the same thing either way — nothing — so collapsing the two is honest
 * rather than lossy.
 */
export function getFlightPlannedLegId(flightId: number): number | null {
  const row = db.prepare(
    'SELECT planned_leg_id FROM flights WHERE id = ?'
  ).get(flightId) as { planned_leg_id: number | null } | undefined;
  return row?.planned_leg_id ?? null;
}

/**
 * Captures the flight's current trip_id (whatever it is, including NULL) into
 * planned_leg_prev_trip_id BEFORE moving the flight into the leg's trip, so
 * unlink can restore it. If the flight is already linked to a different leg,
 * re-targeting is a full unlink of the old link followed by a full link to
 * the new one, in this same transaction — so planned_leg_prev_trip_id ends up
 * holding the flight's ORIGINAL trip, never a trip the old link itself
 * assigned. Throws PlannedLegAlreadyLinkedError if the target leg already
 * belongs to a different flight. design.md §12.2.
 *
 * Linking a flight to the leg it ALREADY holds is a no-op, not a
 * re-target: §12.2 defines re-targeting as putting a DIFFERENT leg onto an
 * already-linked flight, and running the unlink-then-link dance anyway would
 * silently reset a 'flown'/'diverted' leg back to 'planned' and discard its
 * recorded arrival_deviation_nm for a request that asked for no change. This
 * guard has to live here rather than in the endpoint: T-016 calls this
 * function directly with source: 'auto', bypassing any endpoint-level check
 * entirely (phase3.md, adjudication B).
 *
 * `source` is NOT applied on that no-op path either, which the signature
 * invites you to expect. It records how the link came about, and a same-leg
 * re-link did not change that. Writing it would also make this a guard that
 * returns early except when it performs an UPDATE — a narrower version of the
 * bug it closes.
 */
export function linkFlightToPlannedLeg(flightId: number, legId: number, source: 'auto' | 'manual'): void {
  db.transaction(() => {
    const current = db.prepare(
      'SELECT planned_leg_id FROM flights WHERE id = ?'
    ).get(flightId) as { planned_leg_id: number | null } | undefined;
    if (!current) {
      throw new Error(`Flight ${flightId} not found`);
    }
    if (current.planned_leg_id === legId) {
      return;
    }
    if (current.planned_leg_id != null) {
      unlinkFlightFromPlannedLeg(flightId);
    }

    // idx_flights_planned_leg enforces this too, but checking explicitly is
    // what lets the thrown error name the flight already holding the leg.
    const holder = db.prepare(
      'SELECT id FROM flights WHERE planned_leg_id = ?'
    ).get(legId) as { id: number } | undefined;
    if (holder) {
      throw new PlannedLegAlreadyLinkedError(legId, holder.id);
    }

    const leg = db.prepare('SELECT trip_id FROM planned_legs WHERE id = ?').get(legId) as { trip_id: number } | undefined;
    if (!leg) {
      throw new Error(`Planned leg ${legId} not found`);
    }

    // Read again: if we just unlinked this same flight above, its trip_id is
    // now the restored ORIGINAL trip (or NULL) — exactly what must be
    // captured as the new planned_leg_prev_trip_id.
    const flight = db.prepare('SELECT trip_id FROM flights WHERE id = ?').get(flightId) as { trip_id: number | null };

    db.prepare(`
      UPDATE flights
         SET planned_leg_prev_trip_id = ?,
             trip_id                  = ?,
             planned_leg_id           = ?,
             planned_leg_link_source  = ?
       WHERE id = ?
    `).run(flight.trip_id, leg.trip_id, legId, source, flightId);
  })();
}

/**
 * Restores trip_id from planned_leg_prev_trip_id, then NULLs all three
 * planned_leg_* columns, and resets the leg to 'planned' with
 * arrival_deviation_nm cleared — this is how the user reopens a
 * 'flown'/'diverted' leg (design.md §15). Returns false when the flight has
 * no link.
 */
export function unlinkFlightFromPlannedLeg(flightId: number): boolean {
  return db.transaction((): boolean => {
    const flight = db.prepare(
      'SELECT planned_leg_id, planned_leg_prev_trip_id FROM flights WHERE id = ?'
    ).get(flightId) as { planned_leg_id: number | null; planned_leg_prev_trip_id: number | null } | undefined;
    if (!flight || flight.planned_leg_id == null) return false;

    db.prepare(
      "UPDATE planned_legs SET status = 'planned', arrival_deviation_nm = NULL WHERE id = ?"
    ).run(flight.planned_leg_id);

    db.prepare(`
      UPDATE flights
         SET trip_id                  = ?,
             planned_leg_id           = NULL,
             planned_leg_link_source  = NULL,
             planned_leg_prev_trip_id = NULL
       WHERE id = ?
    `).run(flight.planned_leg_prev_trip_id, flightId);

    return true;
  })();
}

/**
 * Same as unlinkFlightFromPlannedLeg() EXCEPT trip_id is deliberately NOT
 * restored: the flight row is about to be destroyed by the caller
 * (deleteFlight(), or combineFlights() for both source flights), so there is
 * no row left for a restored trip_id to mean anything on. design.md §16.
 */
export function clearPlannedLegLink(flightId: number): void {
  db.transaction(() => {
    const flight = db.prepare(
      'SELECT planned_leg_id FROM flights WHERE id = ?'
    ).get(flightId) as { planned_leg_id: number | null } | undefined;
    if (!flight || flight.planned_leg_id == null) return;

    db.prepare(
      "UPDATE planned_legs SET status = 'planned', arrival_deviation_nm = NULL WHERE id = ?"
    ).run(flight.planned_leg_id);

    db.prepare(`
      UPDATE flights
         SET planned_leg_id           = NULL,
             planned_leg_link_source  = NULL,
             planned_leg_prev_trip_id = NULL
       WHERE id = ?
    `).run(flightId);
  })();
}

/**
 * Called by endFlight() (T-016) for a linked flight, after closeFlight().
 * arrival_deviation_nm is written on both the 'flown' and 'diverted' path —
 * the link is kept either way; a diversion never auto-unlinks. design.md §14.
 */
export function recordPlannedLegArrival(legId: number, status: 'flown' | 'diverted', deviationNm: number): void {
  db.prepare(
    'UPDATE planned_legs SET status = ?, arrival_deviation_nm = ? WHERE id = ?'
  ).run(status, deviationNm, legId);
}
