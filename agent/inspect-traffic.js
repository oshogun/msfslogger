#!/usr/bin/env node
'use strict';

// ── AI-traffic batch-assembly scenario harness ───────────────────────────────
//
// A plain-node CLI over agent/traffic.js (buildTrafficBatch, TRAFFIC_ENABLED,
// trafficRadiusM parsing). Requires nothing but agent/traffic.js — no
// node-simconnect, no node_modules, no network — so it runs on this machine
// even though node-simconnect is not installed here.
//
//   node agent/inspect-traffic.js
//   TRAFFIC_ENABLED=off node agent/inspect-traffic.js
//   TRAFFIC_RADIUS_M=5000 node agent/inspect-traffic.js
//
// ── Why the "expected" column is transcribed, not derived ────────────────────
//
// Every expected value below is copied BY HAND from the truth table (rows
// A1-A28) that this harness and src/inspect-traffic.ts both follow. None of
// it is computed by calling buildTrafficBatch to derive what the answer
// "should" be. If a row here is ever found to disagree with the truth table,
// that is a question for the design, not something to quietly reconcile in
// this file.
//
// Because TRAFFIC_ENABLED/trafficRadiusM (rows A20-A26) are parsed once, at
// module load, from process.env, this file re-requires a fresh copy of
// agent/traffic.js under a patched env for each of those rows (Node's require
// cache is bypassed via cache-busting) rather than trying to mutate an
// already-parsed module-level constant.

const path = require('path');
const trafficPath = require.resolve('./traffic.js');

const failures = [];
let rowCount = 0;

function printRow(id, scenario, expected, ok, actual) {
  rowCount++;
  console.log(`   ${id}  ${scenario}`);
  console.log(`        expected: ${expected}`);
  console.log(`        actual:   ${actual}  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failures.push(`   FAIL ${id} (${scenario}): expected ${expected}, got ${actual}`);
}

/** Loads a fresh copy of agent/traffic.js under a patched environment. */
function loadTrafficWithEnv(envOverrides) {
  const saved = {};
  for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[trafficPath];
  const fresh = require('./traffic.js');
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[trafficPath];
  return fresh;
}

function fmtBatch(objs) {
  if (objs.length === 0) return '[]';
  return '[' + objs.map((o) => `{id:${o.id},lat:${o.lat},lon:${o.lon},alt:${o.altitudeFt},hdg:${o.headingDeg},gnd:${o.onGround}}`).join(', ') + ']';
}

function sameBatch(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) =>
    x.id === b[i].id && x.lat === b[i].lat && x.lon === b[i].lon &&
    x.altitudeFt === b[i].altitudeFt && x.headingDeg === b[i].headingDeg && x.onGround === b[i].onGround);
}

// Baseline: userObjectId = 1, user at (47.4500, -122.3000).
const USER_ID = 1;
const USER_LAT = 47.45;
const USER_LON = -122.3;

/** Builds a minimally-shaped, individually-valid sweep record. */
function obj(id, overrides = {}) {
  return {
    id,
    lat: 40 + id * 0.01,
    lon: -120 - id * 0.01,
    altitudeFt: 5000,
    headingDeg: 90,
    groundSpeedKnots: 120,
    onGround: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent batch assembly
// ═══════════════════════════════════════════════════════════════════════════

function runBatchRows() {
  console.log('── Agent batch assembly — buildTrafficBatch() (agent/traffic.js)');
  console.log('');

  const { buildTrafficBatch } = loadTrafficWithEnv({ TRAFFIC_ENABLED: undefined });

  // A1 — 3 airborne, finite objects, none excluded: all 3 kept, in order.
  {
    const sweep = [obj(5), obj(7), obj(9)];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 3 && batch[0].id === 5 && batch[1].id === 7 && batch[2].id === 9
      && Object.keys(batch[0]).sort().join(',') === 'altitudeFt,headingDeg,id,lat,lon,onGround';
    printRow('A1', 'ids 5,7,9, all airborne and finite', 'all 3, in sweep order, six fields, no groundSpeedKnots', ok, fmtBatch(batch));
  }

  // A2 — id 1 is the user: dropped by guard 1.
  {
    const sweep = [obj(1), obj(5), obj(9)];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 2 && batch[0].id === 5 && batch[1].id === 9;
    printRow('A2', 'ids 1,5,9 (id 1 is the user)', 'ids 5 and 9 (user dropped by guard 1)', ok, fmtBatch(batch));
  }

  // A3 — exact user position, different id: dropped by guard 2.
  {
    const sweep = [obj(88, { lat: 47.45, lon: -122.3 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 0;
    printRow('A3', 'id 88 at the user\'s exact position', 'dropped by guard 2', ok, fmtBatch(batch));
  }

  // A4 — 0.00009 deg away in both axes: still within the guard-2 box.
  {
    const sweep = [obj(88, { lat: 47.45009, lon: -122.30009 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 0;
    printRow('A4', 'id 88 at (47.45009, -122.30009)', 'dropped by guard 2 (0.00009 <= 0.0001)', ok, fmtBatch(batch));
  }

  // A5 — 0.0002 deg north: outside the guard-2 box, kept.
  {
    const sweep = [obj(88, { lat: 47.4502, lon: -122.3 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 88;
    printRow('A5', 'id 88 at (47.45020, -122.30000)', 'kept — outside the guard-2 box', ok, fmtBatch(batch));
  }

  // A6 — id 5 with lat: NaN dropped; the rest kept.
  {
    const sweep = [obj(5, { lat: NaN }), obj(9)];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 9;
    printRow('A6', 'id 5 with lat: NaN', 'id 5 dropped; every other object kept', ok, fmtBatch(batch));
  }

  // A7 — id 5 with lon: undefined dropped; the rest kept.
  {
    const sweep = [obj(5, { lon: undefined }), obj(9)];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 9;
    printRow('A7', 'id 5 with lon: undefined', 'id 5 dropped; the rest kept', ok, fmtBatch(batch));
  }

  // A8 — id 5 with altitudeFt: NaN dropped.
  {
    const sweep = [obj(5, { altitudeFt: NaN }), obj(9)];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 9;
    printRow('A8', 'id 5 with altitudeFt: NaN', 'id 5 dropped', ok, fmtBatch(batch));
  }

  // A9 — id 5 with headingDeg: Infinity dropped.
  {
    const sweep = [obj(5, { headingDeg: Infinity }), obj(9)];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 9;
    printRow('A9', 'id 5 with headingDeg: Infinity', 'id 5 dropped', ok, fmtBatch(batch));
  }

  // A10 — onGround:true, groundSpeedKnots:0 — dropped, parked.
  {
    const sweep = [obj(5, { onGround: true, groundSpeedKnots: 0 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 0;
    printRow('A10', 'id 5 onGround:true, groundSpeedKnots:0', 'dropped — parked', ok, fmtBatch(batch));
  }

  // A11 — groundSpeedKnots:0.9 — dropped, below threshold.
  {
    const sweep = [obj(5, { onGround: true, groundSpeedKnots: 0.9 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 0;
    printRow('A11', 'id 5 onGround:true, groundSpeedKnots:0.9', 'dropped — below the 1 kt threshold', ok, fmtBatch(batch));
  }

  // A12 — groundSpeedKnots:1 — kept, rule is < 1 not <= 1.
  {
    const sweep = [obj(5, { onGround: true, groundSpeedKnots: 1 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 5 && batch[0].onGround === true;
    printRow('A12', 'id 5 onGround:true, groundSpeedKnots:1', 'kept, onGround:true — rule is < 1, not <= 1', ok, fmtBatch(batch));
  }

  // A13 — groundSpeedKnots:25 — kept, taxiing traffic.
  {
    const sweep = [obj(5, { onGround: true, groundSpeedKnots: 25 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 5 && batch[0].onGround === true;
    printRow('A13', 'id 5 onGround:true, groundSpeedKnots:25', 'kept, onGround:true — a taxiing aircraft is traffic', ok, fmtBatch(batch));
  }

  // A14 — onGround:false, groundSpeedKnots:0 — kept, filter needs both conditions.
  {
    const sweep = [obj(5, { onGround: false, groundSpeedKnots: 0 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 1 && batch[0].id === 5 && batch[0].onGround === false;
    printRow('A14', 'id 5 onGround:false, groundSpeedKnots:0', 'kept, onGround:false — filter needs both conditions', ok, fmtBatch(batch));
  }

  // A15 — id 42 twice, indices 0 and 3, different lat: one entry, index 3's values, index 0's position.
  {
    const sweep = [obj(42, { lat: 1 }), obj(2), obj(3), obj(42, { lat: 99 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 3 && batch[0].id === 42 && batch[0].lat === 99 && batch[1].id === 2 && batch[2].id === 3;
    printRow('A15', 'id 42 twice, at indices 0 and 3, different lat', 'one entry for id 42 holding index 3\'s values, at index 0\'s position', ok, fmtBatch(batch));
  }

  // A16 — 250 valid objects: first 200 in post-filter order kept.
  {
    const sweep = Array.from({ length: 250 }, (_, i) => obj(100 + i));
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 200 && batch[0].id === 100 && batch[199].id === 299;
    printRow('A16', '250 valid objects', 'the first 200 in post-filter order; 201-250 dropped agent-side', ok, `length=${batch.length}, first=${batch[0] && batch[0].id}, last=${batch[batch.length - 1] && batch[batch.length - 1].id}`);
  }

  // A17 — 200 valid objects: all 200 kept.
  {
    const sweep = Array.from({ length: 200 }, (_, i) => obj(100 + i));
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 200;
    printRow('A17', '200 valid objects', 'all 200 — truncation is to 200, not below it', ok, `length=${batch.length}`);
  }

  // A18 — empty sweep: an empty batch is returned (posting it is agent.js's job, not this function's).
  {
    const batch = buildTrafficBatch([], USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 0;
    printRow('A18', 'Empty sweep (outOf === 0 at the SimConnect layer)', 'an empty batch []', ok, fmtBatch(batch));
  }

  // A19 — every object filtered out (by guard1/NaN/parked): empty batch.
  {
    const sweep = [obj(1), obj(5, { lat: NaN }), obj(9, { onGround: true, groundSpeedKnots: 0 })];
    const batch = buildTrafficBatch(sweep, USER_ID, USER_LAT, USER_LON);
    const ok = batch.length === 0;
    printRow('A19', 'Every object filtered out by A2/A6/A10', 'an empty batch []', ok, fmtBatch(batch));
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Env-var parsing (TRAFFIC_ENABLED, TRAFFIC_RADIUS_M)
// ═══════════════════════════════════════════════════════════════════════════

function runEnvRows() {
  console.log('── Env-var parsing — TRAFFIC_ENABLED / trafficRadiusM (agent/traffic.js)');
  console.log('');

  // A20 — TRAFFIC_ENABLED=off: disabled.
  {
    const { TRAFFIC_ENABLED } = loadTrafficWithEnv({ TRAFFIC_ENABLED: 'off', TRAFFIC_RADIUS_M: undefined });
    const ok = TRAFFIC_ENABLED === false;
    printRow('A20', 'TRAFFIC_ENABLED=off', 'TRAFFIC_ENABLED exported as false', ok, `TRAFFIC_ENABLED=${TRAFFIC_ENABLED}`);
  }

  // A21 — TRAFFIC_ENABLED='' (empty string): enabled.
  {
    const { TRAFFIC_ENABLED } = loadTrafficWithEnv({ TRAFFIC_ENABLED: '', TRAFFIC_RADIUS_M: undefined });
    const ok = TRAFFIC_ENABLED === true;
    printRow('A21', "TRAFFIC_ENABLED='' (empty string)", 'enabled — empty string is not in the disable list', ok, `TRAFFIC_ENABLED=${TRAFFIC_ENABLED}`);
  }

  // A22 — TRAFFIC_RADIUS_M=5000.
  {
    const { trafficRadiusM } = loadTrafficWithEnv({ TRAFFIC_RADIUS_M: '5000', TRAFFIC_ENABLED: undefined });
    const ok = trafficRadiusM === 5000;
    printRow('A22', 'TRAFFIC_RADIUS_M=5000', 'trafficRadiusM === 5000', ok, `trafficRadiusM=${trafficRadiusM}`);
  }

  // A23 — TRAFFIC_RADIUS_M=500: clamped to 1000.
  {
    const { trafficRadiusM } = loadTrafficWithEnv({ TRAFFIC_RADIUS_M: '500', TRAFFIC_ENABLED: undefined });
    const ok = trafficRadiusM === 1000;
    printRow('A23', 'TRAFFIC_RADIUS_M=500', 'trafficRadiusM === 1000 — clamped to the lower bound', ok, `trafficRadiusM=${trafficRadiusM}`);
  }

  // A24 — TRAFFIC_RADIUS_M=999999: clamped to 200000.
  {
    const { trafficRadiusM } = loadTrafficWithEnv({ TRAFFIC_RADIUS_M: '999999', TRAFFIC_ENABLED: undefined });
    const ok = trafficRadiusM === 200000;
    printRow('A24', 'TRAFFIC_RADIUS_M=999999', 'trafficRadiusM === 200000 — clamped to the upper bound', ok, `trafficRadiusM=${trafficRadiusM}`);
  }

  // A25 — TRAFFIC_RADIUS_M=abc: falls back to 40000, one warning line.
  {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    let trafficRadiusM;
    try {
      ({ trafficRadiusM } = loadTrafficWithEnv({ TRAFFIC_RADIUS_M: 'abc', TRAFFIC_ENABLED: undefined }));
    } finally {
      console.warn = origWarn;
    }
    const ok = trafficRadiusM === 40000 && warnings.length === 1;
    printRow('A25', 'TRAFFIC_RADIUS_M=abc', 'trafficRadiusM === 40000 and one warning line', ok, `trafficRadiusM=${trafficRadiusM}, warnings=${warnings.length}`);
  }

  // A26 — TRAFFIC_RADIUS_M unset: 40000.
  {
    const { trafficRadiusM } = loadTrafficWithEnv({ TRAFFIC_RADIUS_M: undefined, TRAFFIC_ENABLED: undefined });
    const ok = trafficRadiusM === 40000;
    printRow('A26', 'TRAFFIC_RADIUS_M unset', 'trafficRadiusM === 40000', ok, `trafficRadiusM=${trafficRadiusM}`);
  }

  console.log('');
}

// ── Runner ────────────────────────────────────────────────────────────────────

function main() {
  runBatchRows();
  runEnvRows();

  if (failures.length === 0) {
    console.log(`${rowCount} rows (A1-A26; A27/A28 are SimConnect-event-handler behaviour in agent/agent.js and are not exercised here), 0 failures`);
  } else {
    for (const f of failures) console.error(f);
    console.error('');
    console.error(`${failures.length} failure(s) out of ${rowCount} rows`);
    process.exitCode = 1;
  }
}

main();
