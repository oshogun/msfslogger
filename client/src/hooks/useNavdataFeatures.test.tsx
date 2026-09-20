import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type L from 'leaflet';
import { useNavdataFeatures, NAVDATA_DEBOUNCE_MS } from './useNavdataFeatures';
import { emptyFeatures } from '../test/navdataFixtures';

type Handler = () => void;

function fakeMap() {
  const handlers = new Set<Handler>();
  const map = {
    on: (_: string, h: Handler) => void handlers.add(h),
    off: (_: string, h: Handler) => void handlers.delete(h),
    getBounds: () => ({ getWest: () => 10, getSouth: () => 40, getEast: () => 20, getNorth: () => 50 }),
    getCenter: () => ({ lat: 45, lng: 15 }),
    getZoom: () => 9,
  };
  return { map: map as unknown as L.Map, move: () => handlers.forEach(h => h()), handlers };
}

interface Call { url: string; signal: AbortSignal; resolve: (r: Response) => void }

function stubFetch() {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      calls.push({ url, signal, resolve });
    })
  ));
  return calls;
}

const ok = () => new Response(JSON.stringify(emptyFeatures()), { status: 200 });

describe('useNavdataFeatures', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces a burst of moves into one request', async () => {
    const calls = stubFetch();
    const { map, move } = fakeMap();
    renderHook(() => useNavdataFeatures(map, ['airports'], true));
    for (let i = 0; i < 5; i++) {
      move();
      await act(() => vi.advanceTimersByTimeAsync(100));
    }
    expect(calls).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/navdata/features?bbox=');
    expect(calls[0].url).toContain('kinds=airports');
  });

  it('aborts the in-flight request when the next one starts, never overlapping', async () => {
    const calls = stubFetch();
    const { map, move } = fakeMap();
    renderHook(() => useNavdataFeatures(map, ['airports'], true));
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);

    move();
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);

    move();
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    expect(calls[1].signal.aborted).toBe(true);
    expect(calls.filter(c => !c.signal.aborted)).toHaveLength(1);
  });

  it('ignores an answer from an aborted request', async () => {
    const calls = stubFetch();
    const { map, move } = fakeMap();
    const { result } = renderHook(() => useNavdataFeatures(map, ['airports'], true));
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    move();
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    await act(async () => calls[0].resolve(ok()));
    expect(result.current.data).toBeNull();
    await act(async () => calls[1].resolve(ok()));
    expect(result.current.data).not.toBeNull();
    expect(result.current.anchor).toEqual([45, 15]);
  });

  it('does nothing while disabled and aborts on unmount', async () => {
    const calls = stubFetch();
    const { map, handlers } = fakeMap();
    const off = renderHook(() => useNavdataFeatures(map, ['airports'], false));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(calls).toHaveLength(0);
    expect(handlers.size).toBe(0);
    off.unmount();

    const on = renderHook(() => useNavdataFeatures(map, ['airports'], true));
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    on.unmount();
    expect(calls[0].signal.aborted).toBe(true);
    expect(handlers.size).toBe(0);
  });

  it('keeps the previous data on a busy 503 and retries once after Retry-After', async () => {
    const calls = stubFetch();
    const { map, move } = fakeMap();
    const { result } = renderHook(() => useNavdataFeatures(map, ['airports'], true));
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    await act(async () => calls[0].resolve(ok()));
    const before = result.current.data;

    move();
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    await act(async () => calls[1].resolve(new Response('{}', { status: 503, headers: { 'Retry-After': '3' } })));
    expect(result.current.data).toBe(before);
    expect(result.current.error).toBeNull();
    expect(calls).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(calls).toHaveLength(3);
    await act(async () => calls[2].resolve(new Response('{}', { status: 503, headers: { 'Retry-After': '3' } })));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(calls).toHaveLength(3);
  });

  it('surfaces a failed request as an error and keeps the data', async () => {
    const calls = stubFetch();
    const { map, move } = fakeMap();
    const { result } = renderHook(() => useNavdataFeatures(map, ['airports'], true));
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    await act(async () => calls[0].resolve(ok()));
    move();
    await act(() => vi.advanceTimersByTimeAsync(NAVDATA_DEBOUNCE_MS));
    await act(async () => calls[1].resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    expect(result.current.error).toBe('boom');
    expect(result.current.data).not.toBeNull();
  });
});
