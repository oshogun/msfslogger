import { describe, it, expect } from 'vitest';
import { paddedBbox } from './navdataApi';

const view = (west: number, south: number, east: number, north: number) => ({ west, south, east, north });

describe('paddedBbox', () => {
  it('pads a plain view by 20% on each side', () => {
    const [w, s, e, n] = paddedBbox(view(10, 40, 20, 50));
    expect([w, s, e, n]).toEqual([8, 38, 22, 52]);
  });

  it('folds a view panned past the dateline into [-180,180] with west > east', () => {
    const [w, , e] = paddedBbox(view(170, 0, 190, 10));
    expect(w).toBeCloseTo(166);
    expect(e).toBeCloseTo(-166);
    expect(w).toBeGreaterThan(e);
  });

  it('folds a view panned west of -180 the same way', () => {
    const [w, , e] = paddedBbox(view(-200, 0, -170, 10));
    expect(w).toBeGreaterThan(0);
    expect(e).toBeLessThan(0);
  });

  it('clamps a view of 360 degrees or more to the whole world', () => {
    const [w, , e] = paddedBbox(view(-300, -10, 300, 10));
    expect([w, e]).toEqual([-180, 180]);
  });

  it('clamps latitude', () => {
    const [, s, , n] = paddedBbox(view(0, -89, 10, 89));
    expect([s, n]).toEqual([-90, 90]);
  });
});
