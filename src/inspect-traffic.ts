#!/usr/bin/env ts-node
// ── AI-traffic store/ingest scenario harness ─────────────────────────────────
//
// A CLI over src/trafficStore.ts (TrafficStore, applyRetentionCap, the §2.4
// rounding formulas) and, for the handful of rows that are genuinely about
// the HTTP layer (auth, the TRAFFIC_ENABLED kill switch, the connected flag),
// over src/ingest.ts's createIngestRouter() run against an ephemeral,
// in-process express app on an OS-assigned port. No sim, no browser, no test
// framework, no flights.db: this never imports src/server.ts or src/db.ts.
//
//   npx ts-node src/inspect-traffic.ts
//
// ── Why the "expected" column is transcribed, not derived ────────────────────
//
// Every expected value below is copied BY HAND from design.md (run
// 2026-09-08-ai-traffic-map) §9.1's 36-row truth table, or from §8's worked
// example (§8.1's raw batch and §8.2's rounded response, both reproduced
// verbatim as fixtures). None of it is computed by calling trafficStore.ts's
// own roundCoord/roundAlt/normHeading/distanceM to derive what the answer
// "should" be, and none of it is a restatement of applyRetentionCap's rule in
// a second sorting function — an inspector that derives "expected" from the
// implementation proves nothing, because a bug shared by both sides would
// agree with itself. Where a row's fixture needs distance *ordering* rather
// than a literal number (S9), the fixture is built so the ordering is a plain
// geometric fact (points spaced along one meridian, so great-circle distance
// is monotonic in the latitude offset) rather than something read off
// distanceM's own output. If a row here is ever found to disagree with
// design.md's own table, that is a question for the design, not something to
// quietly reconcile in this file.
//
// ── Sections ──────────────────────────────────────────────────────────────────
//
// A. VALIDATION_ROWS  — buildTrafficObjects() (src/ingest.ts): body shape,
//                        per-element validation, rounding/normalisation,
//                        de-duplication. §9.1 S7, S11, S13-S28.
// B. PRUNING_ROWS      — applyRetentionCap() (src/trafficStore.ts): the
//                        retention cap and its distance-ordering rule.
//                        §9.1 S8-S10, S12.
// C. STORE_ROWS        — TrafficStore directly: snapshot semantics and lazy
//                        staleness, including the exact worked example of
//                        §8.1/§8.2 end to end. §9.1 S1-S6, S34, S35.
// D. HTTP_ROWS         — createIngestRouter() behind a real (ephemeral,
//                        loopback-only) express app: auth, the server-side
//                        kill switch, and the connected-flag guarantee.
//                        §9.1 S29-S33.
// E. STATIC_ROWS       — a structural check of src/server.ts's route
//                        registration order, standing in for the one row
//                        (S36) that is entirely about server.ts's existing,
//                        unrelated SPA catch-all and needs neither a store
//                        nor a running server to verify.

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { AddressInfo } from 'net';
import {
  TrafficStore,
  applyRetentionCap,
} from './trafficStore';
import { createIngestRouter, buildTrafficObjects } from './ingest';
import type { TrafficObject } from './types';
import type { FlightManager } from './flightManager';

const failures: string[] = [];
let rowCount = 0;

// Captured before section D ever monkey-patches console.log to capture the
// router's own logging (S31) — printRow must always reach the real terminal,
// never the capture buffer.
const realConsoleLog = console.log.bind(console);

// ── Shared helpers ────────────────────────────────────────────────────────────

function withFakeNow<T>(t: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => t;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

function sameObjects(a: TrafficObject[], b: TrafficObject[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.id === b[i].id &&
      x.lat === b[i].lat &&
      x.lon === b[i].lon &&
      x.altitudeFt === b[i].altitudeFt &&
      x.headingDeg === b[i].headingDeg &&
      x.onGround === b[i].onGround,
  );
}

function fmtObjects(objs: TrafficObject[]): string {
  if (objs.length === 0) return '[]';
  if (objs.length > 6) return `[${objs.length} objects, ids ${objs[0].id}..${objs[objs.length - 1].id}]`;
  return '[' + objs.map((o) => `{id:${o.id},lat:${o.lat},lon:${o.lon},alt:${o.altitudeFt},hdg:${o.headingDeg},gnd:${o.onGround}}`).join(', ') + ']';
}

function printRow(id: string, scenario: string, expected: string, ok: boolean, actual: string): void {
  rowCount++;
  realConsoleLog(`   ${id}  ${scenario}`);
  realConsoleLog(`        expected: ${expected}`);
  realConsoleLog(`        actual:   ${actual}  ${ok ? '✓' : '✗'}`);
  if (!ok) failures.push(`   ✗ ${id} (${scenario}): expected ${expected}, got ${actual}`);
}

/** Builds `n` distinct, individually-valid TrafficObject-shaped raw elements, ids 0..n-1. */
function makeRawBatch(n: number, opts: { latBase?: number; lonBase?: number; latStepDeg?: number } = {}): unknown {
  const latBase = opts.latBase ?? 10;
  const lonBase = opts.lonBase ?? 10;
  const latStep = opts.latStepDeg ?? 0;
  const objects = Array.from({ length: n }, (_, i) => ({
    id: i,
    lat: latBase + i * latStep,
    lon: lonBase,
    altitudeFt: 1000 + i,
    headingDeg: 0,
    onGround: false,
  }));
  return { objects };
}

// ═══════════════════════════════════════════════════════════════════════════
// §8 worked example — transcribed verbatim, reused by S1
// ═══════════════════════════════════════════════════════════════════════════

// §8.1, at full double precision, exactly as the agent would post it.
const WORKED_RAW_BATCH: unknown = {
  objects: [
    { id: 12, lat: 47.44982716239, lon: -122.3091455117, altitudeFt: 4325.68359375, headingDeg: 158.4472999572, onGround: false },
    { id: 13, lat: 47.53100482118, lon: -122.2005913734, altitudeFt: 11250.125, headingDeg: 372.5, onGround: false },
    { id: 27, lat: 47.44001139298, lon: -122.3083019876, altitudeFt: 433.1, headingDeg: -12.25, onGround: true },
  ],
};

// §8.2's `traffic` array, transcribed verbatim.
const WORKED_EXPECTED_TRAFFIC: TrafficObject[] = [
  { id: 12, lat: 47.449827, lon: -122.309146, altitudeFt: 4326, headingDeg: 158.4, onGround: false },
  { id: 13, lat: 47.531005, lon: -122.200591, altitudeFt: 11250, headingDeg: 12.5, onGround: false },
  { id: 27, lat: 47.440011, lon: -122.308302, altitudeFt: 433, headingDeg: 347.8, onGround: true },
];

// ═══════════════════════════════════════════════════════════════════════════
// A. VALIDATION_ROWS — buildTrafficObjects() — §9.1 S7, S11, S13-S28
// ═══════════════════════════════════════════════════════════════════════════

function runValidationRows(): void {
  console.log('── A. Validation, normalisation, de-duplication — buildTrafficObjects() (src/ingest.ts)');
  console.log('');

  // S7 — empty batch is valid and normalises to an empty array.
  {
    const result = buildTrafficObjects({ objects: [] });
    const ok = result.ok && result.objects.length === 0;
    printRow('S7', 'Empty batch {"objects":[]}', 'ok:true, objects: []', ok, result.ok ? `ok:true, objects: ${fmtObjects(result.objects)}` : `ok:false "${result.error}"`);
  }

  // S11 — id 42 at indices 0 and 4 with different lat: one record, index 4's
  // values, positioned where index 0 was.
  {
    const body = {
      objects: [
        { id: 42, lat: 10, lon: 10, altitudeFt: 1000, headingDeg: 0 },
        { id: 1, lat: 11, lon: 10, altitudeFt: 1000, headingDeg: 0 },
        { id: 2, lat: 12, lon: 10, altitudeFt: 1000, headingDeg: 0 },
        { id: 3, lat: 13, lon: 10, altitudeFt: 1000, headingDeg: 0 },
        { id: 42, lat: 20, lon: 10, altitudeFt: 1000, headingDeg: 0 },
      ],
    };
    const result = buildTrafficObjects(body);
    const ok = result.ok && result.objects.length === 4 && result.objects[0].id === 42 && result.objects[0].lat === 20
      && result.objects[1].id === 1 && result.objects[2].id === 2 && result.objects[3].id === 3;
    printRow(
      'S11',
      'id 42 twice, at indices 0 and 4, with different lat',
      'one record for id 42 holding index 4\'s values (lat 20), positioned where index 0 was: [42,1,2,3]',
      ok,
      result.ok ? `ok:true, ids/lat ${result.objects.map((o) => `${o.id}:${o.lat}`).join(',')}` : `ok:false "${result.error}"`,
    );
  }

  // S13 — 201 objects: over the batch limit is a rejection.
  {
    const body = makeRawBatch(201);
    const result = buildTrafficObjects(body);
    const ok = !result.ok && result.error === 'Traffic batch exceeds 200 objects';
    printRow('S13', 'Batch of 201 objects', '400 "Traffic batch exceeds 200 objects"', ok, result.ok ? `ok:true (unexpectedly accepted, ${result.objects.length} objects)` : `400 "${result.error}"`);
  }

  // S14 — one bad element (index 2) rejects the whole batch, and — modelled
  // exactly as the real route does (only call store.replace() on result.ok)
  // — the store is left completely unchanged.
  {
    const baseline: TrafficObject[] = [{ id: 900, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0, onGround: false }];
    const store = new TrafficStore();
    withFakeNow(5000, () => store.replace(baseline));
    const before = store.read(5000);

    const body = {
      objects: [
        { id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 1, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 2, lat: '47.4', lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 3, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 4, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
      ],
    };
    const result = buildTrafficObjects(body);
    if (result.ok) store.replace(applyRetentionCap(result.objects, null)); // mirrors src/ingest.ts's route
    const after = store.read(5000);

    const ok = !result.ok && result.error === 'Invalid traffic object at index 2' && sameObjects(before, after);
    printRow(
      'S14',
      'Batch of 5 where index 2 has "lat": "47.4"',
      '400 "Invalid traffic object at index 2"; none of the 5 stored; previous store contents unchanged',
      ok,
      result.ok ? 'ok:true (unexpectedly accepted)' : `400 "${result.error}"; store before=${fmtObjects(before)} after=${fmtObjects(after)}`,
    );
  }

  // S15 — indices 1 and 3 both invalid: the lowest index wins.
  {
    const body = {
      objects: [
        { id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 1, lat: 999, lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 2, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
        { id: 3, lat: 0, lon: 999, altitudeFt: 0, headingDeg: 0 },
        { id: 4, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 },
      ],
    };
    const result = buildTrafficObjects(body);
    const ok = !result.ok && result.error === 'Invalid traffic object at index 1';
    printRow('S15', 'Indices 1 and 3 both invalid', '400 "Invalid traffic object at index 1" (lowest failing index)', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S16 — lat: null.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: null, lon: 0, altitudeFt: 0, headingDeg: 0 }] });
    const ok = !result.ok && result.error === 'Invalid traffic object at index 0';
    printRow('S16', 'Object with "lat": null', '400 at that index (Number.isFinite(null) is false)', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S17 — lon: 181 (range check).
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 181, altitudeFt: 0, headingDeg: 0 }] });
    const ok = !result.ok && result.error === 'Invalid traffic object at index 0';
    printRow('S17', 'Object with "lon": 181', '400 at that index (range check)', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S18 — id: 12.5 (Number.isInteger false).
  {
    const result = buildTrafficObjects({ objects: [{ id: 12.5, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 }] });
    const ok = !result.ok && result.error === 'Invalid traffic object at index 0';
    printRow('S18', 'Object with "id": 12.5', '400 at that index (Number.isInteger false)', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S19 — id: -1 (id >= 0).
  {
    const result = buildTrafficObjects({ objects: [{ id: -1, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 }] });
    const ok = !result.ok && result.error === 'Invalid traffic object at index 0';
    printRow('S19', 'Object with "id": -1', '400 at that index (id >= 0)', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S20 — onGround absent: valid, defaults to false.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0 }] });
    const ok = result.ok && result.objects[0].onGround === false;
    printRow('S20', 'Object with "onGround" absent', 'valid; stored as onGround: false', ok, result.ok ? `ok:true, onGround=${result.objects[0].onGround}` : `400 "${result.error}"`);
  }

  // S21 — onGround: "true" (string) — only a boolean or absence is accepted.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0, onGround: 'true' }] });
    const ok = !result.ok && result.error === 'Invalid traffic object at index 0';
    printRow('S21', 'Object with "onGround": "true" (string)', '400 at that index', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S22 — headingDeg: -10 -> stored as 350.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: -10 }] });
    const ok = result.ok && result.objects[0].headingDeg === 350;
    printRow('S22', 'Object with "headingDeg": -10', 'valid; stored as 350', ok, result.ok ? `ok:true, headingDeg=${result.objects[0].headingDeg}` : `400 "${result.error}"`);
  }

  // S23 — headingDeg: 370 -> stored as 10.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 370 }] });
    const ok = result.ok && result.objects[0].headingDeg === 10;
    printRow('S23', 'Object with "headingDeg": 370', 'valid; stored as 10', ok, result.ok ? `ok:true, headingDeg=${result.objects[0].headingDeg}` : `400 "${result.error}"`);
  }

  // S24 — headingDeg: 359.97 -> rounds to 360.0 then wraps -> 0.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 359.97 }] });
    const ok = result.ok && result.objects[0].headingDeg === 0;
    printRow('S24', 'Object with "headingDeg": 359.97', 'valid; stored as 0 (rounds to 360.0 then wraps)', ok, result.ok ? `ok:true, headingDeg=${result.objects[0].headingDeg}` : `400 "${result.error}"`);
  }

  // S25 — extra key "title" is dropped, never echoed.
  {
    const result = buildTrafficObjects({ objects: [{ id: 0, lat: 0, lon: 0, altitudeFt: 0, headingDeg: 0, title: 'A320' }] });
    const ok = result.ok && !('title' in result.objects[0]);
    printRow('S25', 'Object with an extra key "title": "A320"', 'valid; stored without title', ok, result.ok ? `ok:true, keys=${Object.keys(result.objects[0]).join(',')}` : `400 "${result.error}"`);
  }

  // S26 — bare array body.
  {
    const result = buildTrafficObjects([]);
    const ok = !result.ok && result.error === 'Traffic batch must be a JSON object';
    printRow('S26', 'Body is [] (a bare array)', '400 "Traffic batch must be a JSON object"', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S27 — no `objects` key.
  {
    const result = buildTrafficObjects({ aircraft: [] });
    const ok = !result.ok && result.error === 'Traffic batch requires an objects array';
    printRow('S27', 'Body is {"aircraft": []} (no objects)', '400 "Traffic batch requires an objects array"', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  // S28 — `objects` present but not an array.
  {
    const result = buildTrafficObjects({ objects: {} });
    const ok = !result.ok && result.error === 'Traffic batch requires an objects array';
    printRow('S28', 'Body is {"objects": {}}', '400 "Traffic batch requires an objects array"', ok, result.ok ? 'ok:true' : `400 "${result.error}"`);
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// B. PRUNING_ROWS — applyRetentionCap() — §9.1 S8-S10, S12
// ═══════════════════════════════════════════════════════════════════════════

function runPruningRows(): void {
  console.log('── B. The retention cap — applyRetentionCap() (src/trafficStore.ts)');
  console.log('');

  // S8 — 150 objects, lastFrame null: keep the first 100 in post-dedup order.
  {
    const raw = makeRawBatch(150) as { objects: unknown[] };
    const built = buildTrafficObjects(raw);
    const capped = built.ok ? applyRetentionCap(built.objects, null) : [];
    const ok = built.ok && capped.length === 100 && capped.every((o, i) => o.id === i);
    printRow('S8', 'Batch of 150 valid objects, lastFrame null', 'exactly 100 retained — the first 100 in post-de-duplication array order (ids 0..99)', ok, `retained ${fmtObjects(capped)}`);
  }

  // S9 — 150 objects, lastFrame set: keep the 100 nearest, ties by id.
  // Fixture: all 150 objects share one meridian (same lon), spaced by
  // increasing latitude offset from lastFrame — great-circle distance along a
  // single meridian is monotonic in the (tiny, <1.5 deg total) angular
  // separation, a plain geometric fact independent of distanceM's own
  // formula. So "smallest distance" here is verifiably "smallest id",
  // without asking distanceM what the distances are.
  {
    const lastFrame = { lat: 47.45, lon: -122.31 };
    const raw = makeRawBatch(150, { latBase: lastFrame.lat, lonBase: lastFrame.lon, latStepDeg: 0.01 });
    const built = buildTrafficObjects(raw);
    const capped = built.ok ? applyRetentionCap(built.objects, lastFrame) : [];
    const ok = built.ok && capped.length === 100 && capped.every((o, i) => o.id === i);
    printRow(
      'S9',
      'Batch of 150 valid objects, lastFrame at (47.45, -122.31)',
      'exactly 100 retained — the 100 nearest by haversine distance, ties by ascending id (here: ids 0..99, since each object is spaced further along the same meridian)',
      ok,
      `retained ${fmtObjects(capped)}`,
    );
  }

  // S10 — exactly 100 objects: all retained, no distance computed. Proven by
  // handing applyRetentionCap a lastFrame whose lat/lon getters throw if ever
  // read; the cap's own "objects.length <= MAX_RETAINED_OBJECTS" short-circuit
  // must never reach them.
  {
    const throwingLastFrame = {
      get lat(): number { throw new Error('distance must not be computed for a batch at or under the cap'); },
      get lon(): number { throw new Error('distance must not be computed for a batch at or under the cap'); },
    };
    const raw = makeRawBatch(100) as { objects: unknown[] };
    const built = buildTrafficObjects(raw);
    let capped: TrafficObject[] = [];
    let threw = false;
    try {
      capped = built.ok ? applyRetentionCap(built.objects, throwingLastFrame) : [];
    } catch {
      threw = true;
    }
    const ok = built.ok && !threw && capped.length === 100 && capped.every((o, i) => o.id === i);
    printRow('S10', 'Batch of exactly 100 objects', 'all 100 retained; no distance computed (lastFrame never read)', ok, threw ? 'threw — lastFrame WAS read' : `retained ${capped.length} objects`);
  }

  // S12 — 200 objects: accepted (200 is the limit, not one past it), then
  // trimmed to 100 by S8/S9's rule.
  {
    const raw = makeRawBatch(200) as { objects: unknown[] };
    const built = buildTrafficObjects(raw);
    const capped = built.ok ? applyRetentionCap(built.objects, null) : [];
    const ok = built.ok && built.objects.length === 200 && capped.length === 100 && capped.every((o, i) => o.id === i);
    printRow('S12', 'Batch of 200 objects', '204 (200 is the limit, not one past it), then trimmed to 100 by S8/S9\'s rule', ok, built.ok ? `accepted ${built.objects.length}, retained ${capped.length}` : `400 "${built.error}"`);
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// C. STORE_ROWS — TrafficStore directly — §9.1 S1-S6, S34, S35
// ═══════════════════════════════════════════════════════════════════════════

function runStoreRows(): void {
  console.log('── C. Snapshot semantics and lazy staleness — TrafficStore (src/trafficStore.ts)');
  console.log('');

  // S1 — the §8 worked example end to end: raw batch in, rounded traffic out,
  // read immediately.
  {
    const built = buildTrafficObjects(WORKED_RAW_BATCH);
    const store = new TrafficStore();
    if (built.ok) withFakeNow(1_000_000, () => store.replace(built.objects));
    const read = store.read(1_000_000);
    const ok = built.ok && sameObjects(read, WORKED_EXPECTED_TRAFFIC);
    printRow('S1', 'Batch of 3 valid objects (§8.1), read immediately', `204; traffic = ${fmtObjects(WORKED_EXPECTED_TRAFFIC)} (§8.2)`, ok, `read = ${fmtObjects(read)}`);
  }

  // S2/S3/S4 — staleness boundary: strictly greater than TRAFFIC_STALE_MS
  // (10000) is stale; exactly 10000 is still fresh.
  {
    const objs: TrafficObject[] = [
      { id: 12, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0, onGround: false },
      { id: 13, lat: 2, lon: 2, altitudeFt: 200, headingDeg: 0, onGround: false },
      { id: 27, lat: 3, lon: 3, altitudeFt: 300, headingDeg: 0, onGround: true },
    ];
    const T0 = 2_000_000;

    for (const [id, offset, expectPresent] of [
      ['S2', 9999, true],
      ['S3', 10000, true],
      ['S4', 10001, false],
    ] as const) {
      const store = new TrafficStore();
      withFakeNow(T0, () => store.replace(objs));
      const read = store.read(T0 + offset);
      const ok = expectPresent ? sameObjects(read, objs) : read.length === 0;
      const scenario = `Same batch, read ${offset} ms after`;
      const expected = expectPresent ? 'traffic still present with all 3' : 'traffic key absent; store\'s internal array emptied';
      printRow(id, scenario, expected, ok, `read = ${fmtObjects(read)}`);
    }
  }

  // S5 — batch A = [12,13,27], batch B = [12,13]: 27 is gone immediately, no
  // grace period.
  {
    const A: TrafficObject[] = [12, 13, 27].map((id) => ({ id, lat: id, lon: id, altitudeFt: id, headingDeg: 0, onGround: false }));
    const B: TrafficObject[] = [12, 13].map((id) => ({ id, lat: id, lon: id, altitudeFt: id, headingDeg: 0, onGround: false }));
    const store = new TrafficStore();
    withFakeNow(1000, () => store.replace(A));
    withFakeNow(2000, () => store.replace(B));
    const read = store.read(2000);
    const ok = read.length === 2 && read.every((o) => o.id === 12 || o.id === 13) && !read.some((o) => o.id === 27);
    printRow('S5', 'Batch A = ids [12,13,27], then batch B = ids [12,13]', 'after B: exactly ids 12 and 13; 27 gone on the very next read, no grace period', ok, `read = ${fmtObjects(read)}`);
  }

  // S6 — A=[12,13], B=[12], C=[12,13]: 13's values come solely from C.
  {
    const A: TrafficObject[] = [
      { id: 12, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0, onGround: false },
      { id: 13, lat: 5, lon: 5, altitudeFt: 500, headingDeg: 0, onGround: false }, // stale value, must not survive
    ];
    const B: TrafficObject[] = [{ id: 12, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0, onGround: false }];
    const C: TrafficObject[] = [
      { id: 12, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0, onGround: false },
      { id: 13, lat: 9, lon: 9, altitudeFt: 900, headingDeg: 0, onGround: false }, // fresh value, must be the one that survives
    ];
    const store = new TrafficStore();
    withFakeNow(1000, () => store.replace(A));
    withFakeNow(2000, () => store.replace(B));
    withFakeNow(3000, () => store.replace(C));
    const read = store.read(3000);
    const id13 = read.find((o) => o.id === 13);
    const ok = read.length === 2 && id13 !== undefined && id13.lat === 9;
    printRow('S6', 'Batch A=[12,13], B=[12], C=[12,13]', 'after C: ids 12 and 13, with 13\'s values taken solely from C (lat 9, not A\'s lat 5)', ok, `read = ${fmtObjects(read)}`);
  }

  // S34 — no traffic ever posted: a fresh store's read() is empty, so
  // /api/status's spread contributes no `traffic` key.
  {
    const store = new TrafficStore();
    const read = store.read();
    const ok = read.length === 0;
    printRow('S34', 'No traffic ever posted', '/api/status has no traffic key (store.read() is empty)', ok, `read = ${fmtObjects(read)}`);
  }

  // S35 — expiry does not disable the store: a fresh batch after the gap is
  // accepted normally.
  {
    const first: TrafficObject[] = [{ id: 1, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0, onGround: false }];
    const second: TrafficObject[] = [
      { id: 2, lat: 2, lon: 2, altitudeFt: 200, headingDeg: 0, onGround: false },
      { id: 3, lat: 3, lon: 3, altitudeFt: 300, headingDeg: 0, onGround: false },
    ];
    const store = new TrafficStore();
    const T0 = 5_000_000;
    withFakeNow(T0, () => store.replace(first));
    const expired = store.read(T0 + 10001); // silence longer than the staleness window
    withFakeNow(T0 + 20000, () => store.replace(second));
    const read = store.read(T0 + 20000);
    const ok = expired.length === 0 && sameObjects(read, second);
    printRow('S35', 'Traffic posted, then 10001 ms of silence, then a fresh batch of 2', 'traffic present with those 2 — expiry does not disable the store', ok, `after gap = ${fmtObjects(expired)}, after fresh batch = ${fmtObjects(read)}`);
  }

  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// D. HTTP_ROWS — createIngestRouter() over an ephemeral express app —
//    §9.1 S29-S33
// ═══════════════════════════════════════════════════════════════════════════

function makeStubFlightManager(): FlightManager {
  const stub = {
    appState: {
      flightState: 'IDLE' as const,
      currentFlightId: null,
      connected: false,
      lastFrame: null,
      paused: false,
      pauseFlags: 0,
    },
    // §4.7: the traffic route must call neither. Throwing turns any violation
    // into a synchronous exception inside the route handler, which express
    // turns into a 500 — a loud, unmistakable failure of any row below.
    onFrame: () => {
      throw new Error('onFrame must not be called by the traffic route (design.md §4.7)');
    },
    onSimDisconnect: () => {
      throw new Error('onSimDisconnect must not be called by the traffic route (design.md §4.7)');
    },
  };
  return stub as unknown as FlightManager;
}

async function withRouterServer(
  envOverrides: Record<string, string | undefined>,
  fn: (opts: { baseUrl: string; store: TrafficStore; flightManager: FlightManager; logs: string[] }) => Promise<void>,
): Promise<void> {
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of Object.keys(envOverrides)) savedEnv[k] = process.env[k];
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const store = new TrafficStore();
  const flightManager = makeStubFlightManager();
  const app = express();
  app.use(express.json());
  app.use('/api/ingest', createIngestRouter(flightManager, store));

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await fn({ baseUrl: `http://127.0.0.1:${port}`, store, flightManager, logs });
  } finally {
    console.log = origLog;
    // fetch's keep-alive sockets would otherwise hold the server (and the
    // process) open past this scenario — force them shut so the CLI exits
    // promptly instead of hanging on an idle connection.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function postTraffic(baseUrl: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/ingest/traffic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function runHttpRows(): Promise<void> {
  console.log('── D. Auth, kill switch, connected flag — createIngestRouter() on an ephemeral server');
  console.log('');

  const validBatch = { objects: [{ id: 1, lat: 1, lon: 1, altitudeFt: 100, headingDeg: 0 }] };

  // S29 — wrong/missing token: 401, store untouched.
  await withRouterServer({ INGEST_TOKEN: 'secret', TRAFFIC_ENABLED: undefined }, async ({ baseUrl, store }) => {
    const res = await postTraffic(baseUrl, validBatch);
    const ok = res.status === 401
      && typeof res.body === 'object' && res.body !== null && (res.body as any).error === 'Invalid or missing ingest token'
      && store.read().length === 0;
    printRow('S29', 'INGEST_TOKEN=secret, no x-ingest-token header', '401 {"error":"Invalid or missing ingest token"}; store untouched', ok, `status=${res.status} body=${JSON.stringify(res.body)} store=${fmtObjects(store.read())}`);
  });

  // S30 — correct header: behaves as S1 (204, store updated).
  await withRouterServer({ INGEST_TOKEN: 'secret', TRAFFIC_ENABLED: undefined }, async ({ baseUrl, store }) => {
    const res = await postTraffic(baseUrl, validBatch, { 'x-ingest-token': 'secret' });
    const ok = res.status === 204 && store.read().length === 1 && store.read()[0].id === 1;
    printRow('S30', 'INGEST_TOKEN=secret, correct header', 'behaves as S1: 204; store gets the object', ok, `status=${res.status} store=${fmtObjects(store.read())}`);
  });

  // S31 — TRAFFIC_ENABLED=0, valid batch of 3: 204, store untouched, exactly
  // one log line even after two posts.
  await withRouterServer({ TRAFFIC_ENABLED: '0', INGEST_TOKEN: undefined }, async ({ baseUrl, store, logs }) => {
    const threeObjects = { objects: [1, 2, 3].map((id) => ({ id, lat: id, lon: id, altitudeFt: id, headingDeg: 0 })) };
    const res1 = await postTraffic(baseUrl, threeObjects);
    const res2 = await postTraffic(baseUrl, threeObjects);
    const discardLines = logs.filter((l) => l.includes('[Ingest] Traffic disabled (TRAFFIC_ENABLED) — discarding batch'));
    const ok = res1.status === 204 && res2.status === 204 && store.read().length === 0 && discardLines.length === 1;
    printRow(
      'S31',
      'TRAFFIC_ENABLED=0, valid batch of 3 (posted twice)',
      '204; store untouched; exactly one "[Ingest] Traffic disabled…" line total, only on the first discarded batch',
      ok,
      `status1=${res1.status} status2=${res2.status} store=${fmtObjects(store.read())} discardLines=${discardLines.length}`,
    );
  });

  // S32 — TRAFFIC_ENABLED=0, batch of 201: 204, not 400 — the kill switch
  // short-circuits before validation.
  await withRouterServer({ TRAFFIC_ENABLED: '0', INGEST_TOKEN: undefined }, async ({ baseUrl, store }) => {
    const res = await postTraffic(baseUrl, makeRawBatch(201));
    const ok = res.status === 204 && store.read().length === 0;
    printRow('S32', 'TRAFFIC_ENABLED=0, batch of 201 objects', '204, not 400 — the kill switch short-circuits before validation', ok, `status=${res.status} store=${fmtObjects(store.read())}`);
  });

  // S33 — valid batch accepted while appState.connected === false: connected
  // stays false, no FlightManager method called (proven by the stub's
  // throwing onFrame/onSimDisconnect never firing — a 500 would mean one did).
  await withRouterServer({ INGEST_TOKEN: undefined, TRAFFIC_ENABLED: undefined }, async ({ baseUrl, store, flightManager }) => {
    const res = await postTraffic(baseUrl, validBatch);
    const ok = res.status === 204 && flightManager.appState.connected === false && store.read().length === 1;
    printRow('S33', 'Valid batch accepted while appState.connected === false', 'connected stays false; no FlightManager method called (204, not 500)', ok, `status=${res.status} connected=${flightManager.appState.connected} store=${fmtObjects(store.read())}`);
  });

  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// E. STATIC_ROWS — src/server.ts route-registration order — §9.1 S36
// ═══════════════════════════════════════════════════════════════════════════

function runStaticRows(): void {
  console.log('── E. Existing, unrelated behaviour — src/server.ts route order');
  console.log('');

  // S36 — a bare GET /api/ingest/traffic returns 200 text/html (the SPA
  // catch-all swallows it), not 404 — because src/server.ts registers
  // app.get('*', ...) AFTER every API route, ingest included. This run does
  // not change that ordering; checked structurally rather than by running
  // the whole server (which would need a built client/dist and would import
  // src/db.ts) — the design's own §9.1 note calls this "existing behaviour,
  // unrelated to and unchanged by this run".
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');
  const ingestMountIdx = serverSrc.indexOf("app.use('/api/ingest'");
  const catchAllIdx = serverSrc.indexOf("app.get('*'");
  const ok = ingestMountIdx !== -1 && catchAllIdx !== -1 && ingestMountIdx < catchAllIdx;
  printRow(
    'S36',
    "GET /api/ingest/traffic (no such route registered)",
    "200 text/html — the SPA catch-all (src/server.ts app.get('*', ...)) is registered after the ingest router mount and swallows it; not 404",
    ok,
    `ingest mount at char ${ingestMountIdx}, catch-all at char ${catchAllIdx}`,
  );

  console.log('');
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  runValidationRows();
  runPruningRows();
  runStoreRows();
  await runHttpRows();
  runStaticRows();

  if (failures.length === 0) {
    console.log(`${rowCount} rows (design.md §9.1, S1-S36), 0 failures`);
  } else {
    for (const f of failures) console.error(f);
    console.error('');
    console.error(`${failures.length} failure(s) out of ${rowCount} rows`);
    process.exitCode = 1;
  }

  // Section D's fetch() calls leave undici's global keep-alive agent holding
  // an open handle even after every ephemeral server has been closed — exit
  // explicitly rather than let a harmless client-side socket hang the CLI.
  process.exit(process.exitCode ?? 0);
}

main();
