// tests/geo.test.ts — tests src/geo.ts.
//
// smoke.test.ts already exercises haversineNm as a sanity check that Vitest
// runs TypeScript from src/ at all; this file is the real assertions for both
// exported functions.

import { describe, it, expect } from 'vitest';
import { haversineNm, bearingDeg } from '../src/geo';

describe('haversineNm', () => {
  it('matches a known distance: 1 degree of longitude at the equator', () => {
    expect(haversineNm(0, 0, 0, 1)).toBeCloseTo(60.040461, 5);
  });

  it('is antimeridian-safe: 179E to 179W is 2 degrees of longitude, not 358', () => {
    const crossing = haversineNm(0, 179, 0, -179);
    const twoDegrees = haversineNm(0, 0, 0, 2);

    expect(crossing).toBeCloseTo(twoDegrees, 6);
    expect(crossing).toBeLessThan(150); // nowhere near the 358-degree wrong answer
  });
});

describe('bearingDeg', () => {
  it('is ~0 degrees due north', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 5);
  });

  it('is ~90 degrees due east', () => {
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5);
  });

  it('normalizes a negative raw bearing (due west) into 0..360', () => {
    // atan2 alone would return -90 here; the function must add 360.
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 5);
  });
});
