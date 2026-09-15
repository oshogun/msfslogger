import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { resolveDbPath } from './db';

/**
 * Makes a consistent backup of the database and any attached flight plans.
 *
 * Copying flights.db with `cp` is not safe: the database runs in WAL mode, so
 * recently committed data can still live in flights.db-wal and would be missing
 * from a naive file copy. SQLite's online backup API (exposed by better-sqlite3
 * as db.backup) reads through the WAL and produces a single self-consistent
 * file, and it is safe to run while the server is live.
 */

export interface BackupOptions {
  /** Source database. Defaults to resolveDbPath() in main(), never here. */
  dbFile: string;
  /** Directory of attached flight plans. Missing directory is not an error. */
  plansDir: string;
  /** Destination directory. Created recursively if absent. */
  destDir: string;
}

export interface BackupResult {
  destDir: string;
  dbBytes: number;
  flights: number;
  points: number;
  trips: number;
  planCount: number;
  planBytes: number;
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Everything the backup does. No argv, no process.exit, no console output
 * beyond what main() prints from the returned result.
 */
export async function runBackup(opts: BackupOptions): Promise<BackupResult> {
  const { dbFile, plansDir, destDir } = opts;
  fs.mkdirSync(destDir, { recursive: true });

  const dbOut = path.join(destDir, 'flights.db');
  const source = new Database(dbFile, { readonly: true });
  try {
    await source.backup(dbOut);
  } finally {
    source.close();
  }

  // Read the backup back to prove it opens and to report what it holds
  const check = new Database(dbOut, { readonly: true });
  let flights = 0, points = 0, trips = 0;
  try {
    flights = (check.prepare('SELECT COUNT(*) c FROM flights').get() as { c: number }).c;
    points  = (check.prepare('SELECT COUNT(*) c FROM flight_points').get() as { c: number }).c;
    trips   = (check.prepare('SELECT COUNT(*) c FROM trips').get() as { c: number }).c;
    check.pragma('integrity_check');
  } finally {
    check.close();
  }

  let planCount = 0, planBytes = 0;
  if (fs.existsSync(plansDir)) {
    const plansOut = path.join(destDir, 'flight_plans');
    fs.mkdirSync(plansOut, { recursive: true });
    for (const name of fs.readdirSync(plansDir)) {
      const from = path.join(plansDir, name);
      if (!fs.statSync(from).isFile()) continue;
      fs.copyFileSync(from, path.join(plansOut, name));
      planCount += 1;
      planBytes += fs.statSync(from).size;
    }
  }

  return {
    destDir,
    dbBytes: fs.statSync(dbOut).size,
    flights,
    points,
    trips,
    planCount,
    planBytes,
  };
}

async function main(): Promise<void> {
  const dbFile = resolveDbPath();
  if (!fs.existsSync(dbFile)) {
    console.error(`No database at ${dbFile} — nothing to back up.`);
    process.exit(1);
  }

  const destDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), 'backups', stamp());
  const r = await runBackup({ dbFile, plansDir: path.join(process.cwd(), 'flight_plans'), destDir });
  console.log(`database    ${human(r.dbBytes)}  ${r.flights} flights, ${r.points} points, ${r.trips} trips`);
  console.log(`flight plans ${human(r.planBytes)}  ${r.planCount} file(s)`);
  console.log(`\nBacked up to ${r.destDir}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Backup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
