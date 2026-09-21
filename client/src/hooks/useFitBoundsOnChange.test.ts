import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Map as LeafletMap } from 'leaflet';
import { useFitBoundsOnChange, pointsSignature } from './useFitBoundsOnChange';

type P = [number, number][];
const fakeMap = () => {
  const handlers: Record<string, (() => void)[]> = {};
  const emit = (names: string) => names.split(' ').forEach(n => (handlers[n] ?? []).forEach(h => h()));
  // Like Leaflet, a fit raises movestart/zoomstart synchronously.
  const fitBounds = vi.fn(() => emit('movestart zoomstart'));
  const map = {
    fitBounds,
    on: (names: string, h: () => void) => names.split(' ').forEach(n => (handlers[n] ??= []).push(h)),
    off: (names: string, h: () => void) =>
      names.split(' ').forEach(n => (handlers[n] = (handlers[n] ?? []).filter(x => x !== h))),
  } as unknown as LeafletMap;
  return { map, fitBounds, emit };
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

  it('stops refitting once the user has zoomed', () => {
    const { map, fitBounds, emit } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    act(() => emit('zoomstart movestart'));
    rerender({ pts: [...route(), [13, 23]] });
    rerender({ pts: [...route(), [13, 23], [14, 24]] });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('refits on content change when the user has not interacted', () => {
    const { map, fitBounds } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    rerender({ pts: [...route(), [13, 23]] });
    rerender({ pts: [...route(), [13, 23], [14, 24]] });
    expect(fitBounds).toHaveBeenCalledTimes(3);
  });

  it("does not count its own fitBounds as user interaction", () => {
    const { map, fitBounds } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    // The mount fit already raised movestart/zoomstart; a later change must still refit.
    rerender({ pts: [...route(), [13, 23]] });
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it('starts fresh on a new map instance', () => {
    const a = fakeMap();
    const b = fakeMap();
    const { rerender } = renderHook(({ m }) => useFitBoundsOnChange(m, route(), [30, 30]), {
      initialProps: { m: a.map },
    });
    act(() => a.emit('movestart'));
    rerender({ m: b.map });
    expect(b.fitBounds).toHaveBeenCalledTimes(1);
  });
});
