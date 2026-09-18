// Reference stub — NOT wired into the build. Owner: T-003, at src/sayIntentionsClient.ts.
//
// Shape mirrors src/weatherClient.ts: the only module in the tree that talks to
// SayIntentions, owning the network and nothing else — no ./db import, no
// express import, no ACARS vocabulary. It returns a plain result or rejects
// with a SayIntentionsFetchError, and never anything else.
//
// Unlike weatherClient there is NO cache: a comms transcript changes with every
// radio call, and sayAs is a side effect that must happen exactly when asked.
// There is deliberately no clearSayIntentionsCache() to mirror.
//
// See design.md §7 (client), §8 (failure modes).

/** Reasons a call could not be answered. Every one maps to a user-facing sentence. */
export type SayIntentionsErrorCode =
  | 'NO_KEY'
  | 'BAD_KEY'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_STATUS'
  | 'BAD_BODY'
  | 'NO_ACTIVE_SESSION';

/**
 * Thrown by getCommsHistory/sayAs, and the only thing either throws.
 *
 * `message` is written for the log; `userMessage` is written for a human.
 * NEITHER EVER CONTAINS THE API KEY OR A URL — the key travels as a query
 * parameter, so a URL in an error string is a credential in a log file.
 */
export declare class SayIntentionsFetchError extends Error {
  readonly code: SayIntentionsErrorCode;
  readonly userMessage: string;
  readonly httpStatus?: number;
  constructor(
    code: SayIntentionsErrorCode,
    detail: string,
    userMessage: string,
    extra?: { httpStatus?: number },
  );
}

export interface SayIntentionsClientOptions {
  /** Injected by tests and by nothing else — a parameter with a default, not a
   *  module-level global, so two concurrent tests cannot see each other's stub. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 10s, the same generous margin weatherClient uses. */
export declare const SAYINTENTIONS_TIMEOUT_MS: 10_000;

/** 128, SayIntentions' documented cap for channel=ACARS_IN. */
export declare const MAX_ACARS_IN_CHARS: 128;

/**
 * Lowercased substrings that mark "no active flight session" in an upstream
 * error string. Exported so widening it after a real capture is a one-line
 * amendment, not a rewrite. See design.md §7.4.
 */
export declare const NO_ACTIVE_SESSION_HINTS: readonly string[];

/**
 * One comm_history[] entry, as SayIntentions sends it.
 *
 * Every field is optional and weakly typed on purpose: this is an undocumented
 * external shape (see sayintentions-api-notes.md — "best-effort from docs"), and
 * the client's job is to hand it on without asserting anything it has not
 * verified. `[k: string]: unknown` keeps a field we have never seen from being
 * dropped: the whole entry is stored in payload_json.
 */
export interface CommHistoryEntry {
  /** The cursor. An entry without a numeric id is dropped by the importer (§9.5). */
  id?: number;
  ident?: string | null;
  copilot?: string | null;
  lat?: number | null;
  lon?: number | null;
  frequency?: string | number | null;
  is_acars?: boolean | number | null;
  channel?: string | null;
  stamp_zulu?: string | number | null;
  station_name?: string | null;
  incoming_message?: string | null;
  incoming_message_english?: string | null;
  outgoing_message?: string | null;
  outgoing_message_english?: string | null;
  language?: string | null;
  atc_url?: string | null;
  pilot_url?: string | null;
  [k: string]: unknown;
}

export interface CommsHistoryResult {
  /** SayIntentions' own flight/session id, normalised to a string (their JSON
   *  may carry a number). null when the response carried none. */
  flight_id: string | null;
  /** Ascending by id. Never null — an absent or non-array comm_history is []. */
  comm_history: CommHistoryEntry[];
  /** mission.mission_id / mission_type / status when present, else null.
   *  Carried through unparsed; nothing in this design branches on it. */
  mission: Record<string, unknown> | null;
}

/**
 * GET {base}/getCommsHistory?api_key=…[&since_id=…].
 *
 * `sinceId` omitted/null means "everything the API will give us". A non-finite
 * or negative sinceId is treated as absent rather than sent upstream.
 *
 * Throws NO_KEY when apiKey is empty/whitespace — a guard so a caller that
 * forgot to check cannot send `api_key=` upstream. Never throws
 * NO_ACTIVE_SESSION: this endpoint does not require one.
 */
export declare function getCommsHistory(
  apiKey: string,
  sinceId?: number | null,
  opts?: SayIntentionsClientOptions,
): Promise<CommsHistoryResult>;

export interface SayAsParams {
  /** This design only ever sends ACARS_IN. Widening the union is a later
   *  design's decision, not an implementer's. */
  channel: 'ACARS_IN';
  /** Already condensed and length-checked by the caller. The client re-checks
   *  and throws BAD_BODY (not a silent truncation) if it exceeds
   *  MAX_ACARS_IN_CHARS — a truncated clearance is worse than none. */
  message: string;
  /** Sending station shown in the sim, e.g. 'KSFO'. */
  from?: string;
  messageType?: 'cpdlc' | 'telex';
  responseCode?: string;
  /** 0 always, in this design: an AI rewording a clearance could change a
   *  squawk or an altitude. Sent explicitly rather than left to the default. */
  rephrase?: 0 | 1;
}

export interface SayAsResult {
  /** Always true on a resolved promise; a failure is a thrown error. Present so
   *  a caller reads `result.ok` rather than `result !== undefined`. */
  ok: true;
  /** The parsed confirmation body when it was JSON, else null. */
  raw: unknown;
  /** The response body as text, truncated to 500 chars, for payload_json. */
  rawText: string;
}

/**
 * GET {base}/sayAs?api_key=…&channel=ACARS_IN&message=…[&from=…][&message_type=…][&rephrase=0].
 *
 * Requires an active SayIntentions flight session upstream; NO_ACTIVE_SESSION
 * is the expected outcome when there is none (a pilot flying without
 * SayIntentions running that day), not a bug. Detection heuristic in §7.4.
 */
export declare function sayAs(
  apiKey: string,
  params: SayAsParams,
  opts?: SayIntentionsClientOptions,
): Promise<SayAsResult>;
