// The complete export surface src/airports.ts has AFTER this run — design.md §7.
// REFERENCE ARTIFACT. Not compiled, not imported, not wired into the build.
//
// Four symbols are new (Airport, parseCSVLine, parseCSV, setAirports). Nothing
// else in src/airports.ts changes: no signature, no body, no behaviour — see
// design.md §8.4 (must-not-change M-1..M-4). Verified diff:
//   .claude/runs/2026-09-09-vitest-unit-tests/prototypes/airports-seam.diff

/** NEW export. Was a module-private interface at src/airports.ts:6. */
export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * NEW export. Was module-private at src/airports.ts:29. Body unchanged.
 * Splits one CSV line on unquoted commas. Quote characters are consumed, not
 * emitted; a doubled "" is NOT un-doubled (design.md §7.3, known limitation).
 */
export function parseCSVLine(line: string): string[];

/**
 * NEW export. Was module-private at src/airports.ts:59. Body unchanged.
 * OurAirports airports.csv -> Airport[]. Column indices: type=2, name=3,
 * latitude_deg=4, longitude_deg=5, gps_code=12, ident=1.
 */
export function parseCSV(csv: string): Airport[];

/**
 * NEW export. Replaces the three bare `airports = ...` assignments inside
 * initAirports() (src/airports.ts:82, :94, :98), so the seam sits ON the
 * production path rather than beside it. Production callers: initAirports only.
 */
export function setAirports(list: Airport[]): void;

/** UNCHANGED. src/airports.ts:79. */
export function initAirports(): Promise<void>;

/** UNCHANGED. src/airports.ts:102, including the `maxNm = 10` default. */
export function findNearestAirport(
  lat: number,
  lon: number,
  maxNm?: number,
): { icao: string; name: string } | null;
