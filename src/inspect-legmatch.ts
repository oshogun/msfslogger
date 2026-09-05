#!/usr/bin/env ts-node
// ── Planned-leg matcher scenario harness ──────────────────────────────────────
//
// A read-only CLI over src/legMatcher.ts. There is no test framework in this
// repo and this does not introduce one: it is a scenario table, one row per
// case, expected against actual, and it exits non-zero if any row disagrees.
//
//   npx ts-node src/inspect-legmatch.ts          # the whole table
//   npx ts-node src/inspect-legmatch.ts -v       # also print every field
//
// The matcher is the highest-consequence module in this feature. A false
// positive attaches a flight to the wrong leg and quietly corrupts a trip's
// record; a false negative only means the user links it by hand. So the table
// leans on the *refusals*, and every reason code in design.md §13.4 has at
// least one row.
//
// ── Provenance, and why it is printed in its own column ──────────────────────
//
// REAL   coordinates lifted from samples/lnmpln/*.lnmpln — the first and last
//        <Waypoint><Pos> of each file — so the 10 nm threshold is exercised
//        against genuine airport positions, and the 293 nm KSFO→KLAX leg
//        exercises it at the long end.
// SYNTH  constructed by hand, because the real files cannot produce the case.
//        Two of these matter and must not be mistaken for real coverage:
//
//        * AMBIGUOUS. No two legs of a real trip depart the same field — the
//          VFR fixtures are a chain, KSBA→KMRY→KSTS→KACV. The refusal that
//          matters most is therefore reachable only by assembling two real
//          KMRY departures (KMRY→KSTS and KMRY→KSFO, which in reality belong to
//          different trips) into one trip. Real coordinates, invented trip.
//        * The antimeridian pair. Every fixture is Californian; nothing in this
//          repo crosses 180°, so the classic silent failure of degree-delta
//          distance maths has no real coverage at all and is asserted here on
//          hand-built coordinates.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  matchPlannedLeg,
  DEPARTURE_RADIUS_NM,
  ARRIVAL_RADIUS_NM,
  type LegMatchCandidate,
  type LegMatchInput,
  type LegMatchReason,
} from './legMatcher';

// ── Fixture coordinates ───────────────────────────────────────────────────────
//
// Read out of samples/lnmpln/*.lnmpln. KMRY appears twice with slightly
// different positions — the KSBA→KMRY plan and the KMRY→KSTS plan agree on
// 36.586952/-121.843079, while KMRY→KSFO departs 36.587494/-121.838753, 0.24 nm
// away. That disagreement is real Little Navmap data and is used below as the
// two-ineligible-legs-at-different-distances case.

const KSBA = { lat: 34.426201, lon: -119.841507 };   // VFR KSBA→KMRY, first Pos
const KMRY_A = { lat: 36.586952, lon: -121.843079 }; // VFR KMRY→KSTS, first Pos
const KMRY_B = { lat: 36.587494, lon: -121.838753 }; // VFR KMRY→KSFO, first Pos
const KSTS = { lat: 38.509693, lon: -122.812897 };   // VFR KSTS→KACV, first Pos
const KACV = { lat: 40.977814, lon: -124.108475 };   // VFR KSTS→KACV, last Pos
const KSFO = { lat: 37.618023, lon: -122.375519 };   // IFR KSFO→KLAX, first Pos
const KLAX = { lat: 33.942474, lon: -118.409332 };   // IFR KSFO→KLAX, last Pos

// One minute of latitude is one nautical mile by definition, so a due-north
// offset is exact arithmetic and needs no trigonometry to state an expectation.
const northOf = (p: { lat: number; lon: number }, nm: number) => ({ lat: p.lat + nm / 60, lon: p.lon });

// ── Candidate construction ────────────────────────────────────────────────────

const VFR_TRIP = 1;
const IFR_TRIP = 2;

function leg(
  plannedLegId: number,
  seq: number,
  tripId: number,
  departureIdent: string,
  pos: { lat: number; lon: number },
  over: Partial<LegMatchCandidate> = {},
): LegMatchCandidate {
  return {
    plannedLegId,
    tripId,
    seq,
    departureIdent,
    departureIsAirport: true,
    departureLat: pos.lat,
    departureLon: pos.lon,
    status: 'planned',
    linkedFlightId: null,
    aircraftType: 'C172',
    ...over,
  };
}

/** The VFR trip as imported: KSBA → KMRY → KSTS → KACV, in seq ASC, id ASC. */
const vfrTrip = (
  o: { l11?: Partial<LegMatchCandidate>; l12?: Partial<LegMatchCandidate>; l13?: Partial<LegMatchCandidate> } = {},
): LegMatchCandidate[] => [
  leg(11, 1, VFR_TRIP, 'KSBA', KSBA, o.l11),
  leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A, o.l12),
  leg(13, 3, VFR_TRIP, 'KSTS', KSTS, o.l13),
];

/** The IFR plan: one 293 nm leg, KSFO → KLAX. */
const ifrTrip = (o: Partial<LegMatchCandidate> = {}): LegMatchCandidate[] => [
  leg(21, 1, IFR_TRIP, 'KSFO', KSFO, o),
];

/** Everything a scenario does not care about. startTime and aircraft are inert. */
function takeoff(
  pos: { lat: number; lon: number },
  candidates: LegMatchCandidate[],
  over: Partial<LegMatchInput> = {},
): LegMatchInput {
  return {
    lat: pos.lat,
    lon: pos.lon,
    startTime: '2026-09-05T14:03:00.000Z',
    aircraft: 'Cessna 172',
    activeTripId: VFR_TRIP,
    flightAlreadyLinkedTo: null,
    candidates,
    ...over,
  };
}

// ── The scenario table ────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  real: boolean;
  note?: string;
  input: LegMatchInput;
  reason: LegMatchReason;
  /** Expected matched leg; null on every refusal. */
  legId: number | null;
  nearby: number[];
  /** Inclusive nm window, or null when distanceNm must be null. */
  distance: [number, number] | null;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'exact match over the field (KSBA)',
    real: true,
    input: takeoff(KSBA, vfrTrip()),
    reason: 'MATCHED',
    legId: 11,
    nearby: [11],
    distance: [0, 0.1],
  },
  {
    name: 'takeoff 8 nm out on climb',
    real: true,
    note: 'a missed rotation, an agent reconnect, or a big field — still leg 1',
    input: takeoff(northOf(KSBA, 8), vfrTrip()),
    reason: 'MATCHED',
    legId: 11,
    nearby: [11],
    distance: [7.9, 8.1],
  },
  {
    name: 'takeoff 40 nm away',
    real: true,
    note: 'distanceNm reports the nearest leg not taken, for the log line',
    input: takeoff(northOf(KSBA, 40), vfrTrip()),
    reason: 'NO_LEG_IN_RADIUS',
    legId: null,
    nearby: [],
    distance: [39.9, 40.1],
  },
  {
    name: 'radiusNm override widens the same 40 nm case',
    real: true,
    note: 'the tuning knob plan.json expects to use once after phase 4',
    input: takeoff(northOf(KSBA, 40), vfrTrip(), { radiusNm: 50 }),
    reason: 'MATCHED',
    legId: 11,
    nearby: [11],
    distance: [39.9, 40.1],
  },
  {
    name: 'two eligible legs depart the same field',
    real: false,
    note: 'SYNTH trip: real KMRY coords, but no real trip has two legs off one field',
    input: takeoff(KMRY_A, [
      leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A),
      leg(14, 3, VFR_TRIP, 'KMRY', KMRY_B),
    ]),
    reason: 'AMBIGUOUS',
    legId: null,
    nearby: [12, 14],
    distance: [0, 0.1],
  },
  {
    name: 'leg 1 already flown, second takeoff from KSBA',
    real: true,
    note: 'reachable only because the loader returns flown legs too (Amendment C)',
    input: takeoff(KSBA, vfrTrip({ l11: { status: 'flown', linkedFlightId: null } })),
    reason: 'LEG_ALREADY_FLOWN',
    legId: null,
    nearby: [11],
    distance: [0, 0.1],
  },
  {
    name: 'diverted counts as flown',
    real: true,
    input: takeoff(KSBA, vfrTrip({ l11: { status: 'diverted' } })),
    reason: 'LEG_ALREADY_FLOWN',
    legId: null,
    nearby: [11],
    distance: [0, 0.1],
  },
  {
    name: 'flown leg excluded, its successor still matches',
    real: true,
    note: 'takeoff at KMRY with leg 1 flown+linked: exactly the §13.2 saving grace',
    input: takeoff(KMRY_A, vfrTrip({ l11: { status: 'flown', linkedFlightId: 42 } })),
    reason: 'MATCHED',
    legId: 12,
    nearby: [12],
    distance: [0, 0.1],
  },
  {
    name: 'leg already linked to another flight',
    real: true,
    input: takeoff(KMRY_A, vfrTrip({ l12: { linkedFlightId: 42 } })),
    reason: 'LEG_ALREADY_LINKED',
    legId: null,
    nearby: [12],
    distance: [0, 0.1],
  },
  {
    name: 'leg skipped by the user',
    real: true,
    input: takeoff(KSTS, vfrTrip({ l13: { status: 'skipped' } })),
    reason: 'LEG_SKIPPED',
    legId: null,
    nearby: [13],
    distance: [0, 0.1],
  },
  {
    name: 'precedence: flown AND linked reports FLOWN',
    real: true,
    note: 'the per-leg order in §13.2 step 5, not whichever check runs first',
    input: takeoff(KSBA, vfrTrip({ l11: { status: 'flown', linkedFlightId: 42 } })),
    reason: 'LEG_ALREADY_FLOWN',
    legId: null,
    nearby: [11],
    distance: [0, 0.1],
  },
  {
    name: 'two ineligible legs: the NEARER names the obstacle',
    real: true,
    note: 'KMRY_B linked at 0 nm beats KMRY_A flown at 0.24 nm — distance, not precedence',
    input: takeoff(KMRY_B, [
      leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A, { status: 'flown' }),
      leg(14, 3, VFR_TRIP, 'KMRY', KMRY_B, { linkedFlightId: 42 }),
    ]),
    reason: 'LEG_ALREADY_LINKED',
    legId: null,
    nearby: [12, 14],
    distance: [0, 0.05],
  },
  {
    name: 'same pair, other takeoff position, flips the answer',
    real: true,
    note: 'proves the previous row is decided by distance and nothing else',
    input: takeoff(KMRY_A, [
      leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A, { status: 'flown' }),
      leg(14, 3, VFR_TRIP, 'KMRY', KMRY_B, { linkedFlightId: 42 }),
    ]),
    reason: 'LEG_ALREADY_FLOWN',
    legId: null,
    nearby: [12, 14],
    distance: [0, 0.05],
  },
  {
    name: 'nearer obstacle with a wide gap (6 nm apart)',
    real: false,
    note: 'SYNTH: the 6 nm leg is KSBA offset due north; no fixture pair is 6 nm apart',
    input: takeoff(KSBA, [
      leg(11, 1, VFR_TRIP, 'KSBA', KSBA, { linkedFlightId: 42 }),
      leg(15, 2, VFR_TRIP, 'KSBA', northOf(KSBA, 6), { status: 'flown' }),
    ]),
    reason: 'LEG_ALREADY_LINKED',
    legId: null,
    nearby: [11, 15],
    distance: [0, 0.1],
  },
  {
    name: 'plan snippet: departure is not an airport',
    real: false,
    note: 'SYNTH: all five fixtures are airport-to-airport; departureIsAirport=false',
    input: takeoff(KSTS, [
      leg(16, 1, VFR_TRIP, 'WP1', KSTS, { departureIdent: null, departureIsAirport: false }),
    ]),
    reason: 'SNIPPET_NO_DEPARTURE_AIRPORT',
    legId: null,
    nearby: [16],
    distance: [0, 0.1],
  },
  {
    name: 'no active trip',
    real: true,
    note: 'the feature is simply off for this flight; not an error',
    input: takeoff(KSBA, vfrTrip(), { activeTripId: null }),
    reason: 'NO_ACTIVE_TRIP',
    legId: null,
    nearby: [],
    distance: null,
  },
  {
    name: 'active trip whose legs all belong to another trip',
    real: true,
    input: takeoff(KSBA, vfrTrip(), { activeTripId: 9 }),
    reason: 'NO_PLANNED_LEGS',
    legId: null,
    nearby: [],
    distance: null,
  },
  {
    name: 'flight already linked beats a perfect match below it',
    real: true,
    note: 'step 0 outranks everything, including a leg 0 nm away',
    input: takeoff(KSBA, vfrTrip(), { flightAlreadyLinkedTo: 7 }),
    reason: 'FLIGHT_ALREADY_LINKED',
    legId: null,
    nearby: [],
    distance: null,
  },
  {
    name: 'IFR: takeoff at KSFO matches the 293 nm leg',
    real: true,
    input: takeoff(KSFO, ifrTrip(), { activeTripId: IFR_TRIP }),
    reason: 'MATCHED',
    legId: 21,
    nearby: [21],
    distance: [0, 0.1],
  },
  {
    name: 'IFR: KLAX is 293 nm from the only departure',
    real: true,
    note: 'the radius at the long end: a return flight is not the leg it came from',
    input: takeoff(KLAX, ifrTrip(), { activeTripId: IFR_TRIP }),
    reason: 'NO_LEG_IN_RADIUS',
    legId: null,
    nearby: [],
    distance: [290, 296],
  },
  {
    name: 'KACV, 160 nm up the coast from the nearest departure',
    real: true,
    input: takeoff(KACV, vfrTrip()),
    reason: 'NO_LEG_IN_RADIUS',
    legId: null,
    nearby: [],
    distance: [140, 160],
  },
  {
    name: 'antimeridian: takeoff 179.97°W, leg departs 179.95°E',
    real: false,
    note: 'SYNTH: nothing in this repo crosses 180°. A degree delta reads 359.92° ≈ 21 000 nm and would refuse',
    input: takeoff({ lat: -16.5, lon: -179.97 }, [
      leg(31, 1, VFR_TRIP, 'NFXX', { lat: -16.5, lon: 179.95 }),
    ]),
    reason: 'MATCHED',
    legId: 31,
    nearby: [31],
    distance: [4, 5.5],
  },
  {
    name: 'antimeridian, real pair: NZAA vs an NFFN departure',
    real: false,
    note: 'SYNTH: real airport coordinates, not repo fixtures — a ~1 160 nm sanity check on the same maths',
    input: takeoff({ lat: -37.008056, lon: 174.791667 }, [
      leg(32, 1, VFR_TRIP, 'NFFN', { lat: -17.755278, lon: 177.443333 }),
    ]),
    reason: 'NO_LEG_IN_RADIUS',
    legId: null,
    nearby: [],
    distance: [1100, 1220],
  },
];

// ── Database-backed section: Amendment C has no other guard ──────────────────
//
// Everything above is pure: matchPlannedLeg() is called directly against
// hand-built candidates, and no SQL ever runs. That leaves
// getPlannedLegCandidatesForActiveTrip() (src/db.ts) completely uncovered —
// it deliberately returns EVERY leg of the active trip, 'flown'/'diverted'/
// 'skipped'/already-linked included, so that step 5 of the matcher can name
// the specific obstacle instead of a generic NO_LEG_IN_RADIUS (design.md
// §13.2, Amendment C). Its old name, getUnflownPlannedLegsForActiveTrip,
// endorsed the opposite behaviour, which is exactly why a
// `WHERE l.status NOT IN ('flown','diverted')` filter is the kind of change
// that looks like a harmless optimisation and would revert the amendment by
// accident. Nothing above would notice: the three reason codes it protects
// would silently degrade to NO_LEG_IN_RADIUS. This section runs the real
// query against a real (scratch, temporary) SQLite database and asserts
// what Amendment C requires of it.
//
// src/db.ts computes its DB_PATH from process.cwd() once, at module load —
// so the only way to point it at a scratch database is to chdir there
// BEFORE './db' is first required in this process. This file never imports
// './db' at the top for exactly that reason: the require() below is that
// first import.

function runDbBackedSection(): boolean {
  type DbModule = typeof import('./db');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legmatch-db-'));
  const originalCwd = process.cwd();
  const problems: string[] = [];
  let dbModule: DbModule | null = null;

  console.log('── planned-leg candidates — database-backed section (Amendment C guard)');

  try {
    process.chdir(tmpDir);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    dbModule = require('./db') as DbModule;
    dbModule.initDb();

    const tripId = dbModule.createTrip('DB-backed harness trip', null);
    dbModule.setActiveTrip(tripId);

    // Raw INSERT rather than createPlannedLeg(): that function also wants
    // waypoints, procedures and alternates, none of which
    // getPlannedLegCandidatesForActiveTrip() reads. Only the columns the
    // query actually selects are filled in.
    //
    // seq is deliberately NOT in id order — leg 'flown' and leg 'diverted'
    // share seq=1 (to exercise the id ASC tie-break), leg 'planned' is
    // seq=2 despite being inserted first (id=1), and leg 'skipped' is
    // seq=3. The one correct order is therefore
    // [flown(id2), diverted(id3), planned(id1), skipped(id4)] — anything
    // else means the ORDER BY isn't what §13.2 requires.
    const rawDb = dbModule.getDb();
    const insertLeg = rawDb.prepare(`
      INSERT INTO planned_legs (
        trip_id, seq, status,
        departure_ident, departure_lat, departure_lon, departure_is_airport,
        destination_ident, destination_lat, destination_lon, destination_is_airport,
        source_filename, source_sha256, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?)
    `);
    const leg = (seq: number, status: string, depIdent: string, depLat: number, depLon: number, destIdent: string, destLat: number, destLon: number): number =>
      insertLeg.run(tripId, seq, status, depIdent, depLat, depLon, destIdent, destLat, destLon, `${depIdent}-${destIdent}.lnmpln`, `${depIdent}${destIdent}${seq}`, new Date().toISOString()).lastInsertRowid as number;

    const legPlanned = leg(2, 'planned', 'AAAA', 10, 10, 'BBBB', 11, 11);
    const legFlown = leg(1, 'flown', 'CCCC', 12, 12, 'DDDD', 13, 13);
    const legDiverted = leg(1, 'diverted', 'EEEE', 14, 14, 'FFFF', 15, 15);
    const legSkipped = leg(3, 'skipped', 'GGGG', 16, 16, 'HHHH', 17, 17);

    const flightId = dbModule.insertFlight('TEST', 12, 12, new Date().toISOString());
    dbModule.linkFlightToPlannedLeg(flightId, legFlown, 'manual');

    const candidates = dbModule.getPlannedLegCandidatesForActiveTrip();
    const byId = new Map(candidates.map((c) => [c.plannedLegId, c]));

    const wantStatuses = ['planned', 'flown', 'diverted', 'skipped'];
    const gotStatuses = wantStatuses.filter((s) => candidates.some((c) => c.status === s));
    if (gotStatuses.length !== wantStatuses.length) {
      problems.push(
        `expected all four statuses [${wantStatuses.join(', ')}], got [${gotStatuses.join(', ')}] ` +
        `(${candidates.length} candidate(s) total) — a status filter is dropping rows Amendment C requires`,
      );
    }

    const flownCandidate = byId.get(legFlown);
    if (!flownCandidate || flownCandidate.linkedFlightId !== flightId) {
      problems.push(
        `expected leg #${legFlown} (flown, linked to flight #${flightId}) to report ` +
        `linkedFlightId ${flightId}, got ${flownCandidate ? String(flownCandidate.linkedFlightId) : 'MISSING ROW'}`,
      );
    }

    const wantOrder = [legFlown, legDiverted, legPlanned, legSkipped];
    const gotOrder = candidates.map((c) => c.plannedLegId);
    if (!eq(wantOrder, gotOrder)) {
      problems.push(
        `expected order (seq ASC, id ASC) [${wantOrder.join(', ')}], got [${gotOrder.join(', ')}]`,
      );
    }

    console.log(`   4 legs inserted (planned #${legPlanned}, flown #${legFlown}, diverted #${legDiverted}, skipped #${legSkipped}), 1 linked flight (#${flightId})`);
    console.log(`   statuses returned: [${candidates.map((c) => c.status).join(', ')}]`);
    console.log(`   order returned:    [${gotOrder.join(', ')}]`);
  } catch (err) {
    problems.push(`threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } finally {
    try {
      dbModule?.closeDb();
    } catch {
      // best-effort — the assertions above already ran
    }
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (problems.length === 0) {
    console.log('   ✓ all four statuses present, linked flight reported, seq ASC/id ASC order correct');
    console.log('');
    return true;
  }
  for (const p of problems) console.error(`   ✗ ${p}`);
  console.log('');
  return false;
}

// ── Runner ────────────────────────────────────────────────────────────────────

const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const fmtDist = (d: number | null) => (d === null ? '—' : d < 100 ? d.toFixed(2) : d.toFixed(0));
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

function main(): void {
  const verbose = process.argv.slice(2).includes('-v');
  const failures: string[] = [];

  console.log(`── planned-leg matcher — ${SCENARIOS.length} scenarios`);
  console.log(`   DEPARTURE_RADIUS_NM=${DEPARTURE_RADIUS_NM}  ARRIVAL_RADIUS_NM=${ARRIVAL_RADIUS_NM}`);
  console.log('   src = REAL (samples/lnmpln coordinates) | SYNTH (hand-built; see the header)');
  console.log('');
  console.log(
    `   ${pad('#', 3)}${pad('src', 6)}${pad('scenario', 55)}${pad('expected', 36)}${pad('actual', 36)}${padL('nm', 7)}  ok`,
  );

  SCENARIOS.forEach((s, i) => {
    const r = matchPlannedLeg(s.input);

    const expectedLeg = s.legId === null ? '—' : `#${s.legId}`;
    const actualLeg = r.plannedLegId === null ? '—' : `#${r.plannedLegId}`;
    const distOk =
      s.distance === null
        ? r.distanceNm === null
        : r.distanceNm !== null && r.distanceNm >= s.distance[0] && r.distanceNm <= s.distance[1];
    // tripId travels with plannedLegId or is null; asserted rather than shown.
    const tripOk = r.plannedLegId === null ? r.tripId === null : r.tripId === s.input.activeTripId;
    const ok =
      r.reason === s.reason && r.plannedLegId === s.legId && eq(r.nearbyLegIds, s.nearby) && distOk && tripOk;

    const expected = `${s.reason} ${expectedLeg} [${s.nearby.join(',')}]`;
    const actual = `${r.reason} ${actualLeg} [${r.nearbyLegIds.join(',')}]`;

    console.log(
      `   ${pad(String(i + 1), 3)}${pad(s.real ? 'REAL' : 'SYNTH', 6)}${pad(s.name, 55)}${pad(expected, 36)}${pad(actual, 36)}${padL(fmtDist(r.distanceNm), 7)}  ${ok ? '✓' : '✗'}`,
    );
    if (s.note) console.log(`        ${s.note}`);
    if (verbose) {
      console.log(`        result ${JSON.stringify(r)}`);
    }

    if (!ok) {
      const parts: string[] = [];
      if (r.reason !== s.reason) parts.push(`reason expected ${s.reason}, got ${r.reason}`);
      if (r.plannedLegId !== s.legId) parts.push(`plannedLegId expected ${s.legId}, got ${r.plannedLegId}`);
      if (!eq(r.nearbyLegIds, s.nearby))
        parts.push(`nearbyLegIds expected [${s.nearby.join(',')}], got [${r.nearbyLegIds.join(',')}]`);
      if (!distOk)
        parts.push(
          `distanceNm expected ${s.distance === null ? 'null' : `${s.distance[0]}..${s.distance[1]}`}, got ${r.distanceNm === null ? 'null' : r.distanceNm.toFixed(4)}`,
        );
      if (!tripOk) parts.push(`tripId expected ${r.plannedLegId === null ? 'null' : s.input.activeTripId}, got ${r.tripId}`);
      failures.push(`   ✗ ${i + 1}. ${s.name}\n        ${parts.join('\n        ')}`);
    }
  });

  console.log('');

  // ── Invariants that are not per-scenario ───────────────────────────────────
  // Every reason code in design.md §13.4 must be reachable from this table; a
  // code with no row is a branch nobody has ever seen run.
  const ALL_REASONS: LegMatchReason[] = [
    'MATCHED',
    'NO_ACTIVE_TRIP',
    'NO_PLANNED_LEGS',
    'NO_LEG_IN_RADIUS',
    'AMBIGUOUS',
    'LEG_ALREADY_FLOWN',
    'LEG_ALREADY_LINKED',
    'LEG_SKIPPED',
    'SNIPPET_NO_DEPARTURE_AIRPORT',
    'FLIGHT_ALREADY_LINKED',
  ];
  const covered = new Set(SCENARIOS.map((s) => matchPlannedLeg(s.input).reason));
  const missing = ALL_REASONS.filter((c) => !covered.has(c));
  console.log(`── reason-code coverage  ${ALL_REASONS.length - missing.length}/${ALL_REASONS.length}${missing.length ? `  MISSING: ${missing.join(', ')}` : ''}`);
  if (missing.length) failures.push(`   ✗ reason codes never produced: ${missing.join(', ')}`);

  // Determinism: the same input twice, and the same input with its candidate
  // list reversed, must both produce the identical result. §13.2 says no step
  // depends on iteration order, and this is the cheapest way to keep it true.
  let orderFailures = 0;
  for (const s of SCENARIOS) {
    const a = JSON.stringify(matchPlannedLeg(s.input));
    const b = JSON.stringify(matchPlannedLeg(s.input));
    const reversed = JSON.stringify(
      matchPlannedLeg({ ...s.input, candidates: [...s.input.candidates].reverse() }),
    );
    if (a !== b) {
      failures.push(`   ✗ not deterministic: "${s.name}" gave ${a} then ${b}`);
      orderFailures++;
    } else if (a !== reversed) {
      // A genuine tie in distance may legitimately pick the first-listed leg, so
      // report the input that exposed it rather than asserting a rule it breaks.
      failures.push(`   ✗ order-dependent: "${s.name}" gave ${a}, reversed gave ${reversed}`);
      orderFailures++;
    }
  }
  console.log(`── determinism + candidate-order independence  ${SCENARIOS.length - orderFailures}/${SCENARIOS.length}`);

  // startTime and aircraft must not influence the result in this version.
  let inertFailures = 0;
  for (const s of SCENARIOS) {
    const base = JSON.stringify(matchPlannedLeg(s.input));
    const altered = JSON.stringify(
      matchPlannedLeg({ ...s.input, startTime: '1999-12-31T23:59:59.000Z', aircraft: null }),
    );
    if (base !== altered) {
      failures.push(`   ✗ startTime/aircraft changed the result of "${s.name}"`);
      inertFailures++;
    }
  }
  console.log(`── startTime & aircraft inert  ${SCENARIOS.length - inertFailures}/${SCENARIOS.length}`);
  console.log('');

  // Second, clearly separate section: this one is not pure, and is not part
  // of the scenario table above — it is the only thing in this file (or
  // anywhere else) that runs getPlannedLegCandidatesForActiveTrip()'s actual
  // SQL rather than hand-building candidates. See its own header for why.
  const dbSectionOk = runDbBackedSection();
  if (!dbSectionOk) failures.push('   ✗ database-backed section (Amendment C guard) — see above');

  if (failures.length === 0) {
    console.log(`${SCENARIOS.length} scenarios, 0 failures`);
    return;
  }
  for (const f of failures) console.error(f);
  console.error('');
  console.error(`${SCENARIOS.length} scenarios, ${failures.length} failure(s)`);
  process.exitCode = 1;
}

main();
