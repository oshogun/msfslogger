// The navdata replica schema, shipped as a constant because the production
// image copies only dist/ and a .sql file beside the sources would be missing
// there. Backticks in the SQL comments are escaped; the runtime string is the
// DDL as the sidecar defines it. The SHA-256 in the DDL header is of the
// peer's own file, not of this constant. Never add a column or table here.

import type Database from 'better-sqlite3';

export const NAVDATA_DDL = `-- msfslogger navdata schema — paste of the MCDU repo's authoritative copy.
-- Comments condensed by the server session; DDL is as received (parts 1-3).
-- Peer canonical file SHA-256 (of THEIR file, not this condensed copy): 3edefee0f1a0288070df14503d6a7f73de55f6816a078e3c986d876252474abe
-- Units: metres, degrees, whole hertz, epoch ms. lon in [-180,180].
-- Local-only data (Navigraph-derived): never committed, never in an image, never a fixture.
-- NAVDATA_SCHEMA_VERSION = 2. Requires SQLite >= 3.37 (STRICT).
--
-- A PEER WHOSE VERSION DIFFERS IS REFUSED, NOT RECONCILED. A v2 sender against
-- a v1 replica, or the reverse, is answered NAVDATA_SCHEMA_UNSUPPORTED and the
-- exchange stops; neither side may guess at a missing or surplus column. A LOCAL
-- file of the wrong version is a different matter: it is a rebuildable cache, so
-- it is renamed aside and recreated rather than refused forever.
--
-- v2 (2026-09-20): nav_runway gains primary_threshold_m / secondary_threshold_m.
-- v1: initial.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS nav_meta (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version     INTEGER NOT NULL,
  snapshot_id        TEXT    NOT NULL,
  rev                INTEGER NOT NULL DEFAULT 0,
  sim_id             TEXT    NOT NULL CHECK (sim_id IN ('2020','2024','fsx')),
  sim_app_name       TEXT,
  sim_app_version    TEXT,
  bulk_started_at    INTEGER,
  bulk_completed_at  INTEGER,
  bulk_row_count     INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
) STRICT;

-- Sidecar-only; kept so the file stays one artifact.
CREATE TABLE IF NOT EXISTS nav_sync (
  server_url       TEXT PRIMARY KEY,
  snapshot_id      TEXT,
  acked_rev        INTEGER NOT NULL DEFAULT 0,
  state            TEXT    NOT NULL DEFAULT 'idle'
                     CHECK (state IN ('idle','snapshot-required','snapshot-sending',
                                      'incremental','resync-required','failed')),
  last_ok_at       INTEGER,
  last_error_at    INTEGER,
  last_error_code  TEXT,
  updated_at       INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- KEY: ident alone (all 41871 bulk rows have empty region, idents distinct).
CREATE TABLE IF NOT EXISTS nav_airport (
  ident              TEXT PRIMARY KEY,
  region             TEXT NOT NULL DEFAULT '',
  lat                REAL,
  lon                REAL,
  alt_m              REAL,
  magvar             REAL,
  name               TEXT,
  n_runways          INTEGER,
  n_approaches       INTEGER,
  n_departures       INTEGER,
  n_arrivals         INTEGER,
  detail_state       TEXT NOT NULL DEFAULT 'index'
                       CHECK (detail_state IN ('index','pending','detail','absent','failed')),
  detail_fetched_at  INTEGER,
  detail_runways     INTEGER NOT NULL DEFAULT 0,
  detail_procedures  INTEGER NOT NULL DEFAULT 0,
  position_source    TEXT CHECK (position_source IN ('list','minimal','facility')),
  rev                INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_airport_bbox ON nav_airport (lat, lon);
CREATE INDEX IF NOT EXISTS nav_airport_rev  ON nav_airport (rev);
CREATE INDEX IF NOT EXISTS nav_airport_pending
  ON nav_airport (detail_state) WHERE detail_state = 'pending';

-- KEY: (kind, ident, region) = the REQUEST key — deliberately different from
-- nav_waypoint's position-qualified key. A VOR's facility data carries NO
-- LATITUDE/LONGITUDE/ALTITUDE on this build (rejected outright), so a position
-- key would be uncomputable from the very message that must merge into the row.
-- requestFacilityData names a navaid by ident+region+type only, so anything
-- finer could never be re-fetched. kind is in the key because a VOR and an NDB
-- routinely share an ident in a region. Measured: 59 VORs in the RJ bubble, 59
-- distinct idents. Position (list/minimal) and detail (facility data) arrive
-- from different calls in either order: every non-identity column is nullable
-- and a present position is never overwritten with null.
CREATE TABLE IF NOT EXISTS nav_navaid (
  kind               TEXT NOT NULL CHECK (kind IN ('V','N')),
  ident              TEXT NOT NULL,
  region             TEXT NOT NULL,
  lat                REAL,
  lon                REAL,
  alt_m              REAL,
  position_source    TEXT CHECK (position_source IN ('list','minimal','facility')),
  position_fetched_at INTEGER,
  frequency_hz       INTEGER,
  nav_type           INTEGER,
  name               TEXT,
  magvar             REAL,
  nav_range_m        REAL,
  is_nav             INTEGER CHECK (is_nav IN (0,1)),
  is_dme             INTEGER CHECK (is_dme IN (0,1)),
  is_tacan           INTEGER CHECK (is_tacan IN (0,1)),
  has_glide_slope    INTEGER CHECK (has_glide_slope IN (0,1)),
  has_back_course    INTEGER CHECK (has_back_course IN (0,1)),
  dme_at_nav         INTEGER CHECK (dme_at_nav IN (0,1)),
  dme_at_glide_slope INTEGER CHECK (dme_at_glide_slope IN (0,1)),
  localizer_deg      REAL,
  localizer_width_deg REAL,
  gs_lat             REAL,
  gs_lon             REAL,
  gs_alt_m           REAL,
  dme_lat            REAL,
  dme_lon            REAL,
  dme_alt_m          REAL,
  tacan_lat          REAL,
  tacan_lon          REAL,
  tacan_alt_m        REAL,
  airport_ident      TEXT,
  detail_state       TEXT NOT NULL DEFAULT 'index'
                       CHECK (detail_state IN ('index','pending','detail','absent','failed')),
  detail_fetched_at  INTEGER,
  ambiguous          INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0,1)),
  rev                INTEGER NOT NULL,
  PRIMARY KEY (kind, ident, region)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_navaid_bbox  ON nav_navaid (lat, lon);
CREATE INDEX IF NOT EXISTS nav_navaid_rev   ON nav_navaid (rev);
CREATE INDEX IF NOT EXISTS nav_navaid_ident ON nav_navaid (ident);

-- KEY: wpt_key = ident|region|round(lat*1e5)|round(lon*1e5), ~1.1 m resolution.
-- Measured: one ~350 km bubble returned 1349 waypoints with 1338 distinct idents
-- (LOC10 x3, 36LOC x2, CS25 x2 ...), all duplicates in ONE region (RJ), so
-- (ident,region) is NOT unique. Only the owning airport separates them, and an
-- airport-scoped key is UNFILLABLE: list/subscribe rows carry no airport,
-- requestFacilityData(WAYPOINT) has no airport member and cannot be addressed by
-- one; only facilityMinimalList carries Icao.airport, and only for ambiguous
-- idents. Position is present on every source path (list, minimal, facility,
-- ROUTE endpoints). Never merges two real fixes, never splits one.
-- airport_ident is advisory (labels), never a key.
CREATE TABLE IF NOT EXISTS nav_waypoint (
  wpt_key            TEXT PRIMARY KEY,
  ident              TEXT NOT NULL,
  region             TEXT NOT NULL,
  lat                REAL NOT NULL,
  lon                REAL NOT NULL,
  alt_m              REAL,
  magvar             REAL,
  wpt_type           INTEGER,
  is_terminal        INTEGER CHECK (is_terminal IN (0,1)),
  airport_ident      TEXT,
  n_routes           INTEGER,
  routes_state       TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (routes_state IN ('unknown','pending','fetched','absent','failed')),
  routes_fetched_at  INTEGER,
  position_source    TEXT CHECK (position_source IN ('list','minimal','facility','route')),
  rev                INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_waypoint_bbox  ON nav_waypoint (lat, lon);
CREATE INDEX IF NOT EXISTS nav_waypoint_ident ON nav_waypoint (ident, region);
CREATE INDEX IF NOT EXISTS nav_waypoint_rev   ON nav_waypoint (rev);
CREATE INDEX IF NOT EXISTS nav_waypoint_unrouted
  ON nav_waypoint (routes_state) WHERE routes_state = 'unknown';

-- KEY: leg_key = airway|lo|hi, (lo,hi) = the two endpoint wpt_keys ordered by JS \`<\`.
-- Direction not stored. dateline = 1 when |from_lon - to_lon| > 180; then
-- min_lon/max_lon are meaningless and bbox tests must be latitude-only for the row.
CREATE TABLE IF NOT EXISTS nav_airway_leg (
  leg_key        TEXT PRIMARY KEY,
  airway         TEXT NOT NULL,
  airway_type    INTEGER,
  from_key       TEXT NOT NULL,
  to_key         TEXT NOT NULL,
  from_ident     TEXT NOT NULL,
  from_region    TEXT NOT NULL,
  from_lat       REAL NOT NULL,
  from_lon       REAL NOT NULL,
  to_ident       TEXT NOT NULL,
  to_region      TEXT NOT NULL,
  to_lat         REAL NOT NULL,
  to_lon         REAL NOT NULL,
  min_lat        REAL NOT NULL,
  max_lat        REAL NOT NULL,
  min_lon        REAL NOT NULL,
  max_lon        REAL NOT NULL,
  dateline       INTEGER NOT NULL DEFAULT 0 CHECK (dateline IN (0,1)),
  rev            INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_airway_leg_name ON nav_airway_leg (airway);
CREATE INDEX IF NOT EXISTS nav_airway_leg_from ON nav_airway_leg (from_key);
CREATE INDEX IF NOT EXISTS nav_airway_leg_to   ON nav_airway_leg (to_key);
CREATE INDEX IF NOT EXISTS nav_airway_leg_bbox ON nav_airway_leg (min_lat, max_lat);
CREATE INDEX IF NOT EXISTS nav_airway_leg_rev  ON nav_airway_leg (rev);
CREATE INDEX IF NOT EXISTS nav_airway_leg_dateline
  ON nav_airway_leg (dateline) WHERE dateline = 1;

-- One row per physical runway; lat/lon/alt = centre; thresholds derived by consumer.
CREATE TABLE IF NOT EXISTS nav_runway (
  rwy_key                 TEXT PRIMARY KEY,
  airport_ident           TEXT NOT NULL,
  lat                     REAL,
  lon                     REAL,
  alt_m                   REAL,
  heading_deg             REAL,
  length_m                REAL,
  width_m                 REAL,
  -- Displaced threshold, in metres from the pavement end, per end. NULL and 0
  -- both mean not displaced. MEASURED: displaced thresholds are non-zero on
  -- real runways, and length_m INCLUDES the displaced portions, so the usable
  -- length is shorter than length_m. An instrument final is
  -- referenced to the LANDING threshold, so a final projected from the pavement
  -- end starts ~200 m off on such a runway. Derivation:
  --   pavement end      = lat/lon (the CENTRE) +/- length_m/2 along the bearing
  --   landing threshold = that point moved INBOARD by the matching value here
  -- primary_* pairs with the primary end, i.e. the heading_deg direction.
  -- PROVISIONAL: that pairing is confirmed by arithmetic on ONE runway (the
  -- only non-zero sample so far) plus the member naming.
  primary_threshold_m     REAL,
  secondary_threshold_m   REAL,
  pattern_altitude_m      REAL,
  slope_deg               REAL,
  true_slope_deg          REAL,
  surface                 INTEGER,
  primary_number          INTEGER,
  primary_designator      INTEGER,
  secondary_number        INTEGER,
  secondary_designator    INTEGER,
  primary_ils_ident       TEXT,
  primary_ils_region      TEXT,
  secondary_ils_ident     TEXT,
  secondary_ils_region    TEXT,
  rev                     INTEGER NOT NULL,
  FOREIGN KEY (airport_ident) REFERENCES nav_airport (ident) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_runway_airport ON nav_runway (airport_ident);
CREATE INDEX IF NOT EXISTS nav_runway_bbox    ON nav_runway (lat, lon);
CREATE INDEX IF NOT EXISTS nav_runway_rev     ON nav_runway (rev);

CREATE TABLE IF NOT EXISTS nav_airport_frequency (
  freq_key       TEXT PRIMARY KEY,   -- airport_ident || '|' || type || '|' || frequency_hz
  airport_ident  TEXT NOT NULL,
  freq_type      INTEGER,
  frequency_hz   INTEGER,
  name           TEXT,
  rev            INTEGER NOT NULL,
  FOREIGN KEY (airport_ident) REFERENCES nav_airport (ident) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_airport_frequency_airport ON nav_airport_frequency (airport_ident);
CREATE INDEX IF NOT EXISTS nav_airport_frequency_rev     ON nav_airport_frequency (rev);

-- KEY: airport|kind|name|runway_number|runway_designator|suffix, NULLs as ''.
CREATE TABLE IF NOT EXISTS nav_procedure (
  proc_key                TEXT PRIMARY KEY,
  airport_ident           TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('SID','STAR','APPROACH')),
  name                    TEXT NOT NULL,
  runway_number           INTEGER,
  runway_designator       INTEGER,
  approach_type           INTEGER,
  suffix                  TEXT,
  faf_ident               TEXT,
  faf_region              TEXT,
  faf_alt_m               REAL,
  faf_heading_deg         REAL,
  missed_alt_m            REAL,
  has_lnav                INTEGER CHECK (has_lnav IN (0,1)),
  has_lnavvnav            INTEGER CHECK (has_lnavvnav IN (0,1)),
  has_lp                  INTEGER CHECK (has_lp IN (0,1)),
  has_lpv                 INTEGER CHECK (has_lpv IN (0,1)),
  n_transitions           INTEGER,
  n_runway_transitions    INTEGER,
  n_enroute_transitions   INTEGER,
  rev                     INTEGER NOT NULL,
  FOREIGN KEY (airport_ident) REFERENCES nav_airport (ident) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_procedure_airport ON nav_procedure (airport_ident, kind);
CREATE INDEX IF NOT EXISTS nav_procedure_name    ON nav_procedure (airport_ident, kind, name);
CREATE INDEX IF NOT EXISTS nav_procedure_rev     ON nav_procedure (rev);

-- Every leg list hangs off one of these. A SID/STAR's common legs are stored with
-- role='common', name=''. Roles: common|runway|enroute|approach|final|missed.
CREATE TABLE IF NOT EXISTS nav_procedure_transition (
  trans_key           TEXT PRIMARY KEY,  -- proc_key || '|' || role || '|' || name
  proc_key            TEXT NOT NULL,
  role                TEXT NOT NULL
                        CHECK (role IN ('common','runway','enroute','approach','final','missed')),
  name                TEXT NOT NULL DEFAULT '',
  runway_number       INTEGER,
  runway_designator   INTEGER,
  trans_type          INTEGER,
  iaf_ident           TEXT,
  iaf_region          TEXT,
  iaf_alt_m           REAL,
  dme_arc_ident       TEXT,
  dme_arc_region      TEXT,
  dme_arc_radial_deg  REAL,
  dme_arc_distance_m  REAL,
  n_legs              INTEGER,
  rev                 INTEGER NOT NULL,
  FOREIGN KEY (proc_key) REFERENCES nav_procedure (proc_key) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_procedure_transition_proc ON nav_procedure_transition (proc_key);
CREATE INDEX IF NOT EXISTS nav_procedure_transition_rev  ON nav_procedure_transition (rev);

-- seq = 0-based order the simulator sent legs within the parent; the ONLY ordering.
-- leg_type: 0 UNKNOWN 1 AF 2 CA 3 CD 4 CF 5 CI 6 CR 7 DF 8 FA 9 FC 10 FD 11 FM
-- 12 HA 13 HF 14 HM 15 IF 16 PI 17 RF 18 TF 19 VA 20 VD 21 VI 22 VM 23 VR.
-- Which of those carry a drawable coordinate is a consumer rule, not a schema
-- rule, and both repos MUST classify identically:
--   coordinate-bearing  1 AF, 4 CF, 7 DF, 13 HF, 15 IF, 16 PI, 17 RF, 18 TF
--   coordinate-less     everything else — they terminate on a heading,
--                       altitude, intercept, radial, DME distance or a manual
--                       termination, so there is no end coordinate to draw.
-- Coordinate-less legs are COUNTED and reported, never synthesised.
CREATE TABLE IF NOT EXISTS nav_procedure_leg (
  trans_key             TEXT NOT NULL,
  seq                   INTEGER NOT NULL,
  leg_type              INTEGER NOT NULL,
  fix_ident             TEXT,
  fix_region            TEXT,
  fix_type              TEXT,
  fix_lat               REAL,
  fix_lon               REAL,
  fix_alt_m             REAL,
  origin_ident          TEXT,
  origin_region         TEXT,
  origin_type           TEXT,
  origin_lat            REAL,
  origin_lon            REAL,
  origin_alt_m          REAL,
  arc_center_ident      TEXT,
  arc_center_region     TEXT,
  arc_center_type       TEXT,
  arc_center_lat        REAL,
  arc_center_lon        REAL,
  arc_center_alt_m      REAL,
  fly_over              INTEGER CHECK (fly_over IN (0,1)),
  turn_direction        INTEGER,
  course_deg            REAL,
  true_degree           INTEGER CHECK (true_degree IN (0,1)),
  theta_deg             REAL,
  rho_m                 REAL,
  distance_minute       REAL,
  route_distance_m      REAL,
  alt_desc              INTEGER,
  altitude1_m           REAL,
  altitude2_m           REAL,
  speed_limit_kt        REAL,
  vertical_angle_deg    REAL,
  is_iaf                INTEGER CHECK (is_iaf IN (0,1)),
  is_if                 INTEGER CHECK (is_if IN (0,1)),
  is_faf                INTEGER CHECK (is_faf IN (0,1)),
  is_map                INTEGER CHECK (is_map IN (0,1)),
  rev                   INTEGER NOT NULL,
  PRIMARY KEY (trans_key, seq),
  FOREIGN KEY (trans_key) REFERENCES nav_procedure_transition (trans_key) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_procedure_leg_rev ON nav_procedure_leg (rev);

-- WHY 0.5 DEG, NOT 1: the prototype falsified 1 deg. With 1-degree cells and the
-- all-four-corners test, a 200 km sweep records only 8 cells; at 0.5 deg it
-- records ~33 (36 in the validator) and about two thirds of the disc. Coarsening
-- the grid to save rows silently discards most of each sweep. Finer buys little.
-- Bubble radii measured: 346 km WAYPOINT, 308 km VOR, 305 km AIRPORT (200 km is
-- a conservative inner bound).
-- Area-shaped coverage for the bubble harvest. Fixed global 0.5 deg grid:
--   cell_id = floor((lat+90)*2)*720 + floor((lon+180)*2), 0..259199.
-- A cell is harvested for a kind when all four corners were within
-- NAV_HARVEST_RADIUS_KM (200) of the aircraft. row_count = 0 with non-NULL
-- harvested_at means "harvested, genuinely nothing here".
CREATE TABLE IF NOT EXISTS nav_coverage_cell (
  kind           TEXT NOT NULL CHECK (kind IN ('V','N','W')),
  cell_id        INTEGER NOT NULL CHECK (cell_id BETWEEN 0 AND 259199),
  harvested_at   INTEGER NOT NULL,
  harvest_count  INTEGER NOT NULL DEFAULT 1,
  row_count      INTEGER NOT NULL DEFAULT 0,
  rev            INTEGER NOT NULL,
  PRIMARY KEY (kind, cell_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_coverage_cell_id  ON nav_coverage_cell (cell_id);
CREATE INDEX IF NOT EXISTS nav_coverage_cell_rev ON nav_coverage_cell (rev);

-- "This simulator does not have this facility." Valid only within the current
-- snapshot_id; deleted wholesale on a new epoch (absence is a claim about one
-- install at one AIRAC). WHY \`reason\` EXISTS: measured, an ident with no match
-- produces SILENCE — no facilityData, no facilityDataEnd, no minimal list, no
-- exception. A per-request timeout with zero messages is the only possible
-- detector, which is weaker evidence than an exception and must be re-checkable:
-- 'silent' (timeout) vs 'exception'.
CREATE TABLE IF NOT EXISTS nav_absent (
  kind             TEXT NOT NULL CHECK (kind IN ('A','V','N','W')),
  ident            TEXT NOT NULL,
  region           TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL CHECK (reason IN ('silent','exception')),
  first_seen_at    INTEGER NOT NULL,
  last_checked_at  INTEGER NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 1,
  rev              INTEGER NOT NULL,
  PRIMARY KEY (kind, ident, region)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nav_absent_rev ON nav_absent (rev);
`;

export function applyNavdataSchema(db: Database.Database): void {
  db.exec(NAVDATA_DDL);
}
