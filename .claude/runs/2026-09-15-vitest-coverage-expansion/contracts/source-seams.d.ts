// Every seam this run adds under src/, in one place — design.md §12.
//
// Reference artifact. Not wired into the build. If a task needs a seam that is
// not listed here, it returns `blocked`; it does not add one.

import type Database from 'better-sqlite3';

// ── src/db/connection.ts (§5.2) ──────────────────────────────────────────────

/**
 * NEW export. The operational database file. FLIGHTS_DB_PATH overrides it;
 * unset and empty string both mean the default. Read on every call, never
 * captured at module load.
 *
 *   return process.env.FLIGHTS_DB_PATH || path.join(process.cwd(), 'flights.db');
 */
export function resolveDbPath(): string;

/**
 * CHANGED: gains one optional parameter. Body otherwise identical — WAL,
 * foreign_keys ON, applySchema(db), return db.
 * Precedence (§5.3): explicit argument > FLIGHTS_DB_PATH > cwd/flights.db.
 */
export function initDb(dbPath?: string): Database.Database;

// closeDb() and getDb() are UNCHANGED — not restated here on purpose.

// ── src/backup.ts (§6.2) ─────────────────────────────────────────────────────

export interface BackupOptions {
  /** Source database. main() passes resolveDbPath(); runBackup has no default. */
  dbFile: string;
  /** Attached flight plans. A missing directory is not an error. */
  plansDir: string;
  /** Destination. Created recursively. */
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

/**
 * NEW export. Everything the backup does: online .backup(), reopen read-only,
 * count flights/flight_points/trips, PRAGMA integrity_check, copy plan files.
 * No argv, no process.exit, no console output. Throws on a missing dbFile —
 * the exit-1 path stays in main().
 */
export function runBackup(opts: BackupOptions): Promise<BackupResult>;

/** NEW export, body unchanged: '<n> B' | '<n> KB' | '<n.n> MB'. */
export function human(bytes: number): string;

/** NEW export, body unchanged: local-time 'YYYYMMDD-HHMMSS'. Test under fake timers. */
export function stamp(): string;

// main() stays private and keeps its exact console.log formats (§6.2, §14.9).

// ── src/setPassword.ts (§9.1) ────────────────────────────────────────────────

/**
 * NEW export (add `export` at :31), body unchanged. Calls process.exit via
 * fail() on every error path and on --help, so tests stub process.exit (§9.3).
 * Nothing else in this file is exported; main()'s inline validation is NOT
 * extracted (§9.2).
 */
export function parseUsername(argv: string[]): string;

// ── src/backfill-durations.ts (§10.1) ────────────────────────────────────────

/** NEW export, value unchanged: 120. */
export const MIN_DIFF_SEC: number;

/** NEW export, body unchanged. '<m>m <ss>s', or '<h>h <mm>m <ss>s' at >= 1 h. */
export function fmt(sec: number): string;

/**
 * NEW export, body unchanged. Reads process.argv for --apply, calls initDb()
 * with no argument — so its test points FLIGHTS_DB_PATH at a scratch file and
 * imports this module dynamically (§8.2).
 */
export function main(): void;

// ── src/backfill-icao.ts (§10.2) ─────────────────────────────────────────────

/**
 * NEW export, body unchanged. Calls initAirports(), which downloads
 * airports.csv — its test MUST mock '../src/airports' (sibling §6.1/§6.3) while
 * using a real scratch database (§8.1).
 *
 * Named `mainIcao` here only because this .d.ts declares several modules'
 * seams in one file; in src/backfill-icao.ts the export is `main`.
 */
export function mainIcao(): Promise<void>;

// ── src/pdfExport.ts (§11.1) ─────────────────────────────────────────────────

/**
 * NEW export (add `export` at :22), body unchanged:
 *   EXPORT_BASE_URL ?? `${getConfig().tls.enabled ? 'https' : 'http'}://127.0.0.1:${PORT ?? '3000'}`
 * No test may call puppeteer.launch() or make a network request (§11.2).
 */
export function baseUrl(): string;

// appendPdfs() and closeBrowser() are ALREADY exported and unchanged; they are
// in scope for tests (§11.1) but need no seam.

// ── The four require.main guards (§4.1) ──────────────────────────────────────
//
// src/backfill-durations.ts:84, src/backfill-icao.ts:71,
// src/setPassword.ts:120-123, src/backup.ts:79-82 — each existing call wrapped
// verbatim in `if (require.main === module) { … }`. No other body change.
