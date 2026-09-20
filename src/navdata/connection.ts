// ── Navdata replica handle ────────────────────────────────────────────────────
//
// Owns the one process-wide handle on navdata.db. The file is absent until the
// sidecar delivers a snapshot; every caller must cope with getNavDb() === null.
// The swap is synchronous end to end, so a handler that queries without
// awaiting between getNavDb() and its last query can never see a half-swapped
// file.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { NAVDATA_SCHEMA_VERSION } from './wire';

const DEFAULT_NAVDATA_FILENAME = 'navdata.db';
const INCOMING_INFIX = '.incoming-';

/** Thrown by getNavDb() while a swap is in progress. */
export class NavdataBusyError extends Error {
  readonly retryAfterSeconds = 2;
  constructor() {
    super('navdata replica is being replaced');
    this.name = 'NavdataBusyError';
  }
}

/** NAVDATA_DB_PATH overrides; unset and empty mean <cwd>/navdata.db. Read per call. */
export function resolveNavdataPath(): string {
  return process.env.NAVDATA_DB_PATH || path.join(process.cwd(), DEFAULT_NAVDATA_FILENAME);
}

let navDb: Database.Database | null = null;
let busy = false;

function unlinkQuiet(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function checkpointAndClose(db: Database.Database): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Best effort; close still flushes.
  }
  db.close();
}

/** Opens the file and confirms its schema version; null (handle closed) when unusable. */
function openAndCheck(file: string): Database.Database | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const meta = db.prepare('SELECT schema_version FROM nav_meta WHERE id = 1').get() as
      | { schema_version: number }
      | undefined;
    if (meta && meta.schema_version === NAVDATA_SCHEMA_VERSION) return db;
    console.warn(
      `navdata: ${file} has schema_version ${meta ? meta.schema_version : 'none'}, ` +
        `expected ${NAVDATA_SCHEMA_VERSION}; treating the replica as absent`,
    );
  } catch (err) {
    console.warn(`navdata: cannot open ${file}: ${(err as Error).message}; treating the replica as absent`);
  }
  if (db && db.open) db.close();
  return null;
}

function unlinkStaleIncoming(target: string): void {
  const dir = path.dirname(target);
  const prefix = path.basename(target) + INCOMING_INFIX;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    try {
      unlinkQuiet(path.join(dir, name));
    } catch (err) {
      console.warn(`navdata: could not remove stale ${name}: ${(err as Error).message}`);
    }
  }
}

/** Path for an incoming snapshot: same directory as the target so rename(2) stays atomic. */
export function incomingNavdataPath(target: string = resolveNavdataPath()): string {
  return `${target}${INCOMING_INFIX}${process.pid}-${Date.now()}`;
}

/** Startup: clears leftover incoming files, opens the replica if it exists. */
export function openNavdata(): void {
  const target = resolveNavdataPath();
  unlinkStaleIncoming(target);
  if (navDb && navDb.open) navDb.close();
  navDb = fs.existsSync(target) ? openAndCheck(target) : null;
}

/**
 * The replica handle, or null when absent. Throws NavdataBusyError mid-swap.
 * Never await between this call and the last query on the returned handle.
 */
export function getNavDb(): Database.Database | null {
  if (busy) throw new NavdataBusyError();
  return navDb && navDb.open ? navDb : null;
}

export function isNavdataBusy(): boolean {
  return busy;
}

export function closeNavDb(): void {
  if (navDb && navDb.open) checkpointAndClose(navDb);
  navDb = null;
}

function discardIncoming(incomingPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkQuiet(incomingPath + suffix);
    } catch {
      // Nothing more to do for a temp file.
    }
  }
}

/**
 * Replaces the live replica with a fully built incoming file. `verify` runs on
 * a read-only handle of the checkpointed incoming file and throws to abort;
 * the live file is untouched on an abort. Synchronous: no request runs between
 * marking busy and reopening.
 */
export function swapInReplica(incomingPath: string, verify?: (incoming: Database.Database) => void): void {
  const target = resolveNavdataPath();

  try {
    const built = new Database(incomingPath);
    checkpointAndClose(built);
    if (verify) {
      const check = new Database(incomingPath, { readonly: true });
      try {
        verify(check);
      } finally {
        check.close();
        // Opening a WAL file read-only can leave -wal/-shm beside it; the
        // main file is about to be renamed away, so they would be orphans.
        for (const suffix of ['-wal', '-shm']) {
          try {
            unlinkQuiet(incomingPath + suffix);
          } catch {
            // Best effort; startup clears any stale incoming files.
          }
        }
      }
    }
  } catch (err) {
    discardIncoming(incomingPath);
    throw err;
  }

  busy = true;
  try {
    closeNavDb();
    unlinkQuiet(`${target}-wal`);
    unlinkQuiet(`${target}-shm`);
    fs.renameSync(incomingPath, target);
    navDb = openAndCheck(target);
  } catch (err) {
    console.error(`navdata: swap failed, replica is absent: ${(err as Error).message}`);
    if (navDb && navDb.open) navDb.close();
    navDb = null;
    discardIncoming(incomingPath);
    throw err;
  } finally {
    busy = false;
  }
}
