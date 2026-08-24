import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Makes a consistent backup of the database and any attached flight plans.
 *
 * Copying flights.db with `cp` is not safe: the database runs in WAL mode, so
 * recently committed data can still live in flights.db-wal and would be missing
 * from a naive file copy. SQLite's online backup API (exposed by better-sqlite3
 * as db.backup) reads through the WAL and produces a single self-consistent
 * file, and it is safe to run while the server is live.
 */
const DB_FILE = path.join(process.cwd(), 'flights.db');
const PLANS_DIR = path.join(process.cwd(), 'flight_plans');
const BACKUP_ROOT = path.join(process.cwd(), 'backups');

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DB_FILE)) {
    console.error(`No database at ${DB_FILE} — nothing to back up.`);
    process.exit(1);
  }

  const dest = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(BACKUP_ROOT, stamp());
  fs.mkdirSync(dest, { recursive: true });

  const dbOut = path.join(dest, 'flights.db');
  const source = new Database(DB_FILE, { readonly: true });
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

  console.log(`database    ${human(fs.statSync(dbOut).size)}  ${flights} flights, ${points} points, ${trips} trips`);

  let planCount = 0, planBytes = 0;
  if (fs.existsSync(PLANS_DIR)) {
    const plansOut = path.join(dest, 'flight_plans');
    fs.mkdirSync(plansOut, { recursive: true });
    for (const name of fs.readdirSync(PLANS_DIR)) {
      const from = path.join(PLANS_DIR, name);
      if (!fs.statSync(from).isFile()) continue;
      fs.copyFileSync(from, path.join(plansOut, name));
      planCount += 1;
      planBytes += fs.statSync(from).size;
    }
  }
  console.log(`flight plans ${human(planBytes)}  ${planCount} file(s)`);
  console.log(`\nBacked up to ${dest}`);
}

main().catch(err => {
  console.error('Backup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
