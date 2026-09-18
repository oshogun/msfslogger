// Reference stub — NOT wired into the build.
//
// The exact block to append to src/types.ts, under a new
// "── SayIntentions ──" banner placed after the ACARS block. Split by owner:
// T-003 adds §A, T-006 adds §B, T-009 adds §C. Nothing here edits an existing
// type. client/src/types.ts gets the same declarations, minus the comments
// that talk about the database, under its own "── SayIntentions ──" banner
// (hand-mirrored, same as every other wire type in that file).
//
// See design.md §3 (data model), §16 (per-task contracts).

import type { AcarsMessage } from '../../../../src/types';

// ── §A — owned by T-003 ──────────────────────────────────────────────────────

/**
 * GET and PUT /api/settings/sayintentions.
 *
 * The key itself is NEVER in this shape. Unlike the SimBrief pilot ID — a
 * public identifier — a SayIntentions pilot key is a credential, so it goes
 * into the server and does not come back out. The UI needs exactly two facts:
 * whether one is stored, and enough of it to recognise which one.
 */
export interface SayIntentionsSettings {
  /** The only field any UI gates on. */
  sayintentions_api_key_set: boolean;
  /** 'abcd…wxyz' — first 4 + U+2026 + last 4, or '••••' for a key under 12
   *  characters, or null when nothing is stored. Never the whole key. */
  sayintentions_api_key_masked: string | null;
}

// ── §B — owned by T-006 ──────────────────────────────────────────────────────

/**
 * One msfslogger flight bound to whatever SayIntentions session the stored key
 * held at the moment the operator pressed LINK. One row per flight; the
 * database enforces it (sayintentions_links.flight_id is the primary key).
 */
export interface SayIntentionsLink {
  flight_id: number;
  /** SayIntentions' own flight/session id, as a string, captured at link time.
   *  null when the response carried none — the session-changed guard (§9.4) is
   *  then skipped for this link. */
  upstream_flight_id: string | null;
  /** Highest comm_history[].id imported so far, sent as since_id on the next
   *  import. null before the first import, meaning "from the start of whatever
   *  the API returns". */
  since_id: number | null;
  /** Highest comm_history[].id that already existed at link time; 0 when the
   *  session had no comms yet. Recorded so `?from=now` can be honoured and so
   *  an operator can see how much history predates the link. */
  baseline_comm_id: number;
  /** ISO 8601 UTC. */
  linked_at: string;
  /** ISO 8601 UTC; null until the first import. */
  last_import_at: string | null;
  /** Rows this link has written into acars_messages, cumulative. */
  imported_count: number;
}

/** GET /api/flights/:id/sayintentions/link — always 200 for an existing flight. */
export interface SayIntentionsLinkStatus {
  flight_id: number;
  linked: boolean;
  link: SayIntentionsLink | null;
  /** false when no key is stored. The UI hides its whole SayIntentions block
   *  on this alone, without a second settings request. */
  api_key_set: boolean;
}

/** POST /api/flights/:id/sayintentions/link — 201 on a new link, 200 on a re-link. */
export interface SayIntentionsLinkResponse {
  flight_id: number;
  created: boolean;
  link: SayIntentionsLink;
  /** comm_history entries the first import would file, counted at link time.
   *  0 with `?from=now`. */
  pending_messages: number;
}

/** POST /api/flights/:id/sayintentions/import — 201 when imported > 0, else 200. */
export interface SayIntentionsImportResponse {
  flight_id: number;
  /** Rows written by this call. 0 is a success, not an error. */
  imported: number;
  /** Entries whose dedup_key was already on file. */
  already_seen: number;
  /** Entries that produced no row at all (no usable text in either direction). */
  skipped: number;
  /** The cursor after this import — the link's new since_id. */
  since_id: number | null;
  /** Exactly the rows written, oldest first. [] when imported === 0. */
  messages: AcarsMessage[];
}

/**
 * acars_messages.payload_json for an imported comms row: the upstream entry,
 * verbatim and unparsed by anything downstream, so nothing is lost when the
 * mapping in §9.5 turns out to need an amendment.
 */
export interface SayIntentionsCommPayload {
  v: 1;
  source: 'sayintentions';
  /** comm_history[].id — also the dedup key's discriminator. */
  comm_id: number;
  /** 'in' (station → aircraft) or 'out' (aircraft → station). */
  leg: 'in' | 'out';
  /** The upstream entry exactly as received, minus nothing. */
  entry: Record<string, unknown>;
}

// ── §C — owned by T-009 ──────────────────────────────────────────────────────

/** POST /api/planned-legs/:legId/sayintentions/clearance — 201 on a successful send. */
export interface SayIntentionsPushResponse {
  planned_leg_id: number;
  /** The exact text handed to sayAs. Never longer than 128 characters. */
  sent_text: string;
  /** The acars_messages row that records the send. */
  message: AcarsMessage;
}

/** acars_messages.payload_json for the row recording a push. */
export interface SayIntentionsPushPayload {
  v: 1;
  source: 'sayintentions';
  channel: 'ACARS_IN';
  message_type: 'cpdlc';
  /** What was sent as sayAs's `from` — the departure ICAO, or 'DISPATCH'. */
  from: string;
  sent_text: string;
  /** ISO 8601 UTC. */
  sent_at: string;
  /** Upstream's confirmation body as text, truncated to 500 characters. Kept
   *  because SayIntentions does not document this shape and the first real
   *  response is the evidence that settles it. */
  upstream_excerpt: string;
}

/** Every error body on every route in this design. Matches the existing
 *  { error, code } convention exactly — see src/routes/acars.ts. */
export interface SayIntentionsErrorBody {
  /** A complete, operator-readable sentence. The client renders it verbatim
   *  (apiFetch throws new Error(body.error) and discards `code`). */
  error: string;
  /** For logs, tests and any non-browser client. Never rendered. */
  code: string;
}
