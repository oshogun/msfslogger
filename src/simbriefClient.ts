// ── SimBrief dispatch API client ──────────────────────────────────────────────
//
// The only module in this tree that talks to simbrief.com. It owns the network
// and nothing else: no database, no express, no parsing of the flight plan
// itself — it hands back the decoded body for parseSimbriefPlan (src/simbrief.ts)
// to validate, or rejects with a SimbriefFetchError and never anything else.
//
// Two things about the upstream drive the shape below, both measured against
// real responses rather than documentation:
//
//   * A failure is HTTP 400 with a body carrying only the `fetch` envelope, and
//     both an unknown pilot ID and an account with no saved plan come back that
//     way. Only `fetch.status` tells them apart, so the body is inspected
//     BEFORE the HTTP status.
//   * No authentication of any kind is involved. No key, no token, no cookie.
//     Nothing here may start sending a credential: the request is for a
//     third-party service that answers anyone.

/** Reasons a plan could not be retrieved. Every one maps to a user-facing sentence. */
export type SimbriefErrorCode =
  | 'UNKNOWN_USER'
  | 'NO_PLAN'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_STATUS'
  | 'BAD_BODY';

/**
 * Thrown by fetchSimbriefPlan, and the only thing it ever throws.
 *
 * `message` is written for the log and names the code, the HTTP status and the
 * upstream string. `userMessage` is the sentence the operator reads and never
 * contains a URL, a stack or the pilot ID.
 */
export class SimbriefFetchError extends Error {
  readonly code: SimbriefErrorCode;
  readonly userMessage: string;
  /** SimBrief's own fetch.status string, when there was one. */
  readonly upstreamStatus?: string;
  /** The HTTP status, when a response was received at all. */
  readonly httpStatus?: number;

  constructor(
    code: SimbriefErrorCode,
    detail: string,
    userMessage: string,
    extra: { upstreamStatus?: string; httpStatus?: number } = {},
  ) {
    super(`${code} (${detail})`);
    this.name = 'SimbriefFetchError';
    this.code = code;
    this.userMessage = userMessage;
    this.upstreamStatus = extra.upstreamStatus;
    this.httpStatus = extra.httpStatus;
  }
}

export interface FetchSimbriefPlanOptions {
  /**
   * Injected by tests and by nothing else. A parameter with a default rather
   * than a module-level global, so two tests running concurrently cannot see
   * each other's stub.
   */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const SIMBRIEF_DEFAULT_BASE_URL = 'https://www.simbrief.com/api/xml.fetcher.php';

/** Generous: SimBrief regenerates wind data on some requests. */
const SIMBRIEF_TIMEOUT_MS = 20_000;

/** How much of an unreadable body goes in the log line. */
const BODY_EXCERPT_CHARS = 200;

/**
 * Overridable so a scratch server can point at a local stub instead of the real
 * SimBrief. Read per call rather than captured at module load, so setting the
 * variable does not depend on import order. Deliberately not part of
 * src/config.ts's ENV_VARS, which is scoped to configuration this app's
 * security depends on; this is a test seam.
 */
function baseUrl(): string {
  return process.env.SIMBRIEF_API_BASE_URL ?? SIMBRIEF_DEFAULT_BASE_URL;
}

const USER_MESSAGES: Record<Exclude<SimbriefErrorCode, 'BAD_STATUS'>, string> = {
  UNKNOWN_USER:
    'SimBrief does not recognise that Pilot ID. Check the SimBrief User ID in the field above — it is the numeric Pilot ID from your SimBrief account page.',
  NO_PLAN:
    'That SimBrief account has no flight plan on file. Generate a flight plan on simbrief.com first, then import it here.',
  NETWORK: 'Could not reach SimBrief. Check your internet connection and try again.',
  TIMEOUT: 'SimBrief did not respond within 20 seconds. Try again in a moment.',
  BAD_BODY:
    'SimBrief returned a response this app could not read. This usually means SimBrief is having trouble — try again in a moment.',
};

/** `what` is the upstream status string when there was one, else "HTTP <n>". */
function badStatusMessage(what: string): string {
  return `SimBrief returned an error: ${what}. Try again in a moment.`;
}

/** A timeout surfaces as an abort, sometimes wrapped by the runtime's own error. */
function isAbort(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return isAbort((err as { cause?: unknown }).cause);
}

/**
 * Retrieves the pilot's most recent OFP.
 *
 * Resolves with the decoded JSON body — an `unknown` for parseSimbriefPlan to
 * validate — or rejects with a SimbriefFetchError. Never throws anything else,
 * and never a bare SyntaxError or a socket error.
 */
export async function fetchSimbriefPlan(
  userId: string,
  opts: FetchSimbriefPlanOptions = {},
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? SIMBRIEF_TIMEOUT_MS;

  // Built with URL/searchParams, never string concatenation: a hostile setting
  // value cannot smuggle in a second parameter this way.
  const url = new URL(baseUrl());
  url.searchParams.set('userid', userId);
  url.searchParams.set('json', '1');

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbort(err)) {
      throw new SimbriefFetchError('TIMEOUT', `${timeoutMs}ms`, USER_MESSAGES.TIMEOUT);
    }
    throw new SimbriefFetchError(
      'NETWORK',
      err instanceof Error ? err.message : String(err),
      USER_MESSAGES.NETWORK,
    );
  }

  const httpStatus = res.status;

  // text() then JSON.parse, not json(): an unreadable body has to reach the log
  // as the first 200 characters of what actually arrived, not as a SyntaxError
  // with no context.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new SimbriefFetchError(
      'NETWORK',
      err instanceof Error ? err.message : String(err),
      USER_MESSAGES.NETWORK,
      { httpStatus },
    );
  }

  const excerpt = (): string => `http ${httpStatus}, first ${BODY_EXCERPT_CHARS} chars: ${text.slice(0, BODY_EXCERPT_CHARS)}`;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SimbriefFetchError('BAD_BODY', excerpt(), USER_MESSAGES.BAD_BODY, { httpStatus });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new SimbriefFetchError('BAD_BODY', excerpt(), USER_MESSAGES.BAD_BODY, { httpStatus });
  }

  const envelope = (body as Record<string, unknown>).fetch;
  const upstreamStatus =
    typeof envelope === 'object' && envelope !== null
      ? (envelope as Record<string, unknown>).status
      : undefined;

  if (typeof upstreamStatus === 'string' && /^error:/i.test(upstreamStatus.trim())) {
    const lower = upstreamStatus.toLowerCase();
    const detail = `http ${httpStatus}, upstream "${upstreamStatus}"`;
    // Matched by substring rather than equality: the two literal strings are
    // observed, not documented, and a wording change upstream must degrade to
    // BAD_STATUS rather than to a wrong diagnosis.
    if (lower.includes('unknown userid')) {
      throw new SimbriefFetchError('UNKNOWN_USER', detail, USER_MESSAGES.UNKNOWN_USER, {
        upstreamStatus,
        httpStatus,
      });
    }
    if (lower.includes('no flight plan')) {
      throw new SimbriefFetchError('NO_PLAN', detail, USER_MESSAGES.NO_PLAN, { upstreamStatus, httpStatus });
    }
    throw new SimbriefFetchError('BAD_STATUS', detail, badStatusMessage(upstreamStatus), {
      upstreamStatus,
      httpStatus,
    });
  }

  if (httpStatus !== 200) {
    throw new SimbriefFetchError('BAD_STATUS', `http ${httpStatus}`, badStatusMessage(`HTTP ${httpStatus}`), {
      httpStatus,
    });
  }

  // The envelope is the only reliable verdict, so a body without a "Success" in
  // it is refused even on a 200.
  if (typeof upstreamStatus !== 'string' || upstreamStatus.trim().toLowerCase() !== 'success') {
    throw new SimbriefFetchError('BAD_BODY', excerpt(), USER_MESSAGES.BAD_BODY, { httpStatus });
  }

  return body;
}
