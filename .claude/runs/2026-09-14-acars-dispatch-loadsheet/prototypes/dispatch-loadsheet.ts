/**
 * Prototype for run 2026-09-14-acars-dispatch-loadsheet.
 *
 * Runs the frozen rules against the real captured OFP
 * (samples/simbrief/simbrief.userid.json, 333 KB, captured 2026-09-13) so the
 * design records what they actually produce rather than what they are supposed
 * to produce. Not wired into the build; ts-node only:
 *
 *   export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
 *   npx ts-node .claude/runs/2026-09-14-acars-dispatch-loadsheet/prototypes/dispatch-loadsheet.ts
 *
 * `str` and `num` are copied verbatim from src/simbrief.ts so the coercion
 * behaviour under test is the parser's, not this file's.
 */

import * as fs from 'fs';
import * as path from 'path';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function rec(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}
function arr(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter(isRecord);
  if (isRecord(v) && Object.keys(v).length > 0) return [v];
  return [];
}

const file = path.resolve(__dirname, '../../../../samples/simbrief/simbrief.userid.json');
const root = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

const params = rec(root['params']);
const general = rec(root['general']);
const fuel = rec(root['fuel']);
const times = rec(root['times']);
const weights = rec(root['weights']);
const aircraft = rec(root['aircraft']);

// ── §3.1 plan.dispatch ────────────────────────────────────────────────────────
const dispatch = {
  units: str(params?.['units']),
  aircraftReg: str(aircraft?.['reg']),
  planRamp: num(fuel?.['plan_ramp']),
  planTakeoff: num(fuel?.['plan_takeoff']),
  planLanding: num(fuel?.['plan_landing']),
  taxi: num(fuel?.['taxi']),
  enrouteBurn: num(fuel?.['enroute_burn']),
  contingency: num(fuel?.['contingency']),
  reserve: num(fuel?.['reserve']),
  alternateBurn: num(fuel?.['alternate_burn']),
  estTimeEnrouteSec: num(times?.['est_time_enroute']),
  estBlockSec: num(times?.['est_block']),
  oew: num(weights?.['oew']),
  payload: num(weights?.['payload']),
  estZfw: num(weights?.['est_zfw']),
  maxZfw: num(weights?.['max_zfw']),
  estTow: num(weights?.['est_tow']),
  estLdw: num(weights?.['est_ldw']),
  paxCount: num(weights?.['pax_count']),
  cargo: num(weights?.['cargo']),
};

const originNode = rec(root['origin'])!;
const destNode = rec(root['destination'])!;
const alternates = arr(root['alternate'])
  .map((a) => str(a['icao_code']))
  .filter((x): x is string => x !== null);

// ── §4.2 payload_json ─────────────────────────────────────────────────────────
const payload = {
  v: 1,
  source: 'simbrief',
  ofp: {
    request_id: str(params?.['request_id']),
    sequence_id: str(params?.['sequence_id']),
    time_generated: str(params?.['time_generated']),
  },
  flight_number: str(general?.['flight_number']),
  aircraft_type: str(aircraft?.['icao_code']),
  aircraft_reg: dispatch.aircraftReg,
  origin: str(originNode['icao_code']),
  destination: str(destNode['icao_code']),
  alternates,
  route: str(general?.['route']),
  cruise_alt_ft: num(general?.['initial_altitude']),
  units: dispatch.units,
  ete_sec: dispatch.estTimeEnrouteSec,
  block_time_sec: dispatch.estBlockSec,
  fuel: {
    ramp: dispatch.planRamp,
    takeoff: dispatch.planTakeoff,
    landing: dispatch.planLanding,
    taxi: dispatch.taxi,
    enroute_burn: dispatch.enrouteBurn,
    contingency: dispatch.contingency,
    reserve: dispatch.reserve,
    alternate_burn: dispatch.alternateBurn,
  },
  weights: {
    oew: dispatch.oew,
    payload: dispatch.payload,
    est_zfw: dispatch.estZfw,
    max_zfw: dispatch.maxZfw,
    est_tow: dispatch.estTow,
    est_ldw: dispatch.estLdw,
    pax_count: dispatch.paxCount,
    cargo: dispatch.cargo,
  },
};

// ── §6.1 shared formatters ────────────────────────────────────────────────────
const MAX_ROUTE_CHARS = 900;

function hhmm(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '----';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}
function levelText(ft: number | null): string {
  if (ft === null) return 'UNKNOWN';
  const r = Math.round(ft);
  return r >= 18000 ? `FL${String(Math.round(r / 100)).padStart(3, '0')}` : `${r}FT`;
}
function qty(v: number | null): string {
  return v === null ? '----' : String(Math.round(v));
}
function unitText(units: string | null): string {
  const u = (units ?? '').toLowerCase();
  return u === 'kgs' || u === 'kg' ? 'KG' : u === 'lbs' || u === 'lb' ? 'LB' : 'UNITS UNKNOWN';
}
function clampRoute(route: string | null): string {
  if (route === null) return 'NIL';
  return route.length <= MAX_ROUTE_CHARS ? route : `${route.slice(0, MAX_ROUTE_CHARS - 3)}...`;
}
function field(label: string, value: string): string {
  return `${label.padEnd(14, ' ')}${value.padStart(6, ' ')}`;
}

// ── §5.2 dispatch-release body ────────────────────────────────────────────────
const issuedAt = '2026-09-14T09:22:01.000Z';

function dispatchBody(): string {
  const u = unitText(payload.units);
  const lines = [
    'DISPATCH RELEASE',
    `FLT ${payload.flight_number ?? 'UNKNOWN'}`,
    `${payload.origin ?? '????'} ${payload.destination ?? '????'} ALTN ${payload.alternates.length ? payload.alternates.join(' ') : 'NONE'}`,
    `ACFT ${payload.aircraft_type ?? 'UNKNOWN'} ${payload.aircraft_reg ?? 'NOREG'}`,
    `CRZ ${levelText(payload.cruise_alt_ft)}`,
    `ETE ${hhmm(payload.ete_sec)}`,
    `FUEL ${u} BLOCK ${qty(payload.fuel.ramp)} TRIP ${qty(payload.fuel.enroute_burn)} RESV ${qty(payload.fuel.reserve)} ALTN ${qty(payload.fuel.alternate_burn)} CONT ${qty(payload.fuel.contingency)} TAXI ${qty(payload.fuel.taxi)}`,
    `RTE ${clampRoute(payload.route)}`,
    `OFP ${payload.ofp.request_id ?? 'UNKNOWN'} ISSUED ${issuedAt}`,
    'SIMULATED DISPATCH RELEASE - NOT FOR REAL WORLD USE',
  ];
  return lines.join('\n');
}

// ── §6.3 load-sheet figures ───────────────────────────────────────────────────
type Source = 'simbrief' | 'derived' | 'unavailable';
function resolve(direct: number | null, derived: number | null): [number | null, Source] {
  if (direct !== null) return [direct, 'simbrief'];
  if (derived !== null) return [derived, 'derived'];
  return [null, 'unavailable'];
}
const w = payload.weights;
const f = payload.fuel;
const blockFuel = f.ramp !== null ? f.ramp
  : f.takeoff !== null && f.taxi !== null ? f.takeoff + f.taxi : null;
const [payloadWt, payloadSource] = resolve(
  w.payload,
  w.est_zfw !== null && w.oew !== null ? w.est_zfw - w.oew : null,
);
const [zfw, zfwSource] = resolve(
  w.est_zfw,
  w.oew !== null && payloadWt !== null ? w.oew + payloadWt : null,
);

const sheet = {
  units: payload.units,
  block_fuel: blockFuel,
  taxi_fuel: f.taxi,
  takeoff_fuel: f.takeoff,
  trip_fuel: f.enroute_burn,
  payload: payloadWt,
  payload_source: payloadSource,
  zero_fuel_weight: zfw,
  zfw_source: zfwSource,
  max_zero_fuel_weight: w.max_zfw,
  dry_operating_weight: w.oew,
  takeoff_weight: w.est_tow,
  landing_weight: w.est_ldw,
  pax_count: w.pax_count,
  cargo: w.cargo,
  estimated: true,
};

// ── §6.4 load-sheet bodies ────────────────────────────────────────────────────
const requestBody = `REQUEST LOADSHEET\n${payload.origin ?? '????'} ${payload.destination ?? '????'}${payload.flight_number ? ` FLT ${payload.flight_number}` : ''}`;

function replyBody(): string {
  const u = unitText(sheet.units);
  const zfwLine = sheet.max_zero_fuel_weight === null
    ? field('ZERO FUEL WT', qty(sheet.zero_fuel_weight))
    : `${field('ZERO FUEL WT', qty(sheet.zero_fuel_weight))} MAX ${qty(sheet.max_zero_fuel_weight)}`;
  const lines = [
    'LOADSHEET',
    `FLT ${payload.flight_number ?? 'UNKNOWN'} ${payload.origin ?? '????'} ${payload.destination ?? '????'}`,
    `ACFT ${payload.aircraft_type ?? 'UNKNOWN'} ${payload.aircraft_reg ?? 'NOREG'}`,
    `UNITS ${u}`,
    field('BLOCK FUEL', qty(sheet.block_fuel)),
    field('TAXI FUEL', qty(sheet.taxi_fuel)),
    field('TAKEOFF FUEL', qty(sheet.takeoff_fuel)),
    field('TRIP FUEL', qty(sheet.trip_fuel)),
    field('PAX', sheet.pax_count === null ? '----' : String(Math.round(sheet.pax_count))),
    field('CARGO', qty(sheet.cargo)),
    field('PAYLOAD', qty(sheet.payload)),
    field('DRY OPER WT', qty(sheet.dry_operating_weight)),
    zfwLine,
    field('TAKEOFF WT', qty(sheet.takeoff_weight)),
    field('LANDING WT', qty(sheet.landing_weight)),
    `ISSUED ${issuedAt}`,
    'ESTIMATED FIGURES - SIMULATION ONLY - NOT FOR ACTUAL LOADING',
  ];
  return lines.join('\n');
}

// ── output ────────────────────────────────────────────────────────────────────
const db = dispatchBody();
const rb = replyBody();

console.log('── plan.dispatch (§3.1) ──');
console.log(JSON.stringify(dispatch, null, 2));
console.log('\n── payload_json (§4.2), as stored ──');
console.log(JSON.stringify(payload));
console.log(`\n  payload_json length: ${JSON.stringify(payload).length} chars`);
console.log('\n── dispatch-release body (§5.2) ──');
console.log(db);
console.log(`\n  body length: ${db.length} chars (ceiling 4096)`);
console.log('\n── loadsheet request body (§6.4) ──');
console.log(requestBody);
console.log('\n── loadsheet reply body (§6.4) ──');
console.log(rb);
console.log(`\n  body length: ${rb.length} chars (ceiling 4096)`);
console.log('\n── LoadsheetFigures (§6.3) ──');
console.log(JSON.stringify(sheet, null, 2));

fs.writeFileSync(
  path.resolve(__dirname, 'output.txt'),
  [
    '── plan.dispatch (§3.1) ──', JSON.stringify(dispatch, null, 2),
    '', '── payload_json (§4.2), as stored ──', JSON.stringify(payload),
    '', '── dispatch-release body (§5.2) ──', db,
    '', '── loadsheet request body (§6.4) ──', requestBody,
    '', '── loadsheet reply body (§6.4) ──', rb,
    '', '── LoadsheetFigures (§6.3) ──', JSON.stringify(sheet, null, 2), '',
  ].join('\n'),
);
