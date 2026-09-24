import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { mockFetchRoutes } from '../../test/mockFetch';
import type { ResponseTuple } from '../../test/mockFetch';
import { MockEventSource } from '../../test/mockEventSource';
import { LiveEventsProvider, LIVE_HANDLER_DEBOUNCE_MS } from '../../shell/LiveEventsProvider';
import type { GroundSession } from '../../types';
import { GroundSection } from './GroundSection';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];

const currentSessionFixture: GroundSession = {
  id: 31,
  source: 'auto',
  airport_icao: 'KSEA',
  airport_name: 'Seattle-Tacoma Intl',
  lat: 47.4436,
  lon: -122.3016,
  parking_position: 'GATE N 12',
  parking_position_source: 'auto',
  planned_leg_id: null,
  planned_leg_link_source: null,
  aircraft: 'FlyByWire A320neo',
  started_at: '2026-09-24T14:02:11.512Z',
  ended_at: null,
  ended_reason: null,
  flight_id: null,
  created_at: '2026-09-24T14:02:11.512Z',
  updated_at: '2026-09-24T14:02:11.512Z',
};

function fetchCallCount(): number {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
}

describe('GroundSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches getCurrentGroundSession exactly once for a flights-changed/flight-state pair from one write', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/ground-sessions/current': [200, { session: null }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(<LiveEventsProvider><GroundSection status={null} /></LiveEventsProvider>);
    await act(() => vi.advanceTimersByTimeAsync(0));

    const es = MockEventSource.latest();
    // Drain the reconnect-refetch the initial open already queues.
    act(() => { es.open(); });
    await act(() => vi.advanceTimersByTimeAsync(LIVE_HANDLER_DEBOUNCE_MS));

    const before = fetchCallCount();
    act(() => {
      es.emit('flights-changed', { flightId: 1 });
      es.emit('flight-state', { flightState: 'GROUND', currentFlightId: 1, plannedLegId: null });
    });

    // Still inside the debounce window: no refetch yet.
    await act(() => vi.advanceTimersByTimeAsync(LIVE_HANDLER_DEBOUNCE_MS - 1));
    expect(fetchCallCount()).toBe(before);

    await act(() => vi.advanceTimersByTimeAsync(1));
    // One refetch is one getCurrentGroundSession() call, not two.
    expect(fetchCallCount() - before).toBe(1);
  });

  it('still shows a resolved session under StrictMode (mount, cleanup, mount)', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/ground-sessions/current': [200, { session: currentSessionFixture }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(
      <StrictMode>
        <LiveEventsProvider><GroundSection status={null} /></LiveEventsProvider>
      </StrictMode>
    );
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Dev-mode StrictMode's mount-cleanup-remount must not leave the loader
    // permanently unable to commit state: the resolved session still renders,
    // not the "Not on the ground." fallback the dropped result would show.
    expect(screen.getByTestId('ground-card')).toBeInTheDocument();
    expect(screen.getByText('KSEA — Seattle-Tacoma Intl')).toBeInTheDocument();
    expect(screen.queryByText('Not on the ground.')).not.toBeInTheDocument();
  });
});
