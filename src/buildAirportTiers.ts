// Generates airport-tiers.json from the OurAirports CSV — a manual CLI, run
// by hand and never on a startup or request path. See src/navdata/airportTiers.ts
// for what consumes the file this writes.

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Deliberately duplicated from src/airports.ts's own copy of this URL: the
// two subsystems classify airports for different purposes and stay decoupled,
// at the cost of the same string living in two places.
const AIRPORTS_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUTPUT_PATH = path.join(process.cwd(), 'airport-tiers.json');

const TYPE_CODE: Record<string, number> = {
  large_airport: 1,
  medium_airport: 2,
  small_airport: 3,
  heliport: 5,
  seaplane_base: 5,
  balloonport: 5,
  closed: 5,
};

// The same ident shape the manual-request endpoint already accepts.
const IDENT_RE = /^[A-Z0-9]{1,8}$/;

function download(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        download(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk as Buffer));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Quote-aware splitter, the same shape src/airports.ts uses: a quoted field
// may itself contain a comma.
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

export interface BuildResult {
  counts: Record<number, number>;
  tiers: Record<number, string[]>;
  rowsRead: number;
  rowsSkippedType: number;
  rowsSkippedIdent: number;
}

/**
 * Classifies every row of the OurAirports CSV, resolving columns by header
 * name (the upstream column order has moved before and will again) and
 * keeping the most significant tier when an ident appears more than once —
 * an active airport is never demoted by a closed namesake reusing its code.
 */
export function buildTiers(csv: string): BuildResult {
  const lines = csv.split('\n');
  const header = parseCsvLine(lines[0] ?? '').map(h => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const identCol = col('ident');
  const typeCol = col('type');
  const gpsCol = col('gps_code');
  if (identCol < 0 || typeCol < 0 || gpsCol < 0) {
    throw new Error(`CSV header is missing ident/type/gps_code: ${header.join(',')}`);
  }

  const byIdent = new Map<string, number>();
  let rowsRead = 0;
  let rowsSkippedType = 0;
  let rowsSkippedIdent = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    rowsRead++;
    const f = parseCsvLine(line);
    const code = TYPE_CODE[f[typeCol]];
    if (code === undefined) { rowsSkippedType++; continue; }
    const ident = (f[gpsCol] || f[identCol] || '').trim().toUpperCase();
    if (!IDENT_RE.test(ident)) { rowsSkippedIdent++; continue; }
    const prev = byIdent.get(ident);
    if (prev === undefined || code < prev) byIdent.set(ident, code);
  }

  const tiers: Record<number, string[]> = { 1: [], 2: [], 3: [], 5: [] };
  for (const [ident, code] of byIdent) tiers[code].push(ident);
  for (const code of Object.keys(tiers)) tiers[Number(code)].sort();

  const counts: Record<number, number> = {};
  for (const code of Object.keys(tiers)) counts[Number(code)] = tiers[Number(code)].length;

  return { counts, tiers, rowsRead, rowsSkippedType, rowsSkippedIdent };
}

export function formatOutput(result: BuildResult, generatedAt: string = new Date().toISOString()): string {
  return JSON.stringify({
    version: 1,
    generatedAt,
    source: AIRPORTS_CSV_URL,
    counts: result.counts,
    tiers: Object.fromEntries(Object.entries(result.tiers).map(([code, idents]) => [code, idents.join(' ')])),
  });
}

export async function main(): Promise<void> {
  const csvPath = process.argv[2];
  const csv = csvPath ? fs.readFileSync(csvPath, 'utf8') : await download(AIRPORTS_CSV_URL);
  const result = buildTiers(csv);
  const out = formatOutput(result);
  fs.writeFileSync(OUTPUT_PATH, out);
  console.log(`Rows read: ${result.rowsRead}`);
  console.log(`Skipped (unrecognised type): ${result.rowsSkippedType}`);
  console.log(`Skipped (bad ident): ${result.rowsSkippedIdent}`);
  console.log(`Entries per tier: ${JSON.stringify(result.counts)}`);
  console.log(`Bytes written: ${Buffer.byteLength(out)}`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
