#!/usr/bin/env ts-node
// ── ACARS message inspector ───────────────────────────────────────────────────
//
// A CLI over src/db/acarsMessages.ts. It exists because most of what that
// module stores has no UI and no route yet: the clearance, the loadsheet, the
// weather reply and the position report are all written by features that do not
// exist, and this is how the table is checked against them today.
//
//   npx ts-node src/inspect-acars.ts --db <dir-with-a-copy> --flight 81 \
//       --samples <dir-of-sample-json>
//   npx ts-node src/inspect-acars.ts --db <dir-with-a-copy> --flight 81   # list only
//
// `--db` is mandatory and never optional: initDb() opens the file read-write,
// sets WAL and runs the CREATE TABLE IF NOT EXISTS block, and --samples then
// INSERTS. Pointing either at the user's real logbook would write to it, so the
// path is always explicit. As in src/inspect-kml.ts, './db' must not be
// imported at the top of this file — src/db/connection.ts freezes its path from
// process.cwd() at module load, so the require() below, after the chdir, is the
// first import of that module in this process.
//
// With --samples, each *.json file in the directory is
// { story, note, scope, message } and its `message` is inserted verbatim after
// exactly two substitutions: "{flight_id}" / "{planned_leg_id}" become the ids
// of the flight given on the command line (including inside dedup_key), and
// "{id:<file-stem>}" in correlation_id becomes the id that file's own insert
// returned. A sample that will not store without a new column is a failure of
// the table, not a reason to edit the sample.
//
// PRAGMA table_info(acars_messages) is printed before and after the inserts and
// compared: storing every one of these messages must not change the schema by
// one byte.

import fs from 'fs';
import path from 'path';
import type { AcarsMessage, CreateAcarsMessage } from './types';

function usage(): string {
  return 'usage: npx ts-node src/inspect-acars.ts --db <path-to-flights.db> --flight <id> [--samples <dir>]';
}

interface Args {
  dbPath: string;
  flightId: number;
  samplesDir: string | null;
}

/** Returns null (having printed the usage line and set exitCode 2) on any
 *  malformed invocation — never throws. */
function parseArgs(argv: string[]): Args | null {
  let dbPath: string | null = null;
  let flightRaw: string | null = null;
  let samplesDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') dbPath = argv[++i] ?? null;
    else if (a === '--flight') flightRaw = argv[++i] ?? null;
    else if (a === '--samples') samplesDir = argv[++i] ?? null;
    else {
      console.error(usage());
      process.exitCode = 2;
      return null;
    }
  }

  const flightId = Number(flightRaw);
  if (!dbPath || !flightRaw || !Number.isInteger(flightId)) {
    console.error(usage());
    process.exitCode = 2;
    return null;
  }
  return { dbPath, flightId, samplesDir };
}

interface SampleFile {
  story: string;
  note: string;
  scope: 'flight' | 'leg';
  message: Record<string, unknown>;
}

/** The two permitted substitutions, applied to one string field. */
function substitute(
  value: unknown,
  flightId: number,
  plannedLegId: number | null,
  idsByStem: Map<string, number>,
): unknown {
  if (typeof value !== 'string') return value;
  if (value === '{flight_id}') return flightId;
  if (value === '{planned_leg_id}') return plannedLegId;

  const correlation = /^\{id:(.+)\}$/.exec(value);
  if (correlation) {
    const id = idsByStem.get(correlation[1]);
    if (id === undefined) throw new Error(`sample refers to {id:${correlation[1]}}, which has not been inserted`);
    return id;
  }

  return value
    .replace('{flight_id}', String(flightId))
    .replace('{planned_leg_id}', String(plannedLegId));
}

function formatMessage(m: AcarsMessage): string {
  const scope = m.flight_id !== null ? `flight=${m.flight_id}` : `leg=${m.planned_leg_id}`;
  const firstLine = m.body.split('\n')[0];
  return [
    String(m.id).padStart(4),
    m.sent_at,
    m.direction.padEnd(8),
    String(m.category).padEnd(16),
    scope.padEnd(12),
    (m.label ?? '-').padEnd(18),
    m.dedup_key === null ? '-'.padEnd(28) : m.dedup_key.padEnd(28),
    m.payload_json === null ? 'payload:-' : 'payload:json',
    m.correlation_id === null ? 'reply-to:-' : `reply-to:${m.correlation_id}`,
    `| ${firstLine}`,
  ].join(' ');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return;

  const resolved = path.resolve(args.dbPath);
  const targetDir = path.basename(resolved) === 'flights.db' ? path.dirname(resolved) : resolved;
  const samplesDir = args.samplesDir === null ? null : path.resolve(args.samplesDir);
  process.chdir(targetDir);
  console.error(`opening database: ${path.join(targetDir, 'flights.db')}`);

  // The first import of './db' in this process — see the header comment.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require('./db') as typeof import('./db');
  db.initDb();

  const tableInfoBefore = JSON.stringify(db.getDb().prepare('PRAGMA table_info(acars_messages)').all(), null, 2);
  console.log('── PRAGMA table_info(acars_messages), before ──');
  console.log(tableInfoBefore);

  const plannedLegId = db.getFlightPlannedLegId(args.flightId);
  console.log(`\nflight ${args.flightId}, planned_leg_id ${plannedLegId === null ? 'null' : plannedLegId}`);

  if (samplesDir !== null) {
    const files = fs.readdirSync(samplesDir).filter(f => f.endsWith('.json')).sort();
    const idsByStem = new Map<string, number>();

    console.log('\n── inserting samples ──');
    for (const file of files) {
      const stem = file.replace(/\.json$/, '');
      const sample = JSON.parse(fs.readFileSync(path.join(samplesDir, file), 'utf8')) as SampleFile;

      const message: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(sample.message)) {
        message[key] = substitute(value, args.flightId, plannedLegId, idsByStem);
      }
      const create = message as unknown as CreateAcarsMessage;

      // The dedup path is the one the "issue exactly once" features rely on, so
      // a sample that carries a key is stored through it rather than around it.
      const stored = typeof create.dedup_key === 'string' && create.dedup_key !== ''
        ? db.insertAcarsMessageOnce(create as CreateAcarsMessage & { dedup_key: string })
        : { message: db.insertAcarsMessage(create), created: true };

      idsByStem.set(stem, stored.message.id);
      console.log(`${stored.created ? 'stored ' : 'existed'} ${file.padEnd(28)} id=${String(stored.message.id).padEnd(5)} ${sample.story}`);
    }

    const tableInfoAfter = JSON.stringify(db.getDb().prepare('PRAGMA table_info(acars_messages)').all(), null, 2);
    console.log('\n── PRAGMA table_info(acars_messages), after ──');
    console.log(tableInfoAfter);
    console.log(`\ntable_info unchanged by every insert: ${tableInfoBefore === tableInfoAfter}`);
    if (tableInfoBefore !== tableInfoAfter) process.exitCode = 1;
  }

  console.log(`\n── thread for flight ${args.flightId} (its own rows plus leg ${plannedLegId ?? '-'}'s) ──`);
  for (const m of db.listAcarsMessagesForFlight(args.flightId)) console.log(formatMessage(m));

  if (plannedLegId !== null) {
    console.log(`\n── leg ${plannedLegId} only ──`);
    for (const m of db.listAcarsMessagesForPlannedLeg(plannedLegId)) console.log(formatMessage(m));
  }

  db.closeDb();
}

main();
