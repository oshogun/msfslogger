export interface SimFrame {
  lat: number;
  lon: number;
  altitudeFt: number;
  airspeedKnots: number;
  groundSpeedKnots: number;
  headingDeg: number;
  verticalSpeedFpm: number;
  onGround: boolean;
  simRunning: number;
  aircraft: string;
}

export type FlightState = 'IDLE' | 'FLYING' | 'ENDED';

export interface AppState {
  flightState: FlightState;
  currentFlightId: number | null;
  connected: boolean;
  lastFrame: SimFrame | null;
  /** True while the sim is paused in any form, including Active Pause. */
  paused: boolean;
  /** Raw MSFS Pause_EX1 bitmask, so the UI can name the kind of pause. */
  pauseFlags: number;
}

export interface Flight {
  id: number;
  aircraft: string | null;
  departure_lat: number | null;
  departure_lon: number | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  max_airspeed_kts: number | null;
  point_count: number | null;
  notes: string | null;
  trip_id: number | null;
  departure_icao: string | null;
  departure_name: string | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  flight_plan_name: string | null;
}

export interface Trip {
  id: number;
  name: string;
  notes: string | null;
  created_at: string;
}

export interface TripWithFlights extends Trip {
  flights: FlightWithPoints[];
  flight_count: number;
  total_distance_nm: number | null;
  total_duration_sec: number | null;
  max_altitude_ft: number | null;
}

export interface TripEditPayload {
  name?: string;
  notes?: string | null;
}

export interface FlightEditPayload {
  aircraft?: string | null;
  notes?: string | null;
}

export interface CombinePayload {
  id1: number;
  id2: number;
}

export interface FlightPoint {
  id: number;
  flight_id: number;
  ts: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  airspeed_kts: number;
  ground_speed_kts: number;
  heading_deg: number;
  vertical_speed_fpm: number;
  on_ground: number;
}

export interface FlightWithPoints extends Flight {
  points: FlightPoint[];
}
