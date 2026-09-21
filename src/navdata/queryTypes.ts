// Response shapes of the navdata query routes. camelCase, lon in [-180,180].
// Hand-mirrored into client/src/types.ts.

import type { SidecarState, SnapshotId, Rev, DetailState, TransitionRole } from './wire';

export interface NavdataStatusResponse {
  present: boolean;
  schemaVersion: number | null;
  snapshotId: SnapshotId | null;
  rev: Rev | null;
  simId: string | null;
  simAppName: string | null;
  simAppVersion: string | null;
  snapshotAppliedAt: number | null;
  lastRowsAt: number | null;
  counts: {
    airports: number; airportsWithDetail: number; navaids: number; waypoints: number;
    airwayLegs: number; runways: number; procedures: number; coverageCells: number; absent: number;
  } | null;
  sidecar: { state: SidecarState; reason: string | null } | null;
}

export interface FeatureAirport {
  ident: string; lat: number; lon: number; name: string | null;
  hasDetail: boolean; runways: number | null; procedures: number | null;
}
export interface FeatureNavaid {
  kind: 'V' | 'N'; ident: string; region: string; lat: number; lon: number;
  frequencyHz: number | null; name: string | null; navType: number | null; isDme: boolean | null;
}
export interface FeatureWaypoint {
  key: string; ident: string; region: string; lat: number; lon: number; terminal: boolean | null;
}
export interface FeatureAirwayLeg {
  airway: string; from: [number, number]; to: [number, number];
  fromIdent: string; toIdent: string; dateline: boolean;
}
export interface FeatureRunway {
  airport: string; lat: number; lon: number;
  headingDeg: number | null; lengthM: number | null; widthM: number | null; designation: string;
}
export interface FeatureCoverageKind {
  harvestedCells: number; fraction: number;
  oldestHarvestAt: number | null; newestHarvestAt: number | null;
}
export interface FeatureCoverage {
  totalCells: number;
  byKind: Record<'V' | 'N' | 'W', FeatureCoverageKind>;
  airportsComplete: boolean;
}
export interface FeaturesResponse {
  bbox: [number, number, number, number];
  zoom: number; gated: string[]; truncated: boolean; limit: number;
  airports: FeatureAirport[]; navaids: FeatureNavaid[]; waypoints: FeatureWaypoint[];
  airways: FeatureAirwayLeg[]; runways: FeatureRunway[];
  coverage: FeatureCoverage;
}

export interface AirportProcedureSummary {
  key: string; kind: 'SID' | 'STAR' | 'APPROACH'; name: string; runway: string | null;
  transitions: { key: string; role: TransitionRole; name: string; legs: number }[];
}
export interface AirportDetailResponse {
  ident: string; detailState: DetailState; detailFetchedAt: number | null;
  lat: number | null; lon: number | null; altM: number | null;
  name: string | null; magvar: number | null;
  runways: FeatureRunway[];
  frequencies: { type: number | null; frequencyHz: number | null; name: string | null }[];
  procedures: AirportProcedureSummary[];
}

export interface GeometryPoint {
  lat: number; lon: number; ident: string | null; legType: number | null;
  flyOver: boolean | null;
  altitude1M: number | null; altitude2M: number | null; speedLimitKt: number | null;
}
export interface GeometryArc {
  fromIndex: number; toIndex: number; centerLat: number; centerLon: number; turn: 'L' | 'R' | null;
}
export interface GeometryChain {
  /** proc_key for a real procedure; the plan's opaque sid_name/approach_name
   *  for a synthetic chain; 'planned' for enroute; null when empty. */
  source: string | null;
  /** true only for a custom SID/approach computed from the runway
   *  (see the synthetic procedure builder). false on every other chain, empty
   *  chains included. */
  synthetic: boolean;
  points: GeometryPoint[];
  arcs: GeometryArc[];
}

/** isAirport comes from
 *  planned_legs.departure_is_airport / destination_is_airport; when false the
 *  UI must not offer "fetch detail". This server never emits null — the
 *  planned columns are NOT NULL — but the type admits it. */
export interface RouteGeometryEndpoint {
  ident: string; lat: number; lon: number; isAirport: boolean;
}

export type UnresolvedKind = 'sid' | 'star' | 'approach' | 'airway' | 'waypoint';
export type UnresolvedReason =
  | 'ident not in cache'
  | 'position disagrees with cache'
  | 'no path found'
  | 'procedure not in cache'
  | 'airport detail not fetched'
  /** A custom SID/approach whose runway row is missing or unusable .
   *  A custom procedure is NEVER 'procedure not in cache'. */
  | 'custom procedure, no runway'
  /** A custom procedure whose runway resolved but whose distance is missing or not a positive number. */
  | 'custom procedure, invalid distance'
  | 'unparseable runway'
  | 'approach runway not specified';

export interface RouteGeometryResponse {
  legId: number;
  origin: RouteGeometryEndpoint | null; destination: RouteGeometryEndpoint | null;
  sid: GeometryChain; enroute: GeometryChain; star: GeometryChain; approach: GeometryChain;
  skippedLegs: number;
  skippedByChain: Record<'sid' | 'enroute' | 'star' | 'approach', number>;
  unresolved: { kind: UnresolvedKind; name: string; reason: UnresolvedReason }[];
}
