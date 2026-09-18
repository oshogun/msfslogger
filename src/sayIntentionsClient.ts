// ── SayIntentions API client ────────────────────────────────────────────────────
//
// The only module in this tree that talks to SayIntentions. It owns the
// network and nothing else: no database, no express, no ACARS vocabulary — it
// hands back a plain result or rejects with a SayIntentionsFetchError, and
// never anything else. Mirrors src/weatherClient.ts in posture.
//
// Unlike weatherClient there is NO cache: a comms transcript changes with
// every radio call, and sayAs is a side effect that must happen exactly when
// asked. There is deliberately no clearSayIntentionsCache() to mirror.

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
 * Neither ever contains the API key or a URL — the key travels as a query
 * parameter, so a URL in an error string is a credential in a log file.
 */
export class SayIntentionsFetchError extends Error {
  readonly code: SayIntentionsErrorCode;
  readonly userMessage: string;
  readonly httpStatus?: number;

  constructor(
    code: SayIntentionsErrorCode,
    detail: string,
    userMessage: string,
    extra: { httpStatus?: number } = {},
  ) {
    super(`${code} (${detail})`);
    this.name = 'SayIntentionsFetchError';
    this.code = code;
    this.userMessage = userMessage;
    this.httpStatus = extra.httpStatus;
  }
}

export interface SayIntentionsClientOptions {
  /** Injected by tests and by nothing else — a parameter with a default, not
   *  a module-level global, so two concurrent tests cannot see each other's
   *  stub. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 10s, the same generous margin weatherClient uses. */
export const SAYINTENTIONS_TIMEOUT_MS = 10_000;

/** 128, SayIntentions' documented cap for channel=ACARS_IN. */
export const MAX_ACARS_IN_CHARS = 128;

/**
 * Lowercased substrings that mark "no active flight session" in an upstream
 * error string. Exported so widening it after a real capture is a one-line
 * amendment, not a rewrite.
 */
export const NO_ACTIVE_SESSION_HINTS: readonly string[] = [
  'no active', 'not active', 'inactive',
  'no flight', 'not in flight', 'no session',
  'not connected', 'no aircraft',
];

/**
 * Overridable so a scratch server (or a test) can point this at a local stub
 * instead of the real service. Read per call rather than captured at module
 * load, so setting the variable does not depend on import order. Deliberately
 * not part of src/config.ts's ENV_VARS, which is scoped to configuration this
 * app's security depends on; this is a test seam.
 */
const SAYINTENTIONS_API_BASE_URL_DEFAULT = 'https://apipri.sayintentions.ai/sapi';
function baseUrl(): string {
  return process.env.SAYINTENTIONS_API_BASE_URL ?? SAYINTENTIONS_API_BASE_URL_DEFAULT;
}

const USER_MESSAGES: Record<SayIntentionsErrorCode, (detail: { status?: number }) => string> = {
  NO_KEY: () => 'No SayIntentions API key is saved. Add one under Prefiles → SayIntentions first.',
  BAD_KEY: () => 'SayIntentions rejected the saved API key. Check it under Prefiles → SayIntentions.',
  NETWORK: () => 'Could not reach SayIntentions. Check your internet connection and try again.',
  TIMEOUT: () => 'SayIntentions did not respond within 10 seconds. Try again in a moment.',
  BAD_STATUS: ({ status }) => `SayIntentions returned an error (HTTP ${status}). Try again in a moment.`,
  BAD_BODY: () => 'SayIntentions returned a response this app could not read.',
  NO_ACTIVE_SESSION: () =>
    'SayIntentions has no active flight session for this key right now, so the message was not sent. Start the sim with SayIntentions connected and try again.',
};

/** A timeout surfaces as an abort, sometimes wrapped by the runtime's own error. */
function isAbort(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return isAbort((err as { cause?: unknown }).cause);
}

/**
 * One comm_history[] entry, as SayIntentions sends it.
 *
 * Every field is optional and weakly typed on purpose: this is an
 * undocumented external shape, and the client's job is to hand it on without
 * asserting anything it has not verified. `[k: string]: unknown` keeps a
 * field we have never seen from being dropped: the whole entry is stored in
 * payload_json by the importer.
 */
export interface CommHistoryEntry {
  /** The cursor. An entry without a numeric id is dropped by the importer. */
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
  /** SayIntentions' own flight/session id, normalised to a string (their
   *  JSON may carry a number). null when the response carried none. */
  flight_id: string | null;
  /** Ascending by id. Never null — an absent or non-array comm_history is []. */
  comm_history: CommHistoryEntry[];
  /** mission.mission_id / mission_type / status when present, else null.
   *  Carried through unparsed. */
  mission: Record<string, unknown> | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function doFetch(
  url: URL,
  opts: SayIntentionsClientOptions,
): Promise<{ httpStatus: number; text: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? SAYINTENTIONS_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbort(err)) {
      throw new SayIntentionsFetchError('TIMEOUT', `${timeoutMs}ms`, USER_MESSAGES.TIMEOUT({}));
    }
    throw new SayIntentionsFetchError(
      'NETWORK',
      err instanceof Error ? err.message : String(err),
      USER_MESSAGES.NETWORK({}),
    );
  }

  const httpStatus = res.status;
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new SayIntentionsFetchError(
      'NETWORK',
      err instanceof Error ? err.message : String(err),
      USER_MESSAGES.NETWORK({}),
    );
  }

  return { httpStatus, text };
}

/**
 * GET {base}/getCommsHistory?api_key=…[&since_id=…].
 *
 * `sinceId` omitted/null means "everything the API will give us". A
 * non-finite or negative sinceId is treated as absent rather than sent
 * upstream.
 *
 * Throws NO_KEY when apiKey is empty/whitespace — a guard so a caller that
 * forgot to check cannot send `api_key=` upstream. Never throws
 * NO_ACTIVE_SESSION: this endpoint does not require one.
 */
export async function getCommsHistory(
  apiKey: string,
  sinceId?: number | null,
  opts: SayIntentionsClientOptions = {},
): Promise<CommsHistoryResult> {
  if (!apiKey || apiKey.trim() === '') {
    throw new SayIntentionsFetchError('NO_KEY', 'no api key given', USER_MESSAGES.NO_KEY({}));
  }

  const url = new URL(`${baseUrl()}/getCommsHistory`);
  url.searchParams.set('api_key', apiKey);
  if (typeof sinceId === 'number' && Number.isFinite(sinceId) && sinceId > 0) {
    url.searchParams.set('since_id', String(sinceId));
  }

  const { httpStatus, text } = await doFetch(url, opts);

  if (httpStatus === 401 || httpStatus === 403) {
    throw new SayIntentionsFetchError('BAD_KEY', `http ${httpStatus}`, USER_MESSAGES.BAD_KEY({}), { httpStatus });
  }
  if (httpStatus !== 200) {
    throw new SayIntentionsFetchError('BAD_STATUS', `http ${httpStatus}`, USER_MESSAGES.BAD_STATUS({ status: httpStatus }), {
      httpStatus,
    });
  }

  let body: unknown;
  try {
    // Unlike sayAs, getCommsHistory has no legitimate empty-body success
    // case — an unparseable body, empty included, is BAD_BODY rather than
    // being silently coerced into "no messages."
    body = JSON.parse(text);
  } catch {
    throw new SayIntentionsFetchError(
      'BAD_BODY',
      `http ${httpStatus}, first 200 chars: ${text.slice(0, 200)}`,
      USER_MESSAGES.BAD_BODY({}),
      { httpStatus },
    );
  }
  if (!isRecord(body)) {
    throw new SayIntentionsFetchError(
      'BAD_BODY',
      `http ${httpStatus}, first 200 chars: ${text.slice(0, 200)}`,
      USER_MESSAGES.BAD_BODY({}),
      { httpStatus },
    );
  }

  const rawFlightId = body['flight_id'];
  const flightId =
    (typeof rawFlightId === 'string' && rawFlightId !== '') || (typeof rawFlightId === 'number' && Number.isFinite(rawFlightId))
      ? String(rawFlightId)
      : null;

  // Entries that are not a plain object, or whose id is not a finite number,
  // are passed through untouched — dropping them is the importer's job
  // (src/sayIntentions.ts's mapCommEntryToRows), not this client's.
  const rawHistory = body['comm_history'];
  const commHistory: CommHistoryEntry[] = Array.isArray(rawHistory) ? (rawHistory as CommHistoryEntry[]) : [];
  const idOf = (entry: unknown): number => {
    const id = isRecord(entry) ? entry['id'] : undefined;
    return typeof id === 'number' && Number.isFinite(id) ? id : 0;
  };
  commHistory.sort((a, b) => idOf(a) - idOf(b));

  const mission = isRecord(body['mission']) ? (body['mission'] as Record<string, unknown>) : null;

  return { flight_id: flightId, comm_history: commHistory, mission };
}

export interface SayAsParams {
  /** This design only ever sends ACARS_IN. */
  channel: 'ACARS_IN';
  /** Already condensed and length-checked by the caller. The client
   *  re-checks and throws BAD_BODY (not a silent truncation) if it exceeds
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
  /** Always true on a resolved promise; a failure is a thrown error. */
  ok: true;
  /** The parsed confirmation body when it was JSON, else null. */
  raw: unknown;
  /** The response body as text, truncated to 500 chars, for payload_json. */
  rawText: string;
}

/** True when `body` carries an explicit upstream failure marker. */
function hasFailureMarker(body: unknown): boolean {
  if (!isRecord(body)) return false;
  if (body['success'] === false) return true;
  const status = body['status'];
  if (typeof status === 'string' && ['error', 'fail', 'failed'].includes(status.toLowerCase())) return true;
  const result = body['result'];
  if (typeof result === 'string' && ['error', 'fail', 'failed'].includes(result.toLowerCase())) return true;
  const hasSuccessMarker = 'success' in body || typeof status === 'string' || typeof result === 'string';
  if (!hasSuccessMarker) {
    const err = body['error'];
    const msg = body['message'];
    if (typeof err === 'string' && err !== '') return true;
    if (typeof msg === 'string' && msg !== '') return true;
  }
  return false;
}

function containsHint(text: string): boolean {
  const lower = text.toLowerCase();
  return NO_ACTIVE_SESSION_HINTS.some((hint) => lower.includes(hint));
}

/**
 * GET {base}/sayAs?api_key=…&channel=ACARS_IN&message=…[&from=…][&message_type=…][&rephrase=0].
 *
 * Requires an active SayIntentions flight session upstream; NO_ACTIVE_SESSION
 * is the expected outcome when there is none (a pilot flying without
 * SayIntentions running that day), not a bug.
 */
export async function sayAs(
  apiKey: string,
  params: SayAsParams,
  opts: SayIntentionsClientOptions = {},
): Promise<SayAsResult> {
  if (!apiKey || apiKey.trim() === '') {
    throw new SayIntentionsFetchError('NO_KEY', 'no api key given', USER_MESSAGES.NO_KEY({}));
  }
  if (params.message.length > MAX_ACARS_IN_CHARS) {
    throw new SayIntentionsFetchError(
      'BAD_BODY',
      `message is ${params.message.length} chars, over the ${MAX_ACARS_IN_CHARS}-char cap`,
      USER_MESSAGES.BAD_BODY({}),
    );
  }

  const url = new URL(`${baseUrl()}/sayAs`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('channel', params.channel);
  url.searchParams.set('message', params.message);
  if (params.from !== undefined) url.searchParams.set('from', params.from);
  if (params.messageType !== undefined) url.searchParams.set('message_type', params.messageType);
  if (params.responseCode !== undefined) url.searchParams.set('response_code', params.responseCode);
  if (params.rephrase !== undefined) url.searchParams.set('rephrase', String(params.rephrase));

  const { httpStatus, text } = await doFetch(url, opts);

  if (httpStatus === 401 || httpStatus === 403) {
    throw new SayIntentionsFetchError('BAD_KEY', `http ${httpStatus}`, USER_MESSAGES.BAD_KEY({}), { httpStatus });
  }
  if (httpStatus === 404 || httpStatus === 409) {
    throw new SayIntentionsFetchError('NO_ACTIVE_SESSION', `http ${httpStatus}`, USER_MESSAGES.NO_ACTIVE_SESSION({}), {
      httpStatus,
    });
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new SayIntentionsFetchError('BAD_STATUS', `http ${httpStatus}`, USER_MESSAGES.BAD_STATUS({ status: httpStatus }), {
      httpStatus,
    });
  }

  // 2xx from here on.
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    throw new SayIntentionsFetchError(
      'BAD_BODY',
      `http ${httpStatus}, first 200 chars: ${text.slice(0, 200)}`,
      USER_MESSAGES.BAD_BODY({}),
      { httpStatus },
    );
  }

  if (hasFailureMarker(parsed)) {
    if (containsHint(text)) {
      throw new SayIntentionsFetchError('NO_ACTIVE_SESSION', `http ${httpStatus}`, USER_MESSAGES.NO_ACTIVE_SESSION({}), {
        httpStatus,
      });
    }
    throw new SayIntentionsFetchError('BAD_STATUS', `http ${httpStatus}, body: ${text.slice(0, 200)}`, USER_MESSAGES.BAD_STATUS({ status: httpStatus }), {
      httpStatus,
    });
  }

  if (containsHint(text)) {
    throw new SayIntentionsFetchError('NO_ACTIVE_SESSION', `http ${httpStatus}`, USER_MESSAGES.NO_ACTIVE_SESSION({}), {
      httpStatus,
    });
  }

  // Fallback: any other 2xx body is success. The docs promise only "a
  // confirmation of transmission," so an unrecognised 2xx body must not be
  // turned into an error.
  return { ok: true, raw: parsed, rawText: text.slice(0, 500) };
}
