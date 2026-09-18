// Reference stub — NOT wired into the build. Owner: T-003, at src/db/sayIntentionsLinks.ts.
//
// Mirrors src/db/acarsMessages.ts: one module, one table, no express, no HTTP.
//
// IMPORTED DIRECTLY as '../db/sayIntentionsLinks', NOT re-exported from
// src/db.ts — src/db.ts is not in T-003's or T-006's allowed_paths, and
// src/db/groundSessions.ts already sets that precedent (see the import line at
// the top of src/routes/groundSessions.ts).
//
// See design.md §5 (link storage), §16.1 (T-003's contract).

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
export declare function getSayIntentionsLink(flightId: number): SayIntentionsLinkRow | null;

/**
 * Insert-or-replace, keyed on flight_id. Re-linking a flight overwrites the
 * whole row — including resetting the cursor — because a re-link means the
 * operator is pointing the flight at a session again on purpose.
 * imported_count is preserved across a re-link (the rows it counts are still
 * in the thread); every other field comes from the argument.
 */
export declare function upsertSayIntentionsLink(
  row: Omit<SayIntentionsLinkRow, 'imported_count' | 'last_import_at'>,
): SayIntentionsLinkRow;

/**
 * Called once per successful import. Advances the cursor, stamps
 * last_import_at, and adds `importedDelta` to imported_count in one statement,
 * so two imports cannot interleave into a lost update. Returns the updated row,
 * or null when the link no longer exists.
 *
 * `upstreamFlightId` backfills `upstream_flight_id` via
 * `COALESCE(upstream_flight_id, ?)` — it only fills a `null` slot (the link
 * was made when `getCommsHistory` happened to omit `flight_id`, see design.md
 * §9.4) and never overwrites an id already pinned by an earlier import. Pass
 * the current response's `flight_id` (or `null` if this response also lacks
 * one) on every call, not just the first.
 */
export declare function advanceSayIntentionsCursor(
  flightId: number,
  sinceId: number | null,
  importedDelta: number,
  at: string,
  upstreamFlightId: string | null,
): SayIntentionsLinkRow | null;

/** true when a row was deleted, false when there was nothing to delete. */
export declare function deleteSayIntentionsLink(flightId: number): boolean;
