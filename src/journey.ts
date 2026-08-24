import type { Flight, FlightPoint } from './types';

/** Earth's equatorial circumference in nautical miles. */
export const EARTH_CIRCUMFERENCE_NM = 21639;

/**
 * ICAO prefix -> country. ICAO codes are allocated by region, so the first one
 * or two letters identify the country. Two-letter prefixes are checked first
 * because single letters (K, C) are whole-country allocations while most
 * others subdivide.
 */
const ICAO_COUNTRIES: Record<string, { name: string; flag: string }> = {
  // South America
  SA: { name: 'Argentina', flag: '🇦🇷' },
  SB: { name: 'Brazil', flag: '🇧🇷' },
  SC: { name: 'Chile', flag: '🇨🇱' },
  SD: { name: 'Brazil', flag: '🇧🇷' },
  SE: { name: 'Ecuador', flag: '🇪🇨' },
  SG: { name: 'Paraguay', flag: '🇵🇾' },
  SI: { name: 'Brazil', flag: '🇧🇷' },
  SJ: { name: 'Brazil', flag: '🇧🇷' },
  SK: { name: 'Colombia', flag: '🇨🇴' },
  SL: { name: 'Bolivia', flag: '🇧🇴' },
  SM: { name: 'Suriname', flag: '🇸🇷' },
  SN: { name: 'Brazil', flag: '🇧🇷' },
  SO: { name: 'French Guiana', flag: '🇬🇫' },
  SP: { name: 'Peru', flag: '🇵🇪' },
  SS: { name: 'Brazil', flag: '🇧🇷' },
  SU: { name: 'Uruguay', flag: '🇺🇾' },
  SV: { name: 'Venezuela', flag: '🇻🇪' },
  SW: { name: 'Brazil', flag: '🇧🇷' },
  SY: { name: 'Guyana', flag: '🇬🇾' },
  // Central America & Caribbean
  MB: { name: 'Turks & Caicos', flag: '🇹🇨' },
  MD: { name: 'Dominican Republic', flag: '🇩🇴' },
  MG: { name: 'Guatemala', flag: '🇬🇹' },
  MH: { name: 'Honduras', flag: '🇭🇳' },
  MK: { name: 'Jamaica', flag: '🇯🇲' },
  MM: { name: 'Mexico', flag: '🇲🇽' },
  MN: { name: 'Nicaragua', flag: '🇳🇮' },
  MP: { name: 'Panama', flag: '🇵🇦' },
  MR: { name: 'Costa Rica', flag: '🇨🇷' },
  MS: { name: 'El Salvador', flag: '🇸🇻' },
  MT: { name: 'Haiti', flag: '🇭🇹' },
  MU: { name: 'Cuba', flag: '🇨🇺' },
  MW: { name: 'Cayman Islands', flag: '🇰🇾' },
  MY: { name: 'Bahamas', flag: '🇧🇸' },
  MZ: { name: 'Belize', flag: '🇧🇿' },
  // Elsewhere, by first letter
  BG: { name: 'Greenland', flag: '🇬🇱' },
  BI: { name: 'Iceland', flag: '🇮🇸' },
  CY: { name: 'Canada', flag: '🇨🇦' },
  ED: { name: 'Germany', flag: '🇩🇪' },
  EG: { name: 'United Kingdom', flag: '🇬🇧' },
  EH: { name: 'Netherlands', flag: '🇳🇱' },
  EI: { name: 'Ireland', flag: '🇮🇪' },
  EK: { name: 'Denmark', flag: '🇩🇰' },
  EN: { name: 'Norway', flag: '🇳🇴' },
  ES: { name: 'Sweden', flag: '🇸🇪' },
  LE: { name: 'Spain', flag: '🇪🇸' },
  LF: { name: 'France', flag: '🇫🇷' },
  LI: { name: 'Italy', flag: '🇮🇹' },
  LP: { name: 'Portugal', flag: '🇵🇹' },
  LS: { name: 'Switzerland', flag: '🇨🇭' },
  LT: { name: 'Turkey', flag: '🇹🇷' },
  RJ: { name: 'Japan', flag: '🇯🇵' },
  RK: { name: 'South Korea', flag: '🇰🇷' },
  VA: { name: 'India', flag: '🇮🇳' },
  YM: { name: 'Australia', flag: '🇦🇺' },
  NZ: { name: 'New Zealand', flag: '🇳🇿' },
  FA: { name: 'South Africa', flag: '🇿🇦' },
};

const SINGLE_LETTER_COUNTRIES: Record<string, { name: string; flag: string }> = {
  K: { name: 'United States', flag: '🇺🇸' },
  C: { name: 'Canada', flag: '🇨🇦' },
  Y: { name: 'Australia', flag: '🇦🇺' },
};

export function countryForIcao(icao: string | null): { name: string; flag: string } | null {
  if (!icao || icao.length < 2) return null;
  return ICAO_COUNTRIES[icao.slice(0, 2).toUpperCase()]
      ?? SINGLE_LETTER_COUNTRIES[icao[0].toUpperCase()]
      ?? null;
}

/** Uniform stride sample keeping the endpoints, so overview tracks stay light. */
function sampleTrack(points: FlightPoint[], max: number): [number, number][] {
  if (points.length === 0) return [];
  if (points.length <= max) return points.map(p => [p.lat, p.lon]);
  const step = (points.length - 1) / (max - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < max - 1; i++) {
    const p = points[Math.round(i * step)];
    out.push([p.lat, p.lon]);
  }
  const last = points[points.length - 1];
  out.push([last.lat, last.lon]);
  return out;
}

export interface JourneyLeg {
  id: number;
  seq: number;
  aircraft: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
  distanceNm: number | null;
  durationSec: number | null;
  startTime: string;
  track: [number, number][];
}

export interface JourneyAirport {
  icao: string;
  name: string | null;
  lat: number;
  lon: number;
  visits: number;
}

export interface Journey {
  legCount: number;
  totalDistanceNm: number;
  totalDurationSec: number;
  aircraftCount: number;
  aircraft: { name: string; legs: number; distanceNm: number }[];
  maxAltitudeFt: number;
  maxAirspeedKts: number;
  longestLeg: { id: number; route: string; distanceNm: number } | null;
  countries: { name: string; flag: string; airports: number }[];
  airports: JourneyAirport[];
  aroundTheWorldPct: number;
  /** Consecutive legs where each departure matches the previous arrival. */
  longestChain: { length: number; from: string; to: string } | null;
  chainBreaks: number;
  legs: JourneyLeg[];
  firstFlight: string | null;
  lastFlight: string | null;
}

const TRACK_SAMPLE_POINTS = 160;

export function buildJourney(flights: (Flight & { points: FlightPoint[] })[]): Journey {
  const ordered = [...flights].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const legs: JourneyLeg[] = ordered.map((f, i) => ({
    id: f.id,
    seq: i + 1,
    aircraft: f.aircraft,
    departureIcao: f.departure_icao,
    arrivalIcao: f.arrival_icao,
    distanceNm: f.distance_nm,
    durationSec: f.duration_sec,
    startTime: f.start_time,
    track: sampleTrack(f.points, TRACK_SAMPLE_POINTS),
  }));

  const totalDistanceNm = ordered.reduce((s, f) => s + (f.distance_nm ?? 0), 0);
  const totalDurationSec = ordered.reduce((s, f) => s + (f.duration_sec ?? 0), 0);

  // Per-aircraft rollup, most-flown first
  const byAircraft = new Map<string, { legs: number; distanceNm: number }>();
  for (const f of ordered) {
    const key = f.aircraft ?? 'Unknown';
    const e = byAircraft.get(key) ?? { legs: 0, distanceNm: 0 };
    e.legs += 1;
    e.distanceNm += f.distance_nm ?? 0;
    byAircraft.set(key, e);
  }

  // Airports, deduped by ICAO, with a visit count
  const airports = new Map<string, JourneyAirport>();
  const note = (icao: string | null, name: string | null, lat: number | null, lon: number | null) => {
    if (!icao || lat == null || lon == null) return;
    const e = airports.get(icao);
    if (e) { e.visits += 1; return; }
    airports.set(icao, { icao, name, lat, lon, visits: 1 });
  };
  for (const f of ordered) {
    note(f.departure_icao, f.departure_name, f.departure_lat, f.departure_lon);
    note(f.arrival_icao, f.arrival_name, f.arrival_lat, f.arrival_lon);
  }

  // Countries, counted by distinct airports rather than legs
  const byCountry = new Map<string, { name: string; flag: string; airports: number }>();
  for (const a of airports.values()) {
    const c = countryForIcao(a.icao);
    if (!c) continue;
    const e = byCountry.get(c.name) ?? { name: c.name, flag: c.flag, airports: 0 };
    e.airports += 1;
    byCountry.set(c.name, e);
  }

  // Longest run of legs that link end-to-end
  let bestLen = 0, bestStart = 0, runLen = 0, runStart = 0, breaks = 0;
  for (let i = 0; i < legs.length; i++) {
    const linked = i > 0
      && legs[i - 1].arrivalIcao != null
      && legs[i - 1].arrivalIcao === legs[i].departureIcao;
    if (linked) {
      runLen += 1;
    } else {
      if (i > 0) breaks += 1;
      runStart = i;
      runLen = 1;
    }
    if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
  }

  const longest = ordered.reduce<{ id: number; route: string; distanceNm: number } | null>((best, f) => {
    const d = f.distance_nm ?? 0;
    if (!best || d > best.distanceNm) {
      return { id: f.id, route: `${f.departure_icao ?? '????'} → ${f.arrival_icao ?? '????'}`, distanceNm: d };
    }
    return best;
  }, null);

  return {
    legCount: legs.length,
    totalDistanceNm: Math.round(totalDistanceNm * 10) / 10,
    totalDurationSec,
    aircraftCount: byAircraft.size,
    aircraft: [...byAircraft.entries()]
      .map(([name, v]) => ({ name, legs: v.legs, distanceNm: Math.round(v.distanceNm * 10) / 10 }))
      .sort((a, b) => b.distanceNm - a.distanceNm),
    maxAltitudeFt: ordered.reduce((m, f) => Math.max(m, f.max_altitude_ft ?? 0), 0),
    maxAirspeedKts: ordered.reduce((m, f) => Math.max(m, f.max_airspeed_kts ?? 0), 0),
    longestLeg: longest,
    countries: [...byCountry.values()].sort((a, b) => b.airports - a.airports),
    airports: [...airports.values()],
    aroundTheWorldPct: Math.round((totalDistanceNm / EARTH_CIRCUMFERENCE_NM) * 1000) / 10,
    longestChain: bestLen > 0 && legs.length > 0
      ? {
          length: bestLen,
          from: legs[bestStart].departureIcao ?? '????',
          to: legs[bestStart + bestLen - 1].arrivalIcao ?? '????',
        }
      : null,
    chainBreaks: breaks,
    legs,
    firstFlight: ordered[0]?.start_time ?? null,
    lastFlight: ordered[ordered.length - 1]?.start_time ?? null,
  };
}
