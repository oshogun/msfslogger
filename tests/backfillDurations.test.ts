// tests/backfillDurations.test.ts — src/backfill-durations.ts against a real
// scratch database. Dynamic import throughout: the module is only safe to
// import once FLIGHTS_DB_PATH points at the scratch file, in case its
// require.main guard ever regresses (see the first test below).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScratchDb, destroyScratchDb, seedFlight, seedPoints, useScratchDbEnv, type ScratchDb } from './helpers/db';
import { MAX_COUNTED_GAP_MS } from '../src/flightManager';

describe('src/backfill-durations.ts', () => {
  let scratch: ScratchDb;
  let restoreEnv: () => void;
  let originalArgv: string[];

  beforeEach(() => {
    scratch = createScratchDb();
    restoreEnv = useScratchDbEnv(scratch.file);
    originalArgv = process.argv;
    vi.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    destroyScratchDb(scratch);
  });

  it('does not run main() at import time', async () => {
    const dbMod = await import('../src/db');
    await import('../src/backfill-durations');
    expect(dbMod.getDb()).toBeUndefined();
  });

  // Points: 30s (counted) + 90s (excluded, > MAX_COUNTED_GAP_MS) + 45s
  // (counted) = 75s active. A gap this shape only comes out right if the
  // exclusion rule is applied per-gap, not to the flight's total span.
  const T0 = '2026-09-09T12:00:00.000Z';
  const T1 = '2026-09-09T12:00:30.000Z';
  const T2 = '2026-09-09T12:02:00.000Z';
  const T3 = '2026-09-09T12:02:45.000Z';
  const RECOMPUTED_SEC = 75;

  function seedBigAndSmallDiff(): { bigId: number; smallId: number } {
    expect(new Date(T2).getTime() - new Date(T1).getTime()).toBeGreaterThan(MAX_COUNTED_GAP_MS);

    const bigId = seedFlight(scratch.db, { duration_sec: 500 }); // |500-75| = 425 > 120
    seedPoints(scratch.db, bigId, [{ ts: T0 }, { ts: T1 }, { ts: T2 }, { ts: T3 }]);

    const smallId = seedFlight(scratch.db, { duration_sec: 150 }); // |150-75| = 75 <= 120
    seedPoints(scratch.db, smallId, [{ ts: T0 }, { ts: T1 }, { ts: T2 }, { ts: T3 }]);

    return { bigId, smallId };
  }

  function readDuration(id: number): number | null {
    const row = scratch.db.prepare('SELECT duration_sec FROM flights WHERE id = ?').get(id) as { duration_sec: number | null };
    return row.duration_sec;
  }

  it('dry run (no --apply) reports the difference but writes nothing', async () => {
    const { bigId, smallId } = seedBigAndSmallDiff();
    process.argv = [...originalArgv];

    const mod = await import('../src/backfill-durations');
    mod.main();

    expect(readDuration(bigId)).toBe(500);
    expect(readDuration(smallId)).toBe(150);
  });

  it('--apply writes the recomputed value only for the flight over MIN_DIFF_SEC', async () => {
    const { bigId, smallId } = seedBigAndSmallDiff();
    process.argv = [...originalArgv, '--apply'];

    const mod = await import('../src/backfill-durations');
    mod.main();

    expect(readDuration(bigId)).toBe(RECOMPUTED_SEC);
    expect(readDuration(smallId)).toBe(150); // within MIN_DIFF_SEC, untouched even under --apply
  });

  it('skips a flight with fewer than two points or a NULL duration_sec, apply or not', async () => {
    const onePointId = seedFlight(scratch.db, { duration_sec: 500 });
    seedPoints(scratch.db, onePointId, [{ ts: T0 }]);

    const nullDurationId = seedFlight(scratch.db, { duration_sec: null });
    seedPoints(scratch.db, nullDurationId, [{ ts: T0 }, { ts: T1 }]);

    process.argv = [...originalArgv, '--apply'];
    const mod = await import('../src/backfill-durations');
    mod.main();

    expect(readDuration(onePointId)).toBe(500);
    expect(readDuration(nullDurationId)).toBeNull();
  });

  it('fmt() formats under an hour and an hour or more', async () => {
    const mod = await import('../src/backfill-durations');
    expect(mod.fmt(65)).toBe('1m 05s');
    expect(mod.fmt(3665)).toBe('1h 01m 05s');
  });

  it('exports the frozen MIN_DIFF_SEC threshold', async () => {
    const mod = await import('../src/backfill-durations');
    expect(mod.MIN_DIFF_SEC).toBe(120);
  });
});
