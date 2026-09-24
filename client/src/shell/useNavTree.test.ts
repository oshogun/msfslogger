import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockFetchRoutes } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { MockEventSource } from '../test/mockEventSource';
import { LiveEventsProvider, LIVE_HANDLER_DEBOUNCE_MS } from './LiveEventsProvider';
import { notifyMutation } from '../api';
import { useNavTree } from './useNavTree';

const TRIPS_ROUTE: ResponseTuple = [200, []];
const FLIGHTS_ROUTE: ResponseTuple = [200, []];

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MemoryRouter, null, createElement(LiveEventsProvider, null, children));
}

function fetchCallCount(): number {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
}

/** Mounts the hook and drains both the mount-time load and the stream's own reconnect-on-open load. */
async function mountAndDrain() {
  mockFetchRoutes({ '/api/trips': TRIPS_ROUTE, '/api/flights': FLIGHTS_ROUTE });
  const hook = renderHook(() => useNavTree(), { wrapper });
  await act(() => vi.advanceTimersByTimeAsync(0));
  const es = MockEventSource.latest();
  act(() => { es.open(); });
  await act(() => vi.advanceTimersByTimeAsync(LIVE_HANDLER_DEBOUNCE_MS));
  return hook;
}

describe('useNavTree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads exactly once when a flights-changed event arrives', async () => {
    await mountAndDrain();
    const es = MockEventSource.latest();
    const before = fetchCallCount();

    act(() => { es.emit('flights-changed', { flightId: 1 }); });

    // Still inside the debounce window: no reload yet.
    await act(() => vi.advanceTimersByTimeAsync(LIVE_HANDLER_DEBOUNCE_MS - 1));
    expect(fetchCallCount()).toBe(before);

    await act(() => vi.advanceTimersByTimeAsync(1));
    // One reload is one listTrips() + one listFlights() call, not two of each.
    expect(fetchCallCount() - before).toBe(2);
  });

  it('reloads exactly once for a flights-changed and a flight-state event from one write', async () => {
    await mountAndDrain();
    const es = MockEventSource.latest();
    const before = fetchCallCount();

    act(() => {
      es.emit('flights-changed', { flightId: 1 });
      es.emit('flight-state', { flightState: 'GROUND', currentFlightId: 1, plannedLegId: null });
    });
    await act(() => vi.advanceTimersByTimeAsync(LIVE_HANDLER_DEBOUNCE_MS));

    expect(fetchCallCount() - before).toBe(2);
  });

  it('reloads once when the stream reconnects', async () => {
    mockFetchRoutes({ '/api/trips': TRIPS_ROUTE, '/api/flights': FLIGHTS_ROUTE });
    renderHook(() => useNavTree(), { wrapper });
    // Drain the mount-time load only; the stream has not opened yet.
    await act(() => vi.advanceTimersByTimeAsync(0));
    const before = fetchCallCount();

    const es = MockEventSource.latest();
    act(() => { es.open(); });
    await act(() => vi.advanceTimersByTimeAsync(LIVE_HANDLER_DEBOUNCE_MS));

    expect(fetchCallCount() - before).toBe(2);
  });

  it('still reloads, debounced, on a write notified through subscribeMutations', async () => {
    await mountAndDrain();
    const before = fetchCallCount();

    act(() => { notifyMutation(); });

    // MUTATION_DEBOUNCE_MS (150ms) hasn't elapsed yet.
    await act(() => vi.advanceTimersByTimeAsync(149));
    expect(fetchCallCount()).toBe(before);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchCallCount() - before).toBe(2);
  });

  it('still reloads immediately when the tab becomes visible again', async () => {
    await mountAndDrain();
    const before = fetchCallCount();

    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(fetchCallCount() - before).toBe(2);
  });
});
