import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Map as LeafletMap } from 'leaflet';
import { useFitBoundsOnChange, pointsSignature } from './useFitBoundsOnChange';

type P = [number, number][];
const fakeMap = () => {
  const fitBounds = vi.fn();
  return { map: { fitBounds } as unknown as LeafletMap, fitBounds };
};
const route = (): P => [[10, 20], [11, 21], [12, 22]];

describe('useFitBoundsOnChange', () => {
  it('fits once on mount', () => {
    const { map, fitBounds } = fakeMap();
    renderHook(() => useFitBoundsOnChange(map, route(), [30, 30]));
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(fitBounds.mock.calls[0][1]).toEqual({ padding: [30, 30] });
  });

  it('does not refit when re-rendered with a new array of the same coordinates', () => {
    const { map, fitBounds } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    rerender({ pts: route() });
    rerender({ pts: route() });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('refits when the coordinates change', () => {
    const { map, fitBounds } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    rerender({ pts: [...route(), [13, 23]] });
    expect(fitBounds).toHaveBeenCalledTimes(2);
    rerender({ pts: [[50, 8], [51, 9]] });
    expect(fitBounds).toHaveBeenCalledTimes(3);
  });

  it('never fits an empty point set', () => {
    const { map, fitBounds } = fakeMap();
    renderHook(() => useFitBoundsOnChange(map, [], [30, 30]));
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('signature distinguishes order and values', () => {
    expect(pointsSignature([[1, 2], [3, 4]])).not.toBe(pointsSignature([[3, 4], [1, 2]]));
    expect(pointsSignature([[1, 2]])).toBe(pointsSignature([[1, 2]]));
  });
});
