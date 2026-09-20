// ── Snapshot import ───────────────────────────────────────────────────────────
//
// A snapshot is a gzipped NDJSON stream: a header line, row lines, a footer
// line carrying the counts. It is applied to a brand-new database file beside
// the live replica and only then swapped in, so a truncated or miscounted
// upload leaves the replica the server is already serving untouched.
//
// A snapshot always wins. One carrying the epoch already held is the normal
// resync and replaces the file the same way.

import DatabaseCtor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import { incomingNavdataPath, swapInReplica } from './connection';
import { applyNavdataSchema } from './schema';
import { applyNavRows, NavdataStoreError, verifyNavdataColumns, writeNavMeta } from './store';
import {
  NAVDATA_SCHEMA_VERSION,
  NAVDATA_WIRE_VERSION,
  type NavRow,
  type NavRowType,
  type SnapshotAck,
  type SnapshotFooterLine,
  type SnapshotHeaderLine,
} from './wire';

/** Rows applied per transaction while streaming. */
export const SNAPSHOT_BATCH_ROWS = 5000;

const SIM_IDS = new Set(['2020', '2024', 'fsx']);

const badBatch = (message: string): NavdataStoreError =>
  new NavdataStoreError('NAVDATA_BAD_BATCH', message, { status: 400 });

type Counts = Partial<Record<NavRowType, number>>;

function discardIncoming(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(file + suffix);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`navdata: could not remove ${file}${suffix}: ${(err as Error).message}`);
      }
    }
  }
}

function parseLine(line: string, lineNo: number): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw badBatch(`line ${lineNo} is not JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badBatch(`line ${lineNo} is not an object`);
  }
  return parsed as Record<string, unknown>;
}

function readHeader(obj: Record<string, unknown>): SnapshotHeaderLine {
  if (obj.kind !== 'header') throw badBatch('the first line is not a header');
  if (obj.v !== NAVDATA_WIRE_VERSION || typeof obj.schemaVersion !== 'number') {
    throw badBatch(`header declares wire version ${JSON.stringify(obj.v)}`);
  }
  if (obj.schemaVersion !== NAVDATA_SCHEMA_VERSION) {
    throw new NavdataStoreError(
      'NAVDATA_SCHEMA_UNSUPPORTED',
      `snapshot declares schema version ${obj.schemaVersion}`,
      { status: 409, serverSchemaVersion: NAVDATA_SCHEMA_VERSION },
    );
  }
  if (typeof obj.snapshotId !== 'string' || obj.snapshotId.trim() === '') {
    throw badBatch('header has no snapshotId');
  }
  if (typeof obj.rev !== 'number' || !Number.isInteger(obj.rev)) throw badBatch('header has no integer rev');
  if (typeof obj.simId !== 'string' || !SIM_IDS.has(obj.simId)) {
    throw badBatch(`header has unknown simId ${JSON.stringify(obj.simId)}`);
  }
  if (typeof obj.createdAt !== 'number') throw badBatch('header has no createdAt');
  return obj as unknown as SnapshotHeaderLine;
}

function readFooter(obj: Record<string, unknown>): SnapshotFooterLine {
  if (typeof obj.rows !== 'number' || !Number.isInteger(obj.rows)) throw badBatch('footer has no integer row count');
  const counts = obj.counts;
  if (counts !== undefined && (!counts || typeof counts !== 'object' || Array.isArray(counts))) {
    throw badBatch('footer counts is not an object');
  }
  return { kind: 'footer', rows: obj.rows, counts: (counts ?? {}) as Counts };
}

/** Footer counts are a claim about the stream, so they are checked against what was actually read. */
function checkFooter(footer: SnapshotFooterLine, read: Counts, total: number): void {
  if (footer.rows !== total) {
    throw badBatch(`footer claims ${footer.rows} rows, the stream carried ${total}`);
  }
  const types = new Set<string>([...Object.keys(footer.counts ?? {}), ...Object.keys(read)]);
  for (const t of types) {
    const claimed = (footer.counts as Record<string, number>)[t] ?? 0;
    const actual = (read as Record<string, number>)[t] ?? 0;
    if (claimed !== actual) {
      throw badBatch(`footer claims ${claimed} ${t} rows, the stream carried ${actual}`);
    }
  }
}

/**
 * Streams a gzipped NDJSON snapshot into a fresh replica file and swaps it in.
 * Returns the per-table counts of rows actually written. The caller owns the
 * uploaded file and deletes it; everything this function creates is cleaned up
 * before it returns, whether it succeeds or throws.
 */
export async function importNavdataSnapshot(
  sourcePath: string,
  now: () => number = Date.now,
): Promise<SnapshotAck> {
  const incoming = incomingNavdataPath();
  let db: Database.Database | null = null;

  try {
    db = new DatabaseCtor(incoming);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applyNavdataSchema(db);

    let header: SnapshotHeaderLine | null = null;
    let footer: SnapshotFooterLine | null = null;
    const read: Counts = {};
    const written: Counts = {};
    let total = 0;
    let lineNo = 0;
    let pending: NavRow[] = [];

    const flush = (): void => {
      if (pending.length === 0) return;
      const result = applyNavRows(db as Database.Database, pending);
      for (const [t, n] of Object.entries(result.counts)) {
        written[t as NavRowType] = (written[t as NavRowType] ?? 0) + (n ?? 0);
      }
      pending = [];
    };

    const input = fs.createReadStream(sourcePath).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const raw of lines) {
        const line = raw.trim();
        if (line === '') continue;
        lineNo += 1;
        if (footer) throw badBatch(`line ${lineNo} follows the footer`);
        const obj = parseLine(line, lineNo);

        if (!header) {
          header = readHeader(obj);
          continue;
        }
        if (obj.kind === 'footer') {
          flush();
          footer = readFooter(obj);
          continue;
        }
        const row = obj as unknown as NavRow;
        read[row.t] = (read[row.t] ?? 0) + 1;
        total += 1;
        pending.push(row);
        if (pending.length >= SNAPSHOT_BATCH_ROWS) flush();
      }
    } catch (err) {
      if (err instanceof NavdataStoreError) throw err;
      throw badBatch(`snapshot stream failed: ${(err as Error).message}`);
    } finally {
      lines.close();
      input.destroy();
    }

    if (!header) throw badBatch('snapshot is empty');
    if (!footer) throw badBatch('snapshot has no footer');
    flush();

    const appliedAt = now();
    writeNavMeta(db, header, appliedAt);
    db.close();
    db = null;

    const checkedHeader = header;
    const checkedFooter = footer;
    swapInReplica(incoming, check => {
      verifyNavdataColumns(check);
      checkFooter(checkedFooter, read, total);
      const meta = check.prepare('SELECT snapshot_id AS id FROM nav_meta WHERE id = 1').get() as
        | { id: string }
        | undefined;
      if (!meta || meta.id !== checkedHeader.snapshotId) {
        throw badBatch('the built replica does not carry the snapshot it was streamed from');
      }
    });

    return {
      ok: true,
      snapshotId: header.snapshotId,
      rev: header.rev,
      counts: written,
      appliedAt,
    };
  } finally {
    if (db && db.open) db.close();
    // Unconditional: on the way out the incoming path is either gone (renamed
    // over the replica) or abandoned, and verifying it on a read-only handle
    // re-creates sidecar files that only its own directory entry could clean
    // up. Either way nothing named after it may survive this call.
    discardIncoming(incoming);
  }
}
