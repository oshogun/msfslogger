// tests/backup.test.ts — src/backup.ts's runBackup() against a real scratch
// database and a real scratch flight_plans directory. Never calls main(): it
// reads argv, prints to stdout and calls process.exit, none of which belong
// in a test process.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from '../src/db';
import { createScratchDb, destroyScratchDb, seedFlight, seedPoints, seedTrip, scratchDbRoot, type ScratchDb } from './helpers/db';

// ── Import safety: the require.main guard ───────────────────────────────────
//
// This must be the first test in the file and touch no other database
// helper before it runs — getDb() only ever reports a truthy value once
// something has called initDb(), and the whole point of the guard is that
// merely importing the module must not be that something.
describe('src/backup.ts import safety', () => {
  it('does not run main() merely by being imported', async () => {
    expect(getDb()).toBeUndefined();
    await import('../src/backup');
    expect(getDb()).toBeUndefined();
  });
});

describe('runBackup()', () => {
  let scratch: ScratchDb;
  let plansDir: string;
  let destDir: string;

  beforeEach(() => {
    scratch = createScratchDb();
    plansDir = fs.mkdtempSync(path.join(scratchDbRoot(), 'msfslogger-test-plans-'));
    destDir = fs.mkdtempSync(path.join(scratchDbRoot(), 'msfslogger-test-dest-'));
  });

  afterEach(() => {
    destroyScratchDb(scratch);
    fs.rmSync(plansDir, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('backs up a populated database and a flight_plans directory', async () => {
    const { runBackup } = await import('../src/backup');

    const tripId = seedTrip(scratch.db);
    const flightId = seedFlight(scratch.db, { trip_id: tripId });
    seedPoints(scratch.db, flightId, [
      { ts: '2026-09-09T12:00:00.000Z' },
      { ts: '2026-09-09T12:01:00.000Z' },
    ]);

    const planContent = Buffer.from('VFR KSBA to KMRY sample route content', 'utf8');
    fs.writeFileSync(path.join(plansDir, 'route.lnmpln'), planContent);
    fs.mkdirSync(path.join(plansDir, 'subdir'));
    fs.writeFileSync(path.join(plansDir, 'subdir', 'ignored.lnmpln'), 'should be skipped');

    const out = path.join(destDir, 'run1');
    const result = await runBackup({ dbFile: scratch.file, plansDir, destDir: out });

    expect(result.destDir).toBe(out);
    expect(result.flights).toBe(1);
    expect(result.points).toBe(2);
    expect(result.trips).toBe(1);
    expect(result.planCount).toBe(1);
    expect(result.planBytes).toBe(planContent.length);
    expect(result.dbBytes).toBeGreaterThan(0);

    const dbOut = path.join(out, 'flights.db');
    expect(fs.existsSync(dbOut)).toBe(true);

    const check = new Database(dbOut, { readonly: true });
    try {
      const integrity = check.pragma('integrity_check') as Array<{ integrity_check: string }>;
      expect(integrity[0].integrity_check).toBe('ok');
      expect((check.prepare('SELECT COUNT(*) c FROM flights').get() as { c: number }).c).toBe(1);
      expect((check.prepare('SELECT COUNT(*) c FROM flight_points').get() as { c: number }).c).toBe(2);
      expect((check.prepare('SELECT COUNT(*) c FROM trips').get() as { c: number }).c).toBe(1);
    } finally {
      check.close();
    }

    const copied = fs.readFileSync(path.join(out, 'flight_plans', 'route.lnmpln'));
    expect(copied.equals(planContent)).toBe(true);
    expect(fs.existsSync(path.join(out, 'flight_plans', 'subdir'))).toBe(false);
  });

  it('reports zero plans when plansDir does not exist, without throwing', async () => {
    const { runBackup } = await import('../src/backup');
    seedFlight(scratch.db);

    const missingPlansDir = path.join(os.tmpdir(), 'msfslogger-test-no-such-dir');
    const out = path.join(destDir, 'run2');
    const result = await runBackup({ dbFile: scratch.file, plansDir: missingPlansDir, destDir: out });

    expect(result.planCount).toBe(0);
    expect(result.planBytes).toBe(0);
    expect(result.flights).toBe(1);
  });

  it('throws rather than exiting when dbFile does not exist', async () => {
    const { runBackup } = await import('../src/backup');
    const missingDb = path.join(destDir, 'no-such-flights.db');
    await expect(
      runBackup({ dbFile: missingDb, plansDir, destDir: path.join(destDir, 'run3') }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('human()', () => {
  it('formats bytes, kilobytes and megabytes at the boundaries', async () => {
    const { human } = await import('../src/backup');
    expect(human(0)).toBe('0 B');
    expect(human(1023)).toBe('1023 B');
    expect(human(1024)).toBe('1 KB');
    expect(human(1024 * 1024 - 1)).toBe('1024 KB');
    expect(human(1024 * 1024)).toBe('1.0 MB');
  });
});
