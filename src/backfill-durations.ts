import { initDb, getDb } from './db';
import { MAX_COUNTED_GAP_MS } from './flightManager';

/**
 * Recomputes stored flight durations from their recorded tracks.
 *
 * Flights logged before duration was derived from the track measured plain
 * wall clock, so any interruption the sim never reported — most notably a
 * frozen sim — was counted as flight time. This recomputes them the way the
 * recorder now does: summing the gaps between points and dropping any gap
 * longer than MAX_COUNTED_GAP_MS.
 *
 * Only flights that differ by more than MIN_DIFF_SEC are touched. Small
 * differences are noise, and rewriting them would discard values that are
 * already correct — a flight whose paused time was properly excluded at
 * record time can legitimately sit a few seconds below its recomputed value.
 */
const MIN_DIFF_SEC = 120;

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
               : `${m}m ${String(s).padStart(2, '0')}s`;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const db = initDb();

  const flights = db.prepare(
    'SELECT id, departure_icao, arrival_icao, duration_sec FROM flights ORDER BY id'
  ).all() as { id: number; departure_icao: string | null; arrival_icao: string | null; duration_sec: number | null }[];

  const points = db.prepare('SELECT ts FROM flight_points WHERE flight_id = ? ORDER BY ts ASC');
  const update = db.prepare('UPDATE flights SET duration_sec = ? WHERE id = ?');

  const changes: { id: number; route: string; from: number; to: number }[] = [];

  for (const f of flights) {
    const ts = (points.all(f.id) as { ts: string }[]).map(r => new Date(r.ts).getTime());
    if (ts.length < 2 || f.duration_sec == null) continue;

    let activeMs = 0;
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1];
      if (gap <= MAX_COUNTED_GAP_MS) activeMs += gap;
    }

    const recomputed = Math.round(activeMs / 1000);
    if (Math.abs(f.duration_sec - recomputed) <= MIN_DIFF_SEC) continue;

    changes.push({
      id: f.id,
      route: `${f.departure_icao ?? '????'}->${f.arrival_icao ?? '????'}`,
      from: f.duration_sec,
      to: recomputed,
    });
  }

  if (changes.length === 0) {
    console.log('No flight durations need correcting.');
    return;
  }

  console.log(`${changes.length} flight(s) differ by more than ${MIN_DIFF_SEC}s:\n`);
  for (const c of changes) {
    console.log(`  #${String(c.id).padEnd(3)} ${c.route.padEnd(12)} ${fmt(c.from).padEnd(14)} -> ${fmt(c.to).padEnd(14)} (${c.from - c.to > 0 ? '-' : '+'}${fmt(Math.abs(c.from - c.to))})`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save these changes.');
    return;
  }

  const run = db.transaction(() => {
    for (const c of changes) update.run(c.to, c.id);
  });
  run();
  console.log(`\nUpdated ${changes.length} flight(s).`);
}

main();
