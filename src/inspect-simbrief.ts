#!/usr/bin/env ts-node
// ── SimBrief OFP inspector ────────────────────────────────────────────────────
//
// A read-only CLI over src/simbrief.ts. It exists so the OFP parser can be
// exercised against real captured responses without a database, a server, a
// SimBrief account or a network connection — hand it a saved response body and
// it prints what the import would store.
//
//   npx ts-node src/inspect-simbrief.ts samples/simbrief/simbrief.userid.json
//   npx ts-node src/inspect-simbrief.ts 'samples/simbrief/synthetic/bad-*'
//
// Globs are expanded by the shell when unquoted and by this script when quoted,
// so both forms above work.
//
// Exit status is 0 only when every file parsed. A rejected file prints one line
// naming the reject code and the offending field — never a stack trace — and
// makes the whole run exit non-zero, exactly as the import route turns the same
// error into a 502 with one sentence.

import fs from 'fs';
import path from 'path';
import { parseSimbriefPlan, SimbriefParseError, type ParsedSimbriefPlan } from './simbrief';

// ── Argument expansion ────────────────────────────────────────────────────────

function expandGlob(pattern: string): string[] {
  if (!/[*?]/.test(pattern)) return [pattern];
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  const rx = new RegExp(
    `^${base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
  );
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => rx.test(e)).sort().map((e) => path.join(dir, e));
}

// ── Formatting ────────────────────────────────────────────────────────────────

const nullable = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? '—' : String(v);

function report(file: string, plan: ParsedSimbriefPlan): void {
  const d = plan.departure;
  const a = plan.destination;

  console.log(`── ${path.basename(file)}`);
  console.log(`   departure    ${d.ident}  isAirport=${d.isAirport}  ${nullable(d.name)}  ${d.lat},${d.lon}`);
  console.log(`   destination  ${a.ident}  isAirport=${a.isAirport}  ${nullable(a.name)}  ${a.lat},${a.lon}`);
  console.log(`   cruise alt   ${plan.cruiseAltFt === null ? '—' : `${plan.cruiseAltFt} ft`}`);
  console.log(
    `   counts       waypoints=${plan.waypoints.length}  alternates=${plan.alternates.length}  isSnippet=${plan.isSnippet}`,
  );
  // "approx." because the column and the UI say so, even though the OFP does
  // carry SID and STAR waypoints and this sum is within a fraction of a percent
  // of SimBrief's own figure.
  console.log(`   distance     approx. ${plan.approxDistanceNm.toFixed(1)} nm`);
  console.log(`   plan         type=${nullable(plan.flightplanType)}  aircraft=${nullable(plan.aircraftType)}`);
  console.log(`   created      ${nullable(plan.createdAt)}`);
  console.log(
    `   ofp          request=${nullable(plan.ofp.requestId)}  sequence=${nullable(plan.ofp.sequenceId)}  generated=${nullable(plan.ofp.timeGenerated)}  user=${nullable(plan.ofp.userId)}`,
  );
  console.log(`   flight no.   ${nullable(plan.ofp.flightNumber)}`);
  console.log(`   remarks      ${nullable(plan.remarks)}`);

  const p = plan.procedures;
  console.log(
    `   procedures   SID ${nullable(p.sidName)}/${nullable(p.sidRunway)}/${nullable(p.sidTransition)}   STAR ${nullable(p.starName)}/${nullable(p.starRunway)}/${nullable(p.starTransition)}`,
  );
  console.log(`   route        ${plan.waypoints.map((w) => `${w.ident}:${w.type}`).join(' ')}`);
  for (const alt of plan.alternates) {
    console.log(
      `   alternate ${alt.seq}  ${alt.ident} (${nullable(alt.type)})  lat=${nullable(alt.lat)} lon=${nullable(alt.lon)} alt=${nullable(alt.altFt)}`,
    );
  }

  if (plan.warnings.length === 0) {
    console.log('   warnings     (none)');
  } else {
    console.log(`   warnings     ${plan.warnings.length}`);
    for (const w of plan.warnings) console.log(`                ${w.code}: ${w.message}`);
  }
  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: ts-node src/inspect-simbrief.ts <file-or-glob> [...]');
    process.exitCode = 2;
    return;
  }

  const files = args.flatMap(expandGlob);
  if (files.length === 0) {
    console.error('no files matched');
    process.exitCode = 2;
    return;
  }

  let parsed = 0;
  let rejected = 0;

  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(file);
    } catch (err) {
      console.error(`✗ ${path.basename(file)}: cannot read (${err instanceof Error ? err.message : String(err)})`);
      rejected++;
      continue;
    }
    try {
      // The raw bytes go straight in: decoding is the parser's job, so the two
      // callers — this and the import route — cannot disagree about it.
      const plan = parseSimbriefPlan(bytes);
      parsed++;
      report(file, plan);
    } catch (err) {
      if (err instanceof SimbriefParseError) {
        console.error(`✗ REJECTED ${path.basename(file)} ${err.code}: ${err.message}`);
      } else {
        console.error(
          `✗ REJECTED INTERNAL: ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      rejected++;
    }
  }

  console.log(`${parsed} parsed, ${rejected} rejected, ${files.length} file(s) seen`);
  if (rejected > 0) process.exitCode = 1;
}

main();
