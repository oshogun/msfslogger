/**
 * Frozen types for design.md §4, §5, §6 and §7. Reference artifact — this file
 * is not compiled by the build and is not imported by anything. T-002 copies
 * the server block into src/types.ts; T-004 copies the client block into
 * client/src/types.ts (hand-mirrored, per the note at client/src/types.ts:1-4).
 *
 * Ownership, so two parallel tasks do not write the same lines:
 *   src/types.ts          — every type below, verbatim (T-002)
 *   src/acars.ts          — the runtime values: ACARS_DIRECTIONS, CANNED_MESSAGES,
 *                           the validators (T-002)
 *   src/db/acarsMessages.ts — no type of its own; imports from '../types' (T-002)
 *   client/src/types.ts   — AcarsDirection, AcarsCategory, AcarsMessage,
 *                           AcarsThread, CannedAcarsMessage, CannedAcarsMessageList,
 *                           SendCannedAcarsMessageRequest (T-004)
 */

// ── Server: src/types.ts ──────────────────────────────────────────────────────

/** 'uplink' is dispatch speaking to the aircraft; 'downlink' is the cockpit. */
export type AcarsDirection = 'uplink' | 'downlink';

/**
 * Open on purpose. The five the message-center story names, plus 'oooi', which
 * the position-report story needs; a later story may add another without a
 * schema change or a change here. Validated by shape, not by membership — see
 * isValidAcarsCategory in src/acars.ts.
 */
export type AcarsCategory =
  | 'pdc' | 'wx' | 'freetext' | 'position-report' | 'dispatch' | 'oooi'
  | (string & {});

/** One row of acars_messages, as every read returns it and as the API sends it. */
export interface AcarsMessage {
  id: number;
  flight_id: number | null;
  planned_leg_id: number | null;
  direction: AcarsDirection;
  category: AcarsCategory;
  label: string | null;
  body: string;
  /** Raw JSON text exactly as stored; never parsed by the transport. */
  payload_json: string | null;
  correlation_id: number | null;
  dedup_key: string | null;
  /** ISO 8601 UTC instant. */
  sent_at: string;
  /** NULL means unread. Nothing writes it this run. */
  read_at: string | null;
}

/**
 * Argument to insertAcarsMessage. snake_case, one key per column, so the
 * sample rows in contracts/samples/ are literally insertable and a reader can
 * check a call against §2 without a mapping table.
 */
export interface CreateAcarsMessage {
  flight_id?: number | null;
  planned_leg_id?: number | null;
  direction: AcarsDirection;
  category: AcarsCategory;
  label?: string | null;
  body: string;
  payload_json?: string | null;
  correlation_id?: number | null;
  dedup_key?: string | null;
  /** Defaults to new Date().toISOString() when omitted. */
  sent_at?: string;
}

/** GET /api/flights/:id/acars-messages 200 body. */
export interface AcarsThread {
  flight_id: number;
  /** The leg whose pre-flight messages are included, or null. */
  planned_leg_id: number | null;
  /** Oldest first: sent_at ASC, id ASC. The client reverses for display. */
  messages: AcarsMessage[];
}

/** One entry of the fixed outgoing set. */
export interface CannedAcarsMessage {
  /** Stable, lower-kebab. The only thing a client has to send. */
  id: string;
  /** What the button says. */
  label: string;
  /** What is stored in acars_messages.body, verbatim. */
  body: string;
  category: AcarsCategory;
  /** Always 'downlink' for every entry in this run's set. */
  direction: AcarsDirection;
}

/** GET /api/acars/canned-messages 200 body. */
export interface CannedAcarsMessageList {
  messages: CannedAcarsMessage[];
}

/** POST /api/flights/:id/acars-messages request body. */
export interface SendCannedAcarsMessageRequest {
  /** One of CannedAcarsMessage.id. Required unless `body` is given. */
  canned_id?: string;
  /** The canned text itself, for a client that has no ids. Must match an entry. */
  body?: string;
  /** If present, must be 'downlink'. */
  direction?: AcarsDirection;
  /** If present, must equal the canned entry's category. */
  category?: AcarsCategory;
}

/** Every rejection body: { error, code }. Codes are frozen in §5.4. */
export interface AcarsErrorBody {
  error: string;
  code:
    | 'INVALID_ID' | 'FLIGHT_NOT_FOUND' | 'INVALID_BODY'
    | 'UNKNOWN_CANNED_MESSAGE' | 'NOT_A_CANNED_MESSAGE'
    | 'DIRECTION_NOT_PERMITTED' | 'CATEGORY_NOT_PERMITTED';
}

// ── Client: client/src/types.ts ───────────────────────────────────────────────
//
// AcarsDirection, AcarsCategory, AcarsMessage, AcarsThread, CannedAcarsMessage,
// CannedAcarsMessageList and SendCannedAcarsMessageRequest above are copied
// byte-identically. CreateAcarsMessage and AcarsErrorBody are NOT mirrored: the
// client never inserts a row, and it reads `error` off the parsed body through
// apiFetch, which already narrows it.
