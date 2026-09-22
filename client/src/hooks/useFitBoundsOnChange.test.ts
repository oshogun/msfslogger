import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Map as LeafletMap } from 'leaflet';
import { useFitBoundsOnChange, pointsSignature } from './useFitBoundsOnChange';

type P = [number, number][];
const route = (): P => [[10, 20], [11, 21], [12, 22]];

const fakeMap = () => {
  const handlers: Record<string, (() => void)[]> = {};
  const emit = (names: string) => names.split(' ').forEach(n => (handlers[n] ?? []).forEach(h => h()));
  const container = document.createElement('div');
  // Like Leaflet's animated moves, a fit raises its start events in a later
  // frame, after fitBounds has already returned.
  const fitBounds = vi.fn((_bounds: unknown, _options: { padding: [number, number]; animate: boolean }) => {
    setTimeout(() => emit('movestart zoomstart'), 0);
    setTimeout(() => emit('moveend'), 250);
  });
  const map = {
    fitBounds,
    getContainer: () => container,
    on: (names: string, h: () => void) => names.split(' ').forEach(n => (handlers[n] ??= []).push(h)),
    off: (names: string, h: () => void) =>
      names.split(' ').forEach(n => (handlers[n] = (handlers[n] ?? []).filter(x => x !== h))),
  } as unknown as LeafletMap;
  const gesture = (type = 'mousedown') => container.dispatchEvent(new Event(type));
  return { map, fitBounds, emit, gesture };
};

describe('useFitBoundsOnChange', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fits once on mount', () => {
    const { map, fitBounds } = fakeMap();
    renderHook(() => useFitBoundsOnChange(map, route(), [30, 30]));
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(fitBounds.mock.calls[0][1]).toEqual({ padding: [30, 30], animate: false });
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
    const { map, fitBounds, emit, gesture } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { gesture('wheel'); emit('zoomstart movestart'); });
    rerender({ pts: [...route(), [13, 23]] });
    rerender({ pts: [...route(), [13, 23], [14, 24]] });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('counts a drag that starts long after the mouse went down', () => {
    const { map, fitBounds, emit, gesture } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { gesture('mousedown'); vi.advanceTimersByTime(5000); emit('movestart'); });
    rerender({ pts: [...route(), [13, 23]] });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('refits on content change when the user has not interacted', () => {
    const { map, fitBounds } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ pts: [...route(), [13, 23]] });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ pts: [...route(), [13, 23], [14, 24]] });
    expect(fitBounds).toHaveBeenCalledTimes(3);
  });

  it('does not count the late start events of its own fit as user interaction', () => {
    const { map, fitBounds } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    // The mount fit's movestart/zoomstart arrive after fitBounds returned.
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ pts: [...route(), [13, 23]] });
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it('does not count movement with no user gesture, such as a popup autopan', () => {
    const { map, fitBounds, emit } = fakeMap();
    const { rerender } = renderHook(({ pts }) => useFitBoundsOnChange(map, pts, [30, 30]), {
      initialProps: { pts: route() },
    });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { emit('movestart'); });
    rerender({ pts: [...route(), [13, 23]] });
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it('starts fresh on a new map instance', () => {
    const a = fakeMap();
    const b = fakeMap();
    const { rerender } = renderHook(({ m }) => useFitBoundsOnChange(m, route(), [30, 30]), {
      initialProps: { m: a.map },
    });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { a.gesture('wheel'); a.emit('movestart'); });
    rerender({ m: b.map });
    expect(b.fitBounds).toHaveBeenCalledTimes(1);
  });
});
