import { describe, it, expect } from 'vitest';
import type { FlightPoint } from '../types';
import {
  buildTimeline,
  sample,
  realMsFromVirtual,
  virtualFromRealMs,
  COLLAPSED_GAP_SEC,
} from './replay';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');

function pt(sec: number, over: Partial<FlightPoint> = {}): FlightPoint {
  return {
    id: Math.round(sec),
    flight_id: 1,
    ts: new Date(T0 + sec * 1000).toISOString(),
    lat: 10,
    lon: 20,
    altitude_ft: 1000,
    airspeed_kts: 100,
    ground_speed_kts: 110,
    heading_deg: 90,
    vertical_speed_fpm: 0,
    on_ground: 0,
    ...over,
  };
}

const at = (tl: ReturnType<typeof buildTimeline>, v: number) => sample(tl, v)!;

describe('replay engine', () => {
  it('interpolates every numeric field at the midpoint', () => {
    const tl = buildTimeline([
      pt(0, { lat: 10, lon: 20, altitude_ft: 1000, airspeed_kts: 100, ground_speed_kts: 120, vertical_speed_fpm: 0 }),
      pt(10, { lat: 12, lon: 22, altitude_ft: 2000, airspeed_kts: 140, ground_speed_kts: 160, vertical_speed_fpm: 1000 }),
    ]);
    const s = at(tl, 5);
    expect(s.lat).toBeCloseTo(11);
    expect(s.lon).toBeCloseTo(21);
    expect(s.altitudeFt).toBeCloseTo(1500);
    expect(s.airspeedKnots).toBeCloseTo(120);
    expect(s.groundSpeedKnots).toBeCloseTo(140);
    expect(s.verticalSpeedFpm).toBeCloseTo(500);
    expect(s.realTimeMs).toBe(T0 + 5000);
  });

  it('takes the shortest arc for heading', () => {
    const a = buildTimeline([pt(0, { heading_deg: 350 }), pt(10, { heading_deg: 10 })]);
    expect(at(a, 5).headingDeg).toBeCloseTo(0);
    const b = buildTimeline([pt(0, { heading_deg: 10 }), pt(10, { heading_deg: 350 })]);
    expect(at(b, 5).headingDeg).toBeCloseTo(0);
    const c = buildTimeline([pt(0, { heading_deg: 90 }), pt(10, { heading_deg: 100 })]);
    expect(at(c, 5).headingDeg).toBeCloseTo(95);
  });

  it('keeps heading in [0, 360)', () => {
    const tl = buildTimeline([pt(0, { heading_deg: 350 }), pt(10, { heading_deg: 10 })]);
    for (let v = 0; v <= 10; v += 0.5) {
      const h = at(tl, v).headingDeg;
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  const gapPts = () => [
    pt(0, { lat: 1, lon: 1 }),
    pt(5, { lat: 2, lon: 2, altitude_ft: 2000 }),
    pt(3600, { lat: 3, lon: 3, altitude_ft: 3000 }),
  ];

  it('collapses a long gap and holds the marker at the pre-gap point', () => {
    const tl = buildTimeline(gapPts());
    expect(tl.virtualDurationSec).toBe(5 + COLLAPSED_GAP_SEC);
    expect(tl.gapCount).toBe(1);
    for (const v of [5, 5.5, 6, 6.9]) {
      const s = at(tl, v);
      expect(s.lat).toBe(2);
      expect(s.altitudeFt).toBe(2000);
      expect(s.inGap).toBe(true);
      expect(s.gapRealSec).toBe(3595);
    }
  });

  it('lands on the post-gap point exactly at the end of the collapsed span', () => {
    const tl = buildTimeline(gapPts());
    const s = at(tl, 5 + COLLAPSED_GAP_SEC);
    expect(s.pointIndex).toBe(2);
    expect(s.inGap).toBe(false);
    expect(s.lat).toBe(3);
  });

  it('does not treat a 15 s interval as a gap', () => {
    const tl = buildTimeline([pt(0), pt(15)]);
    expect(tl.segments[0].isGap).toBe(false);
    expect(tl.virtualDurationSec).toBe(15);
  });

  it('steps on_ground rather than blending it', () => {
    const tl = buildTimeline([pt(0, { on_ground: 1 }), pt(10, { on_ground: 0 })]);
    for (const v of [0, 1, 5, 9.99]) expect(at(tl, v).onGround).toBe(true);
    expect(at(tl, 10).onGround).toBe(false);
  });

  it('unwraps longitude across the antimeridian', () => {
    const tl = buildTimeline([
      pt(0, { lon: -179.991806 }),
      pt(5, { lon: -179.999173 }),
      pt(11, { lon: 179.991978 }),
      pt(16, { lon: 179.984615 }),
    ]);
    for (let i = 1; i < tl.latlngs.length; i++) {
      expect(Math.abs(tl.latlngs[i][1] - tl.latlngs[i - 1][1])).toBeLessThan(180);
    }
    const lon = at(tl, 5 + 3).lon;
    expect(Math.abs(lon)).toBeGreaterThan(179.9);
  });

  it('handles zero points', () => {
    const tl = buildTimeline([]);
    expect(tl.virtualDurationSec).toBe(0);
    expect(tl.segments).toEqual([]);
    expect(sample(tl, 0)).toBeNull();
    expect(realMsFromVirtual(tl, 0)).toBe(0);
  });

  it('handles a single point', () => {
    const tl = buildTimeline([pt(0, { lat: 7, heading_deg: 45 })]);
    expect(tl.virtualDurationSec).toBe(0);
    for (const v of [-5, 0, 100]) {
      const s = at(tl, v);
      expect(s.lat).toBe(7);
      expect(s.segmentIndex).toBe(-1);
      expect(s.pointIndex).toBe(0);
      expect(s.headingDeg).toBe(45);
    }
  });

  it('drops duplicate timestamps, first wins', () => {
    const tl = buildTimeline([pt(0, { lat: 1 }), pt(0, { lat: 9 }), pt(10, { lat: 2 })]);
    expect(tl.points).toHaveLength(2);
    expect(tl.points[0].lat).toBe(1);
    expect(tl.segments.every(s => s.durationSec > 0)).toBe(true);
  });

  it('is independent of input order', () => {
    const sorted = [pt(0, { lat: 1 }), pt(5, { lat: 2 }), pt(10, { lat: 3 }), pt(40, { lat: 4 })];
    const shuffled = [sorted[2], sorted[0], sorted[3], sorted[1]];
    expect(buildTimeline(shuffled)).toEqual(buildTimeline(sorted));
  });

  it('drops points with an unparseable ts or non-finite coordinates', () => {
    const tl = buildTimeline([
      pt(0),
      pt(5, { ts: 'not a date' }),
      pt(6, { lat: NaN }),
      pt(7, { lon: Infinity }),
      pt(10),
    ]);
    expect(tl.points).toHaveLength(2);
    expect(tl.virtualDurationSec).toBe(10);
  });

  it('reads non-finite readout fields as 0 without dropping the point', () => {
    const tl = buildTimeline([pt(0, { altitude_ft: NaN }), pt(10, { altitude_ft: 1000 })]);
    expect(tl.points).toHaveLength(2);
    expect(at(tl, 5).altitudeFt).toBeCloseTo(500);
  });

  it('clamps the virtual time', () => {
    const tl = buildTimeline([pt(0), pt(10, { lat: 12 })]);
    expect(sample(tl, -10)).toEqual(sample(tl, 0));
    expect(sample(tl, 1e9)).toEqual(sample(tl, tl.virtualDurationSec));
    expect(sample(tl, NaN)).toEqual(sample(tl, 0));
    expect(at(tl, 1e9).virtualSec).toBe(10);
  });

  it('has exactly continuous segment boundaries', () => {
    const tl = buildTimeline([pt(0), pt(4.3), pt(9.7), pt(200), pt(207.1), pt(212.9)]);
    for (let k = 0; k < tl.segments.length - 1; k++) {
      expect(tl.segments[k].startVirtualSec + tl.segments[k].durationSec).toBe(
        tl.segments[k + 1].startVirtualSec
      );
    }
  });

  it('maps between virtual and real time', () => {
    const tl = buildTimeline(gapPts());
    expect(virtualFromRealMs(tl, realMsFromVirtual(tl, 3))).toBeCloseTo(3);
    expect(virtualFromRealMs(tl, T0 + 5000)).toBe(5);
    expect(virtualFromRealMs(tl, T0 + 1000 * 1000)).toBe(5);
    expect(virtualFromRealMs(tl, T0 - 1)).toBeNull();
    expect(virtualFromRealMs(tl, T0 + 3600 * 1000 + 1)).toBeNull();
    expect(virtualFromRealMs(buildTimeline([]), T0)).toBeNull();
  });

  it('honours custom thresholds', () => {
    const pts = [pt(0), pt(15)];
    const tl = buildTimeline(pts, { gapThresholdSec: 10, collapsedGapSec: 1 });
    expect(tl.segments[0].isGap).toBe(true);
    expect(tl.virtualDurationSec).toBe(1);
    expect(tl.options).toEqual({ gapThresholdSec: 10, collapsedGapSec: 1 });
  });

  it('a timeline made only of gaps is holds and steps', () => {
    const tl = buildTimeline([pt(0), pt(3600), pt(7200)]);
    expect(tl.virtualDurationSec).toBe(2 * COLLAPSED_GAP_SEC);
  });
});
