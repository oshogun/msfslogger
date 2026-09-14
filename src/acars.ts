/**
 * ACARS message rules. This module is deliberately free of database, express
 * and I/O imports — it reads no clock, no environment and no file — so every
 * rule below can be unit-tested on its own: values in, values out. The
 * persistence half lives in src/db/acarsMessages.ts and the transport half in
 * src/routes/acars.ts; neither vocabulary is duplicated there.
 */

import type { AcarsDirection, CannedAcarsMessage } from './types';

/** The two directions the codebase knows. The column itself has no CHECK. */
export const ACARS_DIRECTIONS = ['uplink', 'downlink'] as const;

/**
 * The categories this codebase knows how to label and colour today. NOT a
 * closed set: the column accepts any well-shaped category, so a new kind of
 * message needs no migration and no change to the validator — only to this
 * list, and only if it wants a badge of its own.
 */
export const KNOWN_ACARS_CATEGORIES = [
  'pdc', 'wx', 'freetext', 'position-report', 'dispatch', 'oooi',
] as const;

/** The single direction a client is permitted to write. */
export const CLIENT_DIRECTION = 'downlink';

/**
 * Generous ceiling that still bounds the column: a METAR+TAF pair and a full
 * PDC are each well under it.
 */
export const MAX_ACARS_BODY_LENGTH = 4096;

/**
 * The fixed outgoing set, in render order. A client may send these and nothing
 * else: free text is not accepted, and everything stored comes from the entry
 * rather than from the request.
 *
 * All three are 'freetext', including WX REQUEST — the category records what a
 * message *is*, and this one is a typed-out phrase that triggers no lookup and
 * carries no ICAO, so filing it as 'wx' would put an entry in the weather
 * category that no reply will ever correlate to.
 */
export const CANNED_MESSAGES: readonly CannedAcarsMessage[] = [
  { id: 'wx-request',       label: 'WX REQUEST',       body: 'WX REQUEST',       category: 'freetext', direction: 'downlink' },
  { id: 'gate-request',     label: 'GATE REQUEST',     body: 'GATE REQUEST',     category: 'freetext', direction: 'downlink' },
  { id: 'request-pushback', label: 'REQUEST PUSHBACK', body: 'REQUEST PUSHBACK', category: 'freetext', direction: 'downlink' },
];

export type AcarsBodyResult =
  | { ok: true; body: string }
  | { ok: false; code: 'INVALID_BODY' | 'BODY_TOO_LONG'; error: string };

export function isAcarsDirection(v: unknown): v is AcarsDirection {
  return typeof v === 'string' && (ACARS_DIRECTIONS as readonly string[]).includes(v);
}

/**
 * Shape, not membership: lower-kebab, starting with a letter, at most 32
 * characters. That is what actually protects the column — the enumeration is
 * open (see KNOWN_ACARS_CATEGORIES) — and it is also what makes a category safe
 * to interpolate into a CSS class name.
 */
export function isValidAcarsCategory(v: unknown): boolean {
  return typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);
}

/** Membership, for display decisions. A different question from validity. */
export function isKnownAcarsCategory(v: string): boolean {
  return (KNOWN_ACARS_CATEGORIES as readonly string[]).includes(v);
}

/** Exact, case-sensitive match on id: an id is a wire value, not user typing. */
export function findCannedMessage(id: unknown): CannedAcarsMessage | null {
  if (typeof id !== 'string' || id === '') return null;
  return CANNED_MESSAGES.find(m => m.id === id) ?? null;
}

/**
 * Trims, collapses every run of whitespace (newlines and tabs included) to one
 * space, and uppercases. Applied only to a client-submitted body before it is
 * matched against the canned set — never to a stored body, which keeps its
 * newlines and its case exactly.
 */
export function normaliseCannedBody(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** The entry whose body normalises to the same text, or null. */
export function findCannedMessageByBody(body: unknown): CannedAcarsMessage | null {
  if (typeof body !== 'string') return null;
  const normalised = normaliseCannedBody(body);
  if (normalised === '') return null;
  return CANNED_MESSAGES.find(m => normaliseCannedBody(m.body) === normalised) ?? null;
}

/**
 * The guard for any writer of a message body, including the server-side ones.
 * The length is measured before trimming, so padding cannot smuggle a body past
 * the ceiling; the stored value is the trimmed string, with its interior
 * newlines intact.
 */
export function validateAcarsBody(raw: unknown): AcarsBodyResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_BODY', error: 'Message body must be text' };
  }
  if (raw.length > MAX_ACARS_BODY_LENGTH) {
    return { ok: false, code: 'BODY_TOO_LONG', error: `Message body is too long (max ${MAX_ACARS_BODY_LENGTH} characters)` };
  }
  const body = raw.trim();
  if (body === '') {
    return { ok: false, code: 'INVALID_BODY', error: 'Message body must not be empty' };
  }
  return { ok: true, body };
}

/** 'wx-request, gate-request, request-pushback' — the tail of the error text. */
export function cannedMessageIdList(): string {
  return CANNED_MESSAGES.map(m => m.id).join(', ');
}
