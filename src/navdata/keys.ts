// Key expressions for the navdata replica. Byte-identical with the sidecar:
// the server computes them only for lookups, rows arrive with their keys
// already computed. The runway key is never computed here, because a plan
// runway may name the secondary end of a row keyed on the primary end.

import type { TransitionRole } from './wire';

export const wptKey = (ident: string, region: string, lat: number, lon: number): string =>
  `${ident}|${region}|${Math.round(lat * 1e5)}|${Math.round(lon * 1e5)}`;

/** Endpoints ordered by JS string comparison, so both directions share a key. */
export const legKey = (airway: string, a: string, b: string): string =>
  a < b ? `${airway}|${a}|${b}` : `${airway}|${b}|${a}`;

/** 0.5 degree grid, 720 columns. */
export const cellId = (lat: number, lon: number): number =>
  Math.floor((lat + 90) * 2) * 720 + Math.floor((lon + 180) * 2);

export const procKey = (
  airport: string,
  kind: 'SID' | 'STAR' | 'APPROACH',
  name: string,
  runwayNumber: number | null,
  runwayDesignator: number | null,
  suffix: string | null,
): string => [airport, kind, name, runwayNumber ?? '', runwayDesignator ?? '', suffix ?? ''].join('|');

export const transKey = (proc: string, role: TransitionRole, name: string): string =>
  `${proc}|${role}|${name}`;

const DESIGNATORS: Record<string, number> = { L: 1, R: 2, C: 3, W: 4, A: 5, B: 6 };
const COMPASS: Record<string, number> = { N: 37, NE: 38, E: 39, SE: 40, S: 41, SW: 42, W: 43, NW: 44 };

/**
 * Parses a runway designation into the number/designator pair the replica
 * stores. Digits 1-36 with an optional L/R/C/W/A/B letter, or a compass word
 * (37-44). Anything else, including designator 7 and number 45, is null.
 */
export function parseRunway(s: string | null): { number: number; designator: number } | null {
  if (s == null) return null;
  const t = s.trim().toUpperCase();
  const compass = COMPASS[t];
  if (compass !== undefined) return { number: compass, designator: 0 };
  const m = /^(\d{1,2})([A-Z]?)$/.exec(t);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  if (number < 1 || number > 36) return null;
  if (m[2] === '') return { number, designator: 0 };
  const designator = DESIGNATORS[m[2]];
  return designator === undefined ? null : { number, designator };
}

export interface ProcKeyRecord {
  id: string;
  fafIdent: string | null | undefined;
  nTransitions: number | null | undefined;
  missedLegCount: number | null | undefined;
  missedAltM: number | null | undefined;
}

const isAbsent = (v: string | number | null | undefined): boolean =>
  v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Absent sorts last; otherwise ascending. Total even with NaN, which no subtraction would be. */
function compareField<T extends string | number>(a: T | null | undefined, b: T | null | undefined): number {
  const aAbsent = isAbsent(a);
  const bAbsent = isAbsent(b);
  if (aAbsent || bAbsent) return aAbsent === bAbsent ? 0 : aAbsent ? 1 : -1;
  return (a as T) < (b as T) ? -1 : (a as T) > (b as T) ? 1 : 0;
}

/**
 * Test-only mirror of how the sidecar disambiguates procedures that share a
 * base key; the server never computes a proc_key at runtime. The first record
 * in the order below keeps the base key, the next gets `#2`, then `#3`; there
 * is no `#1`, and a set of one keeps the base key untouched. The order comes
 * from the data (FAF ident by code-unit comparison, then transition count,
 * missed-leg count and missed altitude), with arrival position as the last
 * tiebreak, and absent values always sort last.
 */
export function assignProcKeys(records: readonly ProcKeyRecord[], baseKey: string): Map<string, string> {
  const ordered = records
    .map((record, arrival) => ({ record, arrival }))
    .sort((x, y) =>
      compareField(x.record.fafIdent, y.record.fafIdent) ||
      compareField(x.record.nTransitions, y.record.nTransitions) ||
      compareField(x.record.missedLegCount, y.record.missedLegCount) ||
      compareField(x.record.missedAltM, y.record.missedAltM) ||
      x.arrival - y.arrival);
  const keys = new Map<string, string>();
  ordered.forEach(({ record }, i) => keys.set(record.id, i === 0 ? baseKey : `${baseKey}#${i + 1}`));
  return keys;
}
