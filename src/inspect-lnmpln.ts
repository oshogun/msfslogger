#!/usr/bin/env ts-node
// ── .lnmpln inspector ─────────────────────────────────────────────────────────
//
// A read-only CLI over src/lnmpln.ts. It exists so the parser can be exercised
// against real Little Navmap exports without a database, a server or an import,
// and so the batch chain-sort rule can be demonstrated on actual files rather
// than argued about.
//
//   npx ts-node src/inspect-lnmpln.ts samples/lnmpln/*.lnmpln
//   npx ts-node src/inspect-lnmpln.ts 'samples/lnmpln/VFR*.lnmpln'
//
// Globs are expanded by the shell when unquoted and by this script when quoted,
// so both forms above work.
//
// Exit status is 0 only when every file parsed. A rejected file prints one line
// naming the reject code and the offending element — never a stack trace — and
// makes the whole run exit non-zero.

import fs from 'fs';
import path from 'path';
import {
  parseLnmpln,
  chainOrderForBatch,
  LnmplnParseError,
  type ParsedFlightPlan,
  type ParsedProcedures,
} from './lnmpln';

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

function procedureLines(p: ParsedProcedures): string[] {
  const rows: [string, string | number | null][] = [
    ['SID', p.sidName],
    ['SID runway', p.sidRunway],
    ['SID transition', p.sidTransition],
    ['SID type', p.sidType],
    ['SID custom distance', p.sidCustomDistanceNm],
    ['STAR', p.starName],
    ['STAR runway', p.starRunway],
    ['STAR transition', p.starTransition],
    ['approach', p.approachName],
    ['approach runway', p.approachRunway],
    ['approach transition', p.approachTransition],
    ['approach type', p.approachType],
    ['approach ARINC', p.approachArinc],
    ['approach suffix', p.approachSuffix],
    ['approach transition type', p.approachTransitionType],
    ['approach CustomDistance', p.approachCustomDistanceNm],
    ['approach CustomAltitude', p.approachCustomAltitudeFt],
    ['approach CustomOffsetAngle', p.approachCustomOffsetDeg],
  ];
  return rows.filter(([, v]) => v !== null).map(([k, v]) => `                ${k}: ${v}`);
}

function report(file: string, plan: ParsedFlightPlan): void {
  const d = plan.departure;
  const a = plan.destination;
  const depType = plan.waypoints[0].type;
  const dstType = plan.waypoints[plan.waypoints.length - 1].type;
  const allStrings = plan.waypoints.every((w) => typeof w.ident === 'string');

  console.log(`── ${path.basename(file)}`);
  console.log(`   departure    ${d.ident} (${depType})  isAirport=${d.isAirport}  ${nullable(d.name)}`);
  console.log(`   destination  ${a.ident} (${dstType})  isAirport=${a.isAirport}  ${nullable(a.name)}`);
  console.log(`   cruise alt   ${plan.cruiseAltFt === null ? '—' : `${plan.cruiseAltFt} ft`}`);
  console.log(
    `   counts       waypoints=${plan.waypoints.length}  alternates=${plan.alternates.length}  isSnippet=${plan.isSnippet}`,
  );
  // Always qualified: the file never contains procedure legs, so this number is
  // short of the real routing by the whole length of the SID, STAR and approach.
  console.log(`   distance     approx. ${plan.approxDistanceNm.toFixed(1)} nm`);
  console.log(`   plan         type=${nullable(plan.flightplanType)}  aircraft=${nullable(plan.aircraftType)}`);
  console.log(`   created      ${nullable(plan.createdAt)}`);
  // NavData cycle is read per file and never cached: real logbooks mix cycles.
  console.log(
    `   provenance   ${nullable(plan.sourceProgram)}  sim=${nullable(plan.simData)}  navdata=${nullable(plan.navDataSource)} cycle=${nullable(plan.navDataCycle)}`,
  );
  console.log(`   remarks      ${nullable(plan.remarks)}`);

  const ds = plan.departureStart;
  if (ds.pos || ds.start || ds.startType || ds.headingTrueDeg !== null) {
    console.log(
      `   departure el start=${nullable(ds.start)}  type=${nullable(ds.startType)}  heading=${nullable(ds.headingTrueDeg)}  pos=${ds.pos ? `${ds.pos.lat},${ds.pos.lon}` : '—'}`,
    );
  } else {
    console.log('   departure el (absent — the common case; nothing may depend on it)');
  }

  const procs = procedureLines(plan.procedures);
  console.log(`   procedures   ${procs.length === 0 ? '(none)' : ''}`);
  procs.forEach((l) => console.log(l));

  console.log(
    `   route        ${plan.waypoints.map((w) => `${w.ident}:${w.type}`).join(' ')}  [idents all typeof string: ${allStrings}]`,
  );
  for (const w of plan.waypoints) {
    if (w.comment !== null) console.log(`                remark @${w.seq} ${w.ident}: ${w.comment}`);
  }
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
    console.error('usage: ts-node src/inspect-lnmpln.ts <file-or-glob> [...]');
    process.exitCode = 2;
    return;
  }

  const files = args.flatMap(expandGlob);
  if (files.length === 0) {
    console.error('no files matched');
    process.exitCode = 2;
    return;
  }

  let rejected = 0;
  const parsed: { file: string; plan: ParsedFlightPlan }[] = [];

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
      const plan = parseLnmpln(bytes, path.basename(file));
      parsed.push({ file, plan });
      report(file, plan);
    } catch (err) {
      // One line, naming the code and the element. A stack trace here would be a
      // defect: the same error becomes a 400 body on the import route.
      if (err instanceof LnmplnParseError) {
        console.error(`✗ REJECTED ${err.code}: ${err.message}`);
      } else {
        console.error(`✗ REJECTED INTERNAL: ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
      }
      rejected++;
    }
  }

  // ── Batch ordering ──────────────────────────────────────────────────────────
  // Only the files that parsed take part, exactly as on import: a batch reduced
  // to a broken chain by a rejection simply falls back, which is the conservative
  // outcome.
  if (parsed.length > 0) {
    const chain = chainOrderForBatch(parsed.map((p) => p.plan));
    console.log('── batch chain order');
    console.log(`   ordering     ${chain.resolved ? 'chain' : 'upload'}   reason ${chain.reason}`);
    chain.order.forEach((idx, i) => {
      const { file, plan } = parsed[idx];
      console.log(
        `   ${String(i + 1).padStart(2)}. ${plan.departure.ident} -> ${plan.destination.ident}   ${path.basename(file)}`,
      );
    });
    console.log('');
  }

  console.log(`${parsed.length} parsed, ${rejected} rejected, ${files.length} file(s) seen`);
  if (rejected > 0) process.exitCode = 1;
}

main();
