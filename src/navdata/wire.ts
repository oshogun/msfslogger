// Wire types shared with the MCDU sidecar. snake_case on sync rows.

export const NAVDATA_SCHEMA_VERSION = 2;
export const NAVDATA_WIRE_VERSION = 1;

export type SnapshotId = string;
export type Rev = number;
export type FacilityKind = 'A' | 'V' | 'N' | 'W';
export type DetailState = 'index' | 'pending' | 'detail' | 'absent' | 'failed';
export type TransitionRole = 'common' | 'runway' | 'enroute' | 'approach' | 'final' | 'missed';

export type NavRowType =
  | 'airport' | 'navaid' | 'waypoint' | 'airway_leg' | 'runway' | 'frequency'
  | 'procedure' | 'procedure_transition' | 'procedure_leg' | 'coverage_cell' | 'absent';

/** Emission order in a snapshot, parents first. Also the apply order for a batch. */
export const NAV_ROW_ORDER: readonly NavRowType[] = [
  'airport', 'navaid', 'waypoint', 'airway_leg', 'runway', 'frequency',
  'procedure', 'procedure_transition', 'procedure_leg', 'coverage_cell', 'absent',
];

/** One row as it arrives. `r` keys are the DDL column names, snake_case,
 *  nullability = DDL, `rev` present on every row. The server validates by
 *  column name against its own column list per table rather
 *  than by a hand-written per-table interface. */
export interface NavRow {
  t: NavRowType;
  r: Record<string, string | number | null>;
}

export interface SnapshotHeaderLine {
  kind: 'header'; v: 1; schemaVersion: 2;
  snapshotId: SnapshotId; rev: Rev;
  simId: '2020' | '2024' | 'fsx';
  simAppName: string | null; simAppVersion: string | null;
  sidecarVersion: string; createdAt: number;
  counts: Partial<Record<NavRowType, number>>;
}
export interface SnapshotFooterLine {
  kind: 'footer'; rows: number; counts: Partial<Record<NavRowType, number>>;
}
export interface SnapshotAck {
  ok: true; snapshotId: SnapshotId; rev: Rev;
  counts: Partial<Record<NavRowType, number>>; appliedAt: number;
}
export interface IncrementalBatch {
  v: 1; schemaVersion: 2; snapshotId: SnapshotId;
  fromRev: Rev; toRev: Rev; rows: NavRow[]; more: boolean;
}
export interface IncrementalAck { ok: true; snapshotId: SnapshotId; rev: Rev; applied: number; }

export type SidecarState = 'nav.off' | 'nav.unavailable' | 'nav.bulk' | 'nav.ready' | 'nav.error';

/** POST /api/navdata/state body. */
export interface SidecarStateReport {
  v: 1; state: SidecarState; reason: string | null;
  snapshotId: SnapshotId | null; rev: Rev | null; sentAt: number;
}

export type NavdataErrorCode =
  | 'NAVDATA_SNAPSHOT_MISMATCH' | 'NAVDATA_SCHEMA_UNSUPPORTED'
  | 'NAVDATA_BAD_BATCH' | 'NAVDATA_TOO_LARGE' | 'NAVDATA_BUSY';

export interface NavdataError {
  ok: false; code: NavdataErrorCode; message: string;
  serverSnapshotId?: SnapshotId | null; serverRev?: Rev; serverSchemaVersion?: number;
}

/**
 * One waypoint-shaped facility wanted. `kind` is 'W' for a fix, 'V' for a VOR and
 * 'N' for an NDB; omitted means 'W'. A VOR and a fix may share an ident and are
 * separate entries.
 */
export interface DemandWaypoint { ident: string; region?: string | null; kind?: 'W' | 'V' | 'N'; }
export interface DemandResponse {
  v: 1; airports: string[]; waypoints: DemandWaypoint[];
  cap: number; more: boolean; generatedAt: number;
}
export interface NavdataRequestBody { kind: 'A' | 'W'; ident: string; region?: string | null; force?: boolean; }
export interface NavdataRequestResponse { ok: true; state: 'queued' | 'already-present' | 'known-absent'; ident: string; }
