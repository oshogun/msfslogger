import type { FlightPoint } from '../types';
import { AIRPORTS, bearingDeg, haversineNm, interpolate } from './airports';

export interface TrackSpec {
  flightId: number;
  dep: string;
  arr: string;
  startIso: string;
  durationSec: number;
  /** Number of points to emit. */
  points: number;
  /** Fraction of the route flown so far; 1 for a finished flight. */
  progress: number;
}

/** Cruise altitude scaled to the sector so short hops do not climb to FL370. */
export function cruiseAltFor(distNm: number): number {
  return Math.round(Math.min(37000, 8000 + distNm * 60) / 1000) * 1000;
}

/** A believable climb / cruise / descent track along the great circle dep -> arr. */
export function buildTrack(spec: TrackSpec): FlightPoint[] {
  const a = AIRPORTS[spec.dep];
  const b = AIRPORTS[spec.arr];
  const dist = haversineNm(a.lat, a.lon, b.lat, b.lon);
  const cruise = cruiseAltFor(dist);
  const t0 = Date.parse(spec.startIso);
  const n = spec.points;
  const out: FlightPoint[] = [];
  const alt = (f: number): number => {
    if (f < 0.02) return a.elevationFt;
    if (f > 0.98) return b.elevationFt;
    if (f < 0.25) return a.elevationFt + ((f - 0.02) / 0.23) * (cruise - a.elevationFt);
    if (f > 0.75) return b.elevationFt + ((0.98 - f) / 0.23) * (cruise - b.elevationFt);
    return cruise;
  };
  for (let i = 0; i < n; i++) {
    const f = (n === 1 ? 0 : i / (n - 1)) * spec.progress;
    const [lat, lon] = interpolate(a.lat, a.lon, b.lat, b.lon, f);
    const [nLat, nLon] = interpolate(a.lat, a.lon, b.lat, b.lon, Math.min(1, f + 0.01));
    const altitude = alt(f);
    const gs = f < 0.02 || f > 0.98 ? 12 : Math.round(150 + Math.min(1, altitude / cruise) * (Math.min(470, 250 + cruise / 120) - 150));
    const vs = f >= 0.02 && f < 0.25 ? 1800 : f > 0.75 && f <= 0.98 ? -1500 : 0;
    out.push({
      id: spec.flightId * 10000 + i,
      flight_id: spec.flightId,
      ts: new Date(t0 + (n === 1 ? 0 : (i / (n - 1)) * spec.progress * spec.durationSec * 1000)).toISOString(),
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      altitude_ft: Math.round(altitude),
      airspeed_kts: gs,
      ground_speed_kts: gs,
      heading_deg: Math.round(bearingDeg(lat, lon, nLat, nLon)),
      vertical_speed_fpm: vs,
      on_ground: f < 0.02 || f > 0.98 ? 1 : 0,
    });
  }
  return out;
}

/** (elapsed seconds, altitude ft) pairs for the altitude chart. */
export function altitudeSeries(points: FlightPoint[]): { t: number; altitudeFt: number }[] {
  if (points.length === 0) return [];
  const t0 = Date.parse(points[0].ts);
  return points.map(p => ({ t: (Date.parse(p.ts) - t0) / 1000, altitudeFt: p.altitude_ft }));
}

/** Frames for the replay clock: position + attitude keyed by elapsed seconds. */
export function replayFrames(points: FlightPoint[]): {
  t: number; lat: number; lon: number; altitudeFt: number; headingDeg: number; groundSpeedKts: number;
}[] {
  if (points.length === 0) return [];
  const t0 = Date.parse(points[0].ts);
  return points.map(p => ({
    t: (Date.parse(p.ts) - t0) / 1000,
    lat: p.lat, lon: p.lon, altitudeFt: p.altitude_ft, headingDeg: p.heading_deg, groundSpeedKts: p.ground_speed_kts,
  }));
}
