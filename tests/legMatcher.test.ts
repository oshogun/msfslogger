// tests/legMatcher.test.ts — src/legMatcher.ts, T-004.
//
// Two parts:
//   1. The 24-row scenario table ported from src/inspect-legmatch.ts:143-385
//      (design.md §8.2). Scenario data — names, coordinates, expected reason /
//      legId / nearby / distance window — is TRANSCRIBED from that file, not
//      re-derived. `leg()` maps to `makeCandidate()` (§4.3) and `takeoff()` is
//      a local literal-builder, both mirroring the inspector's own helpers of
//      the same name so the transcription stays line-for-line checkable.
//   2. Three cases design.md §8.2 calls out as NOT in the inspector's table,
//      plus two nearbyLegIds-shape cases (design.md acceptance criterion 5).
//
// Nothing here imports ./db, better-sqlite3, fs, http or https — matchPlannedLeg
// is pure (src/legMatcher.ts's own header).

import { describe, expect, it } from 'vitest';
import {
  matchPlannedLeg,
  type LegMatchCandidate,
  type LegMatchInput,
  type LegMatchReason,
} from '../src/legMatcher';
import { haversineNm } from '../src/geo';
import { makeCandidate } from './helpers';

// ── Fixture coordinates — src/inspect-legmatch.ts:56-62, kept exactly as the
// inspector wrote them so the ported distance windows below still hold
// (design.md §8.2: "carry the inspector's own constants rather than
// substituting" tests/helpers'). ──────────────────────────────────────────────

const KSBA = { lat: 34.426201, lon: -119.841507 }; // VFR KSBA→KMRY, first Pos
const KMRY_A = { lat: 36.586952, lon: -121.843079 }; // VFR KMRY→KSTS, first Pos
const KMRY_B = { lat: 36.587494, lon: -121.838753 }; // VFR KMRY→KSFO, first Pos
const KSTS = { lat: 38.509693, lon: -122.812897 }; // VFR KSTS→KACV, first Pos
const KACV = { lat: 40.977814, lon: -124.108475 }; // VFR KSTS→KACV, last Pos
const KSFO = { lat: 37.618023, lon: -122.375519 }; // IFR KSFO→KLAX, first Pos
const KLAX = { lat: 33.942474, lon: -118.409332 }; // IFR KSFO→KLAX, last Pos

// src/inspect-legmatch.ts:66 — one arc-minute, used ONLY to reproduce the
// ported scenarios' own inclusive distance windows. §4.6's northOfNm (exact
// R=3440.065 arithmetic) is used below for the fresh radius-boundary tests.
const northOf = (p: { lat: number; lon: number }, nm: number) => ({ lat: p.lat + nm / 60, lon: p.lon });

const VFR_TRIP = 1;
const IFR_TRIP = 2;

// src/inspect-legmatch.ts:73-94, rebuilt on top of makeCandidate() (§4.3) per
// design.md §8.2's mapping table — same defaults (departureIsAirport: true,
// status: 'planned', linkedFlightId: null, aircraftType: 'C172').
function leg(
  plannedLegId: number,
  seq: number,
  tripId: number,
  departureIdent: string | null,
  pos: { lat: number; lon: number },
  over: Partial<LegMatchCandidate> = {},
): LegMatchCandidate {
  return makeCandidate({
    plannedLegId,
    tripId,
    seq,
    departureIdent,
    departureLat: pos.lat,
    departureLon: pos.lon,
    ...over,
  });
}

// src/inspect-legmatch.ts:97-103.
const vfrTrip = (
  o: { l11?: Partial<LegMatchCandidate>; l12?: Partial<LegMatchCandidate>; l13?: Partial<LegMatchCandidate> } = {},
): LegMatchCandidate[] => [
  leg(11, 1, VFR_TRIP, 'KSBA', KSBA, o.l11),
  leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A, o.l12),
  leg(13, 3, VFR_TRIP, 'KSTS', KSTS, o.l13),
];

// src/inspect-legmatch.ts:106-108.
const ifrTrip = (o: Partial<LegMatchCandidate> = {}): LegMatchCandidate[] => [leg(21, 1, IFR_TRIP, 'KSFO', KSFO, o)];

// src/inspect-legmatch.ts:111-126.
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

interface Scenario {
  name: string;
  real: boolean;
  note?: string;
  input: LegMatchInput;
  reason: LegMatchReason;
  legId: number | null;
  nearby: number[];
  distance: [number, number] | null;
}

// Transcribed verbatim from src/inspect-legmatch.ts:143-385 (design.md §8.2:
// "that table is the specification. Port it; do not re-derive it").
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
    input: takeoff(KSTS, [leg(16, 1, VFR_TRIP, 'WP1', KSTS, { departureIdent: null, departureIsAirport: false })]),
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
    input: takeoff({ lat: -16.5, lon: -179.97 }, [leg(31, 1, VFR_TRIP, 'NFXX', { lat: -16.5, lon: 179.95 })]),
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

describe('matchPlannedLeg — 24 scenarios ported from src/inspect-legmatch.ts:143-385', () => {
  for (const s of SCENARIOS) {
    it(`[${s.real ? 'REAL' : 'SYNTH'}] ${s.name}${s.note ? ` — ${s.note}` : ''}`, () => {
      const r = matchPlannedLeg(s.input);

      expect(r.reason).toBe(s.reason);
      expect(r.plannedLegId).toBe(s.legId);
      expect(r.nearbyLegIds).toEqual(s.nearby);

      if (s.distance === null) {
        expect(r.distanceNm).toBeNull();
      } else {
        expect(r.distanceNm).not.toBeNull();
        expect(r.distanceNm as number).toBeGreaterThanOrEqual(s.distance[0]);
        expect(r.distanceNm as number).toBeLessThanOrEqual(s.distance[1]);
      }

      if (s.legId === null) {
        expect(r.tripId).toBeNull();
      } else {
        expect(r.tripId).toBe(s.input.activeTripId);
      }
    });
  }
});

// ── Fresh cases: design.md §8.2 names these as NOT in the inspector's 24 rows,
// plus the AMBIGUOUS/MATCHED nearbyLegIds-shape pair (acceptance criterion 5).

describe('matchPlannedLeg — fresh cases not in the inspector table (design.md §8.2)', () => {
  it('NO_PLANNED_LEGS from an empty candidate list', () => {
    const r = matchPlannedLeg(takeoff(KSBA, []));
    expect(r.reason).toBe('NO_PLANNED_LEGS');
    expect(r.plannedLegId).toBeNull();
    expect(r.tripId).toBeNull();
    expect(r.nearbyLegIds).toEqual([]);
    expect(r.distanceNm).toBeNull();
  });

  it('radiusNm: 0 is honoured via ?? (src/legMatcher.ts:183), not replaced by the default radius', () => {
    // 5 nm away: inside the default 10 nm radius (control), outside radiusNm: 0.
    const pos = northOf(KSBA, 5);
    const base = takeoff(pos, [leg(11, 1, VFR_TRIP, 'KSBA', KSBA)]);

    const withDefaultRadius = matchPlannedLeg(base);
    expect(withDefaultRadius.reason).toBe('MATCHED');

    const withZeroRadius = matchPlannedLeg({ ...base, radiusNm: 0 });
    expect(withZeroRadius.reason).toBe('NO_LEG_IN_RADIUS');
  });

  it('radius boundary: exactly DEPARTURE_RADIUS_NM matches, a hair beyond refuses (measured, never a constructed coordinate — design.md §4.6/§10.5)', () => {
    const candidate = leg(11, 1, VFR_TRIP, 'KSBA', KSBA);
    // Any takeoff point works; the measured distance IS the radius under test,
    // never assumed to equal a round number.
    const pos = northOf(KSBA, 10);
    const d = haversineNm(pos.lat, pos.lon, candidate.departureLat, candidate.departureLon);
    const base = takeoff(pos, [candidate]);

    const atBoundary = matchPlannedLeg({ ...base, radiusNm: d });
    expect(atBoundary.reason).toBe('MATCHED');
    expect(atBoundary.distanceNm).toBe(d);

    const justBeyond = matchPlannedLeg({ ...base, radiusNm: d - 1e-9 });
    expect(justBeyond.reason).toBe('NO_LEG_IN_RADIUS');
    expect(justBeyond.distanceNm).toBe(d); // nearest candidate's distance, for the log line
  });

  it('AMBIGUOUS nearbyLegIds names only the ELIGIBLE candidates, excluding an ineligible one in the same radius', () => {
    const input = takeoff(KMRY_A, [
      leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A), // eligible
      leg(14, 3, VFR_TRIP, 'KMRY', KMRY_B), // eligible
      leg(17, 4, VFR_TRIP, 'KMRY', KMRY_A, { status: 'flown' }), // ineligible, same field, in radius
    ]);
    const r = matchPlannedLeg(input);
    expect(r.reason).toBe('AMBIGUOUS');
    expect(r.nearbyLegIds).toEqual([12, 14]); // 17 excluded
  });

  it('MATCHED nearbyLegIds includes every candidate within radius, including an ineligible one at the same field', () => {
    const input = takeoff(KMRY_A, [
      leg(12, 2, VFR_TRIP, 'KMRY', KMRY_A), // eligible -> the winner
      leg(18, 4, VFR_TRIP, 'KMRY', KMRY_B, { status: 'flown' }), // ineligible, same field, in radius
    ]);
    const r = matchPlannedLeg(input);
    expect(r.reason).toBe('MATCHED');
    expect(r.plannedLegId).toBe(12);
    expect(r.nearbyLegIds).toEqual([12, 18]);
  });
});
