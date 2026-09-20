import { getDb } from './connection';

// ── Navdata requests ──────────────────────────────────────────────────────────
//
// Manual "please fetch this facility" requests, remembered until the replica
// can answer them or the TTL passes. Rows are deleted, never flagged. Holds
// user intent only (kind, ident, region, two timestamps), never navdata.

export type NavdataRequestKind = 'A' | 'W';

export interface NavdataRequestRow {
  id: number;
  kind: NavdataRequestKind;
  ident: string;
  region: string | null;
  requested_at: string;
  expires_at: string;
}

export const NAVDATA_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normIdent(ident: string): string {
  return ident.trim().toUpperCase();
}

function normRegion(region: string | null | undefined): string | null {
  const r = region == null ? '' : region.trim().toUpperCase();
  return r === '' ? null : r;
}

/**
 * Records a request, or refreshes requested_at/expires_at when the same
 * (kind, ident, region) is already there. Select-then-write rather than
 * ON CONFLICT: SQLite treats NULL regions as distinct in a UNIQUE index.
 */
export function upsertNavdataRequest(
  kind: NavdataRequestKind,
  ident: string,
  region?: string | null,
  now: Date = new Date(),
): NavdataRequestRow {
  const db = getDb();
  const id = normIdent(ident);
  const reg = normRegion(region);
  const requestedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + NAVDATA_REQUEST_TTL_MS).toISOString();

  const existing = db.prepare(
    'SELECT id FROM navdata_requests WHERE kind = ? AND ident = ? AND region IS ?'
  ).get(kind, id, reg) as { id: number } | undefined;

  if (existing) {
    db.prepare('UPDATE navdata_requests SET requested_at = ?, expires_at = ? WHERE id = ?')
      .run(requestedAt, expiresAt, existing.id);
    return db.prepare('SELECT * FROM navdata_requests WHERE id = ?').get(existing.id) as NavdataRequestRow;
  }
  const info = db.prepare(
    'INSERT INTO navdata_requests (kind, ident, region, requested_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(kind, id, reg, requestedAt, expiresAt);
  return db.prepare('SELECT * FROM navdata_requests WHERE id = ?').get(info.lastInsertRowid) as NavdataRequestRow;
}

/** Deletes rows whose expires_at has passed. Returns how many went. */
export function pruneExpiredNavdataRequests(now: Date = new Date()): number {
  return getDb().prepare('DELETE FROM navdata_requests WHERE expires_at <= ?').run(now.toISOString()).changes;
}

/** Live (unexpired) requests, oldest first. Does not delete. */
export function listNavdataRequests(now: Date = new Date()): NavdataRequestRow[] {
  return getDb().prepare(
    'SELECT * FROM navdata_requests WHERE expires_at > ? ORDER BY requested_at ASC, id ASC'
  ).all(now.toISOString()) as NavdataRequestRow[];
}

/** Removes one request, e.g. once the replica can answer it. True if a row went. */
export function deleteNavdataRequest(kind: NavdataRequestKind, ident: string, region?: string | null): boolean {
  return getDb().prepare(
    'DELETE FROM navdata_requests WHERE kind = ? AND ident = ? AND region IS ?'
  ).run(kind, normIdent(ident), normRegion(region)).changes > 0;
}

/** Removes a request by primary key. True if a row went. */
export function deleteNavdataRequestById(id: number): boolean {
  return getDb().prepare('DELETE FROM navdata_requests WHERE id = ?').run(id).changes > 0;
}
