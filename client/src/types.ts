export interface FlightPoint {
  lat: number;
  lon: number;
  altitude_ft: number;
  timestamp: string;
}

export interface Flight {
  id: number;
  aircraft: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_sec: number | null;
  distance_nm: number | null;
  max_altitude_ft: number | null;
  max_airspeed_kts: number | null;
  point_count: number | null;
  points?: FlightPoint[];
  departure_lat: number | null;
  departure_lon: number | null;
  departure_icao: string | null;
  departure_name: string | null;
  arrival_lat: number | null;
  arrival_lon: number | null;
  arrival_icao: string | null;
  arrival_name: string | null;
  notes: string | null;
  trip_id: number | null;
  flight_plan_name: string | null;
}

export interface Trip {
  id: number;
  name: string;
  notes: string | null;
  flight_count: number;
  total_duration_sec: number | null;
  total_distance_nm: number | null;
  max_altitude_ft: number | null;
  flights: Flight[];
}

export interface StatusFrame {
  lat: number;
  lon: number;
  altitudeFt: number;
  airspeedKnots: number;
  groundSpeedKnots: number;
  headingDeg: number;
  verticalSpeedFpm: number;
  onGround: boolean;
}

export interface Status {
  connected: boolean;
  flightState: string;
  currentFlightId: number | null;
  aircraft: string | null;
  frame: StatusFrame | null;
  /** True for any sim pause, including MSFS Active Pause. Flight time is not counted while true. */
  paused: boolean;
  /** Raw MSFS Pause_EX1 bitmask: 1 full, 2 with-sound, 4 active, 8 sim. */
  pauseFlags: number;
}
