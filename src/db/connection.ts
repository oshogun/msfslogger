// ── Connection and lifecycle ──────────────────────────────────────────────────
//
// Owns the one process-wide database handle. Every other db module reaches it
// through getDb() and never caches it or a prepared statement at module level:
// the handle only exists after initDb() has run.

import Database from 'better-sqlite3';
import path from 'path';
import { applySchema } from './schema';

const DB_PATH = path.join(process.cwd(), 'flights.db');

let db: Database.Database;

export function initDb(): Database.Database {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applySchema(db);

  return db;
}

/**
 * Closes the database, checkpointing the WAL back into flights.db.
 *
 * Without this, killing the process can leave recently committed data only in
 * flights.db-wal, where a naive file copy of flights.db would miss it.
 */
export function closeDb(): void {
  if (!db || !db.open) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Checkpoint is best-effort; closing still flushes.
  }
  db.close();
}

export function getDb(): Database.Database {
  return db;
}
