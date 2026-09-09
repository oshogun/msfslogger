import { describe, expect, it } from 'vitest';
import { haversineNm } from '../src/geo';

describe('smoke: vitest runs TypeScript from this repo', () => {
  it('imports a real symbol from src/ and runs it', () => {
    // Same point twice: zero distance.
    expect(haversineNm(0, 0, 0, 0)).toBe(0);
  });

  it('computes a known great-circle distance (JFK -> LAX, ~2145 nm)', () => {
    const nm = haversineNm(40.6413, -73.7781, 33.9425, -118.4081);
    expect(nm).toBeGreaterThan(2100);
    expect(nm).toBeLessThan(2200);
  });
});
