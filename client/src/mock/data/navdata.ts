import type {
  FeatureAirport, FeatureAirwayLeg, FeatureNavaid, FeatureRunway, FeaturesResponse, FeatureWaypoint,
  GeometryChain, GeometryPoint, NavdataStatusResponse, PlannedLegWithChildren, RouteGeometryResponse,
} from '../types';
import { AIRPORTS, interpolate } from './airports';

export const SEED_NAVDATA_STATUS: NavdataStatusResponse = {
  present: true, schemaVersion: 3, snapshotId: 'mock-snapshot-2026-09-20', rev: 12, simId: 'msfs2024',
  simAppName: 'Microsoft Flight Simulator 2024', simAppVersion: '1.5.7.0',
  snapshotAppliedAt: Date.parse('2026-09-20T18:00:00Z'), lastRowsAt: Date.parse('2026-09-23T12:00:00Z'),
  counts: {
    airports: 16, airportsWithDetail: 4, navaids: 6, waypoints: 8, airwayLegs: 4, runways: 6, procedures: 12,
    coverageCells: 340, absent: 1,
  },
  sidecar: { state: 'nav.ready', reason: null },
};

const LARGE = new Set(['SBGR', 'SBBR', 'SBSV', 'SBGL', 'EFHK', 'ESSA', 'SBCT', 'SBPA', 'SBRF', 'SBFZ', 'SBCF', 'SBKP']);

const airports: FeatureAirport[] = Object.values(AIRPORTS).map(a => ({
  ident: a.icao, lat: a.lat, lon: a.lon, name: a.name, hasDetail: ['SBCT', 'SBPA', 'EFHK', 'SBGR'].includes(a.icao),
  runways: 2, procedures: ['SBCT', 'SBPA'].includes(a.icao) ? 6 : null,
  longestRunwayM: 3000, surface: 'paved', towered: true, longestRunwayHeadingDeg: 150,
  tier: LARGE.has(a.icao) ? 'large' : 'medium',
}));

const navaids: FeatureNavaid[] = [
  { kind: 'V', ident: 'CTB', region: 'SB', lat: -25.51, lon: -49.17, frequencyHz: 113_500_000, name: 'Curitiba', navType: 1, isDme: true },
  { kind: 'V', ident: 'POA', region: 'SB', lat: -29.99, lon: -51.18, frequencyHz: 114_300_000, name: 'Porto Alegre', navType: 1, isDme: true },
  { kind: 'V', ident: 'GRU', region: 'SB', lat: -23.42, lon: -46.47, frequencyHz: 113_900_000, name: 'Guarulhos', navType: 1, isDme: true },
  { kind: 'N', ident: 'SPO', region: 'SB', lat: -23.62, lon: -46.65, frequencyHz: 385_000, name: 'Sao Paulo', navType: 4, isDme: false },
  { kind: 'V', ident: 'HEL', region: 'EF', lat: 60.32, lon: 24.96, frequencyHz: 113_200_000, name: 'Helsinki', navType: 1, isDme: true },
  { kind: 'V', ident: 'TLL', region: 'EE', lat: 59.41, lon: 24.85, frequencyHz: 117_600_000, name: 'Tallinn', navType: 1, isDme: true },
];

function fix(ident: string, region: string, a: string, b: string, f: number): FeatureWaypoint {
  const [lat, lon] = interpolate(AIRPORTS[a].lat, AIRPORTS[a].lon, AIRPORTS[b].lat, AIRPORTS[b].lon, f);
  return { key: `${region}:${ident}`, ident, region, lat, lon, terminal: false };
}

const waypoints: FeatureWaypoint[] = [
  fix('ROSIX', 'SB', 'SBCT', 'SBPA', 0.33), fix('BELOM', 'SB', 'SBCT', 'SBPA', 0.66),
  fix('TNOL', 'SB', 'SBCT', 'SBPA', 0.1), fix('ISOB', 'SB', 'SBCT', 'SBPA', 0.9),
  fix('TIBAM', 'SB', 'SBGR', 'SBBR', 0.33), fix('RUKLA', 'SB', 'SBGR', 'SBBR', 0.66),
  fix('ERKOK', 'EF', 'EFHK', 'EETN', 0.5), fix('VIRAL', 'EE', 'EETN', 'ESSA', 0.5),
];

const airways: FeatureAirwayLeg[] = [
  ['UZ21', waypoints[2], waypoints[0]], ['UZ21', waypoints[0], waypoints[1]], ['UZ21', waypoints[1], waypoints[3]],
  ['UZ22', waypoints[4], waypoints[5]],
].map(([airway, f, t]) => {
  const from = f as FeatureWaypoint;
  const to = t as FeatureWaypoint;
  return {
    airway: airway as string, from: [from.lat, from.lon], to: [to.lat, to.lon],
    fromIdent: from.ident, toIdent: to.ident, dateline: false,
  };
});

const rwy = (airport: string, designation: string, secondary: string, heading: number, lengthM: number): FeatureRunway => ({
  airport, lat: AIRPORTS[airport].lat, lon: AIRPORTS[airport].lon, headingDeg: heading, lengthM, widthM: 45,
  designation, secondaryDesignation: secondary,
});

const runways: FeatureRunway[] = [
  rwy('SBCT', '15', '33', 150, 2218), rwy('SBPA', '11', '29', 110, 3200), rwy('EFHK', '04L', '22R', 40, 3060),
  rwy('SBGR', '09L', '27R', 90, 3700), rwy('SBBR', '11L', '29R', 110, 3300), rwy('EETN', '08', '26', 80, 3070),
];

const inBox = (lat: number, lon: number, [w, s, e, n]: [number, number, number, number]) =>
  lon >= w && lon <= e && lat >= s && lat <= n;

/** The seed FeaturesResponse, cropped to the requested viewport. */
export function featuresFor(bbox: [number, number, number, number], zoom: number): FeaturesResponse {
  const inside = airports.filter(a => inBox(a.lat, a.lon, bbox));
  const shown = zoom < 5 ? inside.filter(a => a.tier === 'large') : inside;
  return {
    bbox, zoom, gated: zoom < 7 ? ['waypoints', 'navaids'] : [], truncated: false, limit: 500,
    airports: shown,
    navaids: zoom < 7 ? [] : navaids.filter(n => inBox(n.lat, n.lon, bbox)),
    waypoints: zoom < 7 ? [] : waypoints.filter(w => inBox(w.lat, w.lon, bbox)),
    airways: zoom < 7 ? [] : airways.filter(l => inBox(l.from[0], l.from[1], bbox) || inBox(l.to[0], l.to[1], bbox)),
    runways: zoom < 8 ? [] : runways.filter(r => inBox(r.lat, r.lon, bbox)),
    coverage: {
      totalCells: 340,
      byKind: {
        V: { harvestedCells: 300, fraction: 0.88, oldestHarvestAt: 1_790_000_000, newestHarvestAt: 1_790_500_000 },
        N: { harvestedCells: 280, fraction: 0.82, oldestHarvestAt: 1_790_000_000, newestHarvestAt: 1_790_500_000 },
        W: { harvestedCells: 220, fraction: 0.65, oldestHarvestAt: 1_790_000_000, newestHarvestAt: 1_790_500_000 },
      },
      airportsComplete: true,
    },
    airportThinning: zoom < 5
      ? { mode: 'tier', through: 'large', hidden: Math.max(0, inside.length - shown.length), byTier: null, nextZoom: 5 }
      : { mode: 'none', through: null, hidden: 0, byTier: null, nextZoom: null },
  };
}

const pt = (lat: number, lon: number, ident: string | null): GeometryPoint => ({
  lat, lon, ident, legType: null, flyOver: null, altitude1M: null, altitude2M: null, speedLimitKt: null,
});
const chain = (source: string | null, points: GeometryPoint[]): GeometryChain => ({ source, synthetic: false, points, arcs: [] });

/** Route geometry for a leg: enroute always, procedures only where the plan names them. */
export function geometryFor(leg: PlannedLegWithChildren): RouteGeometryResponse {
  const wps = leg.waypoints;
  if (wps.length === 0) {
    return {
      legId: leg.id,
      origin: { ident: leg.departure_ident, lat: leg.departure_lat, lon: leg.departure_lon, isAirport: leg.departure_is_airport === 1 },
      destination: { ident: leg.destination_ident, lat: leg.destination_lat, lon: leg.destination_lon, isAirport: true },
      sid: chain(null, []), enroute: chain(null, []), star: chain(null, []), approach: chain(null, []),
      skippedLegs: 0, skippedByChain: { sid: 0, enroute: 0, star: 0, approach: 0 }, unresolved: [],
    };
  }
  const first = wps[0];
  const last = wps[wps.length - 1];
  const second = wps[1] ?? last;
  const beforeLast = wps[wps.length - 2] ?? first;
  const along = (a: PlannedLegWithChildren['waypoints'][number], b: typeof a, f: number, ident: string | null) => {
    const [lat, lon] = interpolate(a.lat, a.lon, b.lat, b.lon, f);
    return pt(lat, lon, ident);
  };
  const sid = leg.sid_name
    ? chain(leg.sid_name, [pt(first.lat, first.lon, first.ident), along(first, second, 0.3, leg.sid_name.slice(0, 4)), along(first, second, 0.6, `${leg.sid_name.slice(0, 3)}02`)])
    : chain(null, []);
  const star = leg.star_name
    ? chain(leg.star_name, [along(beforeLast, last, 0.6, leg.star_name.slice(0, 4)), along(beforeLast, last, 0.8, `${leg.star_name.slice(0, 3)}02`), along(beforeLast, last, 0.92, `${leg.star_name.slice(0, 3)}03`)])
    : chain(null, []);
  const approach = leg.approach_name
    ? chain(leg.approach_name, [along(beforeLast, last, 0.92, `${(leg.star_name ?? 'APP').slice(0, 3)}03`), along(beforeLast, last, 0.97, `FAF${leg.approach_runway ?? ''}`), pt(last.lat, last.lon, `RW${leg.approach_runway}`)])
    : chain(null, []);
  return {
    legId: leg.id,
    origin: { ident: leg.departure_ident, lat: leg.departure_lat, lon: leg.departure_lon, isAirport: leg.departure_is_airport === 1 },
    destination: { ident: leg.destination_ident, lat: leg.destination_lat, lon: leg.destination_lon, isAirport: true },
    sid,
    enroute: chain('planned', wps.map(w => pt(w.lat, w.lon, w.ident))),
    star, approach,
    skippedLegs: 0,
    skippedByChain: { sid: 0, enroute: 0, star: 0, approach: 0 },
    unresolved: leg.departure_is_airport === 0
      ? [{ kind: 'waypoint', name: leg.departure_ident, reason: 'ident not in cache' }]
      : [],
  };
}
