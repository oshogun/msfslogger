import { getDb } from './connection';

// ── SayIntentions links ──────────────────────────────────────────────────────
//
// One table, sayintentions_links: which SayIntentions session a msfslogger
// flight was pointed at, and how far the pull import has read. Mirrors
// src/db/acarsMessages.ts: one module, one table, no express, no HTTP.
//
// Imported by path as '../db/sayIntentionsLinks', not re-exported from
// src/db.ts — src/db/groundSessions.ts already sets that precedent (see the
// import in src/routes/groundSessions.ts).

const COLUMNS = `
  flight_id, upstream_flight_id, since_id, baseline_comm_id,
  linked_at, last_import_at, imported_count
`;

/** One row of sayintentions_links, as every read returns it. */
export interface SayIntentionsLinkRow {
  flight_id: number;
  upstream_flight_id: string | null;
  since_id: number | null;
  baseline_comm_id: number;
  linked_at: string;
  last_import_at: string | null;
  imported_count: number;
}

/** null when this flight has never been linked, or was unlinked. */
export function getSayIntentionsLink(flightId: number): SayIntentionsLinkRow | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM sayintentions_links WHERE flight_id = ?`)
    .get(flightId) as SayIntentionsLinkRow | undefined;
  return row ?? null;
}

/**
 * Insert-or-replace, keyed on flight_id. Re-linking a flight overwrites the
 * whole row — including resetting the cursor — because a re-link means the
 * operator is pointing the flight at a session again on purpose.
 * imported_count is preserved across a re-link (the rows it counts are still
 * in the thread); every other field comes from the argument.
 */
export function upsertSayIntentionsLink(
  row: Omit<SayIntentionsLinkRow, 'imported_count' | 'last_import_at'>,
): SayIntentionsLinkRow {
  getDb().prepare(`
    INSERT INTO sayintentions_links
      (flight_id, upstream_flight_id, since_id, baseline_comm_id, linked_at, last_import_at, imported_count)
    VALUES (?, ?, ?, ?, ?, NULL, 0)
    ON CONFLICT(flight_id) DO UPDATE SET
      upstream_flight_id = excluded.upstream_flight_id,
      since_id            = excluded.since_id,
      baseline_comm_id    = excluded.baseline_comm_id,
      linked_at            = excluded.linked_at
  `).run(row.flight_id, row.upstream_flight_id, row.since_id, row.baseline_comm_id, row.linked_at);

  const updated = getSayIntentionsLink(row.flight_id);
  if (!updated) throw new Error('SayIntentions link vanished immediately after upsert');
  return updated;
}

/**
 * Called once per successful import. Advances the cursor, stamps
 * last_import_at, and adds `importedDelta` to imported_count in one
 * statement, so two imports cannot interleave into a lost update. Returns the
 * updated row, or null when the link no longer exists.
 *
 * `upstreamFlightId` backfills `upstream_flight_id` via
 * COALESCE(upstream_flight_id, ?) — it only fills a NULL slot (the link was
 * made when getCommsHistory happened to omit flight_id) and never overwrites
 * an id already pinned by an earlier import. Pass the current response's
 * flight_id (or null if this response also lacks one) on every call, not
 * just the first.
 */
export function advanceSayIntentionsCursor(
  flightId: number,
  sinceId: number | null,
  importedDelta: number,
  at: string,
  upstreamFlightId: string | null,
): SayIntentionsLinkRow | null {
  const result = getDb().prepare(`
    UPDATE sayintentions_links
       SET since_id            = ?,
           last_import_at      = ?,
           imported_count      = imported_count + ?,
           upstream_flight_id  = COALESCE(upstream_flight_id, ?)
     WHERE flight_id = ?
  `).run(sinceId, at, importedDelta, upstreamFlightId, flightId);

  if (result.changes === 0) return null;
  return getSayIntentionsLink(flightId);
}

/** true when a row was deleted, false when there was nothing to delete. */
export function deleteSayIntentionsLink(flightId: number): boolean {
  const result = getDb().prepare('DELETE FROM sayintentions_links WHERE flight_id = ?').run(flightId);
  return result.changes > 0;
}
