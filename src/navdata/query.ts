// ── Navdata read side ─────────────────────────────────────────────────────────
//
// What the browser asks of the replica: features in a viewport, replica status,
// one airport's detail, and the manual "please fetch this" request. Every
// function takes the replica handle (or null when the file is absent) and never
// yields, so a swap cannot land between a handle being obtained and its last
// query.

import type Database from 'better-sqlite3';
import { upsertNavdataRequest } from '../db/navdataRequests';
import type {
  AirportDetailResponse, AirportProcedureSummary, FeatureAirport, FeatureAirwayLeg, FeatureCoverage,
  FeatureCoverageKind, FeatureNavaid, FeatureRunway, FeatureWaypoint, FeaturesResponse,
  NavdataStatusResponse,
} from './queryTypes';
import type { SidecarStateRecord } from './sidecarState';
import type { DetailState, NavdataRequestBody, NavdataRequestResponse } from './wire';

export const NAVDATA_ZOOM_MIN = {
  airports: 6, airways: 7, navaids: 8, waypoints: 9, runways: 12,
} as const;

export type FeatureKind = keyof typeof NAVDATA_ZOOM_MIN;
export const FEATURE_KINDS: readonly FeatureKind[] = ['airports', 'navaids', 'waypoints', 'airways', 'runways'];

export const FEATURES_DEFAULT_LIMIT = 2000;
export const FEATURES_MAX_LIMIT = 5000;
export const COVERAGE_MAX_CELLS = 259_200;

const CELL_COLS = 720;
const CELL_ROWS = 360;

// ── bbox ──────────────────────────────────────────────────────────────────────

export type Bbox = [number, number, number, number];
type LonRange = [number, number];

/** null when the string is not four finite numbers forming a legal box. */
export function parseBbox(raw: unknown): Bbox | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length !== 4 || parts.some(p => p.trim() === '')) return null;
  const [w, s, e, n] = parts.map(Number);
  if (![w, s, e, n].every(Number.isFinite)) return null;
  if (s < -90 || n > 90 || s > n) return null;
  if (w < -180 || w > 180 || e < -180 || e > 180) return null;
  return [w, s, e, n];
}

/** w > e crosses the antimeridian; w === e is a zero-width box, not the world. */
export function lonRanges(w: number, e: number): LonRange[] {
  if (w === e) return [];
  return w > e ? [[w, 180], [-180, e]] : [[w, e]];
}

const cellRow = (lat: number): number => Math.min(CELL_ROWS - 1, Math.max(0, Math.floor((lat + 90) * 2)));
const cellCol = (lon: number): number => Math.min(CELL_COLS - 1, Math.max(0, Math.floor((lon + 180) * 2)));

export function totalCells(bbox: Bbox): number {
  const [w, s, e, n] = bbox;
  const latCells = cellRow(n) - cellRow(s) + 1;
  let lonCells = 0;
  for (const [lo, hi] of lonRanges(w, e)) lonCells += cellCol(hi) - cellCol(lo) + 1;
  return Math.min(COVERAGE_MAX_CELLS, latCells * lonCells);
}

// ── runway designation ────────────────────────────────────────────────────────

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DESIGNATOR = ['', 'L', 'R', 'C', 'W', 'A', 'B'];

/** "27L" from the SDK's number/designator pair; '' when there is no usable number. */
export function runwayDesignation(number: number | null, designator: number | null): string {
  if (number == null || !Number.isInteger(number)) return '';
  if (number >= 37 && number <= 44) return COMPASS[number - 37];
  if (number < 1 || number > 36) return '';
  const suffix = designator != null && designator >= 0 && designator < DESIGNATOR.length ? DESIGNATOR[designator] : '';
  return String(number).padStart(2, '0') + suffix;
}

// ── features ──────────────────────────────────────────────────────────────────

export interface FeaturesQuery {
  bbox: Bbox;
  zoom: number;
  kinds: readonly FeatureKind[];
  limit: number;
}

interface Extent { clause: string; params: number[] }

/** OR of BETWEEN tests over the longitude ranges, columns given by the caller. */
function lonClause(column: string, ranges: LonRange[]): Extent {
  if (ranges.length === 0) return { clause: '0', params: [] };
  return {
    clause: '(' + ranges.map(() => `${column} BETWEEN ? AND ?`).join(' OR ') + ')',
    params: ranges.flat(),
  };
}

const bool = (v: number | null): boolean | null => (v == null ? null : v === 1);

function emptyCoverageKind(): FeatureCoverageKind {
  return { harvestedCells: 0, fraction: 0, oldestHarvestAt: null, newestHarvestAt: null };
}

function coverageFor(nav: Database.Database | null, bbox: Bbox): FeatureCoverage {
  const total = totalCells(bbox);
  const byKind: FeatureCoverage['byKind'] = { V: emptyCoverageKind(), N: emptyCoverageKind(), W: emptyCoverageKind() };
  let airportsComplete = false;
  if (nav) {
    const [w, s, e, n] = bbox;
    const cols = lonRanges(w, e).map(([lo, hi]): LonRange => [cellCol(lo), cellCol(hi)]);
    if (cols.length > 0) {
      const minCell = cellRow(s) * CELL_COLS + Math.min(...cols.map(c => c[0]));
      const maxCell = cellRow(n) * CELL_COLS + Math.max(...cols.map(c => c[1]));
      const colClause = cols.map(() => '(cell_id % 720) BETWEEN ? AND ?').join(' OR ');
      const rows = nav.prepare(
        `SELECT kind, COUNT(*) AS cells, MIN(harvested_at) AS oldest, MAX(harvested_at) AS newest
           FROM nav_coverage_cell
          WHERE cell_id BETWEEN ? AND ? AND (${colClause})
          GROUP BY kind`,
      ).all(minCell, maxCell, ...cols.flat()) as { kind: 'V' | 'N' | 'W'; cells: number; oldest: number; newest: number }[];
      for (const r of rows) {
        if (!byKind[r.kind]) continue;
        byKind[r.kind] = {
          harvestedCells: r.cells,
          fraction: total === 0 ? 0 : r.cells / total,
          oldestHarvestAt: r.oldest,
          newestHarvestAt: r.newest,
        };
      }
    }
    const meta = nav.prepare('SELECT bulk_completed_at FROM nav_meta WHERE id = 1').get() as
      | { bulk_completed_at: number | null }
      | undefined;
    airportsComplete = Boolean(meta && meta.bulk_completed_at != null);
  }
  return { totalCells: total, byKind, airportsComplete };
}

export function queryFeatures(nav: Database.Database | null, q: FeaturesQuery): FeaturesResponse {
  const { bbox, zoom, kinds, limit } = q;
  const [w, s, e, n] = bbox;
  const ranges = lonRanges(w, e);
  const want = new Set(kinds);
  const gated: string[] = [];
  let truncated = false;

  // A kind under its zoom gate is named in gated[] and answers []; a kind not
  // asked for is neither. Beyond that, one query per kind, one row past the
  // limit to detect truncation.
  const fetch = <T, R>(kind: FeatureKind, run: () => T[], map: (row: T) => R): R[] => {
    if (!want.has(kind)) return [];
    if (zoom < NAVDATA_ZOOM_MIN[kind]) {
      gated.push(kind);
      return [];
    }
    if (!nav || ranges.length === 0) return [];
    let rows = run();
    if (rows.length > limit) {
      truncated = true;
      rows = rows.slice(0, limit);
    }
    return rows.map(map);
  };

  const pointClause = lonClause('lon', ranges);

  const airports = fetch(
    'airports',
    () => nav!.prepare(
      `SELECT ident, lat, lon, name, detail_state, detail_runways, detail_procedures,
              n_runways, n_approaches, n_departures, n_arrivals
         FROM nav_airport
        WHERE lat BETWEEN ? AND ? AND ${pointClause.clause}
        ORDER BY ident ASC LIMIT ?`,
    ).all(s, n, ...pointClause.params, limit + 1) as Record<string, any>[],
    (r): FeatureAirport => {
      const hasDetail = r.detail_state === 'detail';
      const listed = [r.n_approaches, r.n_departures, r.n_arrivals];
      return {
        ident: r.ident, lat: r.lat, lon: r.lon, name: r.name, hasDetail,
        runways: hasDetail ? r.detail_runways : r.n_runways,
        procedures: hasDetail
          ? r.detail_procedures
          : listed.every(v => v == null) ? null : listed.reduce((a, v) => a + (v ?? 0), 0),
      };
    },
  );

  const navaids = fetch(
    'navaids',
    () => nav!.prepare(
      `SELECT kind, ident, region, lat, lon, frequency_hz, name, nav_type, is_dme
         FROM nav_navaid
        WHERE lat BETWEEN ? AND ? AND ${pointClause.clause}
        ORDER BY kind, ident, region ASC LIMIT ?`,
    ).all(s, n, ...pointClause.params, limit + 1) as Record<string, any>[],
    (r): FeatureNavaid => ({
      kind: r.kind, ident: r.ident, region: r.region, lat: r.lat, lon: r.lon,
      frequencyHz: r.frequency_hz, name: r.name, navType: r.nav_type, isDme: bool(r.is_dme),
    }),
  );

  const waypoints = fetch(
    'waypoints',
    () => nav!.prepare(
      `SELECT wpt_key, ident, region, lat, lon, is_terminal
         FROM nav_waypoint
        WHERE lat BETWEEN ? AND ? AND ${pointClause.clause}
        ORDER BY wpt_key ASC LIMIT ?`,
    ).all(s, n, ...pointClause.params, limit + 1) as Record<string, any>[],
    (r): FeatureWaypoint => ({
      key: r.wpt_key, ident: r.ident, region: r.region, lat: r.lat, lon: r.lon, terminal: bool(r.is_terminal),
    }),
  );

  // A dateline row's min_lon/max_lon mean nothing. Such a leg crosses the
  // antimeridian, so it covers [max(from,to), 180] and [-180, min(from,to)];
  // it matches a longitude range only when that range reaches either part.
  const airways = fetch(
    'airways',
    () => {
      const overlap = ranges.map(() => '(max_lon >= ? AND min_lon <= ?)').join(' OR ');
      const wrapped = ranges.map(() => '(? >= MAX(from_lon, to_lon) OR ? <= MIN(from_lon, to_lon))').join(' OR ');
      return nav!.prepare(
        `SELECT airway, from_lat, from_lon, to_lat, to_lon, from_ident, to_ident, dateline
           FROM nav_airway_leg
          WHERE max_lat >= ? AND min_lat <= ?
            AND ((dateline = 0 AND (${overlap})) OR (dateline = 1 AND (${wrapped})))
          ORDER BY leg_key ASC LIMIT ?`,
      ).all(s, n, ...ranges.flat(), ...ranges.map(([w, e]) => [e, w]).flat(), limit + 1) as Record<string, any>[];
    },
    (r): FeatureAirwayLeg => ({
      airway: r.airway, from: [r.from_lat, r.from_lon], to: [r.to_lat, r.to_lon],
      fromIdent: r.from_ident, toIdent: r.to_ident, dateline: r.dateline === 1,
    }),
  );

  const runways = fetch(
    'runways',
    () => nav!.prepare(
      `SELECT airport_ident, lat, lon, heading_deg, length_m, width_m,
              primary_number, primary_designator, secondary_number, secondary_designator
         FROM nav_runway
        WHERE lat IS NOT NULL AND lon IS NOT NULL AND lat BETWEEN ? AND ? AND ${pointClause.clause}
        ORDER BY rwy_key ASC LIMIT ?`,
    ).all(s, n, ...pointClause.params, limit + 1) as Record<string, any>[],
    runwayFeature,
  );

  return {
    bbox, zoom, gated, truncated, limit,
    airports, navaids, waypoints, airways, runways,
    coverage: coverageFor(nav, bbox),
  };
}

function runwayFeature(r: Record<string, any>): FeatureRunway {
  return {
    airport: r.airport_ident, lat: r.lat, lon: r.lon,
    headingDeg: r.heading_deg, lengthM: r.length_m, widthM: r.width_m,
    designation: runwayDesignation(r.primary_number, r.primary_designator),
    secondaryDesignation: runwayDesignation(r.secondary_number, r.secondary_designator),
  };
}

// ── status ────────────────────────────────────────────────────────────────────

export function readStatus(
  nav: Database.Database | null,
  sidecar: SidecarStateRecord | null,
  lastRowsAt: number | null,
): NavdataStatusResponse {
  const sidecarOut = sidecar ? { state: sidecar.state, reason: sidecar.reason } : null;
  const absent: NavdataStatusResponse = {
    present: false, schemaVersion: null, snapshotId: null, rev: null, simId: null,
    simAppName: null, simAppVersion: null, snapshotAppliedAt: null, lastRowsAt: null,
    counts: null, sidecar: sidecarOut,
  };
  if (!nav) return absent;
  const meta = nav.prepare(
    'SELECT schema_version, snapshot_id, rev, sim_id, sim_app_name, sim_app_version, created_at FROM nav_meta WHERE id = 1',
  ).get() as Record<string, any> | undefined;
  if (!meta) return absent;

  const count = (sql: string): number => (nav.prepare(sql).get() as { c: number }).c;
  return {
    present: true,
    schemaVersion: meta.schema_version,
    snapshotId: meta.snapshot_id,
    rev: meta.rev,
    simId: meta.sim_id,
    simAppName: meta.sim_app_name,
    simAppVersion: meta.sim_app_version,
    snapshotAppliedAt: meta.created_at,
    lastRowsAt,
    counts: {
      airports: count('SELECT COUNT(*) AS c FROM nav_airport'),
      airportsWithDetail: count("SELECT COUNT(*) AS c FROM nav_airport WHERE detail_state = 'detail'"),
      navaids: count('SELECT COUNT(*) AS c FROM nav_navaid'),
      waypoints: count('SELECT COUNT(*) AS c FROM nav_waypoint'),
      airwayLegs: count('SELECT COUNT(*) AS c FROM nav_airway_leg'),
      runways: count('SELECT COUNT(*) AS c FROM nav_runway'),
      procedures: count('SELECT COUNT(*) AS c FROM nav_procedure'),
      coverageCells: count('SELECT COUNT(*) AS c FROM nav_coverage_cell'),
      absent: count('SELECT COUNT(*) AS c FROM nav_absent'),
    },
    sidecar: sidecarOut,
  };
}

// ── airport detail ────────────────────────────────────────────────────────────

/** null when the replica is absent or the ident is not in the index. */
export function readAirportDetail(nav: Database.Database | null, rawIdent: string): AirportDetailResponse | null {
  if (!nav) return null;
  const ident = rawIdent.trim().toUpperCase();
  const a = nav.prepare(
    'SELECT ident, lat, lon, alt_m, name, magvar, detail_state, detail_fetched_at FROM nav_airport WHERE ident = ?',
  ).get(ident) as Record<string, any> | undefined;
  if (!a) return null;

  const runways = (nav.prepare(
    `SELECT airport_ident, lat, lon, heading_deg, length_m, width_m,
            primary_number, primary_designator, secondary_number, secondary_designator
       FROM nav_runway WHERE airport_ident = ? AND lat IS NOT NULL AND lon IS NOT NULL
      ORDER BY primary_number, primary_designator`,
  ).all(ident) as Record<string, any>[]).map(runwayFeature);

  const frequencies = (nav.prepare(
    'SELECT freq_type, frequency_hz, name FROM nav_airport_frequency WHERE airport_ident = ? ORDER BY freq_type, frequency_hz',
  ).all(ident) as Record<string, any>[]).map(f => ({
    type: f.freq_type as number | null, frequencyHz: f.frequency_hz as number | null, name: f.name as string | null,
  }));

  const transitionStmt = nav.prepare(
    `SELECT t.trans_key, t.role, t.name,
            COALESCE(t.n_legs, (SELECT COUNT(*) FROM nav_procedure_leg l WHERE l.trans_key = t.trans_key)) AS legs
       FROM nav_procedure_transition t WHERE t.proc_key = ? ORDER BY t.trans_key`,
  );
  const procedures = (nav.prepare(
    `SELECT proc_key, kind, name, runway_number, runway_designator
       FROM nav_procedure WHERE airport_ident = ? ORDER BY kind, name, proc_key`,
  ).all(ident) as Record<string, any>[]).map((p): AirportProcedureSummary => ({
    key: p.proc_key, kind: p.kind, name: p.name,
    runway: p.runway_number == null ? null : runwayDesignation(p.runway_number, p.runway_designator) || null,
    transitions: (transitionStmt.all(p.proc_key) as Record<string, any>[]).map(t => ({
      key: t.trans_key, role: t.role, name: t.name, legs: t.legs,
    })),
  }));

  return {
    ident: a.ident, detailState: a.detail_state as DetailState, detailFetchedAt: a.detail_fetched_at,
    lat: a.lat, lon: a.lon, altM: a.alt_m, name: a.name, magvar: a.magvar,
    runways, frequencies, procedures,
  };
}

// ── manual requests ───────────────────────────────────────────────────────────

const REQUEST_IDENT = /^[A-Z0-9]{1,8}$/;
const REQUEST_REGION = /^[A-Z0-9]{1,4}$/;

export interface ParsedRequest { kind: 'A' | 'W'; ident: string; region: string | null; force: boolean }

/** A parsed request, or the one-line reason it was refused. */
export function parseRequestBody(body: unknown): ParsedRequest | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object' };
  const b = body as Partial<NavdataRequestBody>;
  if (b.kind !== 'A' && b.kind !== 'W') return { error: "kind must be 'A' or 'W'" };
  const ident = typeof b.ident === 'string' ? b.ident.trim().toUpperCase() : '';
  if (!REQUEST_IDENT.test(ident)) return { error: 'ident must be 1-8 letters or digits' };
  let region: string | null = null;
  if (b.region != null && b.region !== '') {
    region = typeof b.region === 'string' ? b.region.trim().toUpperCase() : '';
    if (!REQUEST_REGION.test(region)) return { error: 'region must be 1-4 letters or digits' };
  }
  return { kind: b.kind, ident, region, force: b.force === true };
}

function isAbsent(nav: Database.Database, req: ParsedRequest): boolean {
  if (req.kind === 'A') {
    return Boolean(
      nav.prepare("SELECT 1 FROM nav_absent WHERE kind = 'A' AND ident = ?").get(req.ident) ||
        nav.prepare("SELECT 1 FROM nav_airport WHERE ident = ? AND detail_state = 'absent'").get(req.ident),
    );
  }
  return Boolean(
    req.region === null
      ? nav.prepare("SELECT 1 FROM nav_absent WHERE kind = 'W' AND ident = ?").get(req.ident)
      : nav.prepare("SELECT 1 FROM nav_absent WHERE kind = 'W' AND ident = ? AND region = ?").get(req.ident, req.region),
  );
}

function isHeld(nav: Database.Database, req: ParsedRequest): boolean {
  if (req.kind === 'A') {
    return Boolean(
      nav.prepare("SELECT 1 FROM nav_airport WHERE ident = ? AND detail_state IN ('detail', 'absent')").get(req.ident),
    );
  }
  const r = req.region;
  return Boolean(
    r === null
      ? nav.prepare('SELECT 1 FROM nav_waypoint WHERE ident = ?').get(req.ident) ||
          nav.prepare('SELECT 1 FROM nav_navaid WHERE ident = ?').get(req.ident)
      : nav.prepare('SELECT 1 FROM nav_waypoint WHERE ident = ? AND region = ?').get(req.ident, r) ||
          nav.prepare('SELECT 1 FROM nav_navaid WHERE ident = ? AND region = ?').get(req.ident, r),
  );
}

/**
 * Answers a manual request: a recorded absence wins over a held row (it is the
 * more specific fact), and either short-circuits unless force is set. Only
 * "queued" writes anything, and it writes flights.db, never the replica.
 */
export function submitRequest(nav: Database.Database | null, req: ParsedRequest): NavdataRequestResponse {
  if (nav && !req.force) {
    if (isAbsent(nav, req)) return { ok: true, state: 'known-absent', ident: req.ident };
    if (isHeld(nav, req)) return { ok: true, state: 'already-present', ident: req.ident };
  }
  upsertNavdataRequest(req.kind, req.ident, req.region);
  return { ok: true, state: 'queued', ident: req.ident };
}
