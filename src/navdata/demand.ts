// ── What the sidecar should fetch next ────────────────────────────────────────
//
// There is no queue table in the replica: the demand response is the current
// need, recomputed on every poll. A facility is wanted when a planned leg the
// server would draw refers to it, the replica holds no usable row for it, and
// nothing has recorded it as missing from the simulator.
//
// "A planned leg the server would draw" is not "a leg not yet flown": every
// planned leg on this machine is already flown, and a not-yet-flown rule would
// make demand permanently empty. It is, in order, the manual requests, then
// every leg of the active trip whatever its status, then the legs still marked
// planned.

import type Database from 'better-sqlite3';
import { getDb } from '../db/connection';
import {
  deleteNavdataRequestById,
  listNavdataRequests,
  pruneExpiredNavdataRequests,
  type NavdataRequestRow,
} from '../db/navdataRequests';
import { getNavDb } from './connection';
import type { DemandResponse, DemandWaypoint } from './wire';

/** Planned legs looked at per poll, so the scan cost cannot grow without bound. */
export const NAVDATA_DEMAND_LEG_SCAN = 200;
/** Facilities returned per poll. Echoed in the response so the sidecar need not hardcode it. */
export const NAVDATA_DEMAND_CAP = 50;

/** Planned-waypoint types that name a simulator facility. USER never does. */
const WAYPOINT_TYPES: ReadonlySet<string> = new Set(['WAYPOINT', 'VOR', 'NDB']);

interface DemandLeg {
  id: number;
  departure_ident: string;
  departure_is_airport: number;
  destination_ident: string;
  destination_is_airport: number;
}

interface PlannedWaypointRow {
  ident: string;
  region: string | null;
  type: string;
}

type Want = { kind: 'A'; ident: string; region: null } | { kind: 'W'; ident: string; region: string | null };

const LEG_COLUMNS =
  'pl.id, pl.departure_ident, pl.departure_is_airport, pl.destination_ident, pl.destination_is_airport';

const ACTIVE_TRIP_LEGS = `
  SELECT ${LEG_COLUMNS}
  FROM planned_legs pl
  JOIN trips t ON t.id = pl.trip_id AND t.is_active = 1
  ORDER BY pl.seq ASC, pl.id ASC
  LIMIT ?`;

const PLANNED_LEGS = `
  SELECT ${LEG_COLUMNS}
  FROM planned_legs pl
  LEFT JOIN trips t ON t.id = pl.trip_id
  WHERE pl.status = 'planned' AND COALESCE(t.is_active, 0) = 0
  ORDER BY pl.imported_at DESC, pl.id DESC
  LIMIT ?`;

const normIdent = (ident: string): string => ident.trim().toUpperCase();

function normRegion(region: string | null | undefined): string | null {
  const r = region == null ? '' : region.trim().toUpperCase();
  return r === '' ? null : r;
}

/**
 * Point lookups that decide whether a facility still needs fetching. Prepared
 * once per poll against one replica handle; the caller must not yield while
 * this object is alive, or a swap could pull the file out from under it.
 */
class Satisfaction {
  private readonly airportDetail;
  private readonly airportAbsent;
  private readonly waypointAny;
  private readonly waypointInRegion;
  private readonly navaidAny;
  private readonly navaidInRegion;
  private readonly waypointAbsentAny;
  private readonly waypointAbsentInRegion;

  constructor(nav: Database.Database) {
    this.airportDetail = nav.prepare(
      "SELECT 1 FROM nav_airport WHERE ident = ? AND detail_state IN ('detail', 'absent')",
    );
    this.airportAbsent = nav.prepare("SELECT 1 FROM nav_absent WHERE kind = 'A' AND ident = ?");
    this.waypointAny = nav.prepare('SELECT 1 FROM nav_waypoint WHERE ident = ?');
    this.waypointInRegion = nav.prepare('SELECT 1 FROM nav_waypoint WHERE ident = ? AND region = ?');
    this.navaidAny = nav.prepare('SELECT 1 FROM nav_navaid WHERE ident = ?');
    this.navaidInRegion = nav.prepare('SELECT 1 FROM nav_navaid WHERE ident = ? AND region = ?');
    this.waypointAbsentAny = nav.prepare("SELECT 1 FROM nav_absent WHERE kind = 'W' AND ident = ?");
    this.waypointAbsentInRegion = nav.prepare("SELECT 1 FROM nav_absent WHERE kind = 'W' AND ident = ? AND region = ?");
  }

  holds(want: Want): boolean {
    if (want.kind === 'A') {
      // An index-only row is not enough: the detail is the point, and it is
      // what makes a custom procedure drawable.
      return Boolean(this.airportDetail.get(want.ident) || this.airportAbsent.get(want.ident));
    }
    const region = want.region;
    if (region === null) {
      return Boolean(
        this.waypointAny.get(want.ident) ||
          this.navaidAny.get(want.ident) ||
          this.waypointAbsentAny.get(want.ident),
      );
    }
    return Boolean(
      this.waypointInRegion.get(want.ident, region) ||
        this.navaidInRegion.get(want.ident, region) ||
        this.waypointAbsentInRegion.get(want.ident, region),
    );
  }
}

function legWants(db: Database.Database, leg: DemandLeg): Want[] {
  const wants: Want[] = [];
  if (leg.departure_is_airport) wants.push({ kind: 'A', ident: normIdent(leg.departure_ident), region: null });

  const waypoints = db
    .prepare('SELECT ident, region, type FROM planned_waypoints WHERE planned_leg_id = ? ORDER BY seq ASC')
    .all(leg.id) as PlannedWaypointRow[];
  for (const w of waypoints) {
    const type = (w.type ?? '').trim().toUpperCase();
    if (type === 'AIRPORT') {
      wants.push({ kind: 'A', ident: normIdent(w.ident), region: null });
    } else if (WAYPOINT_TYPES.has(type)) {
      wants.push({ kind: 'W', ident: normIdent(w.ident), region: normRegion(w.region) });
    }
  }

  if (leg.destination_is_airport) wants.push({ kind: 'A', ident: normIdent(leg.destination_ident), region: null });

  const alternates = db
    .prepare('SELECT ident FROM planned_alternates WHERE planned_leg_id = ? ORDER BY seq ASC')
    .all(leg.id) as { ident: string }[];
  // Alternates are airports the aircraft might actually land at.
  for (const a of alternates) wants.push({ kind: 'A', ident: normIdent(a.ident), region: null });

  return wants;
}

function scanLegs(db: Database.Database): DemandLeg[] {
  const active = db.prepare(ACTIVE_TRIP_LEGS).all(NAVDATA_DEMAND_LEG_SCAN) as DemandLeg[];
  const remaining = NAVDATA_DEMAND_LEG_SCAN - active.length;
  if (remaining <= 0) return active;
  const planned = db.prepare(PLANNED_LEGS).all(remaining) as DemandLeg[];
  return active.concat(planned);
}

function wantOfRequest(row: NavdataRequestRow): Want {
  return row.kind === 'A'
    ? { kind: 'A', ident: normIdent(row.ident), region: null }
    : { kind: 'W', ident: normIdent(row.ident), region: normRegion(row.region) };
}

/**
 * The current need. Manual requests come first and are deleted as soon as the
 * replica can answer them — the replica is the only record of what is held, so
 * the request row is an intent and nothing more.
 */
export function buildDemand(now: Date = new Date()): DemandResponse {
  pruneExpiredNavdataRequests(now);
  const db = getDb();
  const nav = getNavDb();
  const satisfaction = nav ? new Satisfaction(nav) : null;
  // With no replica everything is wanted, which is what bootstraps the first harvest.
  const holds = (want: Want): boolean => (satisfaction ? satisfaction.holds(want) : false);

  const airports: string[] = [];
  const waypoints: DemandWaypoint[] = [];
  const seen = new Set<string>();
  let more = false;

  const push = (want: Want): 'added' | 'duplicate' | 'capped' => {
    const key = `${want.kind}|${want.ident}|${want.region ?? ''}`;
    if (seen.has(key)) return 'duplicate';
    if (airports.length + waypoints.length >= NAVDATA_DEMAND_CAP) return 'capped';
    seen.add(key);
    if (want.kind === 'A') airports.push(want.ident);
    else if (want.region === null) waypoints.push({ ident: want.ident });
    else waypoints.push({ ident: want.ident, region: want.region });
    return 'added';
  };

  for (const request of listNavdataRequests(now)) {
    const want = wantOfRequest(request);
    if (holds(want)) {
      deleteNavdataRequestById(request.id);
      continue;
    }
    if (push(want) === 'capped') more = true;
  }

  for (const leg of scanLegs(db)) {
    let capped = false;
    for (const want of legWants(db, leg)) {
      if (holds(want)) continue;
      if (push(want) === 'capped') {
        more = true;
        capped = true;
        break;
      }
    }
    if (capped) break;
  }

  return {
    v: 1,
    airports,
    waypoints,
    cap: NAVDATA_DEMAND_CAP,
    more,
    generatedAt: now.getTime(),
  };
}
