#!/usr/bin/env ts-node
// ── KML export inspector ──────────────────────────────────────────────────────
//
// A read-only CLI over src/kmlExport.ts. It exists because the KML export has
// no route yet (T-004) and no UI: this is how the document shape is checked
// against real rows, with no server running. design.md §5.3.
//
//   npx ts-node src/inspect-kml.ts --db <path-to-flights.db> --flight 63
//   npx ts-node src/inspect-kml.ts --db <dir-containing-a-copy> --trip 7
//   npx ts-node src/inspect-kml.ts --db <path> --flights 63,59,71 --out /tmp/x.kml
//
// `--db` is mandatory and never optional: src/db.ts's initDb() opens the file
// read-write, sets WAL and runs `CREATE TABLE IF NOT EXISTS` migrations, so
// pointing this at the live flights.db would write to the user's real
// logbook. Requiring an explicit path makes that impossible by accident.
//
// src/db.ts:9 freezes DB_PATH = path.join(process.cwd(), 'flights.db') at
// module load, so a --db flag alone does nothing — './db' must not be
// imported at the top of this file. The require() in main(), after the
// chdir, is the first import of that module in this process: the same idiom,
// and the same reason, as src/inspect-legmatch.ts:404-423.
//
// The document goes to stdout (or --out) and nothing else does; every
// diagnostic goes to stderr, so this pipes straight into an XML validator.

import fs from 'fs';
import path from 'path';
import { buildFlightKml, buildFlightSetKml, buildTripKml, type KmlFlight } from './kmlExport';

function usage(): string {
  return 'usage: npx ts-node src/inspect-kml.ts --db <path-to-flights.db> (--flight <id> | --trip <id> | --flights <id,id,…>) [--out <file>]';
}

type Scope =
  | { kind: 'flight'; id: number }
  | { kind: 'trip'; id: number }
  | { kind: 'flights'; ids: number[] };

interface Args {
  dbPath: string;
  outFile: string | null;
  scope: Scope;
}

/** Returns null (and has already printed the one-line usage message and set
 *  process.exitCode = 2) on any malformed invocation — never throws. */
function parseArgs(argv: string[]): Args | null {
  let dbPath: string | null = null;
  let outFile: string | null = null;
  const scopeFlags: { kind: 'flight' | 'trip' | 'flights'; raw: string }[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') dbPath = argv[++i] ?? null;
    else if (a === '--flight') scopeFlags.push({ kind: 'flight', raw: argv[++i] ?? '' });
    else if (a === '--trip') scopeFlags.push({ kind: 'trip', raw: argv[++i] ?? '' });
    else if (a === '--flights') scopeFlags.push({ kind: 'flights', raw: argv[++i] ?? '' });
    else if (a === '--out') outFile = argv[++i] ?? null;
    else {
      console.error(usage());
      process.exitCode = 2;
      return null;
    }
  }

  if (dbPath === null || dbPath === '') {
    console.error(usage());
    process.exitCode = 2;
    return null;
  }
  if (scopeFlags.length !== 1) {
    console.error(usage());
    process.exitCode = 2;
    return null;
  }

  const flag = scopeFlags[0];
  if (flag.kind === 'flight' || flag.kind === 'trip') {
    const id = Number(flag.raw);
    if (!Number.isInteger(id)) {
      console.error(usage());
      process.exitCode = 2;
      return null;
    }
    return { dbPath, outFile, scope: { kind: flag.kind, id } };
  }

  // --flights id,id,… — same first-occurrence-wins de-dup as design §2.3.
  const ids: number[] = [];
  const seen = new Set<number>();
  const parts = flag.raw.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) {
    console.error(usage());
    process.exitCode = 2;
    return null;
  }
  for (const part of parts) {
    const id = Number(part);
    if (!Number.isInteger(id)) {
      console.error(usage());
      process.exitCode = 2;
      return null;
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { dbPath, outFile, scope: { kind: 'flights', ids } };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return;

  const resolved = path.resolve(args.dbPath);
  const targetDir = path.basename(resolved) === 'flights.db' ? path.dirname(resolved) : resolved;
  process.chdir(targetDir);
  // Printed to stderr, per design §5.3, so the operator can see which file was
  // opened before anything that could write to it runs.
  console.error(`opening database: ${path.join(targetDir, 'flights.db')}`);

  // The first import of './db' in this process — see the header comment.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dbModule = require('./db') as typeof import('./db');
  dbModule.initDb();

  let kml: string;
  switch (args.scope.kind) {
    case 'flight': {
      const flight = dbModule.getFlightById(args.scope.id);
      if (flight === null) {
        console.error(`Flight ${args.scope.id} not found`);
        process.exitCode = 1;
        return;
      }
      kml = buildFlightKml(flight);
      break;
    }
    case 'trip': {
      const trip = dbModule.getTripById(args.scope.id);
      if (trip === null) {
        console.error(`Trip ${args.scope.id} not found`);
        process.exitCode = 1;
        return;
      }
      kml = buildTripKml(trip.name, trip.flights);
      break;
    }
    case 'flights': {
      const flights: KmlFlight[] = [];
      for (const id of args.scope.ids) {
        const flight = dbModule.getFlightById(id);
        if (flight === null) {
          console.error(`Flight ${id} not found`);
          process.exitCode = 1;
          return;
        }
        flights.push(flight);
      }
      kml = buildFlightSetKml(flights);
      break;
    }
  }

  if (args.outFile !== null) {
    fs.writeFileSync(args.outFile, kml);
  } else {
    process.stdout.write(kml);
  }
}

main();
