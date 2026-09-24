import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithProviders';
import { mockFetchRoutes, deferred } from '../test/mockFetch';
import type { ResponseTuple } from '../test/mockFetch';
import { flightFixture } from '../test/fixtures';
import { Home } from './Home';

const SESSION_ROUTE: ResponseTuple = [200, { authenticated: true, user: { username: 'e2e' } }];
const IDLE_STATUS: ResponseTuple = [200, {
  connected: true, flightState: 'IDLE', currentFlightId: null, aircraft: null, frame: null, paused: false, pauseFlags: 0,
}];

describe('Home', () => {
  it('shows a loading state before the flights request resolves, then the real stats', async () => {
    const flights = deferred<ResponseTuple>();
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/status': IDLE_STATUS,
      '/api/flights': flights.handler,
      '/api/trips': [200, []],
      '/api/ground-sessions/current': [200, { session: null }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(<Home />);

    // Nothing has resolved yet: neither the empty state nor the stats have
    // rendered, only the loading skeleton.
    expect(screen.queryByText('No flights recorded yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Total flights')).not.toBeInTheDocument();

    flights.resolve([200, [flightFixture]]);

    await waitFor(() => expect(screen.getByText('Total flights')).toBeInTheDocument());
    expect(screen.queryByText('No flights recorded yet.')).not.toBeInTheDocument();
  });

  it('renders the empty state once the flights request resolves with none', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/status': IDLE_STATUS,
      '/api/flights': [200, []],
      '/api/trips': [200, []],
      '/api/ground-sessions/current': [200, { session: null }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(<Home />);

    await waitFor(() => expect(screen.getByText('No flights recorded yet.')).toBeInTheDocument());
    expect(screen.queryByText('Total flights')).not.toBeInTheDocument();
  });

  it('renders the flights-fetch error inline instead of the flight list', async () => {
    mockFetchRoutes({
      '/api/auth/session': SESSION_ROUTE,
      '/api/status': IDLE_STATUS,
      '/api/flights': [500, { error: 'Database is locked' }],
      '/api/trips': [200, []],
      '/api/ground-sessions/current': [200, { session: null }],
      '/api/planned-legs': [200, []],
    });

    renderWithProviders(<Home />);

    await waitFor(() => expect(screen.getByText('Database is locked')).toBeInTheDocument());
  });
});
