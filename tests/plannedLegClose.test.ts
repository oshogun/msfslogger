// tests/plannedLegClose.test.ts — src/plannedLegClose.ts, T-004.
//
// The 24-row gate table (design.md of run 2026-09-07-manual-mark-flown §1.3)
// is transcribed verbatim from src/inspect-manual-mark.ts:99-124, both
// directions (48 verdicts). Message strings are transcribed character for
// character from src/plannedLegClose.ts:103, 112-113, 121, 130-131, 139-141
// and asserted with `toBe`, never `toContain` (design.md §8.3).
//
// Nothing here imports ./db, better-sqlite3, fs, http or https — decideHandClose
// and handCloseDeviationNm are pure (src/plannedLegClose.ts's own header).

import { describe, expect, it } from 'vitest';
import {
  decideHandClose,
  handCloseDeviationNm,
  type HandCloseLeg,
  type HandCloseRefusal,
} from '../src/plannedLegClose';
import { makeHandCloseFlight, makeHandCloseLeg } from './helpers';

// makeHandCloseFlight()/makeHandCloseLeg() default to id 900 / 500 — the same
// ids src/inspect-manual-mark.ts:128-129 uses for the gate table, "so the
// transcribed strings match without editing" (design.md §4.4).
const TABLE_FLIGHT_ID = 900;
const TABLE_LEG_ID = 500;

// ═══════════════════════════════════════════════════════════════════════════
// 1. GATE_TABLE — transcribed verbatim from src/inspect-manual-mark.ts:99-124
// ═══════════════════════════════════════════════════════════════════════════

type ExpectedVerdict = 'ALLOW' | HandCloseRefusal;

interface GateRow {
  row: number;
  linkSource: 'manual' | 'auto' | null;
  ended: boolean;
  legStatus: HandCloseLeg['status'];
  expFlown: ExpectedVerdict;
  expPlanned: ExpectedVerdict;
}

const GATE_TABLE: GateRow[] = [
  { row: 1, linkSource: 'manual', ended: true, legStatus: 'planned', expFlown: 'ALLOW', expPlanned: 'LEG_NOT_FLOWN' },
  { row: 2, linkSource: 'manual', ended: true, legStatus: 'flown', expFlown: 'LEG_NOT_PLANNED', expPlanned: 'ALLOW' },
  { row: 3, linkSource: 'manual', ended: true, legStatus: 'diverted', expFlown: 'LEG_NOT_PLANNED', expPlanned: 'LEG_NOT_FLOWN' },
  { row: 4, linkSource: 'manual', ended: true, legStatus: 'skipped', expFlown: 'LEG_NOT_PLANNED', expPlanned: 'LEG_NOT_FLOWN' },
  { row: 5, linkSource: 'manual', ended: false, legStatus: 'planned', expFlown: 'FLIGHT_NOT_ENDED', expPlanned: 'FLIGHT_NOT_ENDED' },
  { row: 6, linkSource: 'manual', ended: false, legStatus: 'flown', expFlown: 'FLIGHT_NOT_ENDED', expPlanned: 'FLIGHT_NOT_ENDED' },
  { row: 7, linkSource: 'manual', ended: false, legStatus: 'diverted', expFlown: 'FLIGHT_NOT_ENDED', expPlanned: 'FLIGHT_NOT_ENDED' },
  { row: 8, linkSource: 'manual', ended: false, legStatus: 'skipped', expFlown: 'FLIGHT_NOT_ENDED', expPlanned: 'FLIGHT_NOT_ENDED' },
  { row: 9, linkSource: 'auto', ended: true, legStatus: 'planned', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 10, linkSource: 'auto', ended: true, legStatus: 'flown', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 11, linkSource: 'auto', ended: true, legStatus: 'diverted', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 12, linkSource: 'auto', ended: true, legStatus: 'skipped', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 13, linkSource: 'auto', ended: false, legStatus: 'planned', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 14, linkSource: 'auto', ended: false, legStatus: 'flown', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 15, linkSource: 'auto', ended: false, legStatus: 'diverted', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 16, linkSource: 'auto', ended: false, legStatus: 'skipped', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 17, linkSource: null, ended: true, legStatus: 'planned', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 18, linkSource: null, ended: true, legStatus: 'flown', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 19, linkSource: null, ended: true, legStatus: 'diverted', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 20, linkSource: null, ended: true, legStatus: 'skipped', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 21, linkSource: null, ended: false, legStatus: 'planned', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 22, linkSource: null, ended: false, legStatus: 'flown', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 23, linkSource: null, ended: false, legStatus: 'diverted', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
  { row: 24, linkSource: null, ended: false, legStatus: 'skipped', expFlown: 'LINK_NOT_MANUAL', expPlanned: 'LINK_NOT_MANUAL' },
];

function buildFlight(r: GateRow) {
  return makeHandCloseFlight({
    end_time: r.ended ? '2026-09-07T17:06:00.726Z' : null,
    planned_leg_link_source: r.linkSource,
  });
}
function buildLeg(r: GateRow): HandCloseLeg {
  return makeHandCloseLeg({ status: r.legStatus });
}

// Transcribed character for character from src/plannedLegClose.ts:103,
// 112-113, 121, 130-131, 139-141.
function expectedMessage(reason: HandCloseRefusal, legStatus: string): string {
  switch (reason) {
    case 'NOT_LINKED':
      return `Flight ${TABLE_FLIGHT_ID} is not linked to a planned leg`;
    case 'LINK_NOT_MANUAL':
      return (
        `Flight ${TABLE_FLIGHT_ID} was not linked to its planned leg by hand: only a ` +
        `hand-linked flight's leg can be closed by hand`
      );
    case 'FLIGHT_NOT_ENDED':
      return `Flight ${TABLE_FLIGHT_ID} has not ended: its planned leg is closed at touchdown`;
    case 'LEG_NOT_PLANNED':
      return (
        `Planned leg ${TABLE_LEG_ID} is '${legStatus}', not 'planned': only a planned ` +
        `leg can be marked flown by hand`
      );
    case 'LEG_NOT_FLOWN':
      return (
        `Planned leg ${TABLE_LEG_ID} is '${legStatus}', not 'flown': only a flown leg ` +
        `can be returned to planned`
      );
  }
}

describe('decideHandClose — 24-row gate table, both directions (48 verdicts), transcribed from src/inspect-manual-mark.ts:99-124', () => {
  for (const r of GATE_TABLE) {
    it(`row ${r.row}: linkSource=${String(r.linkSource)} ended=${r.ended} legStatus=${r.legStatus}`, () => {
      const flight = buildFlight(r);
      const leg = buildLeg(r);

      const flown = decideHandClose('flown', flight, leg);
      if (r.expFlown === 'ALLOW') {
        expect(flown.allowed).toBe(true);
      } else if (!flown.allowed) {
        expect(flown.reason).toBe(r.expFlown);
        expect(flown.message).toBe(expectedMessage(r.expFlown, r.legStatus));
      } else {
        throw new Error(`row ${r.row} →flown: expected refusal ${r.expFlown}, got allowed`);
      }

      const planned = decideHandClose('planned', flight, leg);
      if (r.expPlanned === 'ALLOW') {
        expect(planned.allowed).toBe(true);
      } else if (!planned.allowed) {
        expect(planned.reason).toBe(r.expPlanned);
        expect(planned.message).toBe(expectedMessage(r.expPlanned, r.legStatus));
      } else {
        throw new Error(`row ${r.row} →planned: expected refusal ${r.expPlanned}, got allowed`);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. NOT_LINKED — not reachable from the 24-row table (its flight/leg are
//    always linked by construction), so covered separately here.
// ═══════════════════════════════════════════════════════════════════════════

describe('decideHandClose — NOT_LINKED (design.md §1.5)', () => {
  it('refuses NOT_LINKED when planned_leg_id is null and leg is null', () => {
    const flight = makeHandCloseFlight({ planned_leg_id: null, planned_leg_link_source: null });
    const result = decideHandClose('flown', flight, null);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('NOT_LINKED');
      expect(result.message).toBe(`Flight ${TABLE_FLIGHT_ID} is not linked to a planned leg`);
    }
  });

  it('refuses NOT_LINKED when planned_leg_id is set but the leg row is missing (leg === null)', () => {
    const flight = makeHandCloseFlight({ planned_leg_id: 500 });
    const result = decideHandClose('flown', flight, null);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('NOT_LINKED');
      expect(result.message).toBe(`Flight ${TABLE_FLIGHT_ID} is not linked to a planned leg`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Refusal ORDER — normative, design.md of run 2026-09-07-manual-mark-flown
//    §1.2: NOT_LINKED · LINK_NOT_MANUAL · FLIGHT_NOT_ENDED · LEG_NOT_PLANNED/
//    LEG_NOT_FLOWN. Each test below trips two conditions at once so the
//    earlier-listed code must win.
// ═══════════════════════════════════════════════════════════════════════════

describe('decideHandClose — refusal order is pinned (earliest applicable check wins)', () => {
  it('NOT_LINKED beats FLIGHT_NOT_ENDED: not linked AND the flight has not ended', () => {
    const flight = makeHandCloseFlight({ planned_leg_id: null, end_time: null });
    const result = decideHandClose('flown', flight, null);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('NOT_LINKED');
  });

  it('LINK_NOT_MANUAL beats FLIGHT_NOT_ENDED: auto-linked AND the flight has not ended', () => {
    const flight = makeHandCloseFlight({ planned_leg_link_source: 'auto', end_time: null });
    const leg = makeHandCloseLeg({ status: 'planned' });
    const result = decideHandClose('flown', flight, leg);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('LINK_NOT_MANUAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Both allowed paths — 'flown' carries a deviation, 'planned' always clears it
// ═══════════════════════════════════════════════════════════════════════════

describe("decideHandClose — the two allowed paths ('flown' with a deviation, 'planned' with deviationNm null)", () => {
  it("'flown' request that is allowed returns a numeric deviationNm and status 'flown'", () => {
    const flight = makeHandCloseFlight(); // manual, ended, arrival set
    const leg = makeHandCloseLeg({ status: 'planned' });
    const result = decideHandClose('flown', flight, leg);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.legId).toBe(TABLE_LEG_ID);
      expect(result.status).toBe('flown');
      expect(typeof result.deviationNm).toBe('number');
    }
  });

  it("'planned' request that is allowed always returns deviationNm: null (the reverse clears the deviation)", () => {
    const flight = makeHandCloseFlight();
    const leg = makeHandCloseLeg({ status: 'flown' });
    const result = decideHandClose('planned', flight, leg);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.legId).toBe(TABLE_LEG_ID);
      expect(result.status).toBe('planned');
      expect(result.deviationNm).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. handCloseDeviationNm
// ═══════════════════════════════════════════════════════════════════════════

describe('handCloseDeviationNm', () => {
  it('returns null when arrival_lat is null', () => {
    expect(
      handCloseDeviationNm(
        { arrival_lat: null, arrival_lon: -119.841507 },
        { destination_lat: 36.586952, destination_lon: -121.843079 },
      ),
    ).toBeNull();
  });

  it('returns null when arrival_lon is null', () => {
    expect(
      handCloseDeviationNm(
        { arrival_lat: 34.426201, arrival_lon: null },
        { destination_lat: 36.586952, destination_lon: -121.843079 },
      ),
    ).toBeNull();
  });

  it('returns null when both arrival coordinates are null', () => {
    expect(
      handCloseDeviationNm(
        { arrival_lat: null, arrival_lon: null },
        { destination_lat: 36.586952, destination_lon: -121.843079 },
      ),
    ).toBeNull();
  });

  it('uses Math.round(x*10)/10, not toFixed(1) — the x.x5 rounding-boundary case from src/inspect-manual-mark.ts:429-487', () => {
    // Transcribed from src/inspect-manual-mark.ts:437-450: destination is
    // 0.0024983152722295506° north of the arrival, found by binary search so
    // that haversineNm(...) lands on the double nearest 0.15 nm
    // (0.14999999999999999445...) — a value where Math.round(x*10)/10 and
    // Number(x.toFixed(1)) actually disagree (0.2 vs 0.1). If a future switch
    // to toFixed(1) lands, this assertion fails.
    const flight = { arrival_lat: 0, arrival_lon: 0 };
    const leg = { destination_lat: 0.0024983152722295506, destination_lon: 0 };

    const raw = 0.14999999999999999445;
    expect(Math.round(raw * 10) / 10).toBe(0.2); // the frozen expression, design.md §3.2
    expect(Number(raw.toFixed(1))).toBe(0.1); // the look-alike the design explicitly rules out

    expect(handCloseDeviationNm(flight, leg)).toBe(0.2);
  });
});
