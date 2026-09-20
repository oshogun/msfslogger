// A real scratch flights.db and a real scratch replica, never the live files.
// Synthetic idents and coordinates only.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { applyNavdataSchema } from '../src/navdata/schema';
import { applyNavRows } from '../src/navdata/store';
import {
  closeNavDb,
  incomingNavdataPath,
  openNavdata,
  resolveNavdataPath,
  swapInReplica,
} from '../src/navdata/connection';
import { buildDemand, NAVDATA_DEMAND_CAP, NAVDATA_DEMAND_LEG_SCAN } from '../src/navdata/demand';
import { listNavdataRequests, upsertNavdataRequest } from '../src/db/navdataRequests';
import { wptKey } from '../src/navdata/keys';
import type { NavRow, NavRowType } from '../src/navdata/wire';
import { createScratchDb, destroyScratchDb, seedPlannedLeg, seedTrip, type ScratchDb } from './helpers/db';

let scratch: ScratchDb;
const savedEnv = process.env.NAVDATA_DB_PATH;
const NOW = new Date('2026-02-01T09:00:00.000Z');

type Row = Record<string, string | number | null>;
const row = (t: NavRowType, r: Row): NavRow => ({ t, r: { rev: 1, ...r } });

const airport = (ident: string, detailState = 'detail'): NavRow =>
  row('airport', { ident, lat: 10, lon: 20, detail_state: detailState });
const waypoint = (ident: string, region = 'ZZ'): NavRow =>
  row('waypoint', { wpt_key: wptKey(ident, region, 11, 21), ident, region, lat: 11, lon: 21 });
const navaid = (ident: string, region = 'ZZ'): NavRow =>
  row('navaid', { kind: 'V', ident, region, lat: 12, lon: 22, position_source: 'list' });
const absent = (kind: 'A' | 'W', ident: string, region = ''): NavRow =>
  row('absent', { kind, ident, region, reason: 'silent', first_seen_at: 1_000, last_checked_at: 1_000 });

/** Builds a replica file from scratch and leaves it open as the live one. */
function setReplica(rows: NavRow[], snapshotId = 'epoch-1'): void {
  closeNavDb();
  const file = resolveNavdataPath();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  writeReplica(file, rows, snapshotId);
  openNavdata();
}

function writeReplica(file: string, rows: NavRow[], snapshotId: string): void {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyNavdataSchema(db);
  db.prepare(
    'INSERT INTO nav_meta (id, schema_version, snapshot_id, sim_id, created_at, updated_at)' +
      " VALUES (1, 2, ?, '2024', 1, 1) ON CONFLICT (id) DO UPDATE SET snapshot_id = excluded.snapshot_id",
  ).run(snapshotId);
  if (rows.length > 0) applyNavRows(db, rows);
  db.close();
}

interface SeedWaypoint {
  ident: string;
  type: string;
  region?: string | null;
}

function seedWaypoints(legId: number, list: SeedWaypoint[]): void {
  const stmt = scratch.db.prepare(
    'INSERT INTO planned_waypoints (planned_leg_id, seq, ident, region, type, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  list.forEach((w, i) => stmt.run(legId, i + 1, w.ident, w.region ?? null, w.type, 11 + i * 0.1, 21 + i * 0.1));
}

function seedAlternates(legId: number, idents: string[]): void {
  const stmt = scratch.db.prepare(
    'INSERT INTO planned_alternates (planned_leg_id, seq, ident, type) VALUES (?, ?, ?, ?)',
  );
  idents.forEach((ident, i) => stmt.run(legId, i + 1, ident, 'AIRPORT'));
}

/** A leg from ZZAA to ZZAB, on no trip and already flown unless told otherwise. */
function seedLeg(over: Partial<Parameters<typeof seedPlannedLeg>[1]> = {}): number {
  return seedPlannedLeg(scratch.db, {
    trip_id: null,
    status: 'flown',
    departure_ident: 'ZZAA',
    departure_lat: 10,
    departure_lon: 20,
    departure_is_airport: 1,
    destination_ident: 'ZZAB',
    destination_lat: 11,
    destination_lon: 21,
    destination_is_airport: 1,
    ...over,
  });
}

beforeEach(() => {
  scratch = createScratchDb();
  process.env.NAVDATA_DB_PATH = path.join(scratch.dir, 'navdata.db');
  openNavdata();
});

afterEach(() => {
  closeNavDb();
  destroyScratchDb(scratch);
  if (savedEnv === undefined) delete process.env.NAVDATA_DB_PATH;
  else process.env.NAVDATA_DB_PATH = savedEnv;
});

describe('demand from planned legs', () => {
  it('wants only what the replica does not already answer', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    const leg = seedLeg({ trip_id: trip, departure_is_airport: 0, destination_is_airport: 0 });
    seedWaypoints(leg, [
      { ident: 'TESTA', type: 'WAYPOINT' },
      { ident: 'NOTHR', type: 'WAYPOINT' },
      { ident: 'NEVER', type: 'WAYPOINT' },
    ]);
    setReplica([waypoint('TESTA'), absent('W', 'NOTHR')]);

    const demand = buildDemand(NOW);

    expect(demand.waypoints).toEqual([{ ident: 'NEVER' }]);
    expect(demand).toMatchObject({ v: 1, airports: [], cap: NAVDATA_DEMAND_CAP, more: false, generatedAt: NOW.getTime() });
  });

  it('never demands a USER waypoint', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    const leg = seedLeg({ trip_id: trip, departure_is_airport: 0, destination_is_airport: 0 });
    seedWaypoints(leg, [
      { ident: 'ZZUSR', type: 'USER' },
      { ident: 'ZZVOR', type: 'VOR' },
      { ident: 'ZZNDB', type: 'NDB' },
      { ident: 'ZZAPT', type: 'AIRPORT' },
      { ident: 'ZZUNK', type: 'UNKNOWN' },
    ]);
    setReplica([]);

    const demand = buildDemand(NOW);

    expect(demand.waypoints.map(w => w.ident)).toEqual(['ZZVOR', 'ZZNDB']);
    expect(demand.airports).toEqual(['ZZAPT']);
  });

  it('still wants an airport the replica only holds an index row for', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    seedLeg({ trip_id: trip });
    seedAlternates(seedLeg({ trip_id: trip, seq: 2, departure_ident: 'ZZAC', destination_ident: 'ZZAD' }), ['ZZALT']);
    setReplica([airport('ZZAA', 'index'), airport('ZZAB', 'detail'), absent('A', 'ZZAC')]);

    expect(buildDemand(NOW).airports).toEqual(['ZZAA', 'ZZAD', 'ZZALT']);
  });

  it('matches a waypoint on region only when the plan names one', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    const leg = seedLeg({ trip_id: trip, departure_is_airport: 0, destination_is_airport: 0 });
    seedWaypoints(leg, [
      { ident: 'ZZFIX', type: 'WAYPOINT', region: 'YY' },
      { ident: 'ZZNAV', type: 'VOR', region: null },
      { ident: 'ZZGON', type: 'WAYPOINT', region: 'ZZ' },
    ]);
    setReplica([waypoint('ZZFIX', 'ZZ'), navaid('ZZNAV', 'ZZ'), absent('W', 'ZZGON', 'ZZ')]);

    // ZZFIX is held for another region, so it is still wanted; ZZNAV names no
    // region, so the navaid answers it; ZZGON is recorded missing.
    expect(buildDemand(NOW).waypoints).toEqual([{ ident: 'ZZFIX', region: 'YY' }]);
  });

  it('wants everything when there is no replica at all', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    const leg = seedLeg({ trip_id: trip });
    seedWaypoints(leg, [{ ident: 'ZZFIX', type: 'WAYPOINT' }]);

    expect(buildDemand(NOW)).toMatchObject({ airports: ['ZZAA', 'ZZAB'], waypoints: [{ ident: 'ZZFIX' }] });
  });

  it('scans the active trip whatever the leg status, then legs still planned', () => {
    const active = seedTrip(scratch.db, { is_active: 1 });
    const other = seedTrip(scratch.db, { is_active: 0 });
    seedLeg({ trip_id: active, seq: 2, status: 'flown', departure_ident: 'ZZA2', destination_ident: 'ZZB2' });
    seedLeg({ trip_id: active, seq: 1, status: 'diverted', departure_ident: 'ZZA1', destination_ident: 'ZZB1' });
    seedLeg({ trip_id: other, status: 'flown', departure_ident: 'ZZOLD', destination_ident: 'ZZOLE' });
    seedLeg({ trip_id: other, seq: 2, status: 'planned', departure_ident: 'ZZNEW', destination_ident: 'ZZNEX' });
    setReplica([]);

    // Active trip first, in seq order; the flown leg of the other trip is not drawn.
    expect(buildDemand(NOW).airports).toEqual(['ZZA1', 'ZZB1', 'ZZA2', 'ZZB2', 'ZZNEW', 'ZZNEX']);
  });

  it('caps the response and says so', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    const leg = seedLeg({ trip_id: trip, departure_is_airport: 0, destination_is_airport: 0 });
    seedWaypoints(leg, Array.from({ length: 60 }, (_, i) => ({
      ident: `ZZW${String(i).padStart(2, '0')}`,
      type: 'WAYPOINT',
    })));
    setReplica([]);

    const demand = buildDemand(NOW);

    expect(demand.waypoints).toHaveLength(NAVDATA_DEMAND_CAP);
    expect(demand.waypoints[0]).toEqual({ ident: 'ZZW00' });
    expect(demand.more).toBe(true);
    expect(demand.cap).toBe(50);
  });

  it('looks no further than the leg budget', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    const dep = (i: number) => `ZZ${String(i).padStart(3, '0')}`;
    const dest = (i: number) => `ZY${String(i).padStart(3, '0')}`;
    const held: NavRow[] = [];
    for (let i = 0; i < NAVDATA_DEMAND_LEG_SCAN + 5; i += 1) {
      seedLeg({ trip_id: trip, seq: i + 1, departure_ident: dep(i), destination_ident: dest(i) });
      if (i < NAVDATA_DEMAND_LEG_SCAN) held.push(airport(dep(i)), airport(dest(i)));
    }
    setReplica(held);

    // Every leg inside the budget is answered, and the five past it are never
    // reached — the scan is a bound on cost, not a truncated answer.
    expect(buildDemand(NOW)).toMatchObject({ airports: [], waypoints: [], more: false });

    // The same run finds a gap inside the budget, so the budget really is 200 legs deep.
    setReplica(held.filter(r => r.r.ident !== dest(NAVDATA_DEMAND_LEG_SCAN - 1)));
    expect(buildDemand(NOW).airports).toEqual([dest(NAVDATA_DEMAND_LEG_SCAN - 1)]);
  });

  it('de-duplicates an ident two legs share', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    seedLeg({ trip_id: trip, seq: 1 });
    seedLeg({ trip_id: trip, seq: 2, departure_ident: 'ZZAB', destination_ident: 'ZZAA' });
    setReplica([]);

    expect(buildDemand(NOW).airports).toEqual(['ZZAA', 'ZZAB']);
  });
});

describe('manual requests', () => {
  it('leads the response and survives a replica swap', () => {
    const trip = seedTrip(scratch.db, { is_active: 1 });
    seedLeg({ trip_id: trip });
    upsertNavdataRequest('A', 'ZZREQ', null, NOW);
    setReplica([]);

    expect(buildDemand(NOW).airports).toEqual(['ZZREQ', 'ZZAA', 'ZZAB']);

    const incoming = incomingNavdataPath();
    writeReplica(incoming, [airport('ZZAA')], 'epoch-2');
    swapInReplica(incoming);

    // The request lives in flights.db, so a new epoch cannot lose it.
    expect(buildDemand(NOW).airports).toEqual(['ZZREQ', 'ZZAB']);
    expect(listNavdataRequests(NOW)).toHaveLength(1);
  });

  it('is deleted on the first poll the replica can answer it', () => {
    upsertNavdataRequest('A', 'ZZREQ', null, NOW);
    upsertNavdataRequest('W', 'zzfix', 'zz', NOW);
    setReplica([airport('ZZREQ', 'detail'), waypoint('ZZFIX', 'ZZ')]);

    const demand = buildDemand(NOW);

    expect(demand).toMatchObject({ airports: [], waypoints: [], more: false });
    expect(listNavdataRequests(NOW)).toHaveLength(0);
  });

  it('keeps a request the replica only holds an index row for', () => {
    upsertNavdataRequest('A', 'ZZREQ', null, NOW);
    setReplica([airport('ZZREQ', 'index')]);

    expect(buildDemand(NOW).airports).toEqual(['ZZREQ']);
    expect(listNavdataRequests(NOW)).toHaveLength(1);
  });

  it('prunes an expired request rather than emitting it', () => {
    upsertNavdataRequest('A', 'ZZOLD', null, new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000));
    upsertNavdataRequest('W', 'ZZNEW', null, NOW);
    setReplica([]);

    const demand = buildDemand(NOW);

    expect(demand.airports).toEqual([]);
    expect(demand.waypoints).toEqual([{ ident: 'ZZNEW' }]);
    expect(listNavdataRequests(NOW).map(r => r.ident)).toEqual(['ZZNEW']);
  });
});
