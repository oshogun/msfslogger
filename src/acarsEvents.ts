// src/acarsEvents.ts — the one impure seam server-generated ACARS messages
// (OOOI events, position reports) pass through. The messages themselves are
// pure data built in src/acars.ts; this file owns the database write, the
// try/catch and the log line, so a duplicate frame or a failed insert can
// never surface as more than one warning and never as a thrown error.

import type { CreateAcarsMessage } from './types';
import { insertAcarsMessageOnce } from './db/acarsMessages';

/**
 * Files a server-generated ACARS message exactly once and never throws.
 * Returns true iff a row was created. `context` is the log prefix subject,
 * e.g. 'Flight #12 OUT'.
 */
export function fileAcarsMessageOnce(
  msg: CreateAcarsMessage & { dedup_key: string },
  context: string,
): boolean {
  try {
    const { created } = insertAcarsMessageOnce(msg);
    if (created) console.log(`[ACARS] ${context} filed (${msg.dedup_key})`);
    return created;
  } catch (err) {
    console.warn(`[ACARS] ${context} not filed:`, err);
    return false;
  }
}
