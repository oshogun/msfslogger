// tests/trafficStore.test.ts — tests src/trafficStore.ts.
//
// Pure rounding/normalization helpers, the retention cap, and the in-memory
// TrafficStore class. No mocks: nothing here touches ./db or ./airports.

import { describe, it, expect, afterEach } from 'vitest';
import type { TrafficObject } from '../src/types';
import { useFakeClock, useRealClock } from './helpers';
import {
  roundCoord,
  roundAlt,
  normHeading,
  distanceM,
  applyRetentionCap,
  MAX_RETAINED_OBJECTS,
  TRAFFIC_STALE_MS,
  TrafficStore,
} from '../src/trafficStore';

function makeObj(id: number, lat = 0, lon = 0, over: Partial<TrafficObject> = {}): TrafficObject {
  return { id, lat, lon, altitudeFt: 1000, headingDeg: 0, onGround: false, ...over };
}

describe('roundCoord', () => {
  it('rounds to 6 decimal places', () => {
    expect(roundCoord(1.23456789)).toBe(1.234568);
  });
});

describe('roundAlt', () => {
  it('rounds to the nearest whole foot', () => {
    expect(roundAlt(1234.4)).toBe(1234);
    expect(roundAlt(1234.6)).toBe(1235);
  });
});

describe('normHeading', () => {
  it('rounds to one decimal', () => {
    expect(normHeading(12.24)).toBe(12.2);
  });

  it('wraps exactly 360.0 to 0, not "360.0"', () => {
    expect(normHeading(360)).toBe(0);
  });

  it('rounds first, then wraps: a value that rounds up TO 360.0 also wraps to 0', () => {
    // 359.96 * 10 = 3599.6, which rounds to 3600 before the modulo is ever
    // applied — proving the wrap happens on the rounded tenth, not the raw
    // heading.
    expect(normHeading(359.96)).toBe(0);
  });

  it('wraps a negative heading into [0, 360)', () => {
    expect(normHeading(-12.2)).toBe(347.8);
  });
});

describe('distanceM', () => {
  it('returns 0 for the same point', () => {
    expect(distanceM(37.6, -122.4, 37.6, -122.4)).toBe(0);
  });

  it('matches a known distance: 1 degree of latitude at the equator', () => {
    // 2 * pi * R / 360, R = 6371000.
    expect(distanceM(0, 0, 1, 0)).toBeCloseTo(111194.926645, 5);
  });
});

describe('applyRetentionCap', () => {
  it('returns objects as-is when already at or under the cap, without reading lastFrame', () => {
    const objects = Array.from({ length: MAX_RETAINED_OBJECTS }, (_, i) => makeObj(i));
    // Any property access on this throws — if applyRetentionCap reads
    // lastFrame at all for an under-cap batch, the test fails with that
    // throw rather than an assertion mismatch.
    const poison = new Proxy(
      {},
      {
        get() {
          throw new Error('lastFrame was read for an under-cap batch');
        },
      },
    ) as unknown as { lat: number; lon: number };

    const result = applyRetentionCap(objects, poison);
    expect(result).toBe(objects);
  });

  it('keeps the nearest N when over cap, breaking ties by ascending id', () => {
    const lastFrame = { lat: 0, lon: 0 };
    // 99 objects with unique, always-kept distances (1..99 degrees of
    // longitude east), plus two objects tied at a larger distance
    // competing for the single remaining (100th) slot.
    const unique = Array.from({ length: 99 }, (_, i) => makeObj(i + 1, 0, i + 1));
    const tieLow = makeObj(200, 0, 500); // smaller id, distance ties with tieHigh
    const tieHigh = makeObj(300, 0, 500); // same distance, larger id
    const objects = [...unique, tieHigh, tieLow];

    const result = applyRetentionCap(objects, lastFrame);

    expect(result).toHaveLength(MAX_RETAINED_OBJECTS);
    const ids = result.map((o) => o.id);
    // All 99 unique-distance objects are kept.
    for (let i = 1; i <= 99; i++) expect(ids).toContain(i);
    // Of the tied pair, only the lower id fills the last slot.
    expect(ids).toContain(200);
    expect(ids).not.toContain(300);
  });

  it('keeps the first N in original order when over cap and lastFrame is null', () => {
    const objects = Array.from({ length: MAX_RETAINED_OBJECTS + 5 }, (_, i) => makeObj(i));

    const result = applyRetentionCap(objects, null);

    expect(result).toEqual(objects.slice(0, MAX_RETAINED_OBJECTS));
  });
});

describe('TrafficStore', () => {
  afterEach(() => {
    useRealClock();
  });

  it('read() after replace() returns the exact objects', () => {
    const store = new TrafficStore();
    const objects = [makeObj(1), makeObj(2)];

    store.replace(objects);

    expect(store.read()).toBe(objects);
  });

  it('read(now) at exactly now - receivedAt === TRAFFIC_STALE_MS is still fresh (inclusive)', () => {
    useFakeClock();
    const store = new TrafficStore();
    const objects = [makeObj(1)];

    store.replace(objects);
    const receivedAt = Date.now();

    expect(store.read(receivedAt + TRAFFIC_STALE_MS)).toBe(objects);
  });

  it('read(now) one ms past the threshold empties the store for good', () => {
    useFakeClock();
    const store = new TrafficStore();
    const objects = [makeObj(1)];

    store.replace(objects);
    const receivedAt = Date.now();

    expect(store.read(receivedAt + TRAFFIC_STALE_MS + 1)).toEqual([]);

    // A second read, even with a `now` that would NOT itself have crossed
    // the staleness threshold, still comes back empty — proving the
    // internal array was actually cleared on the first stale read, not
    // just filtered out for that one call.
    expect(store.read(receivedAt)).toEqual([]);
  });
});
