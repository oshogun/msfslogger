import { MAX_ACARS_BODY_LENGTH } from './acars';
import type { SayIntentionsErrorCode } from './sayIntentionsClient';
import type { AcarsDirection, CreateAcarsMessage } from './types';

// ── SayIntentions integration — settings and shared helpers ────────────────────
//
// This module is deliberately free of database, express and network imports:
// the app_setting key name, the key validator/masker, and the error-code to
// HTTP-status/response-code mapping are pure rules that src/routes/settings.ts,
// src/routes/sayIntentions.ts and their tests can all use without any of them
// pulling in the other two. The network half lives in src/sayIntentionsClient.ts
// and the per-flight link storage lives in src/db/sayIntentionsLinks.ts;
// nothing here knows either exists.

/** The app_setting key the pilot's SayIntentions API key is stored under. */
export const SAYINTENTIONS_API_KEY_SETTING = 'sayintentions_api_key';

/** SayIntentions publishes no key format, so this is a shape guard against
 *  paste errors, not a format check. */
export const MIN_SAYINTENTIONS_API_KEY_LENGTH = 8;
export const MAX_SAYINTENTIONS_API_KEY_LENGTH = 200;

export type SayIntentionsApiKeyResult =
  | { ok: true; apiKey: string | null } // null means "clear it"
  | { ok: false; code: 'INVALID_API_KEY'; error: string };

/**
 * Validates a SayIntentions API key as typed by the operator.
 *
 * Accepts a string or null/undefined (both meaning "clear the setting", as
 * does a string that is empty after trimming — success then carries
 * apiKey: null). The input is trimmed because operators paste it from their
 * SayIntentions account page and bring whitespace with them, but it is never
 * otherwise normalised: SayIntentions documents no key format, so the only
 * rule enforced is "printable ASCII, no whitespace, a plausible length" — a
 * guard against paste errors, not a guess at their format that could reject a
 * valid key the day it changes.
 */
export function validateSayIntentionsApiKey(raw: unknown): SayIntentionsApiKeyResult {
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_API_KEY', error: 'A SayIntentions API key must be text' };
  }

  const value = (raw ?? '').trim();
  if (value === '') return { ok: true, apiKey: null };

  const lengthOk = value.length >= MIN_SAYINTENTIONS_API_KEY_LENGTH && value.length <= MAX_SAYINTENTIONS_API_KEY_LENGTH;
  if (!lengthOk || !/^[\x21-\x7E]+$/.test(value)) {
    return {
      ok: false,
      code: 'INVALID_API_KEY',
      error: 'A SayIntentions API key must be 8 to 200 characters with no spaces — copy it from your SayIntentions account page.',
    };
  }

  return { ok: true, apiKey: value };
}

/**
 * A fixed placeholder ('••••••••') for any set key, regardless of its real
 * length or content. null in, null out.
 *
 * The masked form is the only shape of the key that is ever allowed to leave
 * the server — see /api/settings/sayintentions, which returns this and never
 * the raw value.
 */
export function maskApiKey(key: string | null): string | null {
  // Reveals nothing about the real key — no characters, no length. The
  // previous version showed the first/last 4 characters, which leaks real
  // entropy; a fixed placeholder is the only value with zero information
  // about the saved key.
  return key === null ? null : '••••••••';
}

/**
 * One shared mapping from a SayIntentionsErrorCode to the HTTP status and
 * response `code` every route in this feature answers with, so no route can
 * disagree with another about what a given upstream failure means.
 */
const ERROR_STATUS: Record<SayIntentionsErrorCode, number> = {
  NO_KEY: 409,
  BAD_KEY: 409,
  NO_ACTIVE_SESSION: 409,
  NETWORK: 502,
  TIMEOUT: 504,
  BAD_STATUS: 502,
  BAD_BODY: 502,
};

const ERROR_RESPONSE_CODE: Record<SayIntentionsErrorCode, string> = {
  NO_KEY: 'NO_API_KEY',
  BAD_KEY: 'BAD_API_KEY',
  NO_ACTIVE_SESSION: 'NO_ACTIVE_SESSION',
  NETWORK: 'UPSTREAM_UNREACHABLE',
  TIMEOUT: 'UPSTREAM_TIMEOUT',
  BAD_STATUS: 'UPSTREAM_ERROR',
  BAD_BODY: 'UPSTREAM_BAD_BODY',
};

export function httpStatusForSayIntentionsError(code: SayIntentionsErrorCode): number {
  return ERROR_STATUS[code];
}

export function responseCodeForSayIntentionsError(code: SayIntentionsErrorCode): string {
  return ERROR_RESPONSE_CODE[code];
}

// ── Pull — mapping one comm_history[] entry into acars_messages rows ───────────
//
// Pure by construction: no database, no network, so the mapping the importer
// depends on can be tested directly, the same way tests/acars.test.ts tests
// src/acars.ts. src/routes/sayIntentions.ts is the only caller.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The dedup key a repeat import relies on to be a no-op. `leg` matches which
 *  side of the exchange the row records — 'out' is the cockpit, 'in' is the
 *  station. */
export function commHistoryDedupKey(flightId: number, commId: number, leg: 'in' | 'out'): string {
  return `sayintentions:comm:${flightId}:${commId}:${leg}`;
}

/**
 * The greatest `id` across a comm_history[] response, never lower than
 * `initial`. Used both to seed a fresh link's baseline and to advance an
 * existing one's cursor, so both scans agree on what counts: an entry that
 * is not a plain object, or whose `id` is not a finite number, is skipped
 * rather than read — the same guard mapCommEntryToRows applies before it
 * ever touches `entry.id`, since the array comes from an undocumented,
 * preview-status upstream that has been seen to include a bare `null`.
 */
export function maxCommId(entries: readonly unknown[], initial: number): number {
  let max = initial;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const commId = entry['id'];
    if (typeof commId === 'number' && Number.isFinite(commId) && commId > max) max = commId;
  }
  return max;
}

/**
 * The first of `a`, `b` that is a string whose trim() is non-empty, trimmed;
 * else null. Prefers the English rendering when both are given — the operator
 * reading the logbook is the one who typed the key, and nothing is lost since
 * the original text still goes into payload_json.
 */
export function pickText(a: unknown, b: unknown): string | null {
  for (const candidate of [a, b]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return null;
}

/** trim(), toUpperCase(), collapse whitespace runs to one space, cap at 40
 *  characters. Empty after that falls back to the given default. */
function normaliseLabel(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const normalised = raw.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 40);
  return normalised === '' ? fallback : normalised;
}

/** Clamped to MAX_ACARS_BODY_LENGTH with a trailing '...' if it somehow
 *  exceeds it. Newlines are preserved. */
function clampCommBody(text: string): string {
  if (text.length <= MAX_ACARS_BODY_LENGTH) return text;
  return `${text.slice(0, MAX_ACARS_BODY_LENGTH - 3)}...`;
}

/**
 * Normalises comm_history[].stamp_zulu into the ISO 8601 UTC instant
 * acars_messages.sent_at requires. Total: every branch either returns a valid
 * ISO string or falls through to `fallbackIso`, never throws.
 *
 * 1. A finite number is an epoch; under 1e12 it is read as seconds.
 * 2. A string is trimmed; a bare `YYYY-MM-DD HH:MM[:SS[.sss]]` (space or `T`
 *    separator, with or without a zone) is read as UTC when it carries no
 *    zone of its own — "zulu" in the field name is the only statement of
 *    intent there is.
 * 3. Anything else is handed to `new Date()` as-is. This is the one branch
 *    that is not timezone-independent for an unzoned, non-ISO string (e.g.
 *    '2026/09/17 14:33:12'), which is why every case covering it in tests
 *    uses an explicitly zoned input.
 * 4. An invalid date at any step falls back to `fallbackIso`.
 */
export function normaliseStampZulu(raw: unknown, fallbackIso: string): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fallbackIso : d.toISOString();
  }
  if (typeof raw !== 'string') return fallbackIso;
  const trimmed = raw.trim();
  if (trimmed === '') return fallbackIso;

  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(trimmed);
  const candidate = m ? `${trimmed.replace(' ', 'T')}${m[9] ? '' : 'Z'}` : trimmed;

  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}

/** One row this module produces for one leg of a comm_history[] exchange,
 *  ready for insertAcarsMessageOnce. */
export type MappedCommRow = CreateAcarsMessage & { dedup_key: string; direction: AcarsDirection };

/**
 * Maps one comm_history[] entry to zero, one or two acars_messages rows. An
 * entry is a radio exchange: it may carry what the station said, what the
 * cockpit said, or both.
 *
 * Returns [] (counted as "skipped" by the caller) when `entry` is not a plain
 * object, when its `id` is not a finite number — the id is the dedup key and
 * the cursor, so an entry without one cannot be filed safely — or when
 * neither direction has any usable text.
 */
export function mapCommEntryToRows(entry: unknown, flightId: number, fallbackIso: string): MappedCommRow[] {
  if (!isRecord(entry)) return [];
  const commId = entry['id'];
  if (typeof commId !== 'number' || !Number.isFinite(commId)) return [];

  const sentAt = normaliseStampZulu(entry['stamp_zulu'], fallbackIso);
  const rows: MappedCommRow[] = [];

  // The cockpit's transmission is inserted first, so it reads above the
  // reply under the thread's sent_at ASC, id ASC ordering.
  const outText = pickText(entry['outgoing_message_english'], entry['outgoing_message']);
  if (outText !== null) {
    rows.push({
      flight_id: flightId,
      direction: 'downlink',
      category: 'atc',
      label: normaliseLabel(entry['ident'], 'CREW'),
      body: clampCommBody(outText),
      payload_json: JSON.stringify({ v: 1, source: 'sayintentions', comm_id: commId, leg: 'out', entry }),
      correlation_id: null,
      dedup_key: commHistoryDedupKey(flightId, commId, 'out'),
      sent_at: sentAt,
    });
  }

  const inText = pickText(entry['incoming_message_english'], entry['incoming_message']);
  if (inText !== null) {
    rows.push({
      flight_id: flightId,
      direction: 'uplink',
      category: 'atc',
      label: normaliseLabel(entry['station_name'], 'ATC'),
      body: clampCommBody(inText),
      payload_json: JSON.stringify({ v: 1, source: 'sayintentions', comm_id: commId, leg: 'in', entry }),
      correlation_id: null,
      dedup_key: commHistoryDedupKey(flightId, commId, 'in'),
      sent_at: sentAt,
    });
  }

  return rows;
}
