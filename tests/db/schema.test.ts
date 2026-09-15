// tests/db/schema.test.ts — applySchema()'s idempotency and its column
// migrations, exercised directly against a raw better-sqlite3 handle (not
// through initDb()) so a pre-migration table can be hand-built.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { applySchema } from '../../src/db/schema';
import { scratchDbRoot } from '../helpers/db';

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
}

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .map(t => t.name)
    .sort();
}

describe('applySchema()', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(scratchDbRoot(), 'msfslogger-test-'));
    db = new Database(path.join(dir, 'flights.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates every application table on a fresh database', () => {
    applySchema(db);
    expect(tableNames(db)).toEqual([
      'acars_messages',
      'app_secret',
      'app_setting',
      'auth_session',
      'auth_user',
      'flight_points',
      'flights',
      'planned_alternates',
      'planned_legs',
      'planned_waypoints',
      'sqlite_sequence',
      'trips',
    ]);
  });

  it('is idempotent: running it again changes no table and drops no row', () => {
    applySchema(db);
    db.prepare("INSERT INTO flights (start_time) VALUES ('2026-09-09T12:00:00.000Z')").run();
    const before = tableNames(db);

    expect(() => applySchema(db)).not.toThrow();

    expect(tableNames(db)).toEqual(before);
    const row = db.prepare('SELECT COUNT(*) as n FROM flights').get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('adds trip_id and the planned-leg link columns to a flights table that predates them', () => {
    // Hand-built pre-migration table: only the columns the CREATE TABLE
    // statement declares directly, none of the ones added by ALTER TABLE.
    db.exec(`
      CREATE TABLE flights (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        aircraft         TEXT,
        departure_lat    REAL,
        departure_lon    REAL,
        arrival_lat      REAL,
        arrival_lon      REAL,
        start_time       TEXT NOT NULL,
        end_time         TEXT,
        duration_sec     INTEGER,
        distance_nm      REAL,
        max_altitude_ft  REAL,
        max_airspeed_kts REAL,
        point_count      INTEGER,
        notes            TEXT,
        departure_icao   TEXT,
        departure_name   TEXT,
        arrival_icao     TEXT,
        arrival_name     TEXT
      );
    `);
    const before = columnsOf(db, 'flights');
    expect(before).not.toContain('trip_id');
    expect(before).not.toContain('planned_leg_id');

    applySchema(db);

    const after = columnsOf(db, 'flights');
    expect(after).toContain('trip_id');
    expect(after).toContain('flight_plan_name');
    expect(after).toContain('planned_leg_id');
    expect(after).toContain('planned_leg_link_source');
    expect(after).toContain('planned_leg_prev_trip_id');
  });

  it('adds is_active to a trips table that predates it', () => {
    db.exec(`
      CREATE TABLE trips (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        notes      TEXT,
        created_at TEXT NOT NULL
      );
    `);
    expect(columnsOf(db, 'trips')).not.toContain('is_active');

    applySchema(db);

    expect(columnsOf(db, 'trips')).toContain('is_active');
  });
});
