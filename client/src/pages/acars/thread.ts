import type { AcarsMessage } from '../../mock/types';

/** Oldest-first order the API returns, with id as the tie-break. */
export function bySentAt(a: AcarsMessage, b: AcarsMessage): number {
  return a.sent_at.localeCompare(b.sent_at) || a.id - b.id;
}

/**
 * Merge rows into the thread by id, replacing any already on screen, then
 * re-sort. Used wherever a response can repeat rows the thread already holds
 * (load sheet and clearance re-requests, SayIntentions import, refresh).
 * Sends that always create brand-new rows append instead.
 */
export function mergeById(prev: AcarsMessage[], incoming: AcarsMessage[]): AcarsMessage[] {
  const merged = [...prev];
  for (const m of incoming) {
    const i = merged.findIndex(existing => existing.id === m.id);
    if (i === -1) merged.push(m);
    else merged[i] = m;
  }
  merged.sort(bySentAt);
  return merged;
}

/** A client-side-only sanity check; the server is still the authority. */
export function isPlausibleIcao(v: string): boolean {
  return /^[A-Za-z0-9]{4}$/.test(v.trim());
}
